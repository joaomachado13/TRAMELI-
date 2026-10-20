-- Optional daily baskets. Existing schedules continue using their common items.
begin;
alter table public.trameli_recurring_orders add column items_by_weekday jsonb
  check (items_by_weekday is null or jsonb_typeof(items_by_weekday) = 'object');
create schema if not exists private;
create function private.trameli_recurring_items(p_items jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_product public.trameli_products%rowtype; v_line jsonb;
  v_qty integer; v_price integer; v_grams integer; v_kg_price integer;
  v_items jsonb := '[]'::jsonb; v_subtotal bigint := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Cada dia selecionado precisa ter entre 1 e 100 produtos.' using errcode = '22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_items) loop
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

  return v_items;
end;
$$;
revoke all on function private.trameli_recurring_items(jsonb) from public, anon, authenticated;

create function public.trameli_save_recurring_order_daily(
  p_schedule_id uuid, p_request_id uuid, p_customer_id uuid, p_recurrence text,
  p_start_date date, p_active boolean, p_notes text, p_fee_cents integer,
  p_items jsonb, p_weekdays smallint[], p_items_by_weekday jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
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
      v_daily := v_daily || jsonb_build_object(v_day::text,
        private.trameli_recurring_items(p_items_by_weekday -> v_day::text));
    end loop;
    v_items := v_daily -> v_days[1]::text;
  end if;
  v_id := public.trameli_save_recurring_order(p_schedule_id, p_request_id, p_customer_id,
    p_recurrence, p_start_date, p_active, p_notes, p_fee_cents, v_items);
  update public.trameli_recurring_orders set weekdays = v_days,
    items_by_weekday = v_daily, updated_at = now() where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.trameli_save_recurring_order_daily(uuid,uuid,uuid,text,date,boolean,text,integer,jsonb,smallint[],jsonb) from public, anon;
grant execute on function public.trameli_save_recurring_order_daily(uuid,uuid,uuid,text,date,boolean,text,integer,jsonb,smallint[],jsonb) to authenticated;

create or replace function public.trameli_save_recurring_order_with_days(
  p_schedule_id uuid,
  p_request_id uuid,
  p_customer_id uuid,
  p_recurrence text,
  p_start_date date,
  p_active boolean,
  p_notes text,
  p_fee_cents integer,
  p_items jsonb,
  p_weekdays smallint[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_weekdays is null or cardinality(p_weekdays) not between 1 and 6
     or exists(select 1 from unnest(p_weekdays) d where d is null or d not between 1 and 6) then
    raise exception 'invalid recurring weekdays' using errcode = '22023';
  end if;
  if exists(select 1 from public.trameli_recurring_orders
    where (id = p_schedule_id or (p_schedule_id is null and request_id = p_request_id))
      and items_by_weekday is not null) then
    raise exception 'Edite esta programação no Portal da Shirley para preservar os produtos de cada dia.' using errcode = '22023';
  end if;
  v_id := public.trameli_save_recurring_order(
    p_schedule_id, p_request_id, p_customer_id, p_recurrence,
    p_start_date, p_active, p_notes, p_fee_cents, p_items
  );
  update public.trameli_recurring_orders
     set weekdays = (select array_agg(day order by day)
                     from (select distinct unnest(p_weekdays) as day) days),
         updated_at = now()
   where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.trameli_save_recurring_order_with_days(uuid,uuid,uuid,text,date,boolean,text,integer,jsonb,smallint[]) from public, anon;
grant execute on function public.trameli_save_recurring_order_with_days(uuid,uuid,uuid,text,date,boolean,text,integer,jsonb,smallint[]) to authenticated;

create or replace function public.trameli_materialize_recurring_orders(p_delivery_date date)
returns integer
language plpgsql security definer set search_path = '' as $$
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
    if not (extract(dow from p_delivery_date)::smallint = any(v_schedule.weekdays)) then
      continue;
    end if;
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
    v_source_items := case when v_schedule.items_by_weekday is null then v_schedule.items
      else v_schedule.items_by_weekday -> extract(dow from p_delivery_date)::integer::text end;
    if v_source_items is null then
      raise exception 'Programação sem produtos para o dia selecionado.' using errcode = '22023';
    end if;
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

revoke all on function public.trameli_materialize_recurring_orders(date) from public, anon;
grant execute on function public.trameli_materialize_recurring_orders(date) to authenticated;
notify pgrst, 'reload schema';
commit;
