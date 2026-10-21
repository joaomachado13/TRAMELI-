-- Customer-specific commercial terms: delivery fee and per-product prices.
-- This keeps the catalog price global while allowing negotiated conditions per customer.

create table if not exists public.trameli_customer_terms (
  customer_id uuid primary key references public.trameli_profiles(user_id) on delete cascade,
  delivery_fee_cents integer not null
    check (delivery_fee_cents >= 0 and delivery_fee_cents <= 100000000),
  updated_at timestamptz not null default now()
);

create table if not exists public.trameli_customer_product_prices (
  customer_id uuid not null references public.trameli_profiles(user_id) on delete cascade,
  product_id uuid not null references public.trameli_products(id) on delete cascade,
  price_cents integer not null
    check (price_cents >= 0 and price_cents <= 100000000),
  updated_at timestamptz not null default now(),
  primary key (customer_id, product_id)
);

alter table public.trameli_customer_terms enable row level security;
alter table public.trameli_customer_product_prices enable row level security;

revoke all on public.trameli_customer_terms from anon;
revoke all on public.trameli_customer_product_prices from anon;
grant select on public.trameli_customer_terms to authenticated;
grant select on public.trameli_customer_product_prices to authenticated;

create policy "customer commercial terms are visible to owner or operator"
on public.trameli_customer_terms
for select
to authenticated
using (
  customer_id = (select auth.uid())
  or (select public.trameli_is_operator())
);

create policy "customer product prices are visible to owner or operator"
on public.trameli_customer_product_prices
for select
to authenticated
using (
  customer_id = (select auth.uid())
  or (select public.trameli_is_operator())
);

create or replace function private.trameli_delivery_fee_for_customer(p_customer_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select t.delivery_fee_cents
       from public.trameli_customer_terms t
      where t.customer_id = p_customer_id),
    (select s.delivery_fee_cents
       from public.trameli_settings s
      where s.singleton),
    200
  );
$$;

