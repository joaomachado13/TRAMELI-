-- Trameli production foundation. Apply to a NEW Supabase project, never to a populated database.
-- Prices, totals, authorization and the audit trail are enforced in Postgres.
begin;
create extension if not exists pgcrypto;

create type public.trameli_order_status as enum
  ('received', 'confirmed', 'packing', 'ready', 'delivered', 'cancelled');
create type public.trameli_order_source as enum ('portal', 'operator');

create table public.trameli_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.trameli_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 90),
  phone text not null default '' check (char_length(phone) <= 25),
  address text not null check (char_length(btrim(address)) between 3 and 180),
  updated_at timestamptz not null default now()
);
create table public.trameli_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 90),
  category text not null default 'Padaria',
  unit text not null default 'unidade',
  image_url text,
  price_cents integer not null check (price_cents >= 0 and price_cents <= 100000000),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.trameli_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete set null,
  source public.trameli_order_source not null,
  request_id uuid unique,
  status public.trameli_order_status not null default 'received',
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 90),
  phone text not null default '' check (char_length(phone) <= 25),
  address text not null check (char_length(btrim(address)) between 3 and 180),
  delivery_date date not null,
  notes text not null default '' check (char_length(notes) <= 280),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  fee_cents integer not null check (fee_cents >= 0 and fee_cents <= 100000000),
  total_cents bigint generated always as (subtotal_cents + fee_cents) stored,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trameli_orders_delivery_idx on public.trameli_orders(delivery_date, created_at);
create index trameli_orders_customer_idx on public.trameli_orders(customer_id, created_at desc);
create table public.trameli_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.trameli_orders(id),
  actor_id uuid references auth.users(id) on delete set null,
  happened_at timestamptz not null default now(),
  before_state jsonb,
  after_state jsonb not null
);
create index trameli_order_events_order_idx on public.trameli_order_events(order_id, happened_at);

create function public.trameli_is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trameli_operators where user_id = (select auth.uid()));
$$;

alter table public.trameli_operators enable row level security;
alter table public.trameli_profiles enable row level security;
alter table public.trameli_products enable row level security;
alter table public.trameli_orders enable row level security;
alter table public.trameli_order_events enable row level security;

create policy operator_self on public.trameli_operators for select to authenticated
  using (user_id = (select auth.uid()));
create policy profile_read on public.trameli_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.trameli_is_operator());
create policy product_public_read on public.trameli_products for select to anon, authenticated
  using (active);
create policy product_operator_read on public.trameli_products for select to authenticated
  using (public.trameli_is_operator());
create policy order_read on public.trameli_orders for select to authenticated
  using (customer_id = (select auth.uid()) or public.trameli_is_operator());
create policy event_read on public.trameli_order_events for select to authenticated
  using (public.trameli_is_operator());

-- No direct client writes: all mutations pass through validated RPCs below.
revoke all on public.trameli_operators, public.trameli_profiles,
  public.trameli_products, public.trameli_orders, public.trameli_order_events
  from anon, authenticated;
grant select on public.trameli_operators, public.trameli_profiles,
  public.trameli_products, public.trameli_orders, public.trameli_order_events
  to authenticated;
grant select on public.trameli_products to anon;

