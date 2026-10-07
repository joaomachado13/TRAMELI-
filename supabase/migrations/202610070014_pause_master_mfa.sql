-- Temporarily pause Master TOTP/AAL2 enforcement while keeping the MFA wrappers
-- and frontend implementation ready for a future reactivation.
begin;

create or replace function public.trameli_require_master_aal2()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.trameli_is_master() then
    raise exception 'Apenas Master pode executar esta ação.' using errcode = '42501';
  end if;

  -- MFA enforcement intentionally paused.
  -- To reactivate later, restore the AAL2 + recent TOTP checks from migration 011.
end;
$$;

revoke all on function public.trameli_require_master_aal2()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