create or replace function private.trameli_apply_customer_prices(
  p_customer_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_line jsonb;
  v_result jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_special_price integer;
  v_weight integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    return p_items;
  end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_product_id := null;
    v_special_price := null;

    if coalesce(v_line->>'productId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_product_id := (v_line->>'productId')::uuid;
    else
      select p.id into v_product_id
        from public.trameli_products p
       where p.name = btrim(coalesce(v_line->>'name',''))
       order by p.active desc, p.id
       limit 1;
    end if;

    if v_product_id is not null then
      select cpp.price_cents into v_special_price
        from public.trameli_customer_product_prices cpp
       where cpp.customer_id = p_customer_id
         and cpp.product_id = v_product_id;
    end if;

    if v_special_price is not null then
      if v_line ? 'weightGrams' then
        v_weight := (v_line->>'weightGrams')::integer;
        v_line := jsonb_set(v_line, '{kgPriceCents}', to_jsonb(v_special_price), true);
        v_line := jsonb_set(
          v_line,
          '{priceCents}',
          to_jsonb(round(v_special_price::numeric * v_weight / 1000)::integer),
          true
        );
      else
        v_line := jsonb_set(v_line, '{priceCents}', to_jsonb(v_special_price), true);
      end if;
    end if;

    v_result := v_result || jsonb_build_array(v_line);
  end loop;

  return v_result;
end;
$$;

create or replace function private.trameli_items_subtotal(p_items jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    sum((value->>'quantity')::bigint * (value->>'priceCents')::bigint),
    0
  )::bigint
  from jsonb_array_elements(p_items);
$$;

revoke execute on function private.trameli_delivery_fee_for_customer(uuid) from public, anon, authenticated;
revoke execute on function private.trameli_apply_customer_prices(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.trameli_items_subtotal(jsonb) from public, anon, authenticated;

create or replace function public.trameli_customer_order(
  p_order_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_delivery_date date,
  p_name text,
  p_phone text,
  p_address text,
  p_notes text,
  p_payment_method text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid(); v_order public.trameli_orders%rowtype;
  v_line jsonb; v_product public.trameli_products%rowtype;
  v_qty integer; v_grams integer; v_price integer;
  v_items jsonb := '[]'::jsonb; v_subtotal bigint := 0; v_id uuid;
  v_fee integer;
  v_local_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_cutoff time := coalesce((select cutoff_time from public.trameli_settings where singleton), time '21:00');
begin
  if v_user is null then raise exception 'login required' using errcode = '42501'; end if;

  if p_order_id is null and p_request_id is not null then
    select id into v_id from public.trameli_orders
      where request_id = p_request_id and customer_id = v_user;
    if v_id is not null then return v_id; end if;
  end if;

  if p_order_id is null and (
    case
      when v_cutoff >= time '06:00'
        then (v_local_now::time >= v_cutoff or v_local_now::time < time '06:00')
      else (v_local_now::time >= v_cutoff and v_local_now::time < time '06:00')
    end
  ) then
    raise exception 'A loja está fechada para novos pedidos. Voltamos a aceitar pedidos às 6h.'
      using errcode = '42501';
  end if;

  if p_order_id is null and coalesce((select order_blocked from public.trameli_profiles where user_id = v_user), false) then
    raise exception 'Novos pedidos estão bloqueados. Fale com a Trameli para liberar sua conta.' using errcode = '42501';
  end if;

  if p_delivery_date is null
    or v_local_now > p_delivery_date - 1 + v_cutoff
    or p_delivery_date > v_local_now::date + 90
    or char_length(btrim(coalesce(p_name,''))) not between 2 and 90
    or char_length(btrim(coalesce(p_address,''))) not between 3 and 180
    or char_length(coalesce(p_phone,'')) > 25 or char_length(coalesce(p_notes,'')) > 280
    or p_payment_method is null or p_payment_method not in ('pix_manual', 'cash', 'bank', 'other')
    or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'invalid order or customer cutoff exceeded';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' or (v_line->>'product_id') is null then
      raise exception 'invalid order line';
    end if;
    select * into v_product from public.trameli_products
      where id = (v_line->>'product_id')::uuid and active;
    if not found then raise exception 'product unavailable'; end if;
    if v_product.unit = 'kg' then
      if coalesce(v_line->>'grams', '') !~ '^[0-9]{2,4}$' then raise exception 'invalid weight'; end if;
      v_grams := (v_line->>'grams')::integer;
      if v_grams not between 50 and 4950 or v_grams % 50 <> 0 then raise exception 'invalid weight'; end if;
      v_price := round(v_product.price_cents::numeric * v_grams / 1000)::integer;
      v_subtotal := v_subtotal + v_price;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'name', v_product.name, 'quantity', 1,
        'weightGrams', v_grams, 'kgPriceCents', v_product.price_cents,
        'priceCents', v_price));
    else
      if coalesce(v_line->>'quantity', '') !~ '^[0-9]{1,2}$' then raise exception 'invalid quantity'; end if;
      v_qty := (v_line->>'quantity')::integer;
      if v_qty not between 1 and 99 then raise exception 'invalid quantity'; end if;
      v_subtotal := v_subtotal + v_qty::bigint * v_product.price_cents;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'name', v_product.name,
        'quantity', v_qty, 'priceCents', v_product.price_cents));
    end if;
  end loop;

  v_items := private.trameli_apply_customer_prices(v_user, v_items);
  v_subtotal := private.trameli_items_subtotal(v_items);
  v_fee := private.trameli_delivery_fee_for_customer(v_user);

  insert into public.trameli_profiles(user_id, name, phone, address)
    values (v_user, btrim(p_name), coalesce(p_phone,''), btrim(p_address))
    on conflict (user_id) do update set name = excluded.name, phone = excluded.phone,
      address = excluded.address, updated_at = now();

  if p_order_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || p_delivery_date::text, 0));
    if exists (select 1 from public.trameli_orders
      where customer_id = v_user and delivery_date = p_delivery_date
        and status <> 'cancelled'
        and (p_request_id is null or request_id is distinct from p_request_id)) then
      raise exception 'Você já tem um pedido para essa data. Abra Meus pedidos para editar o pedido existente.';
    end if;
    if p_request_id is null then raise exception 'request id required'; end if;
    insert into public.trameli_orders(customer_id, source, request_id, customer_name, phone, address,
      delivery_date, notes, payment_method_preference, items, subtotal_cents, fee_cents)
    values (v_user, 'portal', p_request_id, btrim(p_name), coalesce(p_phone,''), btrim(p_address),
      p_delivery_date, coalesce(p_notes,''), p_payment_method, v_items, v_subtotal, v_fee)
    on conflict (request_id) do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.trameli_orders
        where request_id = p_request_id and customer_id = v_user;
      if v_id is null then raise exception 'request id already used'; end if;
    end if;
  else
    select * into v_order from public.trameli_orders where id = p_order_id for update;
    if not found or v_order.customer_id is distinct from v_user or v_order.source <> 'portal'
      or v_order.status not in ('received','confirmed','packing','ready') or v_order.version is distinct from p_expected_version
      or v_local_now > v_order.delivery_date - 1 + v_cutoff
      or p_delivery_date is distinct from v_order.delivery_date then
      raise exception 'order changed, cutoff exceeded or order cannot be edited';
    end if;
    update public.trameli_orders set customer_name = btrim(p_name), phone = coalesce(p_phone,''),
      address = btrim(p_address), notes = coalesce(p_notes,''), items = v_items,
      payment_method_preference = p_payment_method, subtotal_cents = v_subtotal,
      fee_cents = v_fee, status = 'received', edited_at = now(), version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$function$;

