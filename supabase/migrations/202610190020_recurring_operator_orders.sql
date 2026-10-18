-- Recurring operator orders: materialize only the date requested by the operation screen.
-- Each delivery is a normal order row, so the existing payment ledger remains authoritative.
begin;

create table public.trameli_recurring_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid unique,
  recurrence text not null check (recurrence in ('fixed','fortnightly','monthly')),
  starts_on date not null,
  cycle_ends_on date,
  active boolean not null default true,
  notes text not null default '' check (char_length(notes) <= 280),
  fee_cents integer not null default 200 check (fee_cents between 0 and 100000000),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trameli_recurring_orders_active_idx
  on public.trameli_recurring_orders(active, starts_on, cycle_ends_on);
create table public.trameli_recurring_occurrences (
  schedule_id uuid not null references public.trameli_recurring_orders(id),
  delivery_date date not null,
  order_id uuid not null unique references public.trameli_orders(id),
  created_at timestamptz not null default now(),
  primary key(schedule_id, delivery_date)
);
alter table public.trameli_recurring_orders enable row level security;
alter table public.trameli_recurring_occurrences enable row level security;
revoke all on public.trameli_recurring_orders, public.trameli_recurring_occurrences from anon, authenticated;
grant select on public.trameli_recurring_orders, public.trameli_recurring_occurrences to authenticated;
create policy recurring_orders_operator_read on public.trameli_recurring_orders
  for select to authenticated using (public.trameli_is_operator());
create policy recurring_occurrences_operator_read on public.trameli_recurring_occurrences
  for select to authenticated using (public.trameli_is_operator());

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
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.trameli_profiles%rowtype;
  v_line jsonb;
  v_qty integer;
  v_price integer;
  v_items jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_id uuid;
  v_cycle_end date;
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_customer_id is null or p_start_date is null
     or p_recurrence not in ('fixed','fortnightly','monthly')
     or p_fee_cents not between 0 and 100000000
     or char_length(coalesce(p_notes,'')) > 280
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid recurring order' using errcode = '22023';
  end if;
  select * into v_profile from public.trameli_profiles where user_id = p_customer_id;
  if not found then raise exception 'customer profile not found' using errcode = 'P0002'; end if;

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
    v_subtotal := v_subtotal + v_qty::bigint * v_price;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'name', btrim(v_line->>'name'), 'quantity', v_qty, 'priceCents', v_price));
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
      coalesce(p_notes,''), p_fee_cents, v_items, auth.uid()
    ) returning id into v_id;
  else
    update public.trameli_recurring_orders set
      customer_id = p_customer_id, recurrence = p_recurrence, starts_on = p_start_date,
      cycle_ends_on = v_cycle_end, active = coalesce(p_active,true), notes = coalesce(p_notes,''),
      fee_cents = p_fee_cents, items = v_items, updated_at = now()
    where id = p_schedule_id returning id into v_id;
    if v_id is null then raise exception 'recurring order not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.trameli_materialize_recurring_orders(p_delivery_date date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_schedule public.trameli_recurring_orders%rowtype;
  v_schedule_ids uuid[];
  v_schedule_id uuid;
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

  select coalesce(array_agg(id order by created_at, id), '{}'::uuid[])
    into v_schedule_ids
    from public.trameli_recurring_orders
    where active and starts_on <= p_delivery_date;

  foreach v_schedule_id in array v_schedule_ids loop
    select * into v_schedule
      from public.trameli_recurring_orders
      where id = v_schedule_id
      for update;
    if not found or not v_schedule.active then continue; end if;

    -- Start a new billing cycle only when a new date is requested; never pre-create future rows.
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
  v_id := public.trameli_operator_order(
    p_order_id, p_request_id, p_expected_version, p_delivery_date,
    v_profile.name, coalesce(v_profile.phone,''), v_profile.address, p_notes, p_fee_cents, p_items
  );
  update public.trameli_orders set customer_id = p_customer_id
    where id = v_id;
  return v_id;
end;
$$;

create or replace function public.trameli_set_recurring_order_active(
  p_schedule_id uuid,
  p_active boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_schedule_id is null or p_active is null then
    raise exception 'schedule and active state required' using errcode = '22023';
  end if;
  update public.trameli_recurring_orders
     set active = p_active, updated_at = now()
   where id = p_schedule_id;
  if not found then raise exception 'recurring order not found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.trameli_set_recurring_order_active(uuid,boolean) from public, anon;
grant execute on function public.trameli_set_recurring_order_active(uuid,boolean) to authenticated;

revoke all on function public.trameli_operator_order_for_customer(uuid,uuid,integer,date,text,text,text,text,integer,jsonb,uuid) from public, anon;
grant execute on function public.trameli_operator_order_for_customer(uuid,uuid,integer,date,text,text,text,text,integer,jsonb,uuid) to authenticated;

revoke all on function public.trameli_save_recurring_order(uuid,uuid,uuid,text,date,boolean,text,integer,jsonb) from public, anon;
revoke all on function public.trameli_materialize_recurring_orders(date) from public, anon;
grant execute on function public.trameli_save_recurring_order(uuid,uuid,uuid,text,date,boolean,text,integer,jsonb) to authenticated;
grant execute on function public.trameli_materialize_recurring_orders(date) to authenticated;
notify pgrst, 'reload schema';
commit;
