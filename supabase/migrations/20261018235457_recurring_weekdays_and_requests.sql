-- Weekly recurring orders and customer requests. Existing orders and payment rows are untouched.
begin;

alter table public.trameli_recurring_orders
  add column weekdays smallint[] not null default array[1,2,3,4,5,6]::smallint[]
  check (cardinality(weekdays) between 1 and 6
    and 0 <> all(weekdays)
    and weekdays <@ array[1,2,3,4,5,6]::smallint[]);

create table public.trameli_recurring_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.trameli_orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  weekdays smallint[] not null
    check (cardinality(weekdays) between 1 and 6
      and 0 <> all(weekdays)
      and weekdays <@ array[1,2,3,4,5,6]::smallint[]),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  recurring_schedule_id uuid references public.trameli_recurring_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trameli_recurring_requests_status_idx
  on public.trameli_recurring_requests(status, created_at desc);
alter table public.trameli_recurring_requests enable row level security;
revoke all on public.trameli_recurring_requests from anon, authenticated;
grant select on public.trameli_recurring_requests to authenticated;
create policy recurring_requests_customer_or_operator_read
  on public.trameli_recurring_requests for select to authenticated
  using (customer_id = auth.uid() or public.trameli_is_operator());

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
     or 0 = any(p_weekdays) or not (p_weekdays <@ array[1,2,3,4,5,6]::smallint[]) then
    raise exception 'invalid recurring weekdays' using errcode = '22023';
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

create or replace function public.trameli_request_recurring_order(
  p_order_id uuid,
  p_weekdays smallint[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.trameli_orders%rowtype;
  v_id uuid;
begin
  if auth.uid() is null or p_order_id is null then
    raise exception 'customer order required' using errcode = '22023';
  end if;
  if p_weekdays is null or cardinality(p_weekdays) not between 1 and 6
     or 0 = any(p_weekdays) or not (p_weekdays <@ array[1,2,3,4,5,6]::smallint[]) then
    raise exception 'invalid recurring weekdays' using errcode = '22023';
  end if;
  select * into v_order from public.trameli_orders
   where id = p_order_id and customer_id = auth.uid();
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if v_order.status = 'cancelled' or v_order.source <> 'portal' then
    raise exception 'order cannot be used for a recurring request' using errcode = '22023';
  end if;
  insert into public.trameli_recurring_requests(order_id, customer_id, weekdays, status, reviewed_by, reviewed_at, recurring_schedule_id, updated_at)
  values (v_order.id, auth.uid(),
    (select array_agg(day order by day) from (select distinct unnest(p_weekdays) as day) days),
    'pending', null, null, null, now())
  on conflict (order_id) do update set
    weekdays = excluded.weekdays,
    status = 'pending',
    reviewed_by = null,
    reviewed_at = null,
    recurring_schedule_id = null,
    updated_at = now()
  where public.trameli_recurring_requests.status <> 'approved'
  returning id into v_id;
  if v_id is null then
    raise exception 'order already has an approved recurring schedule' using errcode = '22023';
  end if;
  return v_id;
end;
$$;
revoke all on function public.trameli_request_recurring_order(uuid,smallint[]) from public, anon;
grant execute on function public.trameli_request_recurring_order(uuid,smallint[]) to authenticated;

create or replace function public.trameli_review_recurring_request(
  p_request_id uuid,
  p_approve boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.trameli_recurring_requests%rowtype;
  v_order public.trameli_orders%rowtype;
  v_profile public.trameli_profiles%rowtype;
  v_schedule_id uuid;
  v_start date;
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_request_id is null or p_approve is null then
    raise exception 'request and decision required' using errcode = '22023';
  end if;
  select * into v_request from public.trameli_recurring_requests
   where id = p_request_id for update;
  if not found then raise exception 'recurring request not found' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then
    raise exception 'recurring request already reviewed' using errcode = '22023';
  end if;
  if not p_approve then
    update public.trameli_recurring_requests set status='rejected', reviewed_by=auth.uid(),
      reviewed_at=now(), updated_at=now() where id=v_request.id;
    return null;
  end if;
  select * into v_order from public.trameli_orders where id=v_request.order_id;
  if not found or v_order.status='cancelled' then
    raise exception 'source order is no longer available' using errcode = '22023';
  end if;
  select * into v_profile from public.trameli_profiles where user_id=v_request.customer_id;
  if not found then raise exception 'customer profile not found' using errcode = 'P0002'; end if;

  v_start := greatest(v_order.delivery_date, (now() at time zone 'America/Sao_Paulo')::date + 1);
  insert into public.trameli_recurring_orders(
    customer_id, request_id, recurrence, starts_on, cycle_ends_on, active, notes,
    fee_cents, items, created_by, weekdays
  ) values (
    v_request.customer_id, gen_random_uuid(), 'fixed', v_start, null, true,
    coalesce(v_order.notes,''), v_order.fee_cents, v_order.items, auth.uid(), v_request.weekdays
  ) returning id into v_schedule_id;

  update public.trameli_recurring_requests set status='approved', reviewed_by=auth.uid(),
    reviewed_at=now(), recurring_schedule_id=v_schedule_id, updated_at=now()
   where id=v_request.id;
  return v_schedule_id;
end;
$$;
revoke all on function public.trameli_review_recurring_request(uuid,boolean) from public, anon;
grant execute on function public.trameli_review_recurring_request(uuid,boolean) to authenticated;

-- Keep the existing order/payment model; only skip materialization on unselected weekdays.
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
    for v_line in select value from jsonb_array_elements(v_schedule.items) loop
      v_subtotal := v_subtotal
        + (v_line->>'quantity')::integer * (v_line->>'priceCents')::integer;
      v_items := v_items || jsonb_build_array(v_line);
    end loop;

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
