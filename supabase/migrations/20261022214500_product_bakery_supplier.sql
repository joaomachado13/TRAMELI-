-- Padaria responsável por produto.
-- A classificação operacional deixa de depender do nome do item.

alter table public.trameli_products
  add column if not exists bakery_supplier text not null default 'divano';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trameli_products_bakery_supplier_check'
      and conrelid = 'public.trameli_products'::regclass
  ) then
    alter table public.trameli_products
      add constraint trameli_products_bakery_supplier_check
      check (bakery_supplier in ('divano','sandra'));
  end if;
end
$$;

comment on column public.trameli_products.bakery_supplier is
  'Padaria responsável pelo item na operação: divano ou sandra.';

-- Mantém a lista oficial já usada pela operação e inclui os novos itens informados pela Shirley.
update public.trameli_products
set bakery_supplier = 'sandra',
    updated_at = now()
where lower(btrim(name)) in (
  'broa',
  'broa doce',
  'broa salgada',
  'carolina doce de leite',
  'biscoito provolone',
  'bolacha de nata',
  'biscoito de nata',
  'biscoito de queijo',
  'biscoito da vovó'
);

create or replace function public.trameli_save_product_operational(
  p_id uuid,
  p_name text,
  p_category text,
  p_unit text,
  p_image_url text,
  p_price_cents integer,
  p_active boolean,
  p_cost_cents integer,
  p_supplier_name text,
  p_unavailable_from date,
  p_unavailable_until date,
  p_substitute_product_id uuid,
  p_bakery_supplier text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_bakery_supplier text := lower(btrim(coalesce(p_bakery_supplier, 'divano')));
begin
  if not public.trameli_is_operator() then
    raise exception 'Acesso restrito à operação.' using errcode='42501';
  end if;
  if v_bakery_supplier not in ('divano','sandra') then
    raise exception 'Padaria responsável inválida.' using errcode='22023';
  end if;

  v_id := public.trameli_save_product_operational(
    p_id, p_name, p_category, p_unit, p_image_url,
    p_price_cents, p_active, p_cost_cents, p_supplier_name,
    p_unavailable_from, p_unavailable_until, p_substitute_product_id
  );

  update public.trameli_products
     set bakery_supplier = v_bakery_supplier,
         updated_at = now()
   where id = v_id;

  return v_id;
end;
$function$;

revoke execute on function public.trameli_save_product_operational(
  uuid,text,text,text,text,integer,boolean,integer,text,date,date,uuid,text
) from public, anon;
grant execute on function public.trameli_save_product_operational(
  uuid,text,text,text,text,integer,boolean,integer,text,date,date,uuid,text
) to authenticated;
