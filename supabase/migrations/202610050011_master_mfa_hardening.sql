-- Require a second authentication factor for high-impact Master actions.
-- This protects Pix destination changes, privilege escalation and destructive cleanup
-- even if frontend checks are bypassed. Apply after 20261002145107_master_controls.sql.
begin;

create function public.trameli_require_master_aal2()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.trameli_is_master() then
    raise exception 'Apenas Master pode executar esta ação.' using errcode = '42501';
  end if;

  if coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
    raise exception 'Confirme a verificação em duas etapas antes de continuar.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.trameli_require_master_aal2() from public, anon, authenticated;

-- Keep the existing, already-audited business logic private and expose MFA-gated wrappers
-- under the original RPC names used by the application.
alter function public.trameli_save_pix_settings(text,text,boolean,integer)
  rename to trameli_save_pix_settings_unchecked;
revoke all on function public.trameli_save_pix_settings_unchecked(text,text,boolean,integer)
  from public, anon, authenticated;

create function public.trameli_save_pix_settings(
  p_payload text, p_receiver_label text, p_enabled boolean, p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.trameli_require_master_aal2();
  perform public.trameli_save_pix_settings_unchecked(
    p_payload, p_receiver_label, p_enabled, p_expected_version
  );
end;
$$;
revoke all on function public.trameli_save_pix_settings(text,text,boolean,integer) from public, anon;
grant execute on function public.trameli_save_pix_settings(text,text,boolean,integer) to authenticated;

alter function public.trameli_set_team_role(text,text)
  rename to trameli_set_team_role_unchecked;
revoke all on function public.trameli_set_team_role_unchecked(text,text)
  from public, anon, authenticated;

create function public.trameli_set_team_role(p_identity text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.trameli_require_master_aal2();
  perform public.trameli_set_team_role_unchecked(p_identity, p_role);
end;
$$;
revoke all on function public.trameli_set_team_role(text,text) from public, anon;
grant execute on function public.trameli_set_team_role(text,text) to authenticated;

alter function public.trameli_master_delete_order(uuid)
  rename to trameli_master_delete_order_unchecked;
revoke all on function public.trameli_master_delete_order_unchecked(uuid)
  from public, anon, authenticated;

create function public.trameli_master_delete_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.trameli_require_master_aal2();
  perform public.trameli_master_delete_order_unchecked(p_order_id);
end;
$$;
revoke all on function public.trameli_master_delete_order(uuid) from public, anon;
grant execute on function public.trameli_master_delete_order(uuid) to authenticated;

alter function public.trameli_master_delete_product(uuid)
  rename to trameli_master_delete_product_unchecked;
revoke all on function public.trameli_master_delete_product_unchecked(uuid)
  from public, anon, authenticated;

create function public.trameli_master_delete_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.trameli_require_master_aal2();
  perform public.trameli_master_delete_product_unchecked(p_product_id);
end;
$$;
revoke all on function public.trameli_master_delete_product(uuid) from public, anon;
grant execute on function public.trameli_master_delete_product(uuid) to authenticated;

alter function public.trameli_master_purge_test_orders()
  rename to trameli_master_purge_test_orders_unchecked;
revoke all on function public.trameli_master_purge_test_orders_unchecked()
  from public, anon, authenticated;

create function public.trameli_master_purge_test_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  perform public.trameli_require_master_aal2();
  select public.trameli_master_purge_test_orders_unchecked() into v_count;
  return v_count;
end;
$$;
revoke all on function public.trameli_master_purge_test_orders() from public, anon;
grant execute on function public.trameli_master_purge_test_orders() to authenticated;


alter function public.trameli_save_settings(text,text,text,text,text,time,time,integer)
  rename to trameli_save_settings_unchecked;
revoke all on function public.trameli_save_settings_unchecked(text,text,text,text,text,time,time,integer)
  from public, anon, authenticated;

create function public.trameli_save_settings(
  p_business_name text, p_contact text, p_primary_color text, p_accent_color text,
  p_surface_color text, p_rollover_time time, p_cutoff_time time, p_delivery_fee_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $
begin
  perform public.trameli_require_master_aal2();
  perform public.trameli_save_settings_unchecked(
    p_business_name, p_contact, p_primary_color, p_accent_color,
    p_surface_color, p_rollover_time, p_cutoff_time, p_delivery_fee_cents
  );
end;
$;
revoke all on function public.trameli_save_settings(text,text,text,text,text,time,time,integer) from public, anon;
grant execute on function public.trameli_save_settings(text,text,text,text,text,time,time,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
