-- TRAMELI: ativação única do catálogo (migrações 002–005).
-- Executar TODO o arquivo no SQL Editor do projeto TRAMELI, como postgres.
-- Requer a migração inicial 001. Compatível com o acesso Master 006 já aplicado.
-- Não reaplica 001/006, não altera contas nem pedidos antigos.
-- Não importa custos privados. Faça backup antes de alterações de estrutura.
-- Tudo fica na mesma transação: qualquer erro desfaz esta ativação.
-- Se já houver catálogo ou estrutura de custos, PARA sem sobrescrever dados.
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(20260930, 25);
do $preflight$
begin
  if to_regclass('public.trameli_products') is null then
    raise exception 'Base inicial ausente. Não execute novamente: solicite revisão.';
  end if;
  if to_regclass('public.trameli_product_costs') is not null
    or to_regclass('public.trameli_order_costs') is not null then
    raise exception 'Estrutura de custos já instalada. Pare e solicite revisão; não reaplique este pacote.';
  end if;
  if exists (select 1 from public.trameli_products) then
    raise exception 'Já existem produtos no banco. Pare e solicite revisão para preservar o catálogo.';
  end if;
end;
$preflight$;

-- === 202609240002_catalog_finance.sql ===
-- Catálogo real e base para separar venda, custo fornecedor e taxa de entrega.
-- Aplicar depois da migração inicial. Os custos reais ficam em importação PRIVADA,
-- fora do Git; não inserir valores de compra neste arquivo público.

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

-- === 202609240003_catalog_seed.sql ===
-- Preços de venda transcritos de DADOS PADARIA.xlsx, aba Valores cliente.
-- Custos da aba Valores Padaria NÃO ficam no repositório público.
-- Itens ambíguos permanecem inativos até revisão da operadora.
insert into public.trameli_products
  (id, name, category, unit, image_url, price_cents, active, source_row, review_reason)
