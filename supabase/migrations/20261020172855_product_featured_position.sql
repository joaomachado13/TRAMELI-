-- Vitrine escolhida pela operação. NULL significa fora dos destaques.
begin;

alter table public.trameli_products
  add column featured_position integer
  check (featured_position between 1 and 20);

create function public.trameli_set_product_featured(p_product_id uuid, p_position integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.trameli_is_operator() then
    raise exception 'Apenas a operação pode escolher os destaques.' using errcode = '42501';
  end if;
  if p_product_id is null or (p_position is not null and p_position not between 1 and 20) then
    raise exception 'Informe um produto e uma posição de 1 a 20.' using errcode = '22023';
  end if;
  update public.trameli_products
    set featured_position = p_position, updated_at = now()
    where id = p_product_id;
  if not found then
    raise exception 'Produto não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.trameli_set_product_featured(uuid,integer) from public, anon;
grant execute on function public.trameli_set_product_featured(uuid,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
