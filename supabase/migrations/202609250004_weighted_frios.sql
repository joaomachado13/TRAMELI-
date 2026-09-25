-- Confirmações de venda: frios por kg, com seleção em intervalos de 50 g.
-- Executar após 202609240003_catalog_seed.sql. Não altera custos da padaria.
begin;

update public.trameli_products as p set
  name = v.name, price_cents = v.price_cents, unit = v.unit,
  active = v.active, review_reason = v.review_reason, updated_at = now()
from (values
  (20, 'Mussarela', 6999, 'kg', true, null::text),
  (21, 'Presunto', 4000, 'kg', true, null::text),
  (22, 'Mortadela defumada', 4000, 'kg', true, null::text),
  (36, 'Manteiga Italac 200g', 1700, 'unidade', true, null::text),
  (43, 'Pão de forma', 1200, 'unidade', true, null::text),
  (48, 'Peito de peru', 5999, 'kg', true, null::text),
  (74, 'Mini pão francês', 70, 'unidade', true, null::text)
) as v(source_row, name, price_cents, unit, active, review_reason)
where p.source_row = v.source_row;

-- Preço do cliente sempre é recalculado no servidor a partir do preço por kg.
create or replace function public.trameli_customer_order(
  p_order_id uuid, p_request_id uuid, p_expected_version integer, p_delivery_date date,
  p_name text, p_phone text, p_address text, p_notes text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_order public.trameli_orders%rowtype;
  v_line jsonb; v_product public.trameli_products%rowtype;
  v_qty integer; v_grams integer; v_price integer;
  v_items jsonb := '[]'::jsonb; v_subtotal bigint := 0; v_id uuid;
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

-- A operadora pode lançar frios manualmente por peso, mantendo o preço/kg no histórico.
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
    or p_fee_cents not between 0 and 100000000
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid order';
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

-- Custos da padaria para itens por kg são armazenados como custo da porção vendida.
-- A tabela privada de produtos continua guardando o custo de 1 kg.
create or replace function public.trameli_snapshot_order_costs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb; v_index integer := 0; v_product_id uuid;
  v_match_count integer; v_unit_cost integer; v_grams integer;
begin
  delete from public.trameli_order_costs where order_id = new.id;
  for v_line in select value from jsonb_array_elements(new.items) loop
    v_index := v_index + 1;
    v_product_id := nullif(v_line->>'productId', '')::uuid;
    if v_product_id is null then
      select count(*), (array_agg(id))[1] into v_match_count, v_product_id
      from public.trameli_products
      where active and lower(btrim(name)) = lower(btrim(v_line->>'name'));
      if v_match_count <> 1 then v_product_id := null; end if;
    end if;
    select unit_cost_cents into v_unit_cost from public.trameli_product_costs
      where product_id = v_product_id;
    if v_line ? 'weightGrams' and v_unit_cost is not null then
      v_grams := (v_line->>'weightGrams')::integer;
      v_unit_cost := round(v_unit_cost::numeric * v_grams / 1000)::integer;
    end if;
    insert into public.trameli_order_costs(order_id, line_index, product_id, quantity, unit_cost_cents)
      values (new.id, v_index, v_product_id, (v_line->>'quantity')::integer, v_unit_cost);
  end loop;
  return new;
end;
$$;

commit;
