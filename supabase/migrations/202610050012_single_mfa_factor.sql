-- Enforce at most one verified MFA factor per user and block new enrollments
-- once a verified factor already exists. This complements Supabase Auth settings
-- with a database-level backstop that cannot be bypassed from the browser.
begin;

create unique index if not exists trameli_one_verified_mfa_factor_per_user
  on auth.mfa_factors(user_id)
  where status = 'verified';

create or replace function public.trameli_guard_mfa_factor_enrollment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = new.user_id
        and f.status = 'verified'
    ) then
      raise exception 'Esta conta já possui um autenticador verificado.'
        using errcode = '23505';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.status = 'verified'
     and old.status is distinct from 'verified' then
    if exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = new.user_id
        and f.id <> new.id
        and f.status = 'verified'
    ) then
      raise exception 'Esta conta já possui um autenticador verificado.'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.trameli_guard_mfa_factor_enrollment()
  from public, anon, authenticated;

drop trigger if exists trameli_guard_mfa_factor_enrollment on auth.mfa_factors;
create trigger trameli_guard_mfa_factor_enrollment
before insert or update of status on auth.mfa_factors
for each row execute function public.trameli_guard_mfa_factor_enrollment();

commit;
