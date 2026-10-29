-- Mantém avisos no Supabase, sem depender das tabelas de push nos bancos isolados de teste.
begin;
CREATE OR REPLACE FUNCTION public.trameli_materialize_recurring_orders(p_delivery_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_schedule public.trameli_recurring_orders%rowtype;
  v_line jsonb;
  v_source_items jsonb;
  v_items jsonb;
  v_subtotal bigint;
  v_order_id uuid;
  v_notification_id uuid;
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

    -- Uma entrega excluída permanece dispensada; a programação segue ativa.
    if exists (
      select 1 from public.trameli_recurring_skipped_dates
      where schedule_id = v_schedule.id and delivery_date = p_delivery_date
    ) then continue; end if;

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

    -- O Supabase real oferece estas tabelas; ambientes locais isolados não.
    if to_regclass('public.trameli_notifications') is not null
       and to_regclass('public.trameli_notification_recipients') is not null then
    insert into public.trameli_notifications(
      created_by, kind, title, body, url, audience, metadata, dedupe_key
    ) values (
      auth.uid(), 'system',
      'Pedido recorrente confirmado 🍞',
      'Seu pedido recorrente de '||to_char(p_delivery_date,'DD/MM')||' foi lançado e já está confirmado.',
      '/?portal=orders#loja', 'system',
      jsonb_build_object(
        'orderId',v_order_id,
        'scheduleId',v_schedule.id,
        'deliveryDate',p_delivery_date,
        'event','recurring_order_created'
      ),
      'order:'||v_order_id::text||':recurring_order_created'
    )
    on conflict (dedupe_key) do nothing
    returning id into v_notification_id;

    if v_notification_id is not null then
      insert into public.trameli_notification_recipients(notification_id,user_id)
      values(v_notification_id,v_schedule.customer_id)
      on conflict do nothing;

      update public.trameli_notifications
      set target_count=1, status='queued', updated_at=now()
      where id=v_notification_id;
    end if;

    end if;

    v_notification_id := null;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$
;
commit;
