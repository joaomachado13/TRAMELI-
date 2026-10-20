-- Exclui uma programação e somente as ocorrências/pedidos que ela gerou.
-- Registros de recebimentos/estornos são mantidos; apenas os vínculos aos pedidos excluídos saem.
begin;

create or replace function public.trameli_delete_recurring_order(
  p_schedule_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_ids uuid[];
  v_deleted integer := 0;
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_schedule_id is null then
    raise exception 'schedule id required' using errcode = '22023';
  end if;

  perform 1
    from public.trameli_recurring_orders
   where id = p_schedule_id
   for update;
  if not found then
    raise exception 'recurring order not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(order_id), array[]::uuid[])
    into v_order_ids
    from public.trameli_recurring_occurrences
   where schedule_id = p_schedule_id;

  if cardinality(v_order_ids) > 0 then
    -- Remove IDs excluídos de intents que também contêm outros pedidos.
    -- Intents que apontam exclusivamente para estes pedidos são removidas.
    delete from public.trameli_payment_intents i
     where i.order_ids <@ v_order_ids;

    update public.trameli_payment_intents i
       set order_ids = (
         select array_agg(x.order_id order by x.ordinality)
           from unnest(i.order_ids) with ordinality as x(order_id, ordinality)
          where not (x.order_id = any(v_order_ids))
       )
     where i.order_ids && v_order_ids
       and not (i.order_ids <@ v_order_ids);

    -- Pagamentos e estornos são registros contábeis: mantenha-os e remova
    -- somente a alocação para os pedidos que serão excluídos.
    delete from public.trameli_payment_allocations
     where order_id = any(v_order_ids);

    delete from public.trameli_order_events
     where order_id = any(v_order_ids);

    delete from public.trameli_recurring_occurrences
     where schedule_id = p_schedule_id;

    delete from public.trameli_orders
     where id = any(v_order_ids);

    get diagnostics v_deleted = row_count;
  end if;

  delete from public.trameli_recurring_orders
   where id = p_schedule_id;

  return v_deleted;
end;
$$;

revoke all on function public.trameli_delete_recurring_order(uuid) from public, anon;
grant execute on function public.trameli_delete_recurring_order(uuid) to authenticated;
notify pgrst, 'reload schema';

commit;
