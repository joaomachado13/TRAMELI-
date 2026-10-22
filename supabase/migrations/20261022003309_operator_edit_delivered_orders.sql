-- Operators may correct delivered orders without reopening delivery.
-- Keeps version locking, item validation, cost snapshots and the existing audit/payment ledger.
begin;

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
    if v_old.status = 'cancelled' then
      raise exception 'finalized order cannot be edited'; end if;
    update public.trameli_orders set customer_name = btrim(p_name), phone = coalesce(p_phone,''),
      address = btrim(p_address), delivery_date = p_delivery_date,
      notes = coalesce(p_notes,''), items = v_items, subtotal_cents = v_subtotal,
      fee_cents = 200,
      status = case when v_old.status = 'delivered' then v_old.status else 'received'::public.trameli_order_status end,
      edited_at = now(), version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.trameli_operator_order(uuid,uuid,integer,date,text,text,text,text,integer,jsonb) from public, anon;
grant execute on function public.trameli_operator_order(uuid,uuid,integer,date,text,text,text,text,integer,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