values
  ('20260924-0000-4000-8000-000000000002', 'Pão francês', 'Pães', 'unidade', null, 140, true, 2, null),
  ('20260924-0000-4000-8000-000000000003', 'Pão de batata/milho', 'Pães', 'unidade', null, 280, true, 3, null),
  ('20260924-0000-4000-8000-000000000004', 'Pão de queijo', 'Pães', 'unidade', null, 130, true, 4, null),
  ('20260924-0000-4000-8000-000000000005', 'Mini roscas', 'Bolos e doces', 'unidade', null, 195, true, 5, null),
  ('20260924-0000-4000-8000-000000000006', 'Rosca Caseira', 'Bolos e doces', 'unidade', null, 1000, true, 6, null),
  ('20260924-0000-4000-8000-000000000007', 'Pct Pão de Batata/Milho', 'Pães', 'pacote', null, 1000, true, 7, null),
  ('20260924-0000-4000-8000-000000000008', 'Pct Pão Doce', 'Pães', 'pacote', null, 1200, true, 8, null),
  ('20260924-0000-4000-8000-000000000009', 'Mini Donuts', 'Bolos e doces', 'unidade', null, 270, true, 9, null),
  ('20260924-0000-4000-8000-00000000000a', 'Donuts', 'Bolos e doces', 'unidade', null, 900, true, 10, null),
  ('20260924-0000-4000-8000-00000000000b', 'Lua de mel', 'Bolos e doces', 'unidade', null, 195, true, 11, null),
  ('20260924-0000-4000-8000-00000000000c', 'Biscoito Frito', 'Bolos e doces', 'unidade', null, 300, true, 12, null),
  ('20260924-0000-4000-8000-00000000000d', 'Broa', 'Bolos e doces', 'unidade', null, 200, true, 13, null),
  ('20260924-0000-4000-8000-00000000000e', 'Broa mini', 'Bolos e doces', 'unidade', null, 150, true, 14, null),
  ('20260924-0000-4000-8000-00000000000f', 'Biscoito da vovó', 'Bolos e doces', 'unidade', null, 300, true, 15, null),
  ('20260924-0000-4000-8000-000000000010', 'Rosca Simples', 'Bolos e doces', 'unidade', null, 300, true, 16, null),
  ('20260924-0000-4000-8000-000000000011', 'Rosca Diversas', 'Bolos e doces', 'unidade', null, 330, true, 17, null),
  ('20260924-0000-4000-8000-000000000012', 'Rosca média', 'Bolos e doces', 'unidade', null, 1500, true, 18, null),
  ('20260924-0000-4000-8000-000000000013', 'Bolo', 'Bolos e doces', 'unidade', null, 2400, true, 19, null),
  ('20260924-0000-4000-8000-000000000014', 'Mussarela', 'Frios e laticínios', 'a confirmar', null, 1078, false, 20, 'Unidade de venda não informada'),
  ('20260924-0000-4000-8000-000000000015', 'Presunto', 'Frios e laticínios', 'a confirmar', null, 616, false, 21, 'Unidade de venda não informada'),
  ('20260924-0000-4000-8000-000000000016', 'Mortadela', 'Frios e laticínios', 'a confirmar', null, 864, false, 22, 'Unidade de venda não informada'),
  ('20260924-0000-4000-8000-000000000017', 'Cookies', 'Bolos e doces', 'unidade', null, 170, true, 23, null),
  ('20260924-0000-4000-8000-000000000018', 'Rosquinha de queijo', 'Outros', 'unidade', null, 195, true, 24, null),
  ('20260924-0000-4000-8000-000000000019', 'Sonho pequeno', 'Bolos e doces', 'unidade', null, 375, true, 25, null),
  ('20260924-0000-4000-8000-00000000001a', 'Sonho', 'Bolos e doces', 'unidade', null, 550, true, 26, null),
  ('20260924-0000-4000-8000-00000000001b', 'Pão de queijo grande', 'Pães', 'unidade', null, 300, true, 27, null),
  ('20260924-0000-4000-8000-00000000001c', 'Carolina', 'Bolos e doces', 'unidade', null, 150, true, 28, null),
  ('20260924-0000-4000-8000-00000000001d', 'Ferradura', 'Bolos e doces', 'unidade', null, 100, true, 29, null),
  ('20260924-0000-4000-8000-00000000001e', 'Mini salgados', 'Salgados', 'unidade', null, 195, true, 30, null),
  ('20260924-0000-4000-8000-000000000020', 'casadinho doce de leite', 'Bolos e doces', 'unidade', null, 100, true, 32, null),
  ('20260924-0000-4000-8000-000000000021', 'Manteiga Taquari 200g', 'Frios e laticínios', 'unidade', null, 1299, true, 33, null),
  ('20260924-0000-4000-8000-000000000022', 'Manteiga Calu 200g', 'Frios e laticínios', 'unidade', null, 1949, true, 34, null),
  ('20260924-0000-4000-8000-000000000023', 'Manteiga Aralat', 'Frios e laticínios', 'unidade', null, 1400, true, 35, null),
  ('20260924-0000-4000-8000-000000000024', 'Manteiga Italac 200g', 'Frios e laticínios', 'unidade', null, 500, false, 36, 'Preço de venda menor que o custo informado'),
  ('20260924-0000-4000-8000-000000000025', 'Manteiga Tourinho 200g', 'Frios e laticínios', 'unidade', null, 1700, true, 37, null),
  ('20260924-0000-4000-8000-000000000026', 'Manteiga Canto de Minas 200g', 'Frios e laticínios', 'unidade', null, 1700, true, 38, null),
  ('20260924-0000-4000-8000-000000000027', 'Bolo indiano', 'Bolos e doces', 'unidade', null, 1400, true, 39, null),
  ('20260924-0000-4000-8000-000000000028', 'Pudim pequeno', 'Bolos e doces', 'unidade', null, 800, true, 40, null),
  ('20260924-0000-4000-8000-000000000029', 'Suco kapo', 'Bebidas', 'unidade', null, 300, true, 41, null),
  ('20260924-0000-4000-8000-00000000002a', 'Pão de forma', 'Pães', 'unidade', null, 950, false, 42, 'Nome repetido com preço diferente na planilha'),
  ('20260924-0000-4000-8000-00000000002b', 'Pão de forma', 'Pães', 'unidade', null, 1200, false, 43, 'Nome repetido com preço diferente na planilha'),
  ('20260924-0000-4000-8000-00000000002c', 'Rosca gaúcha', 'Bolos e doces', 'unidade', null, 250, true, 44, null),
  ('20260924-0000-4000-8000-00000000002d', 'Palha italiana', 'Bolos e doces', 'unidade', null, 200, true, 45, null),
  ('20260924-0000-4000-8000-00000000002e', 'Suco Pratis grande', 'Bebidas', 'unidade', null, 1690, true, 46, null),
  ('20260924-0000-4000-8000-00000000002f', 'Requeijão', 'Frios e laticínios', 'unidade', null, 1400, true, 47, null),
  ('20260924-0000-4000-8000-000000000030', 'Peito de Peru', 'Frios e laticínios', 'a confirmar', null, 1134, false, 48, 'Unidade de venda não informada'),
  ('20260924-0000-4000-8000-000000000031', 'Biscoito de Queijo', 'Bolos e doces', 'unidade', null, 300, true, 49, null),
  ('20260924-0000-4000-8000-000000000032', 'Bolacha de nata', 'Bolos e doces', 'unidade', null, 400, true, 50, null),
  ('20260924-0000-4000-8000-000000000033', 'Biscoitão', 'Outros', 'unidade', null, 400, true, 51, null),
  ('20260924-0000-4000-8000-000000000034', 'Bomba de chocolate', 'Bolos e doces', 'unidade', null, 300, true, 52, null),
  ('20260924-0000-4000-8000-000000000035', 'Pão Sovado', 'Pães', 'unidade', null, 1000, true, 53, null),
  ('20260924-0000-4000-8000-000000000036', 'Sequilhos', 'Bolos e doces', 'unidade', null, 100, true, 54, null),
  ('20260924-0000-4000-8000-000000000037', 'Leite Caixinha', 'Frios e laticínios', 'unidade', null, 750, true, 55, null),
  ('20260924-0000-4000-8000-000000000038', 'Leite saquinho', 'Frios e laticínios', 'unidade', null, 750, true, 56, null),
  ('20260924-0000-4000-8000-000000000039', 'Café Cajubá 500g', 'Bebidas', 'unidade', null, 4400, true, 57, null),
  ('20260924-0000-4000-8000-00000000003a', 'Pudim médio', 'Bolos e doces', 'unidade', null, 3500, true, 58, null),
  ('20260924-0000-4000-8000-00000000003b', 'Ovos', 'Frios e laticínios', 'unidade', null, 150, true, 59, null),
  ('20260924-0000-4000-8000-00000000003c', 'Dúzia Ovos', 'Frios e laticínios', 'dúzia', null, 1500, true, 60, null),
  ('20260924-0000-4000-8000-00000000003d', 'Café Cajubá 250g', 'Bebidas', 'unidade', null, 2300, true, 61, null),
  ('20260924-0000-4000-8000-00000000003e', 'Bolo pedaço fubá/mandioca', 'Bolos e doces', 'pedaço', null, 650, true, 62, null),
  ('20260924-0000-4000-8000-00000000003f', 'Fatia bolo cenoura/chocolate', 'Bolos e doces', 'fatia', null, 699, true, 63, null),
  ('20260924-0000-4000-8000-000000000040', 'Fatia fubá cremoso', 'Outros', 'fatia', null, 799, true, 64, null),
  ('20260924-0000-4000-8000-000000000041', 'Biscoito de nata', 'Bolos e doces', 'unidade', null, 400, true, 65, null),
  ('20260924-0000-4000-8000-000000000042', 'Coca 2l', 'Bebidas', 'unidade', null, 1300, true, 66, null),
  ('20260924-0000-4000-8000-000000000043', 'Mini pão', 'Pães', 'unidade', null, 65, false, 67, 'Nome repetido com preço diferente na planilha'),
  ('20260924-0000-4000-8000-000000000044', 'Manteiga Taquari 500g', 'Frios e laticínios', 'unidade', null, 3149, true, 68, null),
  ('20260924-0000-4000-8000-000000000045', 'Dell Vale 1L', 'Bebidas', 'unidade', null, 1400, true, 69, null),
  ('20260924-0000-4000-8000-000000000046', 'Manteiga Calu 500g', 'Frios e laticínios', 'unidade', null, 3999, true, 70, null),
  ('20260924-0000-4000-8000-000000000047', 'Salgados grande', 'Salgados', 'unidade', null, 700, true, 71, null),
  ('20260924-0000-4000-8000-000000000048', 'Pão de mel', 'Pães', 'unidade', null, 195, true, 72, null),
  ('20260924-0000-4000-8000-000000000049', 'Toddy', 'Bebidas', 'unidade', null, 1349, true, 73, null),
  ('20260924-0000-4000-8000-00000000004a', 'Mini pão', 'Pães', 'unidade', null, 70, false, 74, 'Nome repetido com preço diferente na planilha'),
  ('20260924-0000-4000-8000-00000000004b', 'Nescau', 'Bebidas', 'unidade', null, 1299, true, 75, null),
  ('20260924-0000-4000-8000-00000000004c', 'Margarina 500g', 'Frios e laticínios', 'unidade', null, 1300, true, 76, null),
  ('20260924-0000-4000-8000-00000000004d', 'Margarina 250g', 'Frios e laticínios', 'unidade', null, 600, true, 77, null),
  ('20260924-0000-4000-8000-00000000004e', 'Requeijão grande', 'Frios e laticínios', 'unidade', null, 1699, true, 78, null),
  ('20260924-0000-4000-8000-00000000004f', 'Pão de queijo congelado', 'Pães', 'unidade', null, 3000, true, 79, null),
  ('20260924-0000-4000-8000-000000000050', 'Leite em pó', 'Frios e laticínios', 'unidade', null, 2600, true, 80, null),
  ('20260924-0000-4000-8000-000000000051', 'Torrada', 'Pães', 'unidade', null, 950, true, 81, null),
  ('20260924-0000-4000-8000-000000000052', 'Samantha', 'Bolos e doces', 'unidade', null, 170, true, 82, null),
  ('20260924-0000-4000-8000-000000000053', 'Biscoito provolone', 'Bolos e doces', 'unidade', null, 250, true, 83, null)
