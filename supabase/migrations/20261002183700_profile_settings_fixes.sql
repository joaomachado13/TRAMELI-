begin;

create or replace function public.trameli_save_profile(p_name text, p_phone text, p_address text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para salvar o perfil.' using errcode='42501';
  end if;
  insert into public.trameli_profiles(user_id, name, phone, address)
  values (auth.uid(), btrim(p_name), btrim(coalesce(p_phone, '')), btrim(p_address))
  on conflict (user_id) do update set
    name=excluded.name, phone=excluded.phone, address=excluded.address, updated_at=now();
end;
$$;

revoke all on function public.trameli_save_profile(text,text,text) from public, anon;
grant execute on function public.trameli_save_profile(text,text,text) to authenticated;

commit;
