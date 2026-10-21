begin;

-- Fix permanent product deletion when a product has a cost row.
-- The cost audit trigger inserts into trameli_product_events, whose product_id
-- references trameli_products. Delete the cost while the product still exists.
create or replace function public.trameli_master_delete_product_unchecked(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.trameli_is_master() then
    raise exception 'Apenas Master pode excluir produtos definitivamente.'
      using errcode = '42501';
  end if;

  perform 1
  from public.trameli_products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Produto não encontrado.';
  end if;

  delete from public.trameli_product_costs
  where product_id = p_product_id;

  delete from public.trameli_products
  where id = p_product_id;
end;
$$;

revoke all on function public.trameli_master_delete_product_unchecked(uuid)
  from public, anon, authenticated;

commit;