on conflict (id) do nothing;

-- === 202609250004_weighted_frios.sql ===
-- Confirmações de venda: frios por kg, com seleção em intervalos de 50 g.
-- Executar após 202609240003_catalog_seed.sql. Não altera custos da padaria.

update public.trameli_products as p set
  name = v.name, price_cents = v.price_cents, unit = v.unit,
  active = v.active, review_reason = v.review_reason, updated_at = now()
from (values
  (20, 'Mussarela', 6999, 'kg', true, null::text),
  (21, 'Presunto', 4000, 'kg', true, null::text),
  (22, 'Mortadela defumada', 4000, 'kg', true, null::text),
  (36, 'Manteiga Italac 200g', 1700, 'unidade', true, null::text),
  (43, 'Pão de forma', 1200, 'unidade', true, null::text),
  (48, 'Peito de peru', 5999, 'kg', true, null::text),
  (74, 'Mini pão francês', 70, 'unidade', true, null::text)
) as v(source_row, name, price_cents, unit, active, review_reason)
where p.source_row = v.source_row;

-- Preço do cliente sempre é recalculado no servidor a partir do preço por kg.
create or replace function public.trameli_customer_order(
  p_order_id uuid, p_request_id uuid, p_expected_version integer, p_delivery_date date,
  p_name text, p_phone text, p_address text, p_notes text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_order public.trameli_orders%rowtype;
  v_line jsonb; v_product public.trameli_products%rowtype;
  v_qty integer; v_grams integer; v_price integer;
  v_items jsonb := '[]'::jsonb; v_subtotal bigint := 0; v_id uuid;
begin
  if v_user is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_delivery_date < (now() at time zone 'America/Sao_Paulo')::date
    or p_delivery_date > (now() at time zone 'America/Sao_Paulo')::date + 90
    or char_length(btrim(coalesce(p_name,''))) not between 2 and 90
    or char_length(btrim(coalesce(p_address,''))) not between 3 and 180
    or char_length(coalesce(p_phone,'')) > 25 or char_length(coalesce(p_notes,'')) > 280
    or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'invalid order';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' or (v_line->>'product_id') is null then
      raise exception 'invalid order line';
    end if;
    select * into v_product from public.trameli_products
      where id = (v_line->>'product_id')::uuid and active;
    if not found then raise exception 'product unavailable'; end if;
    if v_product.unit = 'kg' then
      if coalesce(v_line->>'grams', '') !~ '^[0-9]{2,4}$' then raise exception 'invalid weight'; end if;
      v_grams := (v_line->>'grams')::integer;
      if v_grams not between 50 and 4950 or v_grams % 50 <> 0 then raise exception 'invalid weight'; end if;
      v_price := round(v_product.price_cents::numeric * v_grams / 1000)::integer;
      v_subtotal := v_subtotal + v_price;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'name', v_product.name, 'quantity', 1,
        'weightGrams', v_grams, 'kgPriceCents', v_product.price_cents,
        'priceCents', v_price));
    else
      if coalesce(v_line->>'quantity', '') !~ '^[0-9]{1,2}$' then raise exception 'invalid quantity'; end if;
      v_qty := (v_line->>'quantity')::integer;
      if v_qty not between 1 and 99 then raise exception 'invalid quantity'; end if;
      v_subtotal := v_subtotal + v_qty::bigint * v_product.price_cents;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'name', v_product.name,
        'quantity', v_qty, 'priceCents', v_product.price_cents));
    end if;
  end loop;
  insert into public.trameli_profiles(user_id, name, phone, address)
    values (v_user, btrim(p_name), coalesce(p_phone,''), btrim(p_address))
    on conflict (user_id) do update set name = excluded.name, phone = excluded.phone,
      address = excluded.address, updated_at = now();
  if p_order_id is null then
    if p_request_id is null then raise exception 'request id required'; end if;
    select id into v_id from public.trameli_orders
      where request_id = p_request_id and customer_id = v_user;
    if v_id is not null then return v_id; end if;
    insert into public.trameli_orders(customer_id, source, request_id, customer_name, phone, address,
      delivery_date, notes, items, subtotal_cents, fee_cents)
    values (v_user, 'portal', p_request_id, btrim(p_name), coalesce(p_phone,''), btrim(p_address),
      p_delivery_date, coalesce(p_notes,''), v_items, v_subtotal, 200)
    on conflict (request_id) do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.trameli_orders
        where request_id = p_request_id and customer_id = v_user;
      if v_id is null then raise exception 'request id already used'; end if;
    end if;
  else
    select * into v_order from public.trameli_orders where id = p_order_id for update;
    if not found or v_order.customer_id is distinct from v_user or v_order.source <> 'portal'
      or v_order.status <> 'received' or v_order.delivery_date < (now() at time zone 'America/Sao_Paulo')::date
      or v_order.version is distinct from p_expected_version then
      raise exception 'order changed or cannot be edited';
    end if;
    update public.trameli_orders set customer_name = btrim(p_name), phone = coalesce(p_phone,''),
      address = btrim(p_address), notes = coalesce(p_notes,''), items = v_items,
      subtotal_cents = v_subtotal, version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- A operadora pode lançar frios manualmente por peso, mantendo o preço/kg no histórico.
