-- Trilha de eventos do portal para investigar problemas no registro de pedidos.
-- Sem IP, navegador, campos digitados, enderecos ou textos livres.
-- Hora autoritativa do servidor; os clientes nao podem reescrever os eventos.
create table if not exists public.trameli_portal_activity (
  id bigint generated always as identity primary key,
  customer_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  event_type text not null check (event_type in (
    'portal_open','catalog_view','product_view','cart_add','cart_remove','favorite_toggle',
    'cart_open','checkout_open','checkout_attempt','checkout_blocked','checkout_failed','checkout_saved',
    'orders_open','weekly_open','weekly_day','weekly_product','weekly_checkout_attempt',
    'weekly_checkout_blocked','weekly_checkout_failed','weekly_checkout_saved','category_select','filter_select'
  )),
  product_id uuid,
  quantity integer check (quantity is null or quantity between 0 and 999),
  delivery_date date,
  request_id uuid,
  order_id uuid,
  reason text check (reason is null or reason in (
    'after_21','before_06','cutoff_delivery','sunday','overdue','account_blocked',
    'duplicate','invalid_fields','empty_cart','rpc_rejected','network_error',
    'client_error','unknown','success'
  )),
  occurred_at timestamptz not null default now(),
  constraint trameli_activity_product_required check (
    event_type not in ('product_view','cart_add','cart_remove','favorite_toggle','weekly_product')
    or product_id is not null
  )
);
create index if not exists trameli_portal_activity_customer_date_idx
  on public.trameli_portal_activity(customer_id,occurred_at desc);
create index if not exists trameli_portal_activity_date_idx
  on public.trameli_portal_activity(occurred_at desc);
create index if not exists trameli_portal_activity_checkout_idx
  on public.trameli_portal_activity(occurred_at desc)
  where event_type in ('checkout_attempt','checkout_blocked','checkout_failed','checkout_saved','weekly_checkout_attempt','weekly_checkout_blocked','weekly_checkout_failed','weekly_checkout_saved');

alter table public.trameli_portal_activity enable row level security;
revoke all on public.trameli_portal_activity from public,anon,authenticated;
-- Somente os campos estritamente necessarios podem ser enviados pelo cliente.
grant insert (customer_id,session_id,event_type,product_id,quantity,delivery_date,request_id,order_id,reason)
  on public.trameli_portal_activity to authenticated;
grant select on public.trameli_portal_activity to authenticated;
grant usage,select on sequence public.trameli_portal_activity_id_seq to authenticated;

create policy trameli_portal_activity_insert_self
  on public.trameli_portal_activity for insert to authenticated
  with check (customer_id = (select auth.uid()));
create policy trameli_portal_activity_operator_read
  on public.trameli_portal_activity for select to authenticated
  using (public.trameli_is_operator());
-- Nenhuma politica UPDATE ou DELETE para o navegador: trilha somente append.

-- Retencao limitada a 60 dias, excluindo registros antigos diariamente.
select cron.schedule('trameli-portal-activity-retention', '25 4 * * *',
  $$delete from public.trameli_portal_activity where occurred_at < now() - interval '60 days'$$);
notify pgrst,'reload schema';
