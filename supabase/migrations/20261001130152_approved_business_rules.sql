-- Enforces the business rules approved on 2026-10-01.
-- Existing orders keep their history; every new mutation is validated on the server.
begin;

alter table public.trameli_orders
  add column payment_method_preference text not null default 'unspecified'
  check (payment_method_preference in ('unspecified', 'pix_manual', 'cash', 'bank', 'other'));

comment on column public.trameli_orders.payment_method_preference is
  'Customer-declared intended payment method. It never represents confirmed receipt.';

-- Remove the previous overload so the old signature cannot bypass the new rules.
drop function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,jsonb);

create function public.trameli_customer_order(
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
begin
  if v_user is null then raise exception 'login required' using errcode = '42501'; end if;

  -- A repeated request returns its original order even if the cutoff has passed meanwhile.
  if p_order_id is null and p_request_id is not null then
    select id into v_id from public.trameli_orders
      where request_id = p_request_id and customer_id = v_user;
    if v_id is not null then return v_id; end if;
  end if;

  if p_delivery_date is null
    or v_local_now > p_delivery_date - 1 + time '22:30'
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
      or v_local_now > v_order.delivery_date - 1 + time '22:30'
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
begin
  update public.trameli_orders set status = 'cancelled', version = version + 1, updated_at = now()
  where id = p_order_id and customer_id = auth.uid() and source = 'portal'
    and status = 'received'
    and (now() at time zone 'America/Sao_Paulo') <= delivery_date - 1 + time '22:30'
    and version = p_expected_version;
  if not found then raise exception 'order changed, cutoff exceeded or order cannot be cancelled'; end if;
end;
$$;

-- Operators keep manual product entry, but the delivery fee is always R$ 2.00.
-- From confirmed onward, only a master may edit order content.
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
    if v_old.status <> 'received' and not public.trameli_is_master() then
      raise exception 'only master can edit a confirmed order' using errcode = '42501';
    end if;
    update public.trameli_orders set customer_name = btrim(p_name), phone = coalesce(p_phone,''),
      address = btrim(p_address), delivery_date = p_delivery_date,
      notes = coalesce(p_notes,''), items = v_items, subtotal_cents = v_subtotal,
      fee_cents = 200, version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Operators progress the normal workflow. Reopening, moving backwards or cancelling
-- after confirmation is reserved for the master account.
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
  update public.trameli_orders set status = p_status, version = version + 1, updated_at = now()
  where id = p_order_id and version = p_expected_version;
  if not found then raise exception 'order changed; reload before editing'; end if;
end;
$$;

-- A receipt may cover one or many orders from the same account, but each selected
-- order must be settled for its entire current outstanding balance.
create or replace function public.trameli_allocate_payment(p_payment_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_payment public.trameli_payments%rowtype; v_line jsonb; v_order public.trameli_orders%rowtype;
  v_amount integer; v_paid bigint; v_due bigint; v_sum bigint:=0; v_identity text; v_current_identity text;
begin
  if not public.trameli_is_operator() then raise exception 'Acesso restrito à operação.' using errcode='42501'; end if;
  select * into v_payment from public.trameli_payments where id=p_payment_id for update;
  if not found or v_payment.kind<>'receipt' then raise exception 'Recebimento não encontrado.'; end if;
  if exists(select 1 from public.trameli_payments where reverses_id=p_payment_id)
    or exists(select 1 from public.trameli_payment_allocations where payment_id=p_payment_id) then
    raise exception 'Recebimento já vinculado ou estornado.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'Informe entre 1 e 100 pedidos.';
  end if;
  if (select count(distinct value->>'order_id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then
    raise exception 'Pedidos repetidos ou sem identificação.';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) order by (value->>'order_id')::uuid loop
    if coalesce(v_line->>'amount_cents','') !~ '^[0-9]{1,9}$' then raise exception 'Valor inválido.'; end if;
    v_amount:=(v_line->>'amount_cents')::integer;
    if v_amount not between 1 and 100000000 then raise exception 'Valor inválido.'; end if;
    select * into v_order from public.trameli_orders where id=(v_line->>'order_id')::uuid for update;
    if not found or v_order.status='cancelled' then raise exception 'Pedido inexistente ou cancelado.'; end if;
    v_current_identity:=coalesce(v_order.customer_id::text,v_order.id::text);
    if v_identity is not null and v_identity<>v_current_identity then
      raise exception 'Um pagamento deve reunir pedidos da mesma conta. Pedidos manuais sem conta são tratados separadamente.';
    end if;
    v_identity:=v_current_identity;
    select coalesce(sum(case when p.kind='receipt' then a.amount_cents else -a.amount_cents end),0)
      into v_paid from public.trameli_payment_allocations a join public.trameli_payments p on p.id=a.payment_id
      where a.order_id=v_order.id;
    v_due:=greatest(v_order.total_cents-v_paid,0);
    if v_due=0 or v_amount<>v_due then
      raise exception 'Cada pedido selecionado deve ser quitado pelo saldo integral atual. Atualize a tela.';
    end if;
    insert into public.trameli_payment_allocations(payment_id,order_id,amount_cents,actor_id)
      values(p_payment_id,v_order.id,v_amount,auth.uid());
    v_sum:=v_sum+v_amount;
  end loop;
  if v_sum<>v_payment.amount_cents then raise exception 'A distribuição deve ser igual ao valor recebido.'; end if;
end;
$$;

revoke all on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.trameli_cancel_customer_order(uuid,integer)
  from public, anon, authenticated;
revoke all on function public.trameli_operator_order(uuid,uuid,integer,date,text,text,text,text,integer,jsonb)
  from public, anon, authenticated;
revoke all on function public.trameli_operator_status(uuid,integer,public.trameli_order_status)
  from public, anon, authenticated;
revoke all on function public.trameli_allocate_payment(uuid,jsonb)
  from public, anon, authenticated;

grant execute on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,text,jsonb)
  to authenticated;
grant execute on function public.trameli_cancel_customer_order(uuid,integer) to authenticated;
grant execute on function public.trameli_operator_order(uuid,uuid,integer,date,text,text,text,text,integer,jsonb)
  to authenticated;
grant execute on function public.trameli_operator_status(uuid,integer,public.trameli_order_status)
  to authenticated;

notify pgrst, 'reload schema';
commit;