create or replace function public.trameli_operator_order_for_customer(
  p_order_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_delivery_date date,
  p_name text,
  p_phone text,
  p_address text,
  p_notes text,
  p_fee_cents integer,
  p_items jsonb,
  p_customer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_profile public.trameli_profiles%rowtype;
  v_items jsonb;
  v_fee integer;
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_customer_id is null then
    raise exception 'select an existing customer profile' using errcode = '22023';
  end if;
  select * into v_profile from public.trameli_profiles where user_id = p_customer_id;
  if not found then
    raise exception 'select an existing customer profile' using errcode = '22023';
  end if;
  if p_order_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer_id::text || ':' || p_delivery_date::text, 0));
    if exists (select 1 from public.trameli_orders
      where customer_id = p_customer_id and delivery_date = p_delivery_date
        and status <> 'cancelled'
        and (p_request_id is null or request_id is distinct from p_request_id)) then
      raise exception 'Este cliente já tem um pedido para essa data. Edite o pedido existente.';
    end if;
  end if;

  v_items := private.trameli_apply_customer_prices(p_customer_id, p_items);
  v_fee := private.trameli_delivery_fee_for_customer(p_customer_id);

  -- The base operator RPC still validates its historical R$ 2,00 argument.
  -- Customer-specific terms are applied here after the canonical item validation.
  v_id := public.trameli_operator_order(
    p_order_id, p_request_id, p_expected_version, p_delivery_date,
    v_profile.name, coalesce(v_profile.phone,''), v_profile.address, p_notes, 200, v_items
  );

  update public.trameli_orders
     set customer_id = p_customer_id,
         fee_cents = v_fee,
         updated_at = now()
   where id = v_id;
  return v_id;
end;
$function$;

