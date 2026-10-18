-- Future recurring deliveries are operationally visible but not payable until their delivery date.
begin;

create or replace function public.trameli_payment_balances()
returns table(
  order_id uuid, customer_id uuid, customer_name text, delivery_date date,
  order_status text, total_cents bigint, received_cents bigint, refunded_cents bigint,
  paid_cents bigint, due_cents bigint, refund_due_cents bigint, payment_status text
)
language sql stable security definer set search_path = '' as $$
  with sums as (
    select a.order_id,
      coalesce(sum(a.amount_cents) filter(where p.kind='receipt'),0)::bigint received,
      coalesce(sum(a.amount_cents) filter(where p.kind='refund'),0)::bigint refunded
    from public.trameli_payment_allocations a
    join public.trameli_payments p on p.id=a.payment_id
    group by a.order_id
  ), balances as (
    select o.*, case when o.status='cancelled' then 0 else o.total_cents end as charge,
      coalesce(s.received,0) as received, coalesce(s.refunded,0) as refunded,
      coalesce(s.received,0)-coalesce(s.refunded,0) as paid
    from public.trameli_orders o
    left join sums s on s.order_id=o.id
    where auth.uid() is not null
      and (public.trameli_is_operator() or o.customer_id=auth.uid())
      and not exists (
        select 1
        from public.trameli_recurring_occurrences recurring
        where recurring.order_id=o.id
          and recurring.delivery_date > (now() at time zone 'America/Sao_Paulo')::date
      )
  )
  select id,customer_id,customer_name,delivery_date,status::text,charge,received,refunded,paid,
    greatest(charge-paid,0),greatest(paid-charge,0),
    case when paid>charge then 'refund_due'
      when paid=0 and refunded>0 then 'refunded'
      when charge=0 then case when status='cancelled' then 'cancelled' else 'paid' end
      when paid=0 then 'open' when paid<charge then 'partial' else 'paid' end
  from balances;
$$;

revoke all on function public.trameli_payment_balances() from public, anon;
grant execute on function public.trameli_payment_balances() to authenticated;
notify pgrst, 'reload schema';
commit;
