-- Customer payment receipt uploads linked to existing Pix payment intents.
begin;

create table public.trameli_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.trameli_payment_intents(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','application/pdf')),
  created_at timestamptz not null default now()
);

create index trameli_payment_receipts_intent_idx
  on public.trameli_payment_receipts(intent_id, created_at desc);
create index trameli_payment_receipts_customer_idx
  on public.trameli_payment_receipts(customer_id, created_at desc);

alter table public.trameli_payment_receipts enable row level security;

create policy payment_receipts_read on public.trameli_payment_receipts
for select to authenticated
using (
  customer_id = (select auth.uid())
  or (select public.trameli_is_operator())
);

revoke all on public.trameli_payment_receipts from public, anon, authenticated;
grant select on public.trameli_payment_receipts to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'trameli-payment-receipts',
  'trameli-payment-receipts',
  false,
  5242880,
  array['image/jpeg','image/png','application/pdf']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists trameli_payment_receipts_insert on storage.objects;
drop policy if exists trameli_payment_receipts_select on storage.objects;
drop policy if exists trameli_payment_receipts_delete on storage.objects;

create policy trameli_payment_receipts_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='trameli-payment-receipts'
  and split_part(name,'/',1)=(select auth.uid())::text
);

create policy trameli_payment_receipts_select on storage.objects
for select to authenticated
using (
  bucket_id='trameli-payment-receipts'
  and (
    split_part(name,'/',1)=(select auth.uid())::text
    or (select public.trameli_is_operator())
  )
);

create policy trameli_payment_receipts_delete on storage.objects
for delete to authenticated
using (
  bucket_id='trameli-payment-receipts'
  and (
    split_part(name,'/',1)=(select auth.uid())::text
    or (select public.trameli_is_operator())
  )
);

create function public.trameli_submit_payment_receipt(
  p_request_id uuid,
  p_order_ids uuid[],
  p_storage_path text,
  p_file_name text,
  p_mime_type text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_intent uuid;
  v_receipt uuid;
begin
  if v_user is null then
    raise exception 'Login necessário.' using errcode='42501';
  end if;
  if p_storage_path is null
     or split_part(p_storage_path,'/',1)<>v_user::text
     or length(p_storage_path)>500 then
    raise exception 'Arquivo de comprovante inválido.' using errcode='22023';
  end if;
  if p_mime_type not in ('image/jpeg','image/png','application/pdf') then
    raise exception 'Formato de comprovante não permitido.' using errcode='22023';
  end if;
  if length(btrim(coalesce(p_file_name,''))) not between 1 and 180 then
    raise exception 'Nome do arquivo inválido.' using errcode='22023';
  end if;
  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id='trameli-payment-receipts'
      and o.name=p_storage_path
  ) then
    raise exception 'Envie o arquivo antes de registrar o comprovante.' using errcode='22023';
  end if;

  v_intent:=public.trameli_signal_pix_payment(p_request_id,p_order_ids);

  insert into public.trameli_payment_receipts(
    intent_id,customer_id,storage_path,file_name,mime_type
  )
  values(
    v_intent,v_user,p_storage_path,btrim(p_file_name),p_mime_type
  )
  returning id into v_receipt;

  return v_receipt;
end;
$$;

revoke all on function public.trameli_submit_payment_receipt(uuid,uuid[],text,text,text)
  from public, anon;
grant execute on function public.trameli_submit_payment_receipt(uuid,uuid[],text,text,text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
