-- Customers may cancel their own operator/recurring occurrence before cutoff.
-- Cancelling one generated occurrence does not change the recurring schedule.

begin;

create or replace function public.trameli_cancel_customer_order(
  p_order_id uuid,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_cutoff time := coalesce((select cutoff_time from public.trameli_settings where singleton), time '21:00');
begin
  update public.trameli_orders
     set status = 'cancelled',
         version = version + 1,
         updated_at = now()
   where id = p_order_id
     and customer_id = auth.uid()
     and status in ('received','confirmed','packing','ready')
     and (now() at time zone 'America/Sao_Paulo') <= delivery_date - 1 + v_cutoff
     and version = p_expected_version;

  if not found then
    raise exception 'order changed, cutoff exceeded or order cannot be cancelled';
  end if;
end;
$function$;

revoke all on function public.trameli_cancel_customer_order(uuid,integer) from public, anon;
grant execute on function public.trameli_cancel_customer_order(uuid,integer) to authenticated;

notify pgrst, 'reload schema';

commit;
