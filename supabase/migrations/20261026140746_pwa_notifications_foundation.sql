-- Pão Doce Delivery — PWA / Web Push foundation.
-- Applied to production as migration 20261026140746.

create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create table if not exists public.trameli_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  platform text not null default 'web'
    check (platform in ('web','android','ios','desktop','unknown')),
  user_agent text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (char_length(endpoint) between 20 and 4096),
  check (char_length(p256dh) between 20 and 512),
  check (char_length(auth_secret) between 8 and 256),
  check (char_length(user_agent) <= 700)
);

create index if not exists trameli_push_subscriptions_user_idx
  on public.trameli_push_subscriptions(user_id) where enabled;

alter table public.trameli_push_subscriptions enable row level security;

drop policy if exists push_subscription_read_own on public.trameli_push_subscriptions;
create policy push_subscription_read_own
  on public.trameli_push_subscriptions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.trameli_notifications (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  kind text not null default 'manual'
    check (kind in ('manual','system','reminder')),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  body text not null check (char_length(btrim(body)) between 2 and 360),
  url text not null default '/#loja' check (char_length(url) between 1 and 700),
  audience text not null default 'selected'
    check (audience in ('all','selected','operators','order_tomorrow','payment_pending','system')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  dedupe_key text unique,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','partial','failed')),
  target_count integer not null default 0 check (target_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dispatch_started_at timestamptz,
  sent_at timestamptz
);

create index if not exists trameli_notifications_created_idx
  on public.trameli_notifications(created_at desc);
create index if not exists trameli_notifications_status_idx
  on public.trameli_notifications(status,created_at);

create table if not exists public.trameli_notification_recipients (
  notification_id uuid not null references public.trameli_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivery_status text not null default 'queued'
    check (delivery_status in ('queued','sent','failed','no_subscription')),
  delivered_at timestamptz,
  read_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  primary key (notification_id,user_id)
);

create index if not exists trameli_notification_recipients_user_idx
  on public.trameli_notification_recipients(user_id,created_at desc);
create index if not exists trameli_notification_recipients_queue_idx
  on public.trameli_notification_recipients(notification_id,delivery_status);

alter table public.trameli_notifications enable row level security;
alter table public.trameli_notification_recipients enable row level security;

drop policy if exists notification_read_recipient_or_operator on public.trameli_notifications;
create policy notification_read_recipient_or_operator
  on public.trameli_notifications
  for select to authenticated
  using (
    public.trameli_is_operator()
    or exists (
      select 1 from public.trameli_notification_recipients r
      where r.notification_id=id and r.user_id=(select auth.uid())
    )
  );

drop policy if exists notification_recipient_read on public.trameli_notification_recipients;
create policy notification_recipient_read
  on public.trameli_notification_recipients
  for select to authenticated
  using (user_id=(select auth.uid()) or public.trameli_is_operator());

grant select on public.trameli_push_subscriptions to authenticated;
grant select on public.trameli_notifications to authenticated;
grant select on public.trameli_notification_recipients to authenticated;
grant all on public.trameli_push_subscriptions to service_role;
grant all on public.trameli_notifications to service_role;
grant all on public.trameli_notification_recipients to service_role;

create or replace function public.trameli_upsert_push_subscription(
  p_endpoint text,p_p256dh text,p_auth text,p_platform text default 'web',p_user_agent text default ''
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_platform text;
begin
  if v_user is null then raise exception 'login required' using errcode='42501'; end if;
  v_platform:=case when p_platform in ('web','android','ios','desktop','unknown') then p_platform else 'unknown' end;
  if p_endpoint is null or p_endpoint !~ '^https://'
    or char_length(p_endpoint) not between 20 and 4096
    or char_length(coalesce(p_p256dh,'')) not between 20 and 512
    or char_length(coalesce(p_auth,'')) not between 8 and 256
    or char_length(coalesce(p_user_agent,''))>700
  then raise exception 'invalid push subscription' using errcode='22023'; end if;

  insert into public.trameli_push_subscriptions(
    user_id,endpoint,p256dh,auth_secret,platform,user_agent,enabled,updated_at,last_seen_at,revoked_at
  ) values (
    v_user,p_endpoint,p_p256dh,p_auth,v_platform,coalesce(p_user_agent,''),true,now(),now(),null
  )
  on conflict(endpoint) do update set
    user_id=excluded.user_id,p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,
    platform=excluded.platform,user_agent=excluded.user_agent,enabled=true,
    updated_at=now(),last_seen_at=now(),revoked_at=null
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.trameli_upsert_push_subscription(text,text,text,text,text) from public;
grant execute on function public.trameli_upsert_push_subscription(text,text,text,text,text) to authenticated;

create or replace function public.trameli_disable_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path to ''
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'login required' using errcode='42501'; end if;
  update public.trameli_push_subscriptions
    set enabled=false,revoked_at=now(),updated_at=now()
    where endpoint=p_endpoint and user_id=v_user;
end $$;

revoke all on function public.trameli_disable_push_subscription(text) from public;
grant execute on function public.trameli_disable_push_subscription(text) to authenticated;

create or replace function public.trameli_mark_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path to ''
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'login required' using errcode='42501'; end if;
  update public.trameli_notification_recipients set read_at=coalesce(read_at,now())
  where notification_id=p_notification_id and user_id=v_user;
end $$;

revoke all on function public.trameli_mark_notification_read(uuid) from public;
grant execute on function public.trameli_mark_notification_read(uuid) to authenticated;

create or replace function public.trameli_unread_notification_count()
returns integer language sql stable security invoker set search_path to ''
as $$
  select count(*)::integer
  from public.trameli_notification_recipients
  where user_id=(select auth.uid()) and read_at is null;
$$;

revoke all on function public.trameli_unread_notification_count() from public;
grant execute on function public.trameli_unread_notification_count() to authenticated;

create or replace function public.trameli_notification_inbox(p_limit integer default 50)
returns table(
  id uuid,title text,body text,url text,kind text,created_at timestamptz,sent_at timestamptz,
  delivery_status text,read_at timestamptz
)
language sql stable security invoker set search_path to ''
as $$
  select n.id,n.title,n.body,n.url,n.kind,n.created_at,n.sent_at,r.delivery_status,r.read_at
  from public.trameli_notification_recipients r
  join public.trameli_notifications n on n.id=r.notification_id
  where r.user_id=(select auth.uid())
  order by n.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;

revoke all on function public.trameli_notification_inbox(integer) from public;
grant execute on function public.trameli_notification_inbox(integer) to authenticated;

create or replace function public.trameli_create_notification(
  p_title text,p_body text,p_url text default '/#loja',
  p_audience text default 'all',p_customer_ids uuid[] default null
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_id uuid; v_count integer; v_tomorrow date:=((now() at time zone 'America/Sao_Paulo')::date+1);
begin
  if not public.trameli_is_operator() then raise exception 'operator access required' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 2 and 80
    or char_length(btrim(coalesce(p_body,''))) not between 2 and 360
    or char_length(coalesce(p_url,'/#loja')) not between 1 and 700
    or p_audience not in ('all','selected','operators','order_tomorrow','payment_pending')
  then raise exception 'invalid notification' using errcode='22023'; end if;
  if p_audience='selected' and coalesce(cardinality(p_customer_ids),0)=0
  then raise exception 'select at least one customer' using errcode='22023'; end if;

  insert into public.trameli_notifications(created_by,kind,title,body,url,audience,metadata)
  values(auth.uid(),'manual',btrim(p_title),btrim(p_body),coalesce(nullif(p_url,''),'/#loja'),
    p_audience,jsonb_build_object('source','operator')) returning id into v_id;

  if p_audience='operators' then
    insert into public.trameli_notification_recipients(notification_id,user_id)
      select v_id,o.user_id from public.trameli_operators o on conflict do nothing;
  elsif p_audience='selected' then
    insert into public.trameli_notification_recipients(notification_id,user_id)
      select v_id,p.user_id from public.trameli_profiles p
      where p.user_id=any(p_customer_ids)
        and not exists(select 1 from public.trameli_operators o where o.user_id=p.user_id)
      on conflict do nothing;
  elsif p_audience='order_tomorrow' then
    insert into public.trameli_notification_recipients(notification_id,user_id)
      select distinct v_id,o.customer_id from public.trameli_orders o
      where o.customer_id is not null and o.delivery_date=v_tomorrow and o.status<>'cancelled'
      on conflict do nothing;
  elsif p_audience='payment_pending' then
    insert into public.trameli_notification_recipients(notification_id,user_id)
      select distinct v_id,b.customer_id from public.trameli_payment_balances() b
      where b.customer_id is not null and b.due_cents>0 on conflict do nothing;
  else
    insert into public.trameli_notification_recipients(notification_id,user_id)
      select v_id,p.user_id from public.trameli_profiles p
      where not exists(select 1 from public.trameli_operators o where o.user_id=p.user_id)
      on conflict do nothing;
  end if;

  select count(*)::integer into v_count from public.trameli_notification_recipients where notification_id=v_id;
  update public.trameli_notifications set target_count=v_count,
    status=case when v_count=0 then 'failed' else 'queued' end,updated_at=now()
  where id=v_id;
  return v_id;
end $$;

revoke all on function public.trameli_create_notification(text,text,text,text,uuid[]) from public;
grant execute on function public.trameli_create_notification(text,text,text,text,uuid[]) to authenticated;

create or replace function public.trameli_claim_notification(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path to ''
as $$
begin
  update public.trameli_notifications
    set status='sending',dispatch_started_at=now(),updated_at=now()
  where id=p_notification_id and
    (status='queued' or (status='sending' and dispatch_started_at<now()-interval '10 minutes'));
  return found;
end $$;

revoke all on function public.trameli_claim_notification(uuid) from public,anon,authenticated;
grant execute on function public.trameli_claim_notification(uuid) to service_role;

create or replace function public.trameli_push_vapid_config()
returns table(public_key text,private_key text,subject text)
language sql stable security definer set search_path to ''
as $$
  select
    max(case when name='trameli_vapid_public_key' then decrypted_secret end),
    max(case when name='trameli_vapid_private_key' then decrypted_secret end),
    max(case when name='trameli_vapid_subject' then decrypted_secret end)
  from vault.decrypted_secrets
  where name in ('trameli_vapid_public_key','trameli_vapid_private_key','trameli_vapid_subject');
$$;

revoke all on function public.trameli_push_vapid_config() from public,anon,authenticated;
grant execute on function public.trameli_push_vapid_config() to service_role;

create or replace function public.trameli_queue_daily_order_reminders()
returns uuid language plpgsql security definer set search_path to ''
as $$
declare
  v_delivery date:=(now() at time zone 'America/Sao_Paulo')::date+1;
  v_key text:='daily-order-reminder:'||v_delivery::text;
  v_id uuid; v_count integer;
begin
  if extract(isodow from v_delivery)=7 then return null; end if;
  insert into public.trameli_notifications(kind,title,body,url,audience,metadata,dedupe_key)
  values('reminder','Vai querer pão amanhã? 🍞',
    'Você costuma pedir neste dia e ainda não fez o pedido de amanhã. Os pedidos ficam abertos até às 21h.',
    '/?portal=catalog#loja','system',jsonb_build_object('deliveryDate',v_delivery,'reminder','usual-order'),v_key)
  on conflict(dedupe_key) do nothing returning id into v_id;
  if v_id is null then return null; end if;

  with frequent as (
    select o.customer_id from public.trameli_orders o
    where o.customer_id is not null and o.status<>'cancelled'
      and o.delivery_date>=v_delivery-90 and o.delivery_date<v_delivery
      and extract(isodow from o.delivery_date)=extract(isodow from v_delivery)
    group by o.customer_id having count(*)>=2
  )
  insert into public.trameli_notification_recipients(notification_id,user_id)
  select v_id,f.customer_id from frequent f
  where not exists(select 1 from public.trameli_orders o
    where o.customer_id=f.customer_id and o.delivery_date=v_delivery and o.status<>'cancelled')
    and exists(select 1 from public.trameli_push_subscriptions s where s.user_id=f.customer_id and s.enabled)
  on conflict do nothing;

  select count(*)::integer into v_count from public.trameli_notification_recipients where notification_id=v_id;
  if v_count=0 then delete from public.trameli_notifications where id=v_id; return null; end if;
  update public.trameli_notifications set target_count=v_count,updated_at=now() where id=v_id;
  return v_id;
end $$;

revoke all on function public.trameli_queue_daily_order_reminders() from public,anon,authenticated;
grant execute on function public.trameli_queue_daily_order_reminders() to service_role;

create or replace function public.trameli_queue_payment_reminders()
returns integer language plpgsql security definer set search_path to ''
as $$
declare
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
  v_row record; v_id uuid; v_kind text; v_key text; v_amount text; v_created integer:=0;
begin
  for v_row in
    with payment_sums as (
      select a.order_id,
        coalesce(sum(a.amount_cents) filter(where p.kind='receipt'),0)::bigint
        -coalesce(sum(a.amount_cents) filter(where p.kind='refund'),0)::bigint as paid_cents
      from public.trameli_payment_allocations a join public.trameli_payments p on p.id=a.payment_id
      group by a.order_id
    ), due_orders as (
      select o.customer_id,greatest(o.total_cents-coalesce(ps.paid_cents,0),0)::bigint due_cents,
        case when pr.billing_frequency='mensal'
          then (date_trunc('month',o.delivery_date)::date+interval '1 month - 1 day')::date
        when pr.billing_frequency='quinzenal' and extract(day from o.delivery_date)<=15
          then date_trunc('month',o.delivery_date)::date+14
        when pr.billing_frequency='quinzenal'
          then (date_trunc('month',o.delivery_date)::date+interval '1 month - 1 day')::date
        else null end closing_date
      from public.trameli_orders o join public.trameli_profiles pr on pr.user_id=o.customer_id
      left join payment_sums ps on ps.order_id=o.id
      where o.customer_id is not null and o.status<>'cancelled'
        and pr.billing_frequency in ('quinzenal','mensal')
    )
    select customer_id,closing_date,sum(due_cents)::bigint due_cents
    from due_orders where due_cents>0 and closing_date in (v_today,v_today-3)
    group by customer_id,closing_date
  loop
    if not exists(select 1 from public.trameli_push_subscriptions s where s.user_id=v_row.customer_id and s.enabled)
    then continue; end if;
    v_kind:=case when v_row.closing_date=v_today then 'closing' else 'grace' end;
    v_key:='payment-reminder:'||v_row.customer_id::text||':'||v_row.closing_date::text||':'||v_kind;
    v_amount:=replace(to_char(v_row.due_cents::numeric/100,'FM999999990D00'),'.',',');
    insert into public.trameli_notifications(kind,title,body,url,audience,metadata,dedupe_key)
    values('reminder',
      case when v_kind='closing' then 'Seu fechamento está pronto 💳' else 'Último dia para pagar' end,
      case when v_kind='closing'
        then 'Há R$ '||v_amount||' em aberto neste fechamento. Veja os detalhes no Pão Doce.'
        else 'Seu prazo de 3 dias termina hoje. Há R$ '||v_amount||' em aberto; evite o bloqueio de novos pedidos.' end,
      '/?portal=orders#loja','system',
      jsonb_build_object('customerId',v_row.customer_id,'closingDate',v_row.closing_date,'dueCents',v_row.due_cents,'reminder',v_kind),
      v_key)
    on conflict(dedupe_key) do nothing returning id into v_id;
    if v_id is not null then
      insert into public.trameli_notification_recipients(notification_id,user_id)
      values(v_id,v_row.customer_id) on conflict do nothing;
      update public.trameli_notifications set target_count=1,updated_at=now() where id=v_id;
      v_created:=v_created+1;
    end if;
    v_id:=null;
  end loop;
  return v_created;
end $$;

revoke all on function public.trameli_queue_payment_reminders() from public,anon,authenticated;
grant execute on function public.trameli_queue_payment_reminders() to service_role;

do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name='trameli_project_url';
  if v_id is null then
    perform vault.create_secret('https://rwxwcyerhqcprarjptak.supabase.co','trameli_project_url','Pão Doce Edge Function URL base');
  else
    perform vault.update_secret(v_id,'https://rwxwcyerhqcprarjptak.supabase.co','trameli_project_url','Pão Doce Edge Function URL base');
  end if;
end $$;

select cron.schedule('trameli-order-reminders','0 21 * * *','select public.trameli_queue_daily_order_reminders();');
select cron.schedule('trameli-payment-reminders','0 12 * * *','select public.trameli_queue_payment_reminders();');
