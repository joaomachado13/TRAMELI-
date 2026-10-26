create or replace function public.trameli_queue_order_event(p_order_id uuid, p_event text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := auth.uid();
  v_order public.trameli_orders%rowtype;
  v_operator boolean;
  v_id uuid;
  v_title text;
  v_body text;
  v_url text;
  v_dedupe text;
  v_recipient uuid;
begin
  if v_user is null then raise exception 'login required' using errcode='42501'; end if;

  -- "Entregue" é silencioso: a operação pode atualizar esse status dias depois.
  if p_event = 'status_delivered' then
    return null;
  end if;

  select * into v_order from public.trameli_orders where id=p_order_id;
  if not found then raise exception 'order not found' using errcode='P0002'; end if;
  v_operator := public.trameli_is_operator();

  if p_event in ('new_order','order_edited','order_cancelled') then
    if not v_operator and v_order.customer_id is distinct from v_user then
      raise exception 'order access required' using errcode='42501';
    end if;
  elsif p_event in ('operator_order_created','status_confirmed','status_ready','status_cancelled') then
    if not v_operator then raise exception 'operator access required' using errcode='42501'; end if;
  else
    raise exception 'invalid notification event' using errcode='22023';
  end if;

  v_dedupe := 'order:'||v_order.id::text||':'||p_event||':v'||v_order.version::text;

  case p_event
    when 'new_order' then
      v_title := 'Novo pedido recebido';
      v_body := v_order.customer_name||' · entrega '||to_char(v_order.delivery_date,'DD/MM');
      v_url := '/?open-order='||v_order.id::text||'#operacao';
    when 'order_cancelled' then
      v_title := 'Pedido cancelado';
      v_body := v_order.customer_name||' cancelou o pedido de '||to_char(v_order.delivery_date,'DD/MM')||'.';
      v_url := '/?open-order='||v_order.id::text||'#operacao';
    when 'operator_order_created' then
      v_title := 'Novo pedido no Pão Doce 🍞';
      v_body := 'A Shirley registrou um pedido para '||to_char(v_order.delivery_date,'DD/MM')||'. Confira os itens.';
      v_url := '/?portal=orders#loja';
      v_recipient := v_order.customer_id;
    when 'order_edited' then
      if v_operator then
        v_title := 'Seu pedido foi atualizado';
        v_body := 'A operação atualizou seu pedido de '||to_char(v_order.delivery_date,'DD/MM')||'.';
        v_url := '/?portal=orders#loja';
        v_recipient := v_order.customer_id;
      else
        v_title := 'Pedido alterado pelo cliente';
        v_body := v_order.customer_name||' atualizou o pedido de '||to_char(v_order.delivery_date,'DD/MM')||'.';
        v_url := '/?open-order='||v_order.id::text||'#operacao';
      end if;
    when 'status_confirmed' then
      v_title := 'Pedido confirmado 🍞';
      v_body := 'Seu pedido de '||to_char(v_order.delivery_date,'DD/MM')||' foi conferido.';
      v_url := '/?portal=orders#loja';
      v_recipient := v_order.customer_id;
    when 'status_ready' then
      v_title := 'Pedido pronto';
      v_body := 'Seu pedido de '||to_char(v_order.delivery_date,'DD/MM')||' está pronto para a entrega.';
      v_url := '/?portal=orders#loja';
      v_recipient := v_order.customer_id;
    else
      v_title := 'Pedido cancelado';
      v_body := 'Seu pedido de '||to_char(v_order.delivery_date,'DD/MM')||' foi cancelado pela operação.';
      v_url := '/?portal=orders#loja';
      v_recipient := v_order.customer_id;
  end case;

  insert into public.trameli_notifications(created_by,kind,title,body,url,audience,metadata,dedupe_key)
  values(v_user,'system',v_title,v_body,v_url,'system',
    jsonb_build_object('orderId',v_order.id,'event',p_event,'orderCode',v_order.public_code),v_dedupe)
  on conflict(dedupe_key) do nothing returning id into v_id;

  if v_id is null then
    select id into v_id from public.trameli_notifications where dedupe_key=v_dedupe;
    return v_id;
  end if;

  if v_recipient is not null then
    insert into public.trameli_notification_recipients(notification_id,user_id)
    values(v_id,v_recipient) on conflict do nothing;
  else
    insert into public.trameli_notification_recipients(notification_id,user_id)
    select v_id,user_id from public.trameli_operators on conflict do nothing;
  end if;

  update public.trameli_notifications n
  set target_count=(select count(*) from public.trameli_notification_recipients r where r.notification_id=n.id),
      status=case when exists(select 1 from public.trameli_notification_recipients r where r.notification_id=n.id) then 'queued' else 'failed' end,
      updated_at=now()
  where n.id=v_id;
  return v_id;
end;
$function$;

create or replace function public.trameli_materialize_recurring_orders(p_delivery_date date)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
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

    v_notification_id := null;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.trameli_queue_daily_order_reminders()
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_delivery date := (now() at time zone 'America/Sao_Paulo')::date + 1;
  v_key text := 'daily-order-reminder:' || v_delivery::text;
  v_id uuid;
  v_count integer;
begin
  if extract(isodow from v_delivery)=7 then return null; end if;

  insert into public.trameli_notifications(
    kind,title,body,url,audience,metadata,dedupe_key
  ) values (
    'reminder','Vai querer pão amanhã? 🍞',
    'Você costuma pedir neste dia e ainda não fez o pedido de amanhã. Os pedidos ficam abertos até às 21h.',
    '/?portal=catalog#loja','system',
    jsonb_build_object('deliveryDate',v_delivery,'reminder','usual-order'),
    v_key
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then return null; end if;

  with frequent as (
    select o.customer_id
    from public.trameli_orders o
    where o.customer_id is not null
      and o.status <> 'cancelled'
      and o.delivery_date >= v_delivery - 90
      and o.delivery_date < v_delivery
      and extract(isodow from o.delivery_date)=extract(isodow from v_delivery)
    group by o.customer_id
    having count(*) >= 2
  )
  insert into public.trameli_notification_recipients(notification_id,user_id)
  select v_id,f.customer_id
  from frequent f
  where not exists (
    select 1 from public.trameli_orders o
    where o.customer_id=f.customer_id
      and o.delivery_date=v_delivery
      and o.status <> 'cancelled'
  )
  on conflict do nothing;

  select count(*)::integer into v_count
  from public.trameli_notification_recipients
  where notification_id=v_id;

  if v_count=0 then
    delete from public.trameli_notifications where id=v_id;
    return null;
  end if;

  update public.trameli_notifications
     set target_count=v_count, updated_at=now()
   where id=v_id;
  return v_id;
end;
$function$;

create or replace function public.trameli_queue_payment_reminders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_row record;
  v_id uuid;
  v_kind text;
  v_key text;
  v_amount text;
  v_created integer := 0;
begin
  for v_row in
    with payment_sums as (
      select a.order_id,
        coalesce(sum(a.amount_cents) filter(where p.kind='receipt'),0)::bigint
        - coalesce(sum(a.amount_cents) filter(where p.kind='refund'),0)::bigint as paid_cents
      from public.trameli_payment_allocations a
      join public.trameli_payments p on p.id=a.payment_id
      group by a.order_id
    ),
    due_orders as (
      select o.customer_id,
        greatest(o.total_cents-coalesce(ps.paid_cents,0),0)::bigint as due_cents,
        case
          when pr.billing_frequency='mensal'
            then (date_trunc('month',o.delivery_date)::date + interval '1 month - 1 day')::date
          when pr.billing_frequency='quinzenal' and extract(day from o.delivery_date)<=15
            then date_trunc('month',o.delivery_date)::date + 14
          when pr.billing_frequency='quinzenal'
            then (date_trunc('month',o.delivery_date)::date + interval '1 month - 1 day')::date
          else null
        end as closing_date
      from public.trameli_orders o
      join public.trameli_profiles pr on pr.user_id=o.customer_id
      left join payment_sums ps on ps.order_id=o.id
      where o.customer_id is not null
        and o.status <> 'cancelled'
        and pr.billing_frequency in ('quinzenal','mensal')
    )
    select customer_id, closing_date, sum(due_cents)::bigint due_cents
    from due_orders
    where due_cents>0
      and closing_date in (v_today, v_today-3)
    group by customer_id,closing_date
  loop
    v_kind := case when v_row.closing_date=v_today then 'closing' else 'grace' end;
    v_key := 'payment-reminder:' || v_row.customer_id::text || ':' || v_row.closing_date::text || ':' || v_kind;
    v_amount := replace(to_char(v_row.due_cents::numeric / 100,'FM999999990D00'),'.',',');

    insert into public.trameli_notifications(
      kind,title,body,url,audience,metadata,dedupe_key
    ) values (
      'reminder',
      case when v_kind='closing' then 'Seu fechamento está pronto 💳' else 'Último dia para pagar' end,
      case when v_kind='closing'
        then 'Há R$ ' || v_amount || ' em aberto neste fechamento. Veja os detalhes no Pão Doce.'
        else 'Seu prazo de 3 dias termina hoje. Há R$ ' || v_amount || ' em aberto; evite o bloqueio de novos pedidos.'
      end,
      '/?portal=orders#loja','system',
      jsonb_build_object('customerId',v_row.customer_id,'closingDate',v_row.closing_date,'dueCents',v_row.due_cents,'reminder',v_kind),
      v_key
    )
    on conflict (dedupe_key) do nothing
    returning id into v_id;

    if v_id is not null then
      insert into public.trameli_notification_recipients(notification_id,user_id)
      values(v_id,v_row.customer_id)
      on conflict do nothing;
      update public.trameli_notifications set target_count=1,updated_at=now() where id=v_id;
      v_created := v_created + 1;
    end if;
    v_id := null;
  end loop;
  return v_created;
end;
$function$;