create or replace function public.trameli_operator_order(
  p_order_id uuid, p_request_id uuid, p_expected_version integer, p_delivery_date date,
  p_name text, p_phone text, p_address text, p_notes text,
  p_fee_cents integer, p_items jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb; v_qty integer; v_price integer; v_grams integer; v_kg_price integer;
  v_product public.trameli_products%rowtype;
  v_items jsonb := '[]'::jsonb; v_subtotal bigint := 0;
  v_id uuid; v_old public.trameli_orders%rowtype;
begin
  if not public.trameli_is_operator() then raise exception 'operator access required' using errcode = '42501'; end if;
  if p_delivery_date is null or char_length(btrim(coalesce(p_name,''))) not between 2 and 90
    or char_length(btrim(coalesce(p_address,''))) not between 3 and 180
    or char_length(coalesce(p_phone,'')) > 25 or char_length(coalesce(p_notes,'')) > 280
    or p_fee_cents not between 0 and 100000000
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid order';
  end if;
  for v_line in select value from jsonb_array_elements(p_items) loop
    if char_length(btrim(coalesce(v_line->>'name',''))) not between 2 and 90
      or coalesce(v_line->>'quantity', '') !~ '^[0-9]{1,3}$'
      or coalesce(v_line->>'priceCents', '') !~ '^[0-9]{1,9}$' then raise exception 'invalid line'; end if;
    v_qty := (v_line->>'quantity')::integer;
    v_price := (v_line->>'priceCents')::integer;
    if v_qty not between 1 and 999 or v_price > 100000000 then raise exception 'invalid line'; end if;
    if v_line ? 'weightGrams' then
      if coalesce(v_line->>'weightGrams', '') !~ '^[0-9]{2,4}$'
        or coalesce(v_line->>'kgPriceCents', '') !~ '^[0-9]{1,9}$'
        or (v_line->>'productId') is null then raise exception 'invalid weight'; end if;
      v_grams := (v_line->>'weightGrams')::integer;
      v_kg_price := (v_line->>'kgPriceCents')::integer;
      if v_grams not between 50 and 4950 or v_grams % 50 <> 0
        or v_kg_price > 100000000 or v_qty <> 1
        or v_price <> round(v_kg_price::numeric * v_grams / 1000)::integer then
        raise exception 'invalid weight';
      end if;
      select * into v_product from public.trameli_products
        where id = (v_line->>'productId')::uuid and unit = 'kg' and active;
      if not found or v_product.name <> btrim(v_line->>'name') then raise exception 'weighted product unavailable'; end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id, 'name', v_product.name, 'quantity', 1,
        'weightGrams', v_grams, 'kgPriceCents', v_kg_price, 'priceCents', v_price));
    else
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'name', btrim(v_line->>'name'), 'quantity', v_qty, 'priceCents', v_price));
    end if;
    v_subtotal := v_subtotal + v_qty::bigint * v_price;
  end loop;
  if p_order_id is null then
    if p_request_id is null then raise exception 'request id required'; end if;
    select id into v_id from public.trameli_orders where request_id = p_request_id;
    if v_id is not null then return v_id; end if;
    insert into public.trameli_orders(source, request_id, customer_name, phone, address, delivery_date,
      notes, items, subtotal_cents, fee_cents)
    values ('operator', p_request_id, btrim(p_name), coalesce(p_phone,''), btrim(p_address), p_delivery_date,
      coalesce(p_notes,''), v_items, v_subtotal, p_fee_cents)
    on conflict (request_id) do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.trameli_orders where request_id = p_request_id;
      if v_id is null then raise exception 'request id already used'; end if;
    end if;
  else
    select * into v_old from public.trameli_orders where id = p_order_id for update;
    if not found or v_old.version is distinct from p_expected_version then
      raise exception 'order changed; reload before editing'; end if;
    if v_old.status in ('delivered','cancelled') then
      raise exception 'finalized order cannot be edited'; end if;
    update public.trameli_orders set customer_name = btrim(p_name), phone = coalesce(p_phone,''),
      address = btrim(p_address), delivery_date = p_delivery_date,
      notes = coalesce(p_notes,''), items = v_items, subtotal_cents = v_subtotal,
      fee_cents = p_fee_cents, version = version + 1, updated_at = now()
    where id = p_order_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Custos da padaria para itens por kg são armazenados como custo da porção vendida.
