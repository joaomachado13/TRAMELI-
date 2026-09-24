-- Catálogo real e base para separar venda, custo fornecedor e taxa de entrega.
-- Aplicar depois da migração inicial. Os custos reais ficam em importação PRIVADA,
-- fora do Git; não inserir valores de compra neste arquivo público.
begin;

alter table public.trameli_products add column if not exists source_row integer;
alter table public.trameli_products add column if not exists review_reason text;
create unique index if not exists trameli_products_source_row_idx
  on public.trameli_products(source_row) where source_row is not null;

create table if not exists public.trameli_product_costs (
  product_id uuid primary key references public.trameli_products(id) on delete cascade,
  unit_cost_cents integer not null check (unit_cost_cents >= 0 and unit_cost_cents <= 100000000),
  supplier_name text not null default '',
  supplier_source_row integer,
  updated_at timestamptz not null default now()
);
create table if not exists public.trameli_order_costs (
  order_id uuid not null references public.trameli_orders(id) on delete cascade,
  line_index integer not null check (line_index >= 1),
  product_id uuid references public.trameli_products(id) on delete set null,
  quantity integer not null check (quantity between 1 and 999),
  unit_cost_cents integer check (unit_cost_cents >= 0),
  total_cost_cents bigint generated always as (quantity::bigint * unit_cost_cents) stored,
  primary key (order_id, line_index)
);
create index if not exists trameli_order_costs_product_idx on public.trameli_order_costs(product_id);

alter table public.trameli_product_costs enable row level security;
alter table public.trameli_order_costs enable row level security;
create policy costs_operator_read on public.trameli_product_costs for select to authenticated
  using (public.trameli_is_operator());
create policy order_costs_operator_read on public.trameli_order_costs for select to authenticated
  using (public.trameli_is_operator());
revoke all on public.trameli_product_costs, public.trameli_order_costs from anon, authenticated;
grant select on public.trameli_product_costs, public.trameli_order_costs to authenticated;

-- Um custo faltante permanece NULL: nunca representar repasse desconhecido como zero.
create function public.trameli_snapshot_order_costs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_index integer := 0;
  v_product_id uuid;
  v_match_count integer;
  v_unit_cost integer;
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
    select unit_cost_cents into v_unit_cost from public.trameli_product_costs
      where product_id = v_product_id;
    insert into public.trameli_order_costs(order_id, line_index, product_id, quantity, unit_cost_cents)
      values (new.id, v_index, v_product_id, (v_line->>'quantity')::integer, v_unit_cost);
  end loop;
  return new;
end;
$$;
create trigger trameli_order_cost_snapshot after insert or update of items on public.trameli_orders
for each row execute function public.trameli_snapshot_order_costs();

create function public.trameli_save_product_cost(
  p_product_id uuid, p_unit_cost_cents integer, p_supplier_name text
) returns void language plpgsql security definer set search_path = '' as $$
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
  insert into public.trameli_product_costs(product_id, unit_cost_cents, supplier_name)
  values (p_product_id, p_unit_cost_cents, coalesce(p_supplier_name,''))
  on conflict (product_id) do update set unit_cost_cents = excluded.unit_cost_cents,
    supplier_name = excluded.supplier_name, updated_at = now();
end;
$$;
revoke all on function public.trameli_save_product_cost(uuid,integer,text) from public, anon;
grant execute on function public.trameli_save_product_cost(uuid,integer,text) to authenticated;

create function public.trameli_save_product_full(
  p_id uuid, p_name text, p_category text, p_unit text, p_image_url text,
  p_price_cents integer, p_active boolean, p_cost_cents integer, p_supplier_name text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := public.trameli_save_product(p_id, p_name, p_category, p_unit,
    p_image_url, p_price_cents, p_active);
  perform public.trameli_save_product_cost(v_id, p_cost_cents, p_supplier_name);
  if p_active then
    update public.trameli_products set review_reason = null where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.trameli_save_product_full(uuid,text,text,text,text,integer,boolean,integer,text) from public, anon;
grant execute on function public.trameli_save_product_full(uuid,text,text,text,text,integer,boolean,integer,text) to authenticated;

create function public.trameli_order_cost_summary(p_from date default null, p_to date default null)
returns table(order_id uuid, line_count integer, missing_count integer, supplier_total_cents bigint)
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
