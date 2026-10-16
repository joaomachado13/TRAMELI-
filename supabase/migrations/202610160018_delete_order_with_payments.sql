-- Permite que o Master exclua um pedido que já tem pagamento vinculado, escolhendo o destino do pagamento:
--   'keep'   -> exclui o pedido e mantém o dinheiro registrado (o pagamento fica sem pedido vinculado);
--   'delete' -> exclui o pedido e também os pagamentos (e estornos) que ficariam sem nenhum pedido;
--   'none'   -> comportamento anterior: recusa se houver pagamento vinculado.
-- Fechamentos diários já salvos são fotografias e não mudam. Requer as migrações anteriores (ledger e Master).
begin;

create or replace function public.trameli_master_delete_order_with_payments(p_order_id uuid, p_payment_mode text default 'none')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_linked uuid[];
  v_count integer;
begin
  perform public.trameli_require_master_aal2();
  if p_payment_mode not in ('none', 'keep', 'delete') then
    raise exception 'Modo de pagamento inválido.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.trameli_orders where id = p_order_id) then
    raise exception 'Pedido não encontrado.';
  end if;

  select array_agg(distinct payment_id), count(*) into v_linked, v_count
    from public.trameli_payment_allocations where order_id = p_order_id;

  if v_count > 0 and p_payment_mode = 'none' then
    raise exception 'Este pedido possui pagamentos vinculados. Escolha manter o pagamento ou excluir pedido e pagamento.';
  end if;

  delete from public.trameli_payment_intents where p_order_id = any(order_ids);
  delete from public.trameli_payment_allocations where order_id = p_order_id;

  if p_payment_mode = 'delete' and v_linked is not null then
    -- Estornos primeiro (referenciam o recebimento); só sai o pagamento que ficou sem nenhum pedido.
    delete from public.trameli_payments p
      where p.id = any(v_linked) and p.kind = 'refund'
        and not exists (select 1 from public.trameli_payment_allocations a where a.payment_id = p.id);
    delete from public.trameli_payments p
      where p.id = any(v_linked) and p.kind = 'receipt'
        and not exists (select 1 from public.trameli_payment_allocations a where a.payment_id = p.id)
        and not exists (select 1 from public.trameli_payments r where r.reverses_id = p.id);
  end if;

  delete from public.trameli_order_costs where order_id = p_order_id;
  delete from public.trameli_order_events where order_id = p_order_id;
  delete from public.trameli_orders where id = p_order_id;
end;
$$;
revoke all on function public.trameli_master_delete_order_with_payments(uuid, text) from public, anon;
grant execute on function public.trameli_master_delete_order_with_payments(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
