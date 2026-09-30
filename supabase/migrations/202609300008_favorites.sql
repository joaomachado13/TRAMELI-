-- Favoritos privados por conta. Aplicar uma vez depois da base inicial.
begin;
create table public.trameli_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.trameli_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,product_id)
);
alter table public.trameli_favorites enable row level security;
create policy own_favorites on public.trameli_favorites for select to authenticated using(user_id=auth.uid());
revoke all on public.trameli_favorites from anon,authenticated;
grant select on public.trameli_favorites to authenticated;
create function public.trameli_set_favorite(p_product_id uuid,p_favorite boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Login necessário.' using errcode='42501'; end if;
  if p_favorite is null then raise exception 'Escolha inválida.'; end if;
  if p_favorite then
    if not exists(select 1 from public.trameli_products where id=p_product_id and active) then raise exception 'Produto indisponível.'; end if;
    insert into public.trameli_favorites(user_id,product_id) values(auth.uid(),p_product_id) on conflict do nothing;
  else
    delete from public.trameli_favorites where user_id=auth.uid() and product_id=p_product_id;
  end if;
end;
$$;
revoke all on function public.trameli_set_favorite(uuid,boolean) from public,anon;
grant execute on function public.trameli_set_favorite(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
