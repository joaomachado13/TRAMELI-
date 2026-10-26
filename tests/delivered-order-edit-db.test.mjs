import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const operator = randomUUID(), customer = randomUUID(), stranger = randomUUID();
try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,email text,phone text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;`);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const supabasePlatformMigrations = new Set([
    '20261026140746_pwa_notifications_foundation.sql',
    '20261026141007_pwa_vapid_server_init.sql',
    '20261026141259_pwa_dispatch_guard.sql',
    '20261026141648_pwa_operator_order_notifications.sql',
    '20261026142242_pwa_rpc_privileges_hardening.sql',
  ]);
  for (const file of (await readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
    if (supabasePlatformMigrations.has(file)) continue;
    await db.exec(await readFile(new URL(file, dir), 'utf8'));
  }
  for (const id of [operator, customer, stranger]) await db.query('insert into auth.users(id) values($1)', [id]);
  await db.query("insert into public.trameli_operators(user_id,role) values($1,'operator')", [operator]);
  await db.query("insert into public.trameli_profiles(user_id,name,address) values($1,'Cliente teste','Rua teste 10')", [customer]);
  const asUser = async id => {
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const day = (await db.query("select date_trunc('week', now() at time zone 'America/Sao_Paulo')::date::text as day")).rows[0].day;
  const bread = { name: 'Pão teste', quantity: 4, priceCents: 140 };
  const extra = { name: 'Biscoito teste', quantity: 1, priceCents: 200 };
  const save = (id, version, items) => db.query(`select public.trameli_operator_order_for_customer(
    $1,$2,$3,$4,'Cliente teste','','Rua teste 10','',200,$5::jsonb,$6) as id`,
    [id, id ? null : randomUUID(), version, day, JSON.stringify(items), customer]);
  const order = async id => (await db.query('select * from public.trameli_orders where id=$1', [id])).rows[0];
  const balance = async id => (await db.query('select * from public.trameli_payment_balances() where order_id=$1', [id])).rows[0];
  await asUser(operator);
  const id = (await save(null, null, [bread])).rows[0].id;
  for (const status of ['confirmed', 'packing', 'ready', 'delivered']) {
    await db.query('select public.trameli_operator_status($1,$2,$3::public.trameli_order_status)', [id, (await order(id)).version, status]);
  }
  const original = await order(id);
  await db.query(`select public.trameli_record_payment($1,760,'cash','','',$2::jsonb)`,
    [randomUUID(), JSON.stringify([{ order_id: id, amount_cents: 760 }])]);
  const allocations = JSON.stringify((await db.query('select * from public.trameli_payment_allocations where order_id=$1', [id])).rows);
  await save(id, original.version, [bread, extra]);
  const corrected = await order(id);
  assert.equal(corrected.status, 'delivered');
  assert.equal(corrected.version, original.version + 1);
  assert.equal(corrected.public_code, original.public_code);
  assert.equal(corrected.customer_id, original.customer_id);
  assert.equal(corrected.items.length, 2);
  assert.ok(corrected.edited_at);
  assert.equal(Number((await balance(id)).paid_cents), 760);
  assert.equal(Number((await balance(id)).due_cents), 200, 'Somente o item acrescentado fica pendente.');
  assert.equal(JSON.stringify((await db.query('select * from public.trameli_payment_allocations where order_id=$1', [id])).rows), allocations);
  const events = (await db.query(`select * from public.trameli_order_events where order_id=$1
    and before_state->>'status'='delivered' and after_state->>'status'='delivered'
    and jsonb_array_length(before_state->'items')=1 and jsonb_array_length(after_state->'items')=2`, [id])).rows;
  assert.equal(events.length, 1, 'A correção deve registrar antes/depois e quem editou.');
  assert.equal(events[0].actor_id, operator);
  await assert.rejects(save(id, original.version, [bread]), /order changed/);
  await asUser(customer);
  await assert.rejects(save(id, corrected.version, [bread]), /operator access required/);
  await asUser(stranger);
  await assert.rejects(save(id, corrected.version, [bread]), /operator access required/);
  await db.exec('reset role; set role anon');
  await assert.rejects(save(id, corrected.version, [bread]), /permission denied/);
  await asUser(operator);
  await save(id, corrected.version, [{ ...bread, quantity: 1 }, extra]);
  assert.equal(Number((await balance(id)).paid_cents), 760);
  assert.equal(Number((await balance(id)).refund_due_cents), 220, 'Redução do valor preserva o pagamento e mostra o excedente.');
  await db.exec('reset role');
  await db.query("update public.trameli_orders set status='cancelled' where id=$1", [id]);
  await asUser(operator);
  await assert.rejects(save(id, (await order(id)).version, [bread]), /finalized order/);
  console.log('Edição de entregue: operadora autorizada, status/identidade preservados, histórico, conflito de versão e saldos/pagamentos corretos.');
} finally {
  await db.close();
}
