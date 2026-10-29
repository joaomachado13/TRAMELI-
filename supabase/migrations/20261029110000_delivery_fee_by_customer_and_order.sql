-- Taxa de entrega personalizada por cliente e ajuste isolado por pedido.
-- Taxa do cliente afeta novos pedidos; ajustes de uma entrega não alteram o cadastro.
begin;

create or replace function public.trameli_set_customer_delivery_fee(
  p_customer_id uuid,
  p_delivery_fee_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.trameli_is_operator() then
    raise exception 'Acesso restrito à operação.' using errcode = '42501';
  end if;
  if p_customer_id is null or not exists (
    select 1 from public.trameli_profiles where user_id = p_customer_id
  ) then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;
  if p_delivery_fee_cents is not null and
    (p_delivery_fee_cents < 0 or p_delivery_fee_cents > 100000000) then
    raise exception 'Taxa de entrega inválida.' using errcode = '22023';
  end if;
  if p_delivery_fee_cents is null then
    delete from public.trameli_customer_terms where customer_id = p_customer_id;
  else
    insert into public.trameli_customer_terms(customer_id, delivery_fee_cents, updated_at)
    values(p_customer_id, p_delivery_fee_cents, now())
    on conflict (customer_id) do update
      set delivery_fee_cents = excluded.delivery_fee_cents,
          updated_at = now();
  end if;
end;
$function$;

revoke all on function public.trameli_set_customer_delivery_fee(uuid,integer)
  from public, anon, authenticated;
grant execute on function public.trameli_set_customer_delivery_fee(uuid,integer)
  to authenticated;

-- Reutiliza TODAS as verificações originais da gravação de pedidos operacionais
-- (versão, prazo, duplicidade, status e regras do cliente) e aplica a
-- entrega excepcional na mesma transação do novo pedido ou edição.
create or replace function public.trameli_operator_order_with_delivery(
  p_order_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_delivery_date date,
  p_name text,
  p_phone text,
  p_address text,
  p_notes text,
  p_fee_cents integer,
  p_items jsonb,
  p_customer_id uuid,
  p_delivery_address text,
  p_delivery_fee_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_profile public.trameli_profiles%rowtype;
  v_address text;
  v_fee integer;
begin
  if not public.trameli_is_operator() then
    raise exception 'Acesso restrito à operação.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.trameli_profiles where user_id = p_customer_id;
  if not found then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;

  if p_order_id is not null and not exists (
    select 1 from public.trameli_orders
     where id = p_order_id and customer_id = p_customer_id
  ) then
    raise exception 'Não é permitido trocar o cliente de um pedido existente.'
      using errcode = '22023';
  end if;

  v_address := coalesce(nullif(btrim(p_delivery_address), ''), v_profile.address);
  v_fee := coalesce(p_delivery_fee_cents, private.trameli_delivery_fee_for_customer(p_customer_id));

  if length(v_address) not between 3 and 180
    or v_fee < 0 or v_fee > 100000000 then
    raise exception 'Endereço ou taxa de entrega inválidos.' using errcode = '22023';
  end if;

  v_id := public.trameli_operator_order_for_customer(
    p_order_id, p_request_id, p_expected_version, p_delivery_date,
    p_name, p_phone, p_address, p_notes, p_fee_cents, p_items, p_customer_id
  );

  update public.trameli_orders
  set address = v_address, fee_cents = v_fee, updated_at = now()
  where id = v_id and customer_id = p_customer_id;

  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  return v_id;
end;
$function$;

revoke all on function public.trameli_operator_order_with_delivery(
  uuid,uuid,integer,date,text,text,text,text,integer,jsonb,uuid,text,integer
) from public, anon, authenticated;
grant execute on function public.trameli_operator_order_with_delivery(
  uuid,uuid,integer,date,text,text,text,text,integer,jsonb,uuid,text,integer
) to authenticated;

notify pgrst, 'reload schema';
commit;