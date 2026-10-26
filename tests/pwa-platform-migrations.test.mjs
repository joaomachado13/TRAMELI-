import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

const [foundation, vapid, guard, orderEvents, hardening, automation, liveData] = await Promise.all([
  read('supabase/migrations/20261026140746_pwa_notifications_foundation.sql'),
  read('supabase/migrations/20261026141007_pwa_vapid_server_init.sql'),
  read('supabase/migrations/20261026141259_pwa_dispatch_guard.sql'),
  read('supabase/migrations/20261026141648_pwa_operator_order_notifications.sql'),
  read('supabase/migrations/20261026142242_pwa_rpc_privileges_hardening.sql'),
  read('supabase/migrations/20261026165704_notification_automation_without_delivered.sql'),
  read('src/live-data.js'),
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

assert.match(automation, /if p_event = 'status_delivered' then\s+return null/i, 'Entregue precisa permanecer silencioso.');
assert.match(automation, /recurring_order_created/i, 'Pedido recorrente materializado precisa gerar aviso ao cliente.');
assert.match(automation, /Seu fechamento está pronto/i, 'Fechamento precisa continuar gerando lembrete de pagamento.');
assert.match(automation, /Último dia para pagar/i, 'Fim da carência precisa continuar gerando lembrete.');
assert.match(automation, /Vai querer pão amanhã/i, 'Lembrete habitual precisa continuar automático.');
assert.doesNotMatch(automation, /exists \(\s*select 1 from public\.trameli_push_subscriptions/i, 'Inbox não deve depender de PushSubscription.');
assert.doesNotMatch(liveData, /delivered:\s*'status_delivered'/i, 'Frontend não deve solicitar push ao marcar Entregue.');
assert.match(liveData, /recurring_order_created/i, 'Frontend deve tentar entregar imediatamente avisos recorrentes.');

console.log('Migrations PWA/Supabase: extensões, Vault, cron, push, automações, RLS e privilégios verificados.');