-- A tabela privada de produtos continua guardando o custo de 1 kg.
create or replace function public.trameli_snapshot_order_costs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb; v_index integer := 0; v_product_id uuid;
  v_match_count integer; v_unit_cost integer; v_grams integer;
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
    if v_line ? 'weightGrams' and v_unit_cost is not null then
      v_grams := (v_line->>'weightGrams')::integer;
      v_unit_cost := round(v_unit_cost::numeric * v_grams / 1000)::integer;
    end if;
    insert into public.trameli_order_costs(order_id, line_index, product_id, quantity, unit_cost_cents)
      values (new.id, v_index, v_product_id, (v_line->>'quantity')::integer, v_unit_cost);
  end loop;
  return new;
end;
$$;

-- === 202609250005_provisional_costs.sql ===
-- Distingue custo confirmado de estimativa inferida; nunca apresenta estimativa como lucro fechado.

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

-- Fotos oficiais reconhecidas; não cria produtos a partir de fotografias.
update public.trameli_products p set image_url = v.image_url
from (values
  ('20260924-0000-4000-8000-00000000000d'::uuid, 'assets/products/oficiais/broas.jpeg'),
  ('20260924-0000-4000-8000-000000000031'::uuid, 'assets/products/oficiais/biscoito-de-queijo.jpeg'),
  ('20260924-0000-4000-8000-00000000001e'::uuid, 'assets/products/oficiais/mini-salgadinhos.jpeg'),
  ('20260924-0000-4000-8000-000000000033'::uuid, 'assets/products/oficiais/biscoitao.jpeg'),
  ('20260924-0000-4000-8000-00000000000a'::uuid, 'assets/products/oficiais/donuts.jpeg'),
  ('20260924-0000-4000-8000-00000000001a'::uuid, 'assets/products/oficiais/sonho.jpeg'),
  ('20260924-0000-4000-8000-000000000004'::uuid, 'assets/products/oficiais/pao-de-queijo.jpeg'),
  ('20260924-0000-4000-8000-000000000002'::uuid, 'assets/products/oficiais/pao-frances.jpeg'),
  ('20260924-0000-4000-8000-00000000000c'::uuid, 'assets/products/oficiais/biscoito-frito.jpeg'),
  ('20260924-0000-4000-8000-00000000003f'::uuid, 'assets/products/oficiais/pedaco-de-cenoura.jpeg'),
  ('20260924-0000-4000-8000-000000000018'::uuid, 'assets/products/oficiais/rosquinha-de-queijo.jpeg'),
  ('20260924-0000-4000-8000-000000000003'::uuid, 'assets/products/oficiais/pao-de-batata.jpeg'),
  ('20260924-0000-4000-8000-00000000000f'::uuid, 'assets/products/oficiais/biscoito-da-vovo.jpeg'),
  ('20260924-0000-4000-8000-000000000041'::uuid, 'assets/products/oficiais/biscoito-de-nata.jpeg'),
  ('20260924-0000-4000-8000-000000000017'::uuid, 'assets/products/oficiais/cookies.jpeg'),
  ('20260924-0000-4000-8000-000000000009'::uuid, 'assets/products/oficiais/mini-donuts.jpeg')
) v(id, image_url)
where p.id = v.id and p.image_url is null;

do $verify$
begin
  if (select count(*) from public.trameli_products) <> 81
    or (select count(*) from public.trameli_products where active) <> 79
    or (select count(*) from public.trameli_products where image_url is not null) <> 16 then
    raise exception 'Contagem inesperada. Ativação cancelada sem salvar alterações.';
  end if;
end;
$verify$;
notify pgrst, 'reload schema';
commit;

-- Resultado esperado: 81 / 79 / 2 / 16.
select count(*)::integer as produtos_cadastrados,
  count(*) filter (where active)::integer as produtos_disponiveis,
  count(*) filter (where not active)::integer as produtos_indisponiveis,
  count(*) filter (where image_url is not null)::integer as produtos_com_foto
from public.trameli_products;
