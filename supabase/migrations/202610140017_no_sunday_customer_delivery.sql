-- Domingo não é dia de entrega no portal do cliente.
-- O trigger protege a regra mesmo quando alguém ignora a interface e chama o RPC diretamente.
begin;

create or replace function public.trameli_reject_sunday_portal_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'portal' and extract(dow from new.delivery_date) = 0 then
    raise exception 'Sunday delivery is not available for customer orders' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trameli_portal_no_sunday_delivery on public.trameli_orders;
create trigger trameli_portal_no_sunday_delivery
before insert or update of source, delivery_date on public.trameli_orders
for each row execute function public.trameli_reject_sunday_portal_order();

revoke all on function public.trameli_reject_sunday_portal_order() from public, anon, authenticated;

commit;
