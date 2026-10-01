-- Revoke direct API access to internal trigger/event-trigger helpers.
-- Public RPCs intentionally exposed to authenticated users keep their own
-- authorization checks and are not changed here.
begin;

revoke all on function public.trameli_audit_order() from public, anon, authenticated;
revoke all on function public.trameli_snapshot_order_costs() from public, anon, authenticated;

-- Supabase creates this event-trigger helper outside the application
-- migrations. Harden it when present while keeping local PostgreSQL tests
-- portable.
do $migration$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$migration$;

notify pgrst, 'reload schema';
commit;
