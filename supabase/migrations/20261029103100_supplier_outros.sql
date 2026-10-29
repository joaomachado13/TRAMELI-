-- Terceira origem independente para produtos adquiridos fora das duas padarias.
begin;
alter table public.trameli_products
  drop constraint if exists trameli_products_bakery_supplier_check;
alter table public.trameli_products
  add constraint trameli_products_bakery_supplier_check
  check (bakery_supplier in ('divano','sandra','outros'));
comment on column public.trameli_products.bakery_supplier is
  'Origem de compra do item: divano, sandra ou outros.';

CREATE OR REPLACE FUNCTION public.trameli_save_product_operational(p_id uuid, p_name text, p_category text, p_unit text, p_image_url text, p_price_cents integer, p_active boolean, p_cost_cents integer, p_supplier_name text, p_unavailable_from date, p_unavailable_until date, p_substitute_product_id uuid, p_bakery_supplier text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_bakery_supplier text := lower(btrim(coalesce(p_bakery_supplier, 'divano')));
begin
  if not public.trameli_is_operator() then
    raise exception 'Acesso restrito à operação.' using errcode='42501';
  end if;
  if v_bakery_supplier not in ('divano','sandra','outros') then
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
$function$
;

notify pgrst, 'reload schema';
commit;