create or replace function public.trameli_save_recurring_order(
  p_schedule_id uuid,
  p_request_id uuid,
  p_customer_id uuid,
  p_recurrence text,
  p_start_date date,
  p_active boolean,
  p_notes text,
  p_fee_cents integer,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.trameli_profiles%rowtype;
  v_product public.trameli_products%rowtype;
  v_line jsonb;
  v_qty integer;
  v_price integer;
  v_grams integer;
  v_kg_price integer;
  v_items jsonb := '[]'::jsonb;
  v_input_items jsonb;
  v_subtotal bigint := 0;
  v_id uuid;
  v_cycle_end date;
  v_fee integer;
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_customer_id is null or p_start_date is null
     or p_recurrence is null or p_recurrence not in ('fixed','fortnightly','monthly')
     or p_fee_cents is null or p_fee_cents not between 0 and 100000000
     or char_length(coalesce(p_notes,'')) > 280
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid recurring order' using errcode = '22023';
  end if;
  select * into v_profile from public.trameli_profiles where user_id = p_customer_id;
  if not found then raise exception 'customer profile not found' using errcode = 'P0002'; end if;

  v_input_items := private.trameli_apply_customer_prices(p_customer_id, p_items);
  v_fee := private.trameli_delivery_fee_for_customer(p_customer_id);

  for v_line in select value from jsonb_array_elements(v_input_items) loop
    if jsonb_typeof(v_line) <> 'object'
       or char_length(btrim(coalesce(v_line->>'name',''))) not between 2 and 90
       or coalesce(v_line->>'quantity','') !~ '^[0-9]{1,3}$'
       or coalesce(v_line->>'priceCents','') !~ '^[0-9]{1,9}$' then
      raise exception 'invalid recurring order line' using errcode = '22023';
    end if;
    v_qty := (v_line->>'quantity')::integer;
    v_price := (v_line->>'priceCents')::integer;
    if v_qty not between 1 and 999 or v_price > 100000000 then
      raise exception 'invalid recurring order line' using errcode = '22023';
    end if;

    if v_line ? 'weightGrams' then
      if coalesce(v_line->>'weightGrams','') !~ '^[0-9]{2,4}$'
         or coalesce(v_line->>'kgPriceCents','') !~ '^[0-9]{1,9}$'
         or coalesce(v_line->>'productId','') !~ '^[0-9a-fA-F-]{36}$'
         or v_qty <> 1 then
        raise exception 'invalid weighted recurring order line' using errcode = '22023';
      end if;
      v_grams := (v_line->>'weightGrams')::integer;
      v_kg_price := (v_line->>'kgPriceCents')::integer;
      if v_grams not between 50 and 4950 or v_grams % 50 <> 0
         or v_kg_price > 100000000
         or v_price <> round(v_kg_price::numeric * v_grams / 1000)::integer then
        raise exception 'invalid weighted recurring order line' using errcode = '22023';
      end if;
      select * into v_product from public.trameli_products
        where id = (v_line->>'productId')::uuid and unit = 'kg' and active;
      if not found or v_product.name <> btrim(v_line->>'name') then
        raise exception 'weighted product unavailable' using errcode = '22023';
      end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'name', v_product.name, 'quantity', 1,
        'weightGrams', v_grams, 'kgPriceCents', v_kg_price, 'priceCents', v_price));
    else
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'name', btrim(v_line->>'name'), 'quantity', v_qty, 'priceCents', v_price));
    end if;
    v_subtotal := v_subtotal + v_qty::bigint * v_price;
  end loop;

  if p_recurrence = 'fixed' then
    v_cycle_end := null;
  elsif p_recurrence = 'monthly' then
    v_cycle_end := (date_trunc('month', p_start_date)::date + interval '1 month - 1 day')::date;
  elsif extract(day from p_start_date) <= 15 then
    v_cycle_end := date_trunc('month', p_start_date)::date + 14;
  else
    v_cycle_end := (date_trunc('month', p_start_date)::date + interval '1 month - 1 day')::date;
  end if;

  if p_schedule_id is null then
    if p_request_id is null then raise exception 'request id required' using errcode = '22023'; end if;
    select id into v_id from public.trameli_recurring_orders where request_id = p_request_id;
    if v_id is not null then return v_id; end if;
    insert into public.trameli_recurring_orders(
      customer_id, request_id, recurrence, starts_on, cycle_ends_on, active, notes, fee_cents, items, created_by
    ) values (
      p_customer_id, p_request_id, p_recurrence, p_start_date, v_cycle_end, coalesce(p_active,true),
      coalesce(p_notes,''), v_fee, v_items, auth.uid()
    ) returning id into v_id;
  else
    update public.trameli_recurring_orders set
      customer_id = p_customer_id, recurrence = p_recurrence, starts_on = p_start_date,
      cycle_ends_on = v_cycle_end, active = coalesce(p_active,true), notes = coalesce(p_notes,''),
      fee_cents = v_fee, items = v_items, updated_at = now()
    where id = p_schedule_id returning id into v_id;
    if v_id is null then raise exception 'recurring order not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$function$;

