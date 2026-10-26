import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

const [foundation, vapid, guard, orderEvents, hardening] = await Promise.all([
  read('supabase/migrations/20261026140746_pwa_notifications_foundation.sql'),
  read('supabase/migrations/20261026141007_pwa_vapid_server_init.sql'),
  read('supabase/migrations/20261026141259_pwa_dispatch_guard.sql'),
  read('supabase/migrations/20261026141648_pwa_operator_order_notifications.sql'),
  read('supabase/migrations/20261026142242_pwa_rpc_privileges_hardening.sql'),
]);

assert.match(foundation, /create extension if not exists pg_net/i);
assert.match(foundation, /create extension if not exists pg_cron/i);
assert.match(foundation, /trameli_push_subscriptions/i);
assert.match(foundation, /trameli_notifications/i);
assert.match(foundation, /trameli_notification_recipients/i);
assert.match(foundation, /enable row level security/i);
assert.match(foundation, /cron\.schedule\('trameli-order-reminders'/i);
assert.match(foundation, /cron\.schedule\('trameli-payment-reminders'/i);

assert.match(vapid, /vault\.create_secret\(p_private_key/i);
assert.match(vapid, /trameli_vapid_public_key/i);
assert.match(vapid, /trameli_vapid_private_key/i);

assert.match(guard, /X-Dispatch-Token/i);
assert.match(guard, /net\.http_post/i);
assert.match(guard, /trameli_push_dispatch_token/i);

for (const event of ['operator_order_created','status_confirmed','status_ready','status_delivered','status_cancelled']) {
  assert.match(orderEvents, new RegExp(event), `Evento ${event} precisa continuar coberto.`);
}

for (const fn of ['trameli_upsert_push_subscription','trameli_create_notification','trameli_queue_order_event']) {
  assert.match(hardening, new RegExp(`revoke all on function public\\.${fn}`, 'i'), `${fn} precisa de hardening explícito.`);
}

console.log('Migrations PWA/Supabase: extensões, Vault, cron, push, RLS e privilégios verificados.');
