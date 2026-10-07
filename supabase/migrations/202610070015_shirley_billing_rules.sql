-- Shirley meeting follow-up: configurable 21:00 customer cutoff.
-- The UI reads the same singleton setting and the database remains authoritative.
begin;

alter table public.trameli_settings
  alter column cutoff_time set default '21:00';

update public.trameli_settings
set cutoff_time = '21:00', updated_at = now()
where singleton;

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
      or v_order.status <> 'received' or v_order.version is distinct from p_expected_version
      or v_local_now > v_order.delivery_date - 1 + v_cutoff
      or p_delivery_date is distinct from v_order.delivery_date then
      raise exception 'order changed, cutoff exceeded or order cannot be edited';
    end if;
    update public.trameli_orders set customer_name = btrim(p_name), phone = coalesce(p_phone,''),
      address = btrim(p_address), notes = coalesce(p_notes,''), items = v_items,
      payment_method_preference = p_payment_method, subtotal_cents = v_subtotal,
      fee_cents = 200, version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.trameli_cancel_customer_order(p_order_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_cutoff time := coalesce((select cutoff_time from public.trameli_settings where singleton), time '21:00');
begin
  update public.trameli_orders set status = 'cancelled', version = version + 1, updated_at = now()
  where id = p_order_id and customer_id = auth.uid() and source = 'portal'
    and status = 'received'
    and (now() at time zone 'America/Sao_Paulo') <= delivery_date - 1 + v_cutoff
    and version = p_expected_version;
  if not found then raise exception 'order changed, cutoff exceeded or order cannot be cancelled'; end if;
end;
$$;

revoke all on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.trameli_cancel_customer_order(uuid,integer)
  from public, anon, authenticated;
grant execute on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,text,jsonb)
  to authenticated;
grant execute on function public.trameli_cancel_customer_order(uuid,integer)
  to authenticated;

commit;
