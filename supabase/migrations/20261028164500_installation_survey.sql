-- Campanha de instalacao PWA e notificacoes de 28/10/2026.
-- Uma visualizacao e no maximo uma resposta atual por cliente; somente operacao consulta agregados.
create table if not exists public.trameli_install_campaign (
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_date date not null default date '2026-10-28',
  choice text check (choice is null or choice in ('vamos_la','ja_instalei','agora_nao')),
  platform text not null default 'unknown' check (platform in ('ios','android','desktop','other','unknown')),
  standalone boolean not null default false,
  permission_status text not null default 'unsupported' check (permission_status in ('granted','denied','default','unsupported')),
  first_seen_at timestamptz not null default now(),
  answered_at timestamptz,
  primary key (user_id, campaign_date),
  constraint trameli_install_campaign_only_today check (campaign_date = date '2026-10-28'),
  constraint trameli_install_campaign_answer_time check (choice is null or answered_at is not null)
);
create index if not exists trameli_install_campaign_report_idx
  on public.trameli_install_campaign (campaign_date, choice);

alter table public.trameli_install_campaign enable row level security;

drop policy if exists trameli_install_campaign_read on public.trameli_install_campaign;
create policy trameli_install_campaign_read on public.trameli_install_campaign
for select to authenticated
using (user_id = (select auth.uid()) or public.trameli_is_operator());

drop policy if exists trameli_install_campaign_insert on public.trameli_install_campaign;
create policy trameli_install_campaign_insert on public.trameli_install_campaign
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists trameli_install_campaign_update on public.trameli_install_campaign;
create policy trameli_install_campaign_update on public.trameli_install_campaign
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.trameli_install_campaign from anon;
grant select, insert, update on public.trameli_install_campaign to authenticated;
-- Em producao, service_role usa o acesso de servico padrao do Supabase.
