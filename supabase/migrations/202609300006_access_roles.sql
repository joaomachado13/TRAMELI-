-- Requires only 202609240001_initial.sql. No catalog or order data is changed.
-- Existing operators stay operators. A trusted administrator explicitly assigns the first master.
begin;
alter table public.trameli_operators add column role text not null default 'operator'
  check (role in ('operator', 'master'));

create table public.trameli_access_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  target_id uuid references auth.users(id) on delete set null,
  before_role text not null,
  after_role text not null,
  happened_at timestamptz not null default now()
);
alter table public.trameli_access_events enable row level security;

create function public.trameli_is_master() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trameli_operators where user_id = auth.uid() and role = 'master');
$$;

create function public.trameli_access_role() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select role from public.trameli_operators where user_id = auth.uid()), 'customer');
$$;

create policy access_events_master_read on public.trameli_access_events for select to authenticated
  using (public.trameli_is_master());
revoke all on public.trameli_access_events from anon, authenticated;
grant select on public.trameli_access_events to authenticated;

create function public.trameli_audit_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trameli_access_events(actor_id, target_id, before_role, after_role)
  values (auth.uid(), coalesce(new.user_id, old.user_id),
    case when tg_op = 'INSERT' then 'customer' else old.role end,
    case when tg_op = 'DELETE' then 'customer' else new.role end);
  return coalesce(new, old);
end;
$$;
create trigger trameli_access_audit after insert or update or delete on public.trameli_operators
for each row execute function public.trameli_audit_access();

create function public.trameli_list_team()
returns table(user_id uuid, email text, phone text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.trameli_is_master() then raise exception 'Apenas a conta master pode consultar a equipe.' using errcode = '42501'; end if;
  return query select o.user_id, u.email::text, u.phone::text, o.role
    from public.trameli_operators o join auth.users u on u.id = o.user_id
    order by o.created_at, o.user_id;
end;
$$;

create function public.trameli_set_team_role(p_identity text, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid;
begin
  -- Serialize authorization changes, including simultaneous attempts to demote masters.
  perform pg_advisory_xact_lock(730930006);
  if not public.trameli_is_master() then raise exception 'Apenas a conta master pode alterar acessos.' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('customer', 'operator', 'master') then raise exception 'Permissão inválida.'; end if;
  if p_identity is null or btrim(p_identity) = '' then raise exception 'Informe o e-mail ou telefone cadastrado.'; end if;
  select id into v_target from auth.users where
    lower(email) = lower(btrim(p_identity)) or ltrim(phone, '+') = ltrim(btrim(p_identity), '+');
  if v_target is null then raise exception 'Conta não encontrada. A pessoa precisa criar sua conta primeiro.'; end if;
  if v_target = auth.uid() then raise exception 'Você não pode alterar sua própria permissão.'; end if;
  if p_role = 'customer' then
    delete from public.trameli_operators where user_id = v_target;
  else
    insert into public.trameli_operators(user_id, role) values (v_target, p_role)
    on conflict (user_id) do update set role = excluded.role;
  end if;
end;
$$;

revoke all on function public.trameli_is_master() from public, anon;
revoke all on function public.trameli_access_role() from public, anon;
revoke all on function public.trameli_list_team() from public, anon;
revoke all on function public.trameli_set_team_role(text,text) from public, anon;
revoke all on function public.trameli_audit_access() from public, anon, authenticated;
grant execute on function public.trameli_is_master() to authenticated;
grant execute on function public.trameli_access_role() to authenticated;
grant execute on function public.trameli_list_team() to authenticated;
grant execute on function public.trameli_set_team_role(text,text) to authenticated;
commit;
