-- Recursos operacionais gratuitos: aviso Pix manual, alertas em tempo real,
-- indisponibilidade/substituição, central de pendências e histórico de catálogo.
begin;

alter table public.trameli_products
  add column unavailable_from date,
  add column unavailable_until date,
  add column substitute_product_id uuid references public.trameli_products(id) on delete set null;

alter table public.trameli_products
  add constraint trameli_products_unavailable_period_check check (
    (unavailable_from is null and unavailable_until is null)
    or (unavailable_from is not null and unavailable_until is not null and unavailable_from <= unavailable_until)
  ),
  add constraint trameli_products_substitute_check check (substitute_product_id is distinct from id);

create index trameli_products_substitute_idx on public.trameli_products(substitute_product_id)
  where substitute_product_id is not null;

create table public.trameli_product_events (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.trameli_products(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_kind text not null check (event_kind in ('catalog','cost')),
  happened_at timestamptz not null default now(),
  before_state jsonb,
  after_state jsonb
);
create index trameli_product_events_product_time_idx
  on public.trameli_product_events(product_id,happened_at desc);
create index trameli_product_events_actor_idx on public.trameli_product_events(actor_id)
  where actor_id is not null;
alter table public.trameli_product_events enable row level security;
create policy product_events_operator_read on public.trameli_product_events for select to authenticated
  using ((select public.trameli_is_operator()));
revoke all on public.trameli_product_events from public,anon,authenticated;
grant select on public.trameli_product_events to authenticated;

create function public.trameli_audit_product() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='trameli_product_costs' then
    if tg_op='DELETE' then
      insert into public.trameli_product_events(product_id,actor_id,event_kind,before_state)
        values(old.product_id,auth.uid(),'cost',to_jsonb(old));
      return old;
    elsif tg_op='INSERT' then
      insert into public.trameli_product_events(product_id,actor_id,event_kind,after_state)
        values(new.product_id,auth.uid(),'cost',to_jsonb(new));
      return new;
    end if;
    insert into public.trameli_product_events(product_id,actor_id,event_kind,before_state,after_state)
      values(new.product_id,auth.uid(),'cost',to_jsonb(old),to_jsonb(new));
    return new;
  elsif tg_op='INSERT' then
    insert into public.trameli_product_events(product_id,actor_id,event_kind,after_state)
      values(new.id,auth.uid(),'catalog',to_jsonb(new));
    return new;
  end if;
  insert into public.trameli_product_events(product_id,actor_id,event_kind,before_state,after_state)
    values(new.id,auth.uid(),'catalog',to_jsonb(old),to_jsonb(new));
  return new;
end;
$$;
create trigger trameli_product_audit after insert or update on public.trameli_products
  for each row execute function public.trameli_audit_product();
create trigger trameli_product_cost_audit after insert or update or delete on public.trameli_product_costs
  for each row execute function public.trameli_audit_product();
revoke all on function public.trameli_audit_product() from public,anon,authenticated;

create function public.trameli_save_product_operational(
  p_id uuid,p_name text,p_category text,p_unit text,p_image_url text,
  p_price_cents integer,p_active boolean,p_cost_cents integer,p_supplier_name text,
  p_unavailable_from date,p_unavailable_until date,p_substitute_product_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.trameli_is_operator() then raise exception 'Acesso restrito à operação.' using errcode='42501'; end if;
  if (p_unavailable_from is null) <> (p_unavailable_until is null)
    or p_unavailable_from > p_unavailable_until then
    raise exception 'Informe o início e o fim da indisponibilidade.';
  end if;
  v_id:=public.trameli_save_product_full(p_id,p_name,p_category,p_unit,p_image_url,
    p_price_cents,p_active,p_cost_cents,p_supplier_name);
  if p_substitute_product_id=v_id or (p_substitute_product_id is not null and not exists(
    select 1 from public.trameli_products where id=p_substitute_product_id and active
  )) then raise exception 'Substituto inválido ou indisponível.'; end if;
  update public.trameli_products set unavailable_from=p_unavailable_from,
    unavailable_until=p_unavailable_until,substitute_product_id=p_substitute_product_id,
    updated_at=now() where id=v_id;
  return v_id;
end;
$$;
revoke all on function public.trameli_save_product_operational(uuid,text,text,text,text,integer,boolean,integer,text,date,date,uuid)
  from public,anon,authenticated;
grant execute on function public.trameli_save_product_operational(uuid,text,text,text,text,integer,boolean,integer,text,date,date,uuid)
  to authenticated;

-- A indisponibilidade também é validada no banco. A interface apenas sugere o
-- substituto; nunca troca um item escolhido pelo cliente silenciosamente.
create function public.trameli_validate_order_availability() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_item jsonb;v_name text;
begin
  if new.source='portal' and new.status<>'cancelled' then
    for v_item in select value from jsonb_array_elements(new.items) loop
      select p.name into v_name from public.trameli_products p
        where p.id=nullif(v_item->>'productId','')::uuid
          and p.unavailable_from is not null
          and new.delivery_date between p.unavailable_from and p.unavailable_until;
      if v_name is not null then
        raise exception 'Produto indisponível nessa data: %.',v_name using errcode='23514';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
create trigger trameli_order_availability before insert or update of items,delivery_date,status
  on public.trameli_orders for each row execute function public.trameli_validate_order_availability();
revoke all on function public.trameli_validate_order_availability() from public,anon,authenticated;

create table public.trameli_payment_intents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  customer_id uuid not null references auth.users(id) on delete cascade,
  order_ids uuid[] not null check (cardinality(order_ids) between 1 and 100),
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create index trameli_payment_intents_customer_idx on public.trameli_payment_intents(customer_id,created_at desc);
create index trameli_payment_intents_pending_idx on public.trameli_payment_intents(created_at)
  where status='pending';
create index trameli_payment_intents_resolved_by_idx on public.trameli_payment_intents(resolved_by)
  where resolved_by is not null;
alter table public.trameli_payment_intents enable row level security;
create policy payment_intents_read on public.trameli_payment_intents for select to authenticated
  using (customer_id=(select auth.uid()) or (select public.trameli_is_operator()));
revoke all on public.trameli_payment_intents from public,anon,authenticated;
grant select on public.trameli_payment_intents to authenticated;

create function public.trameli_signal_pix_payment(p_request_id uuid,p_order_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_id uuid;v_order_id uuid;v_due bigint;v_total bigint:=0;v_clean uuid[];
begin
  if v_user is null then raise exception 'Login necessário.' using errcode='42501'; end if;
  if p_request_id is null or p_order_ids is null or cardinality(p_order_ids) not between 1 and 100 then
    raise exception 'Selecione de 1 a 100 pedidos.';
  end if;
  select array_agg(distinct x order by x) into v_clean from unnest(p_order_ids) x;
  if cardinality(v_clean)<>cardinality(p_order_ids) then raise exception 'Pedidos repetidos.'; end if;
  select id into v_id from public.trameli_payment_intents
    where request_id=p_request_id and customer_id=v_user;
  if v_id is not null then return v_id; end if;
  for v_order_id in select unnest(v_clean) loop
    select total_cents into v_due from public.trameli_orders
      where id=v_order_id and customer_id=v_user and status<>'cancelled' for update;
    if v_due is null then raise exception 'Pedido inexistente ou cancelado.'; end if;
    select greatest(v_due-coalesce(sum(case when p.kind='receipt' then a.amount_cents else -a.amount_cents end),0),0)
      into v_due from public.trameli_payment_allocations a
      join public.trameli_payments p on p.id=a.payment_id where a.order_id=v_order_id;
    if v_due=0 then raise exception 'Pedido sem saldo.'; end if;
    v_total:=v_total+v_due;
  end loop;
  insert into public.trameli_payment_intents(request_id,customer_id,order_ids,amount_cents)
    values(p_request_id,v_user,v_clean,v_total)
    on conflict(request_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.trameli_payment_intents where request_id=p_request_id and customer_id=v_user;
    if v_id is null then raise exception 'Identificador já utilizado.'; end if;
  end if;
  return v_id;
end;
$$;

create function public.trameli_resolve_payment_intent(p_intent_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.trameli_is_operator() then raise exception 'Acesso restrito à operação.' using errcode='42501'; end if;
  if p_status not in ('reviewed','dismissed') then raise exception 'Situação inválida.'; end if;
  update public.trameli_payment_intents set status=p_status,resolved_at=now(),resolved_by=auth.uid()
    where id=p_intent_id and status='pending';
  if not found then raise exception 'Aviso já tratado ou inexistente.'; end if;
end;
$$;
revoke all on function public.trameli_signal_pix_payment(uuid,uuid[]),
  public.trameli_resolve_payment_intent(uuid,text) from public,anon,authenticated;
grant execute on function public.trameli_signal_pix_payment(uuid,uuid[]),
  public.trameli_resolve_payment_intent(uuid,text) to authenticated;

-- Corrige os avisos de desempenho atuais sem remover índices úteis de uma base ainda pequena.
create index trameli_access_events_actor_idx on public.trameli_access_events(actor_id) where actor_id is not null;
create index trameli_access_events_target_idx on public.trameli_access_events(target_id) where target_id is not null;
create index trameli_daily_closings_actor_idx on public.trameli_daily_closings(actor_id) where actor_id is not null;
create index trameli_favorites_product_idx on public.trameli_favorites(product_id);
create index trameli_order_events_actor_idx on public.trameli_order_events(actor_id) where actor_id is not null;
create index trameli_payment_allocations_actor_idx on public.trameli_payment_allocations(actor_id) where actor_id is not null;
create index trameli_payments_actor_idx on public.trameli_payments(actor_id) where actor_id is not null;
create index trameli_pix_settings_events_actor_idx on public.trameli_pix_settings_events(actor_id) where actor_id is not null;

drop policy allocation_read on public.trameli_payment_allocations;
create policy allocation_read on public.trameli_payment_allocations for select to authenticated
  using ((select public.trameli_is_operator()) or exists(
    select 1 from public.trameli_orders o where o.id=order_id and o.customer_id=(select auth.uid())));
drop policy own_favorites on public.trameli_favorites;
create policy own_favorites on public.trameli_favorites for select to authenticated
  using(user_id=(select auth.uid()));
drop policy product_public_read on public.trameli_products;
drop policy product_operator_read on public.trameli_products;
create policy product_read on public.trameli_products for select to anon,authenticated
  using(active or (select public.trameli_is_operator()));

do $realtime$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trameli_orders') then
      alter publication supabase_realtime add table public.trameli_orders;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trameli_payment_intents') then
      alter publication supabase_realtime add table public.trameli_payment_intents;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trameli_products') then
      alter publication supabase_realtime add table public.trameli_products;
    end if;
  end if;
end
$realtime$;

notify pgrst,'reload schema';
commit;