create or replace function public.trameli_save_recurring_order_daily(
  p_schedule_id uuid,
  p_request_id uuid,
  p_customer_id uuid,
  p_recurrence text,
  p_start_date date,
  p_active boolean,
  p_notes text,
  p_fee_cents integer,
  p_items jsonb,
  p_weekdays smallint[],
  p_items_by_weekday jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid; v_day smallint; v_days smallint[];
  v_daily jsonb := null; v_items jsonb := p_items;
begin
  if auth.uid() is null or not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_schedule_id is null and p_request_id is not null then
    select id into v_id from public.trameli_recurring_orders where request_id = p_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_weekdays is null or cardinality(p_weekdays) not between 1 and 6
    or exists(select 1 from unnest(p_weekdays) d where d is null or d not between 1 and 6) then
    raise exception 'Selecione os dias de segunda a sábado.' using errcode = '22023';
  end if;
  select array_agg(distinct d order by d) into v_days from unnest(p_weekdays) d;
  if p_items_by_weekday is not null then
    if jsonb_typeof(p_items_by_weekday) is distinct from 'object' then
      raise exception 'invalid daily items' using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_object_keys(p_items_by_weekday) k
      where not(k = any(select d::text from unnest(v_days) d))) then
      raise exception 'Os produtos devem corresponder aos dias selecionados.' using errcode = '22023';
    end if;
    v_daily := '{}'::jsonb;
    foreach v_day in array v_days loop
      v_daily := v_daily || jsonb_build_object(
        v_day::text,
        private.trameli_apply_customer_prices(
          p_customer_id,
          private.trameli_recurring_items(p_items_by_weekday -> v_day::text)
        )
      );
    end loop;
    v_items := v_daily -> v_days[1]::text;
  end if;
  v_id := public.trameli_save_recurring_order(p_schedule_id, p_request_id, p_customer_id,
    p_recurrence, p_start_date, p_active, p_notes, p_fee_cents, v_items);
  update public.trameli_recurring_orders set weekdays = v_days,
    items_by_weekday = v_daily, updated_at = now() where id = v_id;
  return v_id;
end;
$function$;

