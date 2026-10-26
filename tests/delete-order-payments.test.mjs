import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const master = randomUUID(), customer = randomUUID();
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
    '20261026165704_notification_automation_without_delivered.sql',
  ]);
  for (const file of (await readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
    if (supabasePlatformMigrations.has(file)) continue;
    try { await db.exec(await readFile(new URL(file, dir), 'utf8')); }
    catch (cause) { throw new Error(`${file}: ${cause.message}`); }
  }
  await db.query('insert into auth.users(id) values($1),($2)', [master, customer]);
  await db.query("insert into public.trameli_operators(user_id,role) values($1,'master')", [master]);
  const today = (await db.query("select (now() at time zone 'America/Sao_Paulo')::date::text as day")).rows[0].day;
  const makeOrder = async () => { await db.exec('reset role'); const id = (await db.query(`insert into public.trameli_orders(customer_id,source,customer_name,address,delivery_date,items,subtotal_cents,fee_cents)
    values($1,'operator','Cliente','Rua 1',$2,$3::jsonb,1000,200) returning id`, [customer, today, JSON.stringify([{ name: 'Teste', quantity: 1, priceCents: 1000 }])])).rows[0].id; await as(master); return id; };
  const as = async id => { await db.exec('reset role; set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); };
  const pay = async (amount, lines) => (await db.query("select public.trameli_record_payment($1,$2,'pix_manual','ref','nota',$3::jsonb) as id", [randomUUID(), amount, JSON.stringify(lines)])).rows[0].id;
  const count = async table => (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n;
  const del = (order, mode) => db.query('select public.trameli_master_delete_order_with_payments($1,$2)', [order, mode]);

  await as(master);
  // Pedido sem pagamento: exclui em qualquer modo.
  const free = await makeOrder();
  await del(free, 'none');
  assert.equal((await db.query('select 1 from public.trameli_orders where id=$1', [free])).rows.length, 0);

  // Com pagamento: 'none' recusa e não altera nada.
  const kept = await makeOrder();
  const p1 = await pay(1200, [{ order_id: kept, amount_cents: 1200 }]);
  await assert.rejects(del(kept, 'none'), /pagamentos vinculados/);
  assert.equal(await count('trameli_orders'), 1);
  await assert.rejects(del(kept, 'invalido'), /inválido/);

  // 'keep': pedido sai, pagamento permanece sem pedido.
  await del(kept, 'keep');
  assert.equal(await count('trameli_orders'), 0);
  assert.equal(await count('trameli_payments'), 1);
  assert.equal(await count('trameli_payment_allocations'), 0);
  assert.equal((await db.query('select id from public.trameli_payments')).rows[0].id, p1);

  // 'delete': pedido e pagamento saem juntos, inclusive com estorno.
  const gone = await makeOrder();
  const p2 = await pay(1200, [{ order_id: gone, amount_cents: 1200 }]);
  await db.query('select public.trameli_refund_payment($1,$2,$3)', [randomUUID(), p2, 'Devolvido']);
  assert.equal(await count('trameli_payments'), 3);
  await del(gone, 'delete');
  assert.equal(await count('trameli_orders'), 0);
  assert.equal(await count('trameli_payments'), 1, 'Só o pagamento mantido anteriormente continua.');

  // Pagamento dividido entre dois pedidos: excluir um não apaga o dinheiro do outro.
  const a = await makeOrder(), b = await makeOrder();
  await pay(2400, [{ order_id: a, amount_cents: 1200 }, { order_id: b, amount_cents: 1200 }]);
  await del(a, 'delete');
  assert.equal(await count('trameli_payments'), 2);
  assert.equal(await count('trameli_payment_allocations'), 1);

  // Excluir uma programação remove somente os pedidos ligados a ela e preserva pagamentos.
  const generatedA = await makeOrder(), generatedB = await makeOrder(), unrelated = await makeOrder();
  const scheduleId = randomUUID();
  await db.exec('reset role');
  await db.query(`insert into public.trameli_recurring_orders
    (id, customer_id, recurrence, starts_on, active, notes, fee_cents, items, created_by)
    values ($1,$2,'fixed',$3,true,'',200,'[{"name":"Teste","quantity":1,"priceCents":1000}]'::jsonb,$4)`,
    [scheduleId, customer, today, master]);
  await db.query(`insert into public.trameli_recurring_occurrences(schedule_id,delivery_date,order_id)
    values ($1,$2,$3),($1,$2::date + 1,$4)`, [scheduleId, today, generatedA, generatedB]);
  await as(master);
  const recurringPayment = await pay(1200, [{ order_id: generatedA, amount_cents: 1200 }]);
  const beforeRecurringDelete = await count('trameli_payments');
  const deletedCount = (await db.query('select public.trameli_delete_recurring_order($1) as n', [scheduleId])).rows[0].n;
  assert.equal(Number(deletedCount), 2);
  assert.equal((await db.query('select 1 from public.trameli_recurring_orders where id=$1', [scheduleId])).rows.length, 0);
  assert.equal((await db.query('select 1 from public.trameli_recurring_occurrences where schedule_id=$1', [scheduleId])).rows.length, 0);
  assert.equal((await db.query('select 1 from public.trameli_orders where id=any($1::uuid[])', [[generatedA, generatedB]])).rows.length, 0);
  assert.equal((await db.query('select 1 from public.trameli_orders where id=$1', [unrelated])).rows.length, 1);
  assert.equal((await db.query('select 1 from public.trameli_orders where id=$1', [b])).rows.length, 1);
  assert.equal(await count('trameli_orders'), 2, 'Pedidos manuais não relacionados continuam existindo.');
  assert.equal(await count('trameli_payments'), beforeRecurringDelete, 'O registro de pagamento é preservado.');
  assert.equal((await db.query('select 1 from public.trameli_payments where id=$1', [recurringPayment])).rows.length, 1);
  assert.equal((await db.query('select 1 from public.trameli_payment_allocations where order_id=$1', [generatedA])).rows.length, 0);
  assert.equal((await db.query('select 1 from public.trameli_payment_allocations where order_id=$1', [b])).rows.length, 1);

  // Clientes e operadores comuns não executam.
  await as(customer);
  await assert.rejects(del(b, 'delete'), /Master|restrito|permission/i);
  await assert.rejects(db.query('select public.trameli_delete_recurring_order($1)', [scheduleId]), /operator access required|permission/i);
  console.log('Exclusão de pedido com pagamento vinculado e programação recorrente: OK.');
} finally { await db.close(); }
