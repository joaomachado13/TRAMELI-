-- Permit only Master to reopen an accidentally finalized delivery, returning it to Ready.
-- Cancelled orders remain final; ordinary operators cannot reopen delivered orders.
create or replace function public.trameli_operator_status(
  p_order_id uuid, p_expected_version integer, p_status public.trameli_order_status
) returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.trameli_order_status; v_master boolean;
begin
  if not public.trameli_is_operator() then raise exception 'operator access required' using errcode = '42501'; end if;
  select status into v_old from public.trameli_orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if p_expected_version is null or not exists(
    select 1 from public.trameli_orders where id = p_order_id and version = p_expected_version
  ) then raise exception 'order changed; reload before editing'; end if;
  if (v_old = 'cancelled' or (v_old = 'delivered' and not public.trameli_is_master())) or p_status is null then
    raise exception 'finalized order cannot change status'; end if;
  v_master := public.trameli_is_master();
  if not (
    (v_old = 'received' and p_status in ('confirmed','cancelled')) or
    (v_old = 'confirmed' and p_status = 'packing') or
    (v_old = 'packing' and p_status = 'ready') or
    (v_old = 'ready' and p_status = 'delivered') or
    (v_master and v_old = 'confirmed' and p_status in ('received','cancelled')) or
    (v_master and v_old = 'packing' and p_status in ('confirmed','cancelled')) or
    (v_master and v_old = 'ready' and p_status in ('packing','cancelled')) or
    (v_master and v_old = 'delivered' and p_status = 'ready')
  ) then raise exception 'invalid status transition or master access required'; end if;
  update public.trameli_orders set status = p_status, version = version + 1, updated_at = now()
  where id = p_order_id and version = p_expected_version;
  if not found then raise exception 'order changed; reload before editing'; end if;
end;
$$;

-- A receipt may cover one or many orders from the same account, but each selected
-- order must be settled for its entire current outstanding balance.
create or replace function public.trameli_allocate_payment(p_payment_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_payment public.trameli_payments%rowtype; v_line jsonb; v_order public.trameli_orders%rowtype;
  v_amount integer; v_paid bigint; v_due bigint; v_sum bigint:=0; v_identity text; v_current_identity text;
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
    v_due:=greatest(v_order.total_cents-v_paid,0);
    if v_due=0 or v_amount<>v_due then
      raise exception 'Cada pedido selecionado deve ser quitado pelo saldo integral atual. Atualize a tela.';
    end if;
    insert into public.trameli_payment_allocations(payment_id,order_id,amount_cents,actor_id)
      values(p_payment_id,v_order.id,v_amount,auth.uid());
    v_sum:=v_sum+v_amount;
  end loop;
  if v_sum<>v_payment.amount_cents then raise exception 'A distribuição deve ser igual ao valor recebido.'; end if;
end;
$$;
