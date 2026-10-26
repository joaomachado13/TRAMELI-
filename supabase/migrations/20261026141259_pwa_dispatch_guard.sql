-- Protect the cron dispatcher with a server-generated token kept in Vault.
do $$
declare v_id uuid; v_value text:=gen_random_uuid()::text||gen_random_uuid()::text;
begin
  select id into v_id from vault.secrets where name='trameli_push_dispatch_token';
  if v_id is null then
    perform vault.create_secret(v_value,'trameli_push_dispatch_token','Internal token for Pão Doce push dispatcher');
  end if;
end $$;

create or replace function public.trameli_push_dispatch_token()
returns text
language sql stable security definer set search_path to ''
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name='trameli_push_dispatch_token' limit 1;
$$;
revoke all on function public.trameli_push_dispatch_token() from public,anon,authenticated;
grant execute on function public.trameli_push_dispatch_token() to service_role;

select cron.schedule(
  'trameli-push-dispatch','* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='trameli_project_url') || '/functions/v1/trameli-push',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Dispatch-Token',(select decrypted_secret from vault.decrypted_secrets where name='trameli_push_dispatch_token')
      ),
      body := '{"action":"dispatch_queued"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);
