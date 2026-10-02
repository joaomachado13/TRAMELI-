begin;

create table if not exists public.trameli_settings (
  singleton boolean primary key default true check (singleton),
  business_name text not null default 'Trameli' check (char_length(btrim(business_name)) between 2 and 80),
  contact text not null default '' check (char_length(contact) <= 80),
  primary_color text not null default '#244d32' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#b6c780' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  surface_color text not null default '#f5f1e8' check (surface_color ~ '^#[0-9A-Fa-f]{6}$'),
  rollover_time time not null default '13:30',
  cutoff_time time not null default '22:30',
  delivery_fee_cents integer not null default 200 check (delivery_fee_cents between 0 and 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.trameli_settings(singleton) values (true) on conflict do nothing;
alter table public.trameli_settings enable row level security;
drop policy if exists settings_read on public.trameli_settings;
create policy settings_read on public.trameli_settings for select to anon, authenticated using (true);
revoke all on public.trameli_settings from public, anon, authenticated;
grant select on public.trameli_settings to anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('trameli-products','trameli-products',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists trameli_product_images_master_insert on storage.objects;
drop policy if exists trameli_product_images_master_update on storage.objects;
drop policy if exists trameli_product_images_master_delete on storage.objects;
create policy trameli_product_images_master_insert on storage.objects for insert to authenticated
  with check (bucket_id='trameli-products' and public.trameli_is_master());
create policy trameli_product_images_master_update on storage.objects for update to authenticated
  using (bucket_id='trameli-products' and public.trameli_is_master())
  with check (bucket_id='trameli-products' and public.trameli_is_master());
create policy trameli_product_images_master_delete on storage.objects for delete to authenticated
  using (bucket_id='trameli-products' and public.trameli_is_master());

create or replace function public.trameli_save_settings(
  p_business_name text, p_contact text, p_primary_color text, p_accent_color text,
  p_surface_color text, p_rollover_time time, p_cutoff_time time, p_delivery_fee_cents integer
) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.trameli_is_master() then
    raise exception 'Apenas Master pode alterar as configurações.' using errcode='42501';
  end if;
  update public.trameli_settings set
    business_name=btrim(p_business_name), contact=btrim(coalesce(p_contact,'')),
    primary_color=p_primary_color, accent_color=p_accent_color, surface_color=p_surface_color,
    rollover_time=p_rollover_time, cutoff_time=p_cutoff_time,
    delivery_fee_cents=p_delivery_fee_cents, updated_at=now(), updated_by=auth.uid()
  where singleton;
end;
$$;

create or replace function public.trameli_master_delete_order(p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_payment_count integer;
begin
  if not public.trameli_is_master() then
    raise exception 'Apenas Master pode excluir pedidos definitivamente.' using errcode='42501';
  end if;
  select count(*) into v_payment_count from public.trameli_payment_allocations where order_id=p_order_id;
  if v_payment_count > 0 then
    raise exception 'Este pedido possui pagamentos vinculados. Use a limpeza completa somente para uma base de testes.';
  end if;
  delete from public.trameli_payment_intents where p_order_id=any(order_ids);
  delete from public.trameli_order_costs where order_id=p_order_id;
  delete from public.trameli_order_events where order_id=p_order_id;
  delete from public.trameli_orders where id=p_order_id;
  if not found then raise exception 'Pedido não encontrado.'; end if;
end;
$$;

create or replace function public.trameli_master_delete_product(p_product_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.trameli_is_master() then
    raise exception 'Apenas Master pode excluir produtos definitivamente.' using errcode='42501';
  end if;
  delete from public.trameli_products where id=p_product_id;
  if not found then raise exception 'Produto não encontrado.'; end if;
end;
$$;

create or replace function public.trameli_master_purge_test_orders()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  perform pg_advisory_xact_lock(7310022026);
  if not public.trameli_is_master() then
    raise exception 'Apenas Master pode limpar a base de pedidos.' using errcode='42501';
  end if;
  select count(*) into v_count from public.trameli_orders;
  delete from public.trameli_daily_closings;
  delete from public.trameli_payment_intents;
  delete from public.trameli_payment_allocations;
  delete from public.trameli_payments;
  delete from public.trameli_order_costs;
  delete from public.trameli_order_events;
  delete from public.trameli_orders;
  return v_count;
end;
$$;

revoke all on function public.trameli_save_settings(text,text,text,text,text,time,time,integer),
  public.trameli_master_delete_order(uuid), public.trameli_master_delete_product(uuid),
  public.trameli_master_purge_test_orders() from public, anon;
grant execute on function public.trameli_save_settings(text,text,text,text,text,time,time,integer),
  public.trameli_master_delete_order(uuid), public.trameli_master_delete_product(uuid),
  public.trameli_master_purge_test_orders() to authenticated;

commit;