create or replace function public.trameli_materialize_recurring_orders(p_delivery_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_schedule public.trameli_recurring_orders%rowtype;
  v_line jsonb;
  v_source_items jsonb;
  v_items jsonb;
  v_subtotal bigint;
  v_order_id uuid;
  v_count integer := 0;
  v_customer public.trameli_profiles%rowtype;
  v_cycle_end date;
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_delivery_date is null then raise exception 'delivery date required' using errcode = '22023'; end if;
  if p_delivery_date < (now() at time zone 'America/Sao_Paulo')::date then return 0; end if;
  if extract(dow from p_delivery_date) = 0 then return 0; end if;

  for v_schedule in
    select * from public.trameli_recurring_orders
    where active and starts_on <= p_delivery_date
    order by created_at, id
    for update
  loop
    if not (extract(dow from p_delivery_date)::smallint = any(v_schedule.weekdays)) then
      continue;
    end if;
    if v_schedule.recurrence <> 'fixed'
       and v_schedule.cycle_ends_on is not null
       and p_delivery_date > v_schedule.cycle_ends_on then
      if v_schedule.recurrence = 'monthly' then
        v_cycle_end := (date_trunc('month', p_delivery_date)::date + interval '1 month - 1 day')::date;
      elsif extract(day from p_delivery_date) <= 15 then
        v_cycle_end := date_trunc('month', p_delivery_date)::date + 14;
      else
        v_cycle_end := (date_trunc('month', p_delivery_date)::date + interval '1 month - 1 day')::date;
      end if;
      update public.trameli_recurring_orders set
        starts_on = p_delivery_date, cycle_ends_on = v_cycle_end, updated_at = now()
      where id = v_schedule.id;
      v_schedule.starts_on := p_delivery_date;
      v_schedule.cycle_ends_on := v_cycle_end;
    end if;

    if exists (
      select 1 from public.trameli_recurring_occurrences
      where schedule_id = v_schedule.id and delivery_date = p_delivery_date
    ) then continue; end if;

    select * into v_customer from public.trameli_profiles where user_id = v_schedule.customer_id;
    if not found then continue; end if;
    v_items := '[]'::jsonb;
    v_subtotal := 0;
    v_source_items := case when v_schedule.items_by_weekday is null then v_schedule.items
      else v_schedule.items_by_weekday -> extract(dow from p_delivery_date)::integer::text end;
    if v_source_items is null then
      raise exception 'Programação sem produtos para o dia selecionado.' using errcode = '22023';
    end if;

    v_source_items := private.trameli_apply_customer_prices(v_schedule.customer_id, v_source_items);
    for v_line in select value from jsonb_array_elements(v_source_items) loop
      v_subtotal := v_subtotal
        + (v_line->>'quantity')::integer * (v_line->>'priceCents')::integer;
      v_items := v_items || jsonb_build_array(v_line);
    end loop;

    if exists (select 1 from public.trameli_orders
      where customer_id = v_schedule.customer_id
        and delivery_date = p_delivery_date and status <> 'cancelled') then
      continue;
    end if;

    insert into public.trameli_orders(
      customer_id, source, request_id, status, customer_name, phone, address,
      delivery_date, notes, items, subtotal_cents, fee_cents
    ) values (
      v_schedule.customer_id, 'operator', gen_random_uuid(), 'confirmed',
      v_customer.name, v_customer.phone, v_customer.address,
      p_delivery_date, v_schedule.notes, v_items, v_subtotal,
      private.trameli_delivery_fee_for_customer(v_schedule.customer_id)
    ) returning id into v_order_id;

    insert into public.trameli_recurring_occurrences(schedule_id, delivery_date, order_id)
      values (v_schedule.id, p_delivery_date, v_order_id)
      on conflict (schedule_id, delivery_date) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- Carlos (Mercadinho): negotiated commercial condition.
insert into public.trameli_customer_terms(customer_id, delivery_fee_cents)
select p.user_id, 100
  from public.trameli_profiles p
 where p.user_id = 'da248c82-2b3d-403d-b040-2c865a4b4d85'::uuid
on conflict (customer_id) do update
  set delivery_fee_cents = excluded.delivery_fee_cents,
      updated_at = now();

insert into public.trameli_customer_product_prices(customer_id, product_id, price_cents)
select p.user_id, product.id, 135
  from public.trameli_profiles p
  join public.trameli_products product
    on product.id = '20260924-0000-4000-8000-000000000002'::uuid
 where p.user_id = 'da248c82-2b3d-403d-b040-2c865a4b4d85'::uuid
on conflict (customer_id, product_id) do update
  set price_cents = excluded.price_cents,
      updated_at = now();

-- Reprice every existing Carlos order, including delivered orders, without changing status.
with priced as (
  select o.id,
         private.trameli_apply_customer_prices(o.customer_id, o.items) as items
    from public.trameli_orders o
   where o.customer_id = 'da248c82-2b3d-403d-b040-2c865a4b4d85'::uuid
)
update public.trameli_orders o
   set items = priced.items,
       subtotal_cents = private.trameli_items_subtotal(priced.items),
       fee_cents = private.trameli_delivery_fee_for_customer(o.customer_id),
       version = o.version + 1,
       updated_at = now()
  from priced
 where o.id = priced.id;

-- Keep Carlos's active recurring schedule aligned immediately.
with priced as (
  select r.id,
         private.trameli_apply_customer_prices(r.customer_id, r.items) as items
    from public.trameli_recurring_orders r
   where r.customer_id = 'da248c82-2b3d-403d-b040-2c865a4b4d85'::uuid
)
update public.trameli_recurring_orders r
   set items = priced.items,
       fee_cents = private.trameli_delivery_fee_for_customer(r.customer_id),
       updated_at = now()
  from priced
 where r.id = priced.id;
