-- Marca Pão Doce: nome padrão, paleta ajustada à logo e mensagem de bloqueio sem o nome antigo.
-- Só altera linhas que ainda estão com os valores originais; personalizações feitas pelo Master permanecem.
begin;

alter table public.trameli_settings alter column business_name set default 'Pão Doce';
update public.trameli_settings set business_name = 'Pão Doce' where business_name = 'Trameli';
update public.trameli_settings set primary_color = '#8F3D22' where upper(primary_color) = '#9E432C';
update public.trameli_settings set accent_color = '#EBBFA1' where upper(accent_color) = '#E8B8A6';
update public.trameli_settings set surface_color = '#FBF0E4' where upper(surface_color) = '#F7F2EA';

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trameli_customer_order'
   order by p.oid desc limit 1;
  if v_def is not null and v_def like '%Fale com a Trameli%' then
    execute replace(v_def, 'Fale com a Trameli', 'Fale com o Pão Doce');
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
