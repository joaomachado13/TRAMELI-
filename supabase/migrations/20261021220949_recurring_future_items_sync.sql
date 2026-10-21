-- Keep future, untouched recurring orders aligned with weekday-specific baskets.
begin;

alter table public.trameli_recurring_occurrences
  add column synced_order_version integer check (synced_order_version > 0);

create function private.trameli_sync_recurring_future(p_schedule_id uuid)
returns integer language plpgsql set search_path = '' as $$
declare
  v_schedule public.trameli_recurring_orders%rowtype;
  v_order public.trameli_orders%rowtype;
  v_items jsonb;
  v_subtotal bigint;
  v_count integer := 0;
begin
  select * into v_schedule from public.trameli_recurring_orders
  where id = p_schedule_id and active for update;
  if not found then return 0; end if;
  for v_order in
    select o.* from public.trameli_recurring_occurrences x
    join public.trameli_orders o on o.id = x.order_id
    where x.schedule_id = p_schedule_id
      and o.customer_id = v_schedule.customer_id
      and o.delivery_date = x.delivery_date
      and o.delivery_date > (now() at time zone 'America/Sao_Paulo')::date
      and o.delivery_date >= v_schedule.starts_on
      and extract(dow from o.delivery_date)::smallint = any(v_schedule.weekdays)
      and o.status = 'confirmed' and o.edited_at is null
      and (x.synced_order_version = o.version or
        (x.synced_order_version is null and o.version = 1 and o.updated_at = o.created_at))
      and not exists(select 1 from public.trameli_payment_allocations a where a.order_id = o.id)
      and not exists(select 1 from public.trameli_payment_intents i
        where i.status = 'pending' and o.id = any(i.order_ids))
    order by o.delivery_date,o.id
    for update of o,x
  loop
    -- Payment RPCs lock the order too. Recheck with a fresh snapshot after
    -- acquiring that lock in case a receipt/signal committed while we waited.
    if exists(select 1 from public.trameli_payment_allocations a where a.order_id = v_order.id)
       or exists(select 1 from public.trameli_payment_intents i
         where i.status = 'pending' and v_order.id = any(i.order_ids)) then
      continue;
    end if;
    v_items := case when v_schedule.items_by_weekday is null then v_schedule.items
      else v_schedule.items_by_weekday -> extract(dow from v_order.delivery_date)::integer::text end;
    if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
      raise exception 'Programação sem produtos para o dia selecionado.' using errcode = '22023';
    end if;
    v_items := private.trameli_apply_customer_prices(v_schedule.customer_id,v_items);
    select sum((line->>'quantity')::bigint * (line->>'priceCents')::bigint)
      into v_subtotal from jsonb_array_elements(v_items) line;
    if v_order.items is distinct from v_items
       or v_order.notes is distinct from v_schedule.notes then
      update public.trameli_orders set items = v_items, subtotal_cents = v_subtotal,
        notes = v_schedule.notes, version = version + 1, updated_at = now()
      where id = v_order.id;
      update public.trameli_recurring_occurrences set synced_order_version = v_order.version + 1
      where schedule_id = p_schedule_id and order_id = v_order.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.trameli_sync_recurring_future(uuid) from public,anon,authenticated;

-- An explicit operator-only repair for already saved schedules. Does not create
-- orders, change past/today deliveries, or overwrite manual/payment activity.
create function public.trameli_sync_recurring_future(p_schedule_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  return private.trameli_sync_recurring_future(p_schedule_id);
end;
$$;
revoke all on function public.trameli_sync_recurring_future(uuid) from public,anon;
grant execute on function public.trameli_sync_recurring_future(uuid) to authenticated;

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
  perform private.trameli_sync_recurring_future(v_id);
  return v_id;
end;
$function$;

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
  perform private.trameli_sync_recurring_future(v_id);
  return v_id;
end;
$$;
revoke all on function public.trameli_save_recurring_order_with_days(uuid,uuid,uuid,text,date,boolean,text,integer,jsonb,smallint[]) from public, anon;
grant execute on function public.trameli_save_recurring_order_with_days(uuid,uuid,uuid,text,date,boolean,text,integer,jsonb,smallint[]) to authenticated;


notify pgrst, 'reload schema';
commit;
