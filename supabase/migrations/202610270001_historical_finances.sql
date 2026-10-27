-- Lancamentos de historico financeiro, independentes de pedidos e da producao.
-- Um lancamento so pertence ao fechamento financeiro da data original.
create table if not exists public.trameli_historical_finances (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.trameli_profiles(user_id),
  entry_date date not null,
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  status text not null default 'pending' check (status in ('pending','paid')),
  origin text not null check (origin in ('excel','manual')),
  original_name text not null check (char_length(btrim(original_name)) between 2 and 180),
  batch_id uuid,
  source_key text unique,
  note text not null default '' check (char_length(note) <= 280),
  paid_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint trameli_historical_excel_key check (origin <> 'excel' or source_key is not null)
);
create index if not exists trameli_historical_finances_customer_date_idx on public.trameli_historical_finances(customer_id,entry_date);
create index if not exists trameli_historical_finances_date_idx on public.trameli_historical_finances(entry_date) where removed_at is null;
create index if not exists trameli_historical_finances_batch_idx on public.trameli_historical_finances(batch_id) where batch_id is not null;
alter table public.trameli_historical_finances enable row level security;
revoke all on public.trameli_historical_finances from public,anon,authenticated;
grant select,insert,update on public.trameli_historical_finances to authenticated;
create policy trameli_historical_finances_select on public.trameli_historical_finances
  for select to authenticated using (public.trameli_is_operator() or customer_id = (select auth.uid()));
create policy trameli_historical_finances_insert on public.trameli_historical_finances
  for insert to authenticated with check (public.trameli_is_operator() and created_by = (select auth.uid()));
create policy trameli_historical_finances_update on public.trameli_historical_finances
  for update to authenticated using (public.trameli_is_operator())
  with check (public.trameli_is_operator());
notify pgrst,'reload schema';
