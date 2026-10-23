-- Automatic purchase block after the 3-day payment grace period.
-- Applies to fortnightly/monthly billing only. Manual blocks remain independent.

create or replace function private.trameli_customer_purchase_status(
  p_customer_id uuid,
  p_reference_date date default (now() at time zone 'America/Sao_Paulo')::date
)
returns table(
  blocked boolean,
  block_kind text,
  reason text,
  billing_frequency text,
  closing_date date,
  grace_until date,
  due_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_profile public.trameli_profiles%rowtype;
begin
  if p_customer_id is null then
    return query select false, 'clear'::text, ''::text, null::text, null::date, null::date, 0::bigint;
    return;
  end if;

  select * into v_profile
  from public.trameli_profiles
  where user_id = p_customer_id;

  if not found then
    return query select false, 'clear'::text, ''::text, null::text, null::date, null::date, 0::bigint;
    return;
  end if;

  if coalesce(v_profile.order_blocked, false) then
    return query select
      true,
      'manual'::text,
      coalesce(nullif(btrim(v_profile.order_block_reason), ''), 'Novos pedidos bloqueados pela operação.')::text,
      v_profile.billing_frequency,
      null::date,
      null::date,
      0::bigint;
    return;
  end if;

  if v_profile.billing_frequency not in ('quinzenal', 'mensal') then
    return query select false, 'clear'::text, ''::text, v_profile.billing_frequency, null::date, null::date, 0::bigint;
    return;
  end if;

  return query
  with payment_sums as (
    select
      a.order_id,
      coalesce(sum(a.amount_cents) filter (where p.kind = 'receipt'), 0)::bigint
      - coalesce(sum(a.amount_cents) filter (where p.kind = 'refund'), 0)::bigint as paid_cents
    from public.trameli_payment_allocations a
    join public.trameli_payments p on p.id = a.payment_id
    group by a.order_id
  ),
  open_orders as (
    select
      o.delivery_date,
      greatest(o.total_cents - coalesce(ps.paid_cents, 0), 0)::bigint as order_due_cents,
      case
        when v_profile.billing_frequency = 'mensal'
          then (date_trunc('month', o.delivery_date)::date + interval '1 month - 1 day')::date
        when extract(day from o.delivery_date) <= 15
          then date_trunc('month', o.delivery_date)::date + 14
        else (date_trunc('month', o.delivery_date)::date + interval '1 month - 1 day')::date
      end as period_closing_date
    from public.trameli_orders o
    left join payment_sums ps on ps.order_id = o.id
    where o.customer_id = p_customer_id
      and o.status <> 'cancelled'
  ),
  overdue_periods as (
    select
      period_closing_date,
      sum(order_due_cents)::bigint as period_due_cents
    from open_orders
    where order_due_cents > 0
    group by period_closing_date
    having p_reference_date > period_closing_date + 3
  )
  select
    true,
    'overdue'::text,
    ('Pagamento do fechamento de ' || to_char(op.period_closing_date, 'DD/MM/YYYY') || ' em atraso.')::text,
    v_profile.billing_frequency,
    op.period_closing_date,
    op.period_closing_date + 3,
    op.period_due_cents
  from overdue_periods op
  order by op.period_closing_date
  limit 1;

  if not found then
    return query select false, 'clear'::text, ''::text, v_profile.billing_frequency, null::date, null::date, 0::bigint;
  end if;
end;
$function$;

revoke all on function private.trameli_customer_purchase_status(uuid,date) from public, anon, authenticated;

create or replace function public.trameli_customer_purchase_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_status record;
begin
  if v_user is null then
    raise exception 'login required' using errcode = '42501';
  end if;

  select * into v_status
  from private.trameli_customer_purchase_status(
    v_user,
    (now() at time zone 'America/Sao_Paulo')::date
  );

  return jsonb_build_object(
    'blocked', coalesce(v_status.blocked, false),
    'kind', coalesce(v_status.block_kind, 'clear'),
    'reason', coalesce(v_status.reason, ''),
    'billingFrequency', v_status.billing_frequency,
    'closingDate', v_status.closing_date,
    'graceUntil', v_status.grace_until,
    'dueCents', coalesce(v_status.due_cents, 0)
  );
end;
$function$;

revoke all on function public.trameli_customer_purchase_status() from public, anon;
grant execute on function public.trameli_customer_purchase_status() to authenticated;

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
  v_purchase record;
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

  if p_order_id is null then
    select * into v_purchase
    from private.trameli_customer_purchase_status(v_user, v_local_now::date);

    if coalesce(v_purchase.blocked, false) then
      if v_purchase.block_kind = 'overdue' then
        raise exception 'Novos pedidos bloqueados por pagamento em atraso. Quite o fechamento pendente em Meus pagamentos para liberar as compras automaticamente.'
          using errcode = '42501';
      end if;
      raise exception 'Novos pedidos estão bloqueados. Fale com a Shirley para liberar sua conta.'
        using errcode = '42501';
    end if;
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
    if not found or v_order.customer_id is distinct from v_user
      or v_order.status not in ('received','confirmed','packing','ready')
      or v_order.version is distinct from p_expected_version
      or v_local_now > v_order.delivery_date - 1 + v_cutoff
      or p_delivery_date is distinct from v_order.delivery_date then
      raise exception 'order changed, cutoff exceeded or order cannot be edited';
    end if;
    update public.trameli_orders set customer_name = btrim(p_name), phone = coalesce(p_phone,''),
      address = btrim(p_address), notes = coalesce(p_notes,''), items = v_items,
      payment_method_preference = p_payment_method, subtotal_cents = v_subtotal,
      fee_cents = v_fee, status = 'received', edited_at = now(), edited_by = v_user,
      version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
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
  v_purchase record;
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

    select * into v_purchase
    from private.trameli_customer_purchase_status(
      v_schedule.customer_id,
      (now() at time zone 'America/Sao_Paulo')::date
    );
    if coalesce(v_purchase.blocked, false) then
      continue;
    end if;

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

revoke all on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,text,jsonb) from public, anon;
grant execute on function public.trameli_customer_order(uuid,uuid,integer,date,text,text,text,text,text,jsonb) to authenticated;

revoke all on function public.trameli_materialize_recurring_orders(date) from public, anon;
grant execute on function public.trameli_materialize_recurring_orders(date) to authenticated;

notify pgrst, 'reload schema';