create function public.trameli_audit_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trameli_order_events(order_id, actor_id, before_state, after_state)
  values (new.id, auth.uid(), case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$$;
create trigger trameli_order_audit after insert or update on public.trameli_orders
for each row execute function public.trameli_audit_order();

-- Operator role is assigned by a trusted administrator in the SQL editor, never by the app.
create function public.trameli_save_product(
  p_id uuid, p_name text, p_category text, p_unit text,
  p_image_url text, p_price_cents integer, p_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.trameli_is_operator() then raise exception 'operator access required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 90
     or p_price_cents not between 0 and 100000000 then
    raise exception 'invalid product';
  end if;
  if p_id is null then
    insert into public.trameli_products(name, category, unit, image_url, price_cents, active)
    values (btrim(p_name), left(coalesce(p_category,'Padaria'), 60),
      left(coalesce(p_unit,'unidade'), 30), p_image_url, p_price_cents, coalesce(p_active,true))
    returning id into v_id;
  else
    update public.trameli_products set name = btrim(p_name), category = left(coalesce(p_category,'Padaria'),60),
      unit = left(coalesce(p_unit,'unidade'),30), image_url = p_image_url,
      price_cents = p_price_cents, active = coalesce(p_active,true), updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'product not found'; end if;
  end if;
  return v_id;
end;
$$;

-- Resolve catalog lines on the server; browser-submitted prices are ignored.
create function public.trameli_customer_order(
  p_order_id uuid, p_request_id uuid, p_expected_version integer, p_delivery_date date,
  p_name text, p_phone text, p_address text, p_notes text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_order public.trameli_orders%rowtype;
  v_line jsonb; v_product public.trameli_products%rowtype;
  v_qty integer; v_items jsonb := '[]'::jsonb; v_subtotal bigint := 0; v_id uuid;
begin
  if v_user is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_delivery_date < (now() at time zone 'America/Sao_Paulo')::date
    or p_delivery_date > (now() at time zone 'America/Sao_Paulo')::date + 90
    or char_length(btrim(coalesce(p_name,''))) not between 2 and 90
    or char_length(btrim(coalesce(p_address,''))) not between 3 and 180
    or char_length(coalesce(p_phone,'')) > 25 or char_length(coalesce(p_notes,'')) > 280
    or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'invalid order';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' or (v_line->>'quantity') !~ '^[0-9]{1,2}$' then
      raise exception 'invalid order line';
    end if;
    v_qty := (v_line->>'quantity')::integer;
    if v_qty not between 1 and 99 then raise exception 'invalid quantity'; end if;
    select * into v_product from public.trameli_products
      where id = (v_line->>'product_id')::uuid and active;
    if not found then raise exception 'product unavailable'; end if;
    v_subtotal := v_subtotal + v_qty::bigint * v_product.price_cents;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id, 'name', v_product.name,
      'quantity', v_qty, 'priceCents', v_product.price_cents));
  end loop;
  insert into public.trameli_profiles(user_id, name, phone, address)
    values (v_user, btrim(p_name), coalesce(p_phone,''), btrim(p_address))
    on conflict (user_id) do update set name = excluded.name, phone = excluded.phone,
      address = excluded.address, updated_at = now();
  if p_order_id is null then
    if p_request_id is null then raise exception 'request id required'; end if;
    select id into v_id from public.trameli_orders
      where request_id = p_request_id and customer_id = v_user;
    if v_id is not null then return v_id; end if;
    insert into public.trameli_orders(customer_id, source, request_id, customer_name, phone, address,
      delivery_date, notes, items, subtotal_cents, fee_cents)
    values (v_user, 'portal', p_request_id, btrim(p_name), coalesce(p_phone,''), btrim(p_address),
      p_delivery_date, coalesce(p_notes,''), v_items, v_subtotal, 200)
    on conflict (request_id) do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.trameli_orders
        where request_id = p_request_id and customer_id = v_user;
      if v_id is null then raise exception 'request id already used'; end if;
    end if;
  else
    select * into v_order from public.trameli_orders where id = p_order_id for update;
    if not found or v_order.customer_id is distinct from v_user or v_order.source <> 'portal'
      or v_order.status <> 'received' or v_order.delivery_date < (now() at time zone 'America/Sao_Paulo')::date
      or v_order.version is distinct from p_expected_version then
      raise exception 'order changed or cannot be edited';
    end if;
    update public.trameli_orders set customer_name = btrim(p_name), phone = coalesce(p_phone,''),
      address = btrim(p_address), notes = coalesce(p_notes,''), items = v_items,
      subtotal_cents = v_subtotal, version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create function public.trameli_cancel_customer_order(p_order_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.trameli_orders set status = 'cancelled', version = version + 1, updated_at = now()
  where id = p_order_id and customer_id = auth.uid() and source = 'portal'
    and status = 'received' and delivery_date >= (now() at time zone 'America/Sao_Paulo')::date
    and version = p_expected_version;
  if not found then raise exception 'order changed or cannot be cancelled'; end if;
end;
$$;

-- Manual lines may have agreed prices, but are validated and summed on the server.
create function public.trameli_operator_order(
  p_order_id uuid, p_request_id uuid, p_expected_version integer, p_delivery_date date,
  p_name text, p_phone text, p_address text, p_notes text,
  p_fee_cents integer, p_items jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb; v_qty integer; v_price integer;
  v_items jsonb := '[]'::jsonb; v_subtotal bigint := 0;
  v_id uuid; v_old public.trameli_orders%rowtype;
begin
  if not public.trameli_is_operator() then raise exception 'operator access required' using errcode = '42501'; end if;
  if p_delivery_date is null or char_length(btrim(coalesce(p_name,''))) not between 2 and 90
    or char_length(btrim(coalesce(p_address,''))) not between 3 and 180
    or char_length(coalesce(p_phone,'')) > 25 or char_length(coalesce(p_notes,'')) > 280
    or p_fee_cents not between 0 and 100000000
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid order';
  end if;
  for v_line in select value from jsonb_array_elements(p_items) loop
    if char_length(btrim(coalesce(v_line->>'name',''))) not between 2 and 90
      or (v_line->>'quantity') !~ '^[0-9]{1,3}$'
      or (v_line->>'priceCents') !~ '^[0-9]{1,9}$' then raise exception 'invalid line'; end if;
    v_qty := (v_line->>'quantity')::integer;
    v_price := (v_line->>'priceCents')::integer;
    if v_qty not between 1 and 999 or v_price > 100000000 then raise exception 'invalid line'; end if;
    v_subtotal := v_subtotal + v_qty::bigint * v_price;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'name', btrim(v_line->>'name'), 'quantity', v_qty, 'priceCents', v_price));
  end loop;
  if p_order_id is null then
    if p_request_id is null then raise exception 'request id required'; end if;
    select id into v_id from public.trameli_orders where request_id = p_request_id;
    if v_id is not null then return v_id; end if;
    insert into public.trameli_orders(source, request_id, customer_name, phone, address, delivery_date,
      notes, items, subtotal_cents, fee_cents)
    values ('operator', p_request_id, btrim(p_name), coalesce(p_phone,''), btrim(p_address), p_delivery_date,
      coalesce(p_notes,''), v_items, v_subtotal, p_fee_cents)
    on conflict (request_id) do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.trameli_orders where request_id = p_request_id;
      if v_id is null then raise exception 'request id already used'; end if;
    end if;
  else
    select * into v_old from public.trameli_orders where id = p_order_id for update;
    if not found or v_old.version is distinct from p_expected_version then
      raise exception 'order changed; reload before editing'; end if;
    if v_old.status in ('delivered','cancelled') then
      raise exception 'finalized order cannot be edited'; end if;
    update public.trameli_orders set customer_name = btrim(p_name), phone = coalesce(p_phone,''),
      address = btrim(p_address), delivery_date = p_delivery_date,
      notes = coalesce(p_notes,''), items = v_items, subtotal_cents = v_subtotal,
      fee_cents = p_fee_cents, version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create function public.trameli_operator_status(
  p_order_id uuid, p_expected_version integer, p_status public.trameli_order_status
) returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.trameli_order_status;
begin
  if not public.trameli_is_operator() then raise exception 'operator access required' using errcode = '42501'; end if;
  select status into v_old from public.trameli_orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_old in ('delivered','cancelled') or p_status is null then
    raise exception 'finalized order cannot change status'; end if;
  if not (
    (v_old = 'received' and p_status in ('confirmed','cancelled')) or
    (v_old = 'confirmed' and p_status in ('received','packing','cancelled')) or
    (v_old = 'packing' and p_status in ('confirmed','ready','cancelled')) or
    (v_old = 'ready' and p_status in ('packing','delivered','cancelled'))
  ) then raise exception 'invalid status transition'; end if;
  update public.trameli_orders set status = p_status, version = version + 1, updated_at = now()
  where id = p_order_id and version = p_expected_version;
  if not found then raise exception 'order changed; reload before editing'; end if;
end;
$$;

revoke all on function public.trameli_is_operator() from public, anon;
revoke all on function public.trameli_save_product(uuid,text,text,text,text,integer,boolean) from public, anon;
revoke all on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,jsonb) from public, anon;
revoke all on function public.trameli_cancel_customer_order(uuid,integer) from public, anon;
revoke all on function public.trameli_operator_order(uuid,uuid,integer,date,text,text,text,text,integer,jsonb) from public, anon;
revoke all on function public.trameli_operator_status(uuid,integer,public.trameli_order_status) from public, anon;
grant execute on function public.trameli_is_operator() to authenticated;
grant execute on function public.trameli_save_product(uuid,text,text,text,text,integer,boolean) to authenticated;
grant execute on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,jsonb) to authenticated;
grant execute on function public.trameli_cancel_customer_order(uuid,integer) to authenticated;
grant execute on function public.trameli_operator_order(uuid,uuid,integer,date,text,text,text,text,integer,jsonb) to authenticated;
grant execute on function public.trameli_operator_status(uuid,integer,public.trameli_order_status) to authenticated;
commit;
