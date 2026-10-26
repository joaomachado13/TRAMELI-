import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

const [foundation, vapid, guard, orderEvents, hardening, pwa, sw, manifest, edge, live] = await Promise.all([
  read('supabase/migrations/20261026140746_pwa_notifications_foundation.sql'),
  read('supabase/migrations/20261026141007_pwa_vapid_server_init.sql'),
  read('supabase/migrations/20261026141259_pwa_dispatch_guard.sql'),
  read('supabase/migrations/20261026141648_pwa_operator_order_notifications.sql'),
  read('supabase/migrations/20261026142242_pwa_rpc_privileges_hardening.sql'),
  read('src/pwa.js'),
  read('public/pwa-sw.js'),
  read('public/manifest.webmanifest'),
  read('supabase/functions/trameli-push/index.ts'),
  read('src/live-data.js'),
]);

for (const table of ['trameli_push_subscriptions','trameli_notifications','trameli_notification_recipients']) {
  assert.match(foundation, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} precisa de RLS.`);
}
for (const fn of ['trameli_upsert_push_subscription','trameli_create_notification','trameli_queue_order_event']) {
  assert.match(hardening, new RegExp(`revoke all on function public\\.${fn}[^;]* from anon`, 'i'), `${fn} não pode ficar executável por anon.`);
}
assert.match(vapid, /trameli_store_vapid_config/, 'VAPID deve ser inicializado no servidor.');
assert.match(vapid, /vault\.create_secret\(p_private_key/, 'Chave VAPID privada deve ficar no Vault.');
assert.match(guard, /X-Dispatch-Token/i, 'Cron precisa usar token interno.');
assert.match(edge, /trameli_push_dispatch_token/, 'Edge Function deve validar o token do cron.');
assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/, 'Dispatcher usa service role somente no backend.');
assert.doesNotMatch(pwa, /SUPABASE_SERVICE_ROLE_KEY|service_role/i, 'Frontend nunca pode conter service role.');
assert.match(pwa, /trameli_upsert_push_subscription/, 'Frontend deve registrar a inscrição no backend.');
assert.match(pwa, /trameli_notification_inbox/, 'Frontend deve ler a caixa de avisos.');
assert.match(sw, /request\.mode==='navigate'/, 'Service worker deve tratar navegação offline.');
assert.match(sw, /caches\.match\('\/offline\.html'\)/, 'Fallback offline deve ser estático e seguro.');
assert.doesNotMatch(sw, /caches\.match\(request\)/, 'Pedidos e respostas dinâmicas não devem vir de cache.');
const parsed = JSON.parse(manifest);
assert.equal(parsed.id, '/pao-doce');
assert.equal(parsed.start_url, '/#loja');
assert.ok(Array.isArray(parsed.shortcuts) && parsed.shortcuts.length >= 3, 'PWA deve ter atalhos úteis.');
assert.doesNotMatch(manifest, /pwa-pilot/, 'Manifesto de produção não pode manter o piloto.');
for (const event of ['new_order','order_edited','order_cancelled','status_confirmed','status_delivered','operator_order_created']) {
  assert.match(live + orderEvents, new RegExp(event), `Evento ${event} precisa estar ligado ao push.`);
}
console.log('PWA/Push: RLS, privilégios, VAPID, cron, offline, manifesto e eventos verificados.');
