-- Manual Pix configuration; no bank integration and no financial postings.
-- Apply only this migration after 001–008. Initially disabled.
begin;
create function public.trameli_pix_fields(p_text text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare p integer:=1; n integer; k text; h text; result jsonb:='{}';
begin
  while p<=length(p_text) loop
    h:=substr(p_text,p,4);
    if h !~ '^[0-9]{4}$' then raise exception 'Código Pix incompleto.'; end if;
    k:=substr(h,1,2);n:=substr(h,3,2)::integer;
    if n=0 or result ? k or p+3+n>length(p_text) then raise exception 'Campos Pix inválidos.'; end if;
    result:=result||jsonb_build_object(k,substr(p_text,p+4,n));p:=p+4+n;
  end loop;
  return result;
end $$;
create function public.trameli_validate_pix(p_code text) returns void
language plpgsql immutable set search_path='' as $$
declare r jsonb; a jsonb; e jsonb; crc integer:=65535; i integer; bit integer;
begin
  if p_code is null or length(p_code) not between 80 and 512 or p_code !~ '^[ -~]+$' then raise exception 'Código Pix inválido.'; end if;
  r:=public.trameli_pix_fields(p_code);
  if (r-array['00','01','26','52','53','58','59','60','62','63'])<>'{}'::jsonb
    or (r->>'00') is distinct from '01' or (r ? '01' and r->>'01'<>'11')
    or (r->>'53') is distinct from '986' or (r->>'58') is distinct from 'BR'
    or coalesce(r->>'52','') !~ '^[0-9]{4}$'
    or length(btrim(coalesce(r->>'59',''))) not between 1 and 25
    or length(btrim(coalesce(r->>'60',''))) not between 1 and 15 then
    raise exception 'Use Pix estático simples, sem valor fixo, saque, recorrência ou URL.';
  end if;
  if p_code !~ '6304[0-9A-F]{4}$' then raise exception 'Integridade Pix inválida.'; end if;
  for i in 1..length(p_code)-4 loop
    crc:=crc # (ascii(substr(p_code,i,1))<<8);
    for bit in 1..8 loop
      if (crc & 32768)<>0 then crc:=((crc<<1)#4129)&65535; else crc:=(crc<<1)&65535; end if;
    end loop;
  end loop;
  if upper(lpad(to_hex(crc),4,'0')) is distinct from r->>'63' then raise exception 'Integridade Pix inválida.'; end if;
  a:=public.trameli_pix_fields(coalesce(r->>'26',''));e:=public.trameli_pix_fields(coalesce(r->>'62',''));
  if lower(a->>'00') is distinct from 'br.gov.bcb.pix' or length(coalesce(a->>'01','')) not between 1 and 77
    or (a-array['00','01','02'])<>'{}'::jsonb or (e-array['05'])<>'{}'::jsonb
    or coalesce(e->>'05','') !~ '^(\*\*\*|[a-zA-Z0-9]{1,25})$' then raise exception 'Chave ou referência Pix inválida.'; end if;
end $$;
create table public.trameli_pix_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  payload text,
  receiver_label text not null default '',
  version integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.trameli_pix_settings(id) values(true);
create table public.trameli_pix_settings_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  happened_at timestamptz not null default now(),
  before_config jsonb not null,
  after_config jsonb not null
);
alter table public.trameli_pix_settings enable row level security;
alter table public.trameli_pix_settings_events enable row level security;
create policy pix_settings_read on public.trameli_pix_settings for select to authenticated using(enabled or public.trameli_is_master());
create policy pix_events_master on public.trameli_pix_settings_events for select to authenticated using(public.trameli_is_master());
revoke all on public.trameli_pix_settings, public.trameli_pix_settings_events from public,anon,authenticated;
grant select on public.trameli_pix_settings,public.trameli_pix_settings_events to authenticated;
create function public.trameli_save_pix_settings(p_payload text,p_receiver_label text,p_enabled boolean,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare old_config public.trameli_pix_settings; new_config public.trameli_pix_settings;
begin
  if not public.trameli_is_master() then raise exception 'Apenas Master pode alterar o destino Pix.' using errcode='42501'; end if;
  select * into old_config from public.trameli_pix_settings where id for update;
  if p_expected_version is distinct from old_config.version then raise exception 'Configuração alterada em outra sessão. Recarregue.'; end if;
  if p_enabled is null then raise exception 'Informe a situação do Pix.'; end if;
  if p_enabled then
    perform public.trameli_validate_pix(btrim(p_payload));
    if p_receiver_label is null or length(btrim(p_receiver_label)) not between 2 and 90 then raise exception 'Confira o nome do titular no banco.'; end if;
  end if;
  update public.trameli_pix_settings set enabled=p_enabled,
    payload=case when p_enabled then btrim(p_payload) else old_config.payload end,
    receiver_label=case when p_enabled then btrim(p_receiver_label) else old_config.receiver_label end,
    version=version+1,updated_at=now() where id returning * into new_config;
  insert into public.trameli_pix_settings_events(actor_id,before_config,after_config)
    values(auth.uid(),to_jsonb(old_config),to_jsonb(new_config));
end $$;
revoke all on function public.trameli_pix_fields(text),public.trameli_validate_pix(text) from public,anon,authenticated;
revoke all on function public.trameli_save_pix_settings(text,text,boolean,integer) from public,anon;
grant execute on function public.trameli_save_pix_settings(text,text,boolean,integer) to authenticated;
notify pgrst,'reload schema';
commit;
