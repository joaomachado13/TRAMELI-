-- Distingue custo confirmado de estimativa inferida; nunca apresenta estimativa como lucro fechado.
begin;

alter table public.trameli_product_costs add column if not exists estimated boolean not null default false;
alter table public.trameli_order_costs add column if not exists estimated boolean not null default false;

create or replace function public.trameli_snapshot_order_costs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb; v_index integer := 0; v_product_id uuid;
  v_match_count integer; v_unit_cost integer; v_grams integer;
  v_estimated boolean;
begin
  delete from public.trameli_order_costs where order_id = new.id;
  for v_line in select value from jsonb_array_elements(new.items) loop
    v_index := v_index + 1;
    v_product_id := nullif(v_line->>'productId', '')::uuid;
    if v_product_id is null then
      select count(*), (array_agg(id))[1] into v_match_count, v_product_id
      from public.trameli_products
      where active and lower(btrim(name)) = lower(btrim(v_line->>'name'));
      if v_match_count <> 1 then v_product_id := null; end if;
    end if;
    select unit_cost_cents, estimated into v_unit_cost, v_estimated
      from public.trameli_product_costs where product_id = v_product_id;
    if v_line ? 'weightGrams' and v_unit_cost is not null then
      v_grams := (v_line->>'weightGrams')::integer;
      v_unit_cost := round(v_unit_cost::numeric * v_grams / 1000)::integer;
    end if;
    insert into public.trameli_order_costs(order_id, line_index, product_id, quantity, unit_cost_cents, estimated)
      values (new.id, v_index, v_product_id, (v_line->>'quantity')::integer, v_unit_cost, coalesce(v_estimated, false));
  end loop;
  return new;
end;
$$;

create or replace function public.trameli_save_product_cost(
  p_product_id uuid, p_unit_cost_cents integer, p_supplier_name text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_existing public.trameli_product_costs%rowtype;
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.trameli_products where id = p_product_id) then
    raise exception 'product not found';
  end if;
  if p_unit_cost_cents is null then
    delete from public.trameli_product_costs where product_id = p_product_id;
    return;
  end if;
  if p_unit_cost_cents not between 0 and 100000000
    or char_length(coalesce(p_supplier_name,'')) > 90 then
    raise exception 'invalid supplier cost';
  end if;
  select * into v_existing from public.trameli_product_costs where product_id = p_product_id;
  if found and v_existing.unit_cost_cents = p_unit_cost_cents
    and v_existing.supplier_name = coalesce(p_supplier_name,'') then
    return; -- editar outro campo do produto não confirma um custo estimado
  end if;
  insert into public.trameli_product_costs(product_id, unit_cost_cents, supplier_name, estimated)
  values (p_product_id, p_unit_cost_cents, coalesce(p_supplier_name,''), false)
  on conflict (product_id) do update set unit_cost_cents = excluded.unit_cost_cents,
    supplier_name = excluded.supplier_name, estimated = false, updated_at = now();
end;
$$;

create function public.trameli_confirm_product_cost(p_product_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  update public.trameli_product_costs set estimated = false, updated_at = now()
    where product_id = p_product_id and estimated;
  if not found then raise exception 'provisional cost not found'; end if;
end;
$$;
revoke all on function public.trameli_confirm_product_cost(uuid) from public, anon;
grant execute on function public.trameli_confirm_product_cost(uuid) to authenticated;

drop function public.trameli_order_cost_summary(date,date);
create function public.trameli_order_cost_summary(p_from date default null, p_to date default null)
returns table(order_id uuid, line_count integer, missing_count integer, estimated_count integer, supplier_total_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  return query
    select o.id,
      jsonb_array_length(o.items)::integer,
      (jsonb_array_length(o.items) - count(c.line_index)
        + count(*) filter (where c.line_index is not null and c.unit_cost_cents is null))::integer,
      count(*) filter (where c.line_index is not null and c.estimated)::integer,
      coalesce(sum(c.total_cost_cents), 0)::bigint
    from public.trameli_orders o
    left join public.trameli_order_costs c on c.order_id = o.id
    where (p_from is null or o.delivery_date >= p_from)
      and (p_to is null or o.delivery_date <= p_to)
      and o.status <> 'cancelled'
    group by o.id, o.items;
end;
$$;
revoke all on function public.trameli_order_cost_summary(date,date) from public, anon;
grant execute on function public.trameli_order_cost_summary(date,date) to authenticated;

commit;
