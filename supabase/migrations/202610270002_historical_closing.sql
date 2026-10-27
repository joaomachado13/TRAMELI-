-- Integra os valores anteriores ao aplicativo ao prazo de pagamento e ao resumo diario.
CREATE OR REPLACE FUNCTION private.trameli_customer_purchase_status(p_customer_id uuid, p_reference_date date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date)
 RETURNS TABLE(blocked boolean, block_kind text, reason text, billing_frequency text, closing_date date, grace_until date, due_cents bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if coalesce(v_profile.billing_frequency, '') not in ('quinzenal', 'mensal') then
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
  open_history as (
    select
      h.amount_cents::bigint as order_due_cents,
      case
        when v_profile.billing_frequency = 'mensal'
          then (date_trunc('month', h.entry_date)::date + interval '1 month - 1 day')::date
        when extract(day from h.entry_date) <= 15
          then date_trunc('month', h.entry_date)::date + 14
        else (date_trunc('month', h.entry_date)::date + interval '1 month - 1 day')::date
      end as period_closing_date
    from public.trameli_historical_finances h
    where h.customer_id = p_customer_id and h.status = 'pending' and h.removed_at is null
  ),
  overdue_periods as (
    select
      period_closing_date,
      sum(order_due_cents)::bigint as period_due_cents
    from (
      select period_closing_date,order_due_cents from open_orders
      union all
      select period_closing_date,order_due_cents from open_history
    ) charges
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
$function$
;
CREATE OR REPLACE FUNCTION public.trameli_day_snapshot(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if not public.trameli_is_operator() then raise exception 'Acesso restrito à operação.' using errcode='42501'; end if;
  if p_day is null then raise exception 'Informe a data.'; end if;
  -- One statement, one MVCC snapshot. Delivery-date balances and registration-date receipts are separate.
  with orders as (select * from public.trameli_orders where delivery_date=p_day),
  balances as (select * from public.trameli_payment_balances() where delivery_date=p_day),
  costs as (select * from public.trameli_order_cost_summary(p_day,p_day)),
  totals as (
    select count(*) as orders,count(*) filter(where status='delivered') as delivered,
      count(*) filter(where status='cancelled') as cancelled,
      count(*) filter(where status not in ('delivered','cancelled')) as pending,
      coalesce(sum(subtotal_cents) filter(where status<>'cancelled'),0) as products,
      coalesce(sum(fee_cents) filter(where status<>'cancelled'),0) as delivery from orders
  ), cost_totals as (
    select coalesce(sum(missing_count),0) as missing,coalesce(sum(estimated_count),0) as estimated,
      coalesce(sum(supplier_total_cents),0) as supplier from costs
  ), receipts as (
    select coalesce(sum(amount_cents) filter(where kind='receipt'),0) as received,
      coalesce(sum(amount_cents) filter(where kind='receipt' and method='pix_manual'),0) as pix,
      coalesce(sum(amount_cents) filter(where kind='refund'),0) as refunded
    from public.trameli_payments where (recorded_at at time zone 'America/Sao_Paulo')::date=p_day
  )
  select jsonb_build_object('day',p_day,
    'historical_total_cents', coalesce((select sum(amount_cents) from public.trameli_historical_finances where entry_date=p_day and removed_at is null),0),
    'historical_paid_cents', coalesce((select sum(amount_cents) from public.trameli_historical_finances where entry_date=p_day and status='paid' and removed_at is null),0),
    'historical_due_cents', coalesce((select sum(amount_cents) from public.trameli_historical_finances where entry_date=p_day and status='pending' and removed_at is null),0),'orders',t.orders,'delivered',t.delivered,'cancelled',t.cancelled,'pending',t.pending,
    'products_cents',t.products,'delivery_cents',t.delivery,'total_cents',t.products+t.delivery,
    'supplier_cents',c.supplier,'missing_cost_items',c.missing,'estimated_cost_items',c.estimated,
    'profit_cents',case when c.missing=0 then t.products-c.supplier else null end,
    'due_cents',coalesce((select sum(due_cents) from balances),0),
    'refund_due_cents',coalesce((select sum(refund_due_cents) from balances),0),
    'paid_for_orders_cents',coalesce((select sum(paid_cents) from balances),0),
    'received_on_day_cents',r.received,'pix_manual_on_day_cents',r.pix,'refunded_on_day_cents',r.refunded,
    'net_received_on_day_cents',r.received-r.refunded,
    'order_balances',coalesce((select jsonb_agg(to_jsonb(b) order by b.order_id) from balances b),'[]'::jsonb))
  into v_result from totals t cross join cost_totals c cross join receipts r;
  return v_result;
end;
$function$
;
notify pgrst,'reload schema';
