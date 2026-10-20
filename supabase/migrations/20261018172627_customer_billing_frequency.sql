-- Store a customer's agreed billing frequency without touching existing orders or approval state.
begin;
alter table public.trameli_profiles
  add column if not exists billing_frequency text
  check (billing_frequency in ('semanal', 'quinzenal', 'mensal'));

create or replace function public.trameli_set_customer_billing_frequency(
  p_customer_id uuid,
  p_billing_frequency text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.trameli_is_operator() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_customer_id is null then
    raise exception 'customer id required' using errcode = '22023';
  end if;
  if p_billing_frequency is not null
     and p_billing_frequency not in ('semanal', 'quinzenal', 'mensal') then
    raise exception 'invalid billing frequency' using errcode = '22023';
  end if;
  update public.trameli_profiles
     set billing_frequency = p_billing_frequency, updated_at = now()
   where user_id = p_customer_id;
  if not found then
    raise exception 'customer profile not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.trameli_set_customer_billing_frequency(uuid, text) from public, anon;
grant execute on function public.trameli_set_customer_billing_frequency(uuid, text) to authenticated;
notify pgrst, 'reload schema';
commit;
