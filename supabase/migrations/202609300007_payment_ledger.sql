-- Pagamentos independentes dos estados dos pedidos. Requer 001–006.
-- Aplicar uma vez; não importa custos nem considera pedidos antigos como pagos.
begin;
create table public.trameli_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  request_payload jsonb not null,
  kind text not null check (kind in ('receipt','refund')),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  method text not null check (method in ('pix_manual','cash','bank','other')),
  reference text not null default '' check (char_length(reference) <= 120),
  note text not null default '' check (char_length(note) <= 280),
  reverses_id uuid unique references public.trameli_payments(id),
  actor_id uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  check ((kind = 'refund') = (reverses_id is not null))
);
create table public.trameli_payment_allocations (
  payment_id uuid not null references public.trameli_payments(id),
  order_id uuid not null references public.trameli_orders(id),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  actor_id uuid references auth.users(id),
  assigned_at timestamptz not null default now(),
  primary key(payment_id,order_id)
);
create index trameli_payment_allocations_order_idx on public.trameli_payment_allocations(order_id);
create index trameli_payments_recorded_idx on public.trameli_payments(recorded_at);
create table public.trameli_daily_closings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  day date not null,
  revision integer not null,
  actor_id uuid references auth.users(id),
  closed_at timestamptz not null default now(),
  snapshot jsonb not null,
  unique(day,revision)
);
alter table public.trameli_payments enable row level security;
alter table public.trameli_payment_allocations enable row level security;
alter table public.trameli_daily_closings enable row level security;
create policy allocation_read on public.trameli_payment_allocations for select to authenticated
  using (public.trameli_is_operator() or exists (
    select 1 from public.trameli_orders o where o.id=order_id and o.customer_id=auth.uid()));
-- Payment metadata (operator notes/reference) stays private. Customers use the statement RPC.
create policy payment_operator_read on public.trameli_payments for select to authenticated
  using (public.trameli_is_operator());
create policy closing_operator_read on public.trameli_daily_closings for select to authenticated
  using (public.trameli_is_operator());
revoke all on public.trameli_payments,public.trameli_payment_allocations,public.trameli_daily_closings from anon,authenticated;
grant select on public.trameli_payments,public.trameli_payment_allocations,public.trameli_daily_closings to authenticated;

-- Single source of outstanding balance, including credits caused by cancellation or correction.
create function public.trameli_payment_balances()
returns table(order_id uuid, customer_id uuid, customer_name text, delivery_date date,
  order_status text, total_cents bigint, received_cents bigint, refunded_cents bigint,
  paid_cents bigint, due_cents bigint, refund_due_cents bigint, payment_status text)
language sql stable security definer set search_path='' as $$
  with sums as (
    select a.order_id,
      coalesce(sum(a.amount_cents) filter(where p.kind='receipt'),0)::bigint received,
      coalesce(sum(a.amount_cents) filter(where p.kind='refund'),0)::bigint refunded
    from public.trameli_payment_allocations a join public.trameli_payments p on p.id=a.payment_id
    group by a.order_id
  ), balances as (
    select o.*, case when o.status='cancelled' then 0 else o.total_cents end as charge,
      coalesce(s.received,0) as received, coalesce(s.refunded,0) as refunded,
      coalesce(s.received,0)-coalesce(s.refunded,0) as paid
    from public.trameli_orders o left join sums s on s.order_id=o.id
    where auth.uid() is not null and (public.trameli_is_operator() or o.customer_id=auth.uid())
  )
  select id,customer_id,customer_name,delivery_date,status::text,charge,received,refunded,paid,
    greatest(charge-paid,0),greatest(paid-charge,0),
    case when paid>charge then 'refund_due'
      when paid=0 and refunded>0 then 'refunded'
      when charge=0 then case when status='cancelled' then 'cancelled' else 'paid' end
      when paid=0 then 'open' when paid<charge then 'partial' else 'paid' end
  from balances;
$$;

-- Internal allocation validator. Called only by protected RPCs; locks orders in UUID order.
create function public.trameli_allocate_payment(p_payment_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_payment public.trameli_payments%rowtype; v_line jsonb; v_order public.trameli_orders%rowtype;
  v_amount integer; v_paid bigint; v_sum bigint:=0; v_identity text; v_current_identity text;
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
    if v_amount>v_order.total_cents-v_paid then raise exception 'Valor maior que o saldo do pedido. Atualize a tela.'; end if;
    insert into public.trameli_payment_allocations(payment_id,order_id,amount_cents,actor_id)
      values(p_payment_id,v_order.id,v_amount,auth.uid());
    v_sum:=v_sum+v_amount;
  end loop;
  if v_sum<>v_payment.amount_cents then raise exception 'A distribuição deve ser igual ao valor recebido.'; end if;
end;
$$;

create function public.trameli_record_payment(p_request_id uuid,p_amount_cents integer,p_method text,
  p_reference text,p_note text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_payload jsonb; v_previous jsonb;
begin
  if not public.trameli_is_operator() then raise exception 'Acesso restrito à operação.' using errcode='42501'; end if;
  if p_request_id is null or p_amount_cents is null or p_amount_cents not between 1 and 100000000
    or p_method is null or p_method not in ('pix_manual','cash','bank','other')
    or char_length(coalesce(p_reference,''))>120 or char_length(coalesce(p_note,''))>280
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>100 then
    raise exception 'Dados de pagamento inválidos.';
  end if;
  v_payload:=jsonb_build_object('amount',p_amount_cents,'method',p_method,'reference',coalesce(p_reference,''),'note',coalesce(p_note,''),'lines',p_lines);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,7));
  select id,request_payload into v_id,v_previous from public.trameli_payments where request_id=p_request_id;
  if found then
    if v_previous is distinct from v_payload then raise exception 'Identificador reutilizado com dados diferentes.'; end if;
    return v_id;
  end if;
  insert into public.trameli_payments(request_id,request_payload,kind,amount_cents,method,reference,note,actor_id)
    values(p_request_id,v_payload,'receipt',p_amount_cents,p_method,coalesce(p_reference,''),coalesce(p_note,''),auth.uid()) returning id into v_id;
  if jsonb_array_length(p_lines)>0 then perform public.trameli_allocate_payment(v_id,p_lines); end if;
  return v_id;
