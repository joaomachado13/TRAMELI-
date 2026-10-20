-- Prevent duplicate customer/date orders and flag edited orders for re-check.
begin;

alter table public.trameli_orders
  add column if not exists edited_at timestamptz;

create or replace function public.trameli_customer_order(
  p_order_id uuid, p_request_id uuid, p_expected_version integer, p_delivery_date date,
  p_name text, p_phone text, p_address text, p_notes text,
  p_payment_method text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_order public.trameli_orders%rowtype;
  v_line jsonb; v_product public.trameli_products%rowtype;
  v_qty integer; v_grams integer; v_price integer;
  v_items jsonb := '[]'::jsonb; v_subtotal bigint := 0; v_id uuid;
  v_local_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_cutoff time := coalesce((select cutoff_time from public.trameli_settings where singleton), time '21:00');
begin
  if v_user is null then raise exception 'login required' using errcode = '42501'; end if;

  -- A repeated request returns its original order even if the cutoff has passed meanwhile.
  if p_order_id is null and p_request_id is not null then
    select id into v_id from public.trameli_orders
      where request_id = p_request_id and customer_id = v_user;
    if v_id is not null then return v_id; end if;
  end if;

  -- Bloqueia novos pedidos entre o horário de corte e 06:00, no relógio de São Paulo.
  -- Pedidos existentes continuam sujeitos às regras próprias de edição.
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
      p_delivery_date, coalesce(p_notes,''), p_payment_method, v_items, v_subtotal, 200)
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
      fee_cents = 200, status = 'received', edited_at = now(), version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.trameli_operator_order(
  p_order_id uuid, p_request_id uuid, p_expected_version integer, p_delivery_date date,
  p_name text, p_phone text, p_address text, p_notes text,
  p_fee_cents integer, p_items jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb; v_qty integer; v_price integer; v_grams integer; v_kg_price integer;
  v_product public.trameli_products%rowtype;
  v_items jsonb := '[]'::jsonb; v_subtotal bigint := 0;
  v_id uuid; v_old public.trameli_orders%rowtype;
begin
  if not public.trameli_is_operator() then raise exception 'operator access required' using errcode = '42501'; end if;
  if p_delivery_date is null or char_length(btrim(coalesce(p_name,''))) not between 2 and 90
    or char_length(btrim(coalesce(p_address,''))) not between 3 and 180
    or char_length(coalesce(p_phone,'')) > 25 or char_length(coalesce(p_notes,'')) > 280
    or p_fee_cents is distinct from 200
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid order or delivery fee; fee must be R$ 2.00';
  end if;
  for v_line in select value from jsonb_array_elements(p_items) loop
    if char_length(btrim(coalesce(v_line->>'name',''))) not between 2 and 90
      or coalesce(v_line->>'quantity', '') !~ '^[0-9]{1,3}$'
      or coalesce(v_line->>'priceCents', '') !~ '^[0-9]{1,9}$' then raise exception 'invalid line'; end if;
    v_qty := (v_line->>'quantity')::integer;
    v_price := (v_line->>'priceCents')::integer;
    if v_qty not between 1 and 999 or v_price > 100000000 then raise exception 'invalid line'; end if;
    if v_line ? 'weightGrams' then
      if coalesce(v_line->>'weightGrams', '') !~ '^[0-9]{2,4}$'
        or coalesce(v_line->>'kgPriceCents', '') !~ '^[0-9]{1,9}$'
        or (v_line->>'productId') is null then raise exception 'invalid weight'; end if;
      v_grams := (v_line->>'weightGrams')::integer;
      v_kg_price := (v_line->>'kgPriceCents')::integer;
      if v_grams not between 50 and 4950 or v_grams % 50 <> 0
        or v_kg_price > 100000000 or v_qty <> 1
        or v_price <> round(v_kg_price::numeric * v_grams / 1000)::integer then
        raise exception 'invalid weight';
      end if;
      select * into v_product from public.trameli_products
        where id = (v_line->>'productId')::uuid and unit = 'kg' and active;
      if not found or v_product.name <> btrim(v_line->>'name') then raise exception 'weighted product unavailable'; end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'name', v_product.name, 'quantity', 1,
        'weightGrams', v_grams, 'kgPriceCents', v_kg_price, 'priceCents', v_price));
    else
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'name', btrim(v_line->>'name'), 'quantity', v_qty, 'priceCents', v_price));
    end if;
    v_subtotal := v_subtotal + v_qty::bigint * v_price;
  end loop;
  if p_order_id is null then
    if p_request_id is null then raise exception 'request id required'; end if;
    select id into v_id from public.trameli_orders where request_id = p_request_id;
    if v_id is not null then return v_id; end if;
    insert into public.trameli_orders(source, request_id, customer_name, phone, address, delivery_date,
      notes, items, subtotal_cents, fee_cents)
    values ('operator', p_request_id, btrim(p_name), coalesce(p_phone,''), btrim(p_address), p_delivery_date,
      coalesce(p_notes,''), v_items, v_subtotal, 200)
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
      fee_cents = 200, status = 'received', edited_at = now(), version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.trameli_operator_order_for_customer(
  p_order_id uuid, p_request_id uuid, p_expected_version integer, p_delivery_date date,
  p_name text, p_phone text, p_address text, p_notes text,
  p_fee_cents integer, p_items jsonb, p_customer_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_profile public.trameli_profiles%rowtype;
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
  v_id := public.trameli_operator_order(
    p_order_id, p_request_id, p_expected_version, p_delivery_date,
    v_profile.name, coalesce(v_profile.phone,''), v_profile.address, p_notes, p_fee_cents, p_items
  );
  update public.trameli_orders set customer_id = p_customer_id
    where id = v_id;
  return v_id;
end;
$$;

create or replace function public.trameli_operator_status(
  p_order_id uuid, p_expected_version integer, p_status public.trameli_order_status
) returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.trameli_order_status; v_master boolean;
begin
  if not public.trameli_is_operator() then raise exception 'operator access required' using errcode = '42501'; end if;
  select status into v_old from public.trameli_orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if p_expected_version is null or not exists(
    select 1 from public.trameli_orders where id = p_order_id and version = p_expected_version
  ) then raise exception 'order changed; reload before editing'; end if;
  if v_old in ('delivered','cancelled') or p_status is null then
    raise exception 'finalized order cannot change status'; end if;
  v_master := public.trameli_is_master();
  if not (
    (v_old = 'received' and p_status in ('confirmed','cancelled')) or
    (v_old = 'confirmed' and p_status = 'packing') or
    (v_old = 'packing' and p_status = 'ready') or
    (v_old = 'ready' and p_status = 'delivered') or
    (v_master and v_old = 'confirmed' and p_status in ('received','cancelled')) or
    (v_master and v_old = 'packing' and p_status in ('confirmed','cancelled')) or
    (v_master and v_old = 'ready' and p_status in ('packing','cancelled'))
  ) then raise exception 'invalid status transition or master access required'; end if;
  update public.trameli_orders set status = p_status, edited_at = case when p_status = 'confirmed' then null else edited_at end, version = version + 1, updated_at = now()
  where id = p_order_id and version = p_expected_version;
  if not found then raise exception 'order changed; reload before editing'; end if;
end;
$$;

create or replace function public.trameli_materialize_recurring_orders(p_delivery_date date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_schedule public.trameli_recurring_orders%rowtype;
  v_line jsonb;
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
  -- Historical views must never create retroactive charges.
  if p_delivery_date < (now() at time zone 'America/Sao_Paulo')::date then return 0; end if;
  -- Sunday deliveries are never generated.
  if extract(dow from p_delivery_date) = 0 then return 0; end if;

  for v_schedule in
    select * from public.trameli_recurring_orders
    where active and starts_on <= p_delivery_date
    order by created_at, id
    for update
  loop
    -- Renew the billing cycle only when a date in the next cycle is requested.
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
    for v_line in select value from jsonb_array_elements(v_schedule.items) loop
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
      p_delivery_date, v_schedule.notes, v_items, v_subtotal, v_schedule.fee_cents
    ) returning id into v_order_id;

    insert into public.trameli_recurring_occurrences(schedule_id, delivery_date, order_id)
      values (v_schedule.id, p_delivery_date, v_order_id)
      on conflict (schedule_id, delivery_date) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,text,jsonb) from public, anon;
grant execute on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,text,jsonb) to authenticated;
revoke all on function public.trameli_operator_order(uuid,uuid,integer,date,text,text,text,text,integer,jsonb) from public, anon, authenticated;
revoke all on function public.trameli_operator_order_for_customer(uuid,uuid,integer,date,text,text,text,text,integer,jsonb,uuid) from public, anon;
grant execute on function public.trameli_operator_order_for_customer(uuid,uuid,integer,date,text,text,text,text,integer,jsonb,uuid) to authenticated;
revoke all on function public.trameli_operator_status(uuid,integer,public.trameli_order_status) from public, anon;
grant execute on function public.trameli_operator_status(uuid,integer,public.trameli_order_status) to authenticated;
revoke all on function public.trameli_materialize_recurring_orders(date) from public, anon;
grant execute on function public.trameli_materialize_recurring_orders(date) to authenticated;

notify pgrst, 'reload schema';
commit;