end;
$$;

create function public.trameli_identify_payment(p_payment_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.trameli_is_operator() then raise exception 'Acesso restrito à operação.' using errcode='42501'; end if;
  perform public.trameli_allocate_payment(p_payment_id,p_lines);
end;
$$;

-- Registers an actual full refund made outside Trameli; never sends money to a bank.
create function public.trameli_refund_payment(p_request_id uuid,p_payment_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_original public.trameli_payments%rowtype; v_id uuid; v_payload jsonb; v_previous jsonb;
begin
  if not public.trameli_is_operator() then raise exception 'Acesso restrito à operação.' using errcode='42501'; end if;
  if p_request_id is null or char_length(btrim(coalesce(p_reason,''))) not between 3 and 280 then raise exception 'Informe o motivo da devolução.'; end if;
  v_payload:=jsonb_build_object('refund',p_payment_id,'reason',btrim(p_reason));
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,7));
  select id,request_payload into v_id,v_previous from public.trameli_payments where request_id=p_request_id;
  if found then
    if v_previous is distinct from v_payload then raise exception 'Identificador reutilizado com dados diferentes.'; end if;
    return v_id;
  end if;
  select * into v_original from public.trameli_payments where id=p_payment_id for update;
  if not found or v_original.kind<>'receipt' then raise exception 'Recebimento não encontrado.'; end if;
  if exists(select 1 from public.trameli_payments where reverses_id=p_payment_id) then raise exception 'Recebimento já estornado.'; end if;
  perform 1 from public.trameli_orders where id in (
    select order_id from public.trameli_payment_allocations where payment_id=p_payment_id) order by id for update;
  insert into public.trameli_payments(request_id,request_payload,kind,amount_cents,method,reference,note,reverses_id,actor_id)
    values(p_request_id,v_payload,'refund',v_original.amount_cents,v_original.method,v_original.reference,btrim(p_reason),p_payment_id,auth.uid()) returning id into v_id;
  insert into public.trameli_payment_allocations(payment_id,order_id,amount_cents,actor_id)
    select v_id,order_id,amount_cents,auth.uid() from public.trameli_payment_allocations where payment_id=p_payment_id;
  return v_id;
end;
$$;

-- No notes, references, actor IDs or supplier costs in the customer's statement.
create function public.trameli_payment_statement()
returns table(payment_id uuid,order_id uuid,kind text,method text,amount_cents integer,recorded_at timestamptz)
language sql stable security definer set search_path='' as $$
  select p.id,a.order_id,p.kind,p.method,a.amount_cents,p.recorded_at
  from public.trameli_payment_allocations a join public.trameli_payments p on p.id=a.payment_id
  join public.trameli_orders o on o.id=a.order_id
  where auth.uid() is not null and (public.trameli_is_operator() or o.customer_id=auth.uid());
$$;

create function public.trameli_day_snapshot(p_day date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
  select jsonb_build_object('day',p_day,'orders',t.orders,'delivered',t.delivered,'cancelled',t.cancelled,'pending',t.pending,
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
$$;

create function public.trameli_close_day(p_request_id uuid,p_day date) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_day date; v_revision integer;
begin
  if not public.trameli_is_operator() then raise exception 'Acesso restrito à operação.' using errcode='42501'; end if;
  if p_request_id is null or p_day is null or p_day>(now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Escolha hoje ou uma data anterior.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,8));
  select id,day into v_id,v_day from public.trameli_daily_closings where request_id=p_request_id;
  if found then
    if v_day<>p_day then raise exception 'Identificador reutilizado em outra data.'; end if;
    return v_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_day::text,9));
  select coalesce(max(revision),0)+1 into v_revision from public.trameli_daily_closings where day=p_day;
  insert into public.trameli_daily_closings(request_id,day,revision,actor_id,snapshot)
    values(p_request_id,p_day,v_revision,auth.uid(),public.trameli_day_snapshot(p_day)) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.trameli_allocate_payment(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.trameli_payment_balances(),public.trameli_payment_statement(),
  public.trameli_record_payment(uuid,integer,text,text,text,jsonb),public.trameli_identify_payment(uuid,jsonb),
  public.trameli_refund_payment(uuid,uuid,text),public.trameli_day_snapshot(date),public.trameli_close_day(uuid,date) from public,anon;
grant execute on function public.trameli_payment_balances(),public.trameli_payment_statement(),
  public.trameli_record_payment(uuid,integer,text,text,text,jsonb),public.trameli_identify_payment(uuid,jsonb),
  public.trameli_refund_payment(uuid,uuid,text),public.trameli_day_snapshot(date),public.trameli_close_day(uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
