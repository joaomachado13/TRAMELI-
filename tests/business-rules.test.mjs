import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const master = randomUUID(), operator = randomUUID(), customer = randomUUID();
const migrations = [
  '202609240001_initial.sql',
  '202609240002_catalog_finance.sql',
  '202609240003_catalog_seed.sql',
  '202609250004_weighted_frios.sql',
  '202609250005_provisional_costs.sql',
  '202609300006_access_roles.sql',
  '202609300007_payment_ledger.sql',
  '20261001130152_approved_business_rules.sql',
];

try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,email text,phone text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  for (const file of migrations) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  // Minimal settings fixture used by the later configurable-cutoff migration.
  await db.exec(`create table public.trameli_settings(
    singleton boolean primary key default true check(singleton),
    cutoff_time time not null default '22:30',
    updated_at timestamptz not null default now()
  ); insert into public.trameli_settings(singleton) values(true);`);
  await db.exec(await readFile(new URL('../supabase/migrations/202610070015_shirley_billing_rules.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query("select cutoff_time::text value from public.trameli_settings where singleton")).rows[0].value, '21:00:00');
  await db.query('insert into auth.users(id) values($1),($2),($3)', [master, operator, customer]);
  await db.query("insert into public.trameli_operators(user_id,role) values($1,'master'),($2,'operator')", [master, operator]);
  const dates = (await db.query(`select
    (now() at time zone 'America/Sao_Paulo')::date::text today,
    ((now() at time zone 'America/Sao_Paulo')::date + 2)::text future`)).rows[0];
  const productId = (await db.query("select id from public.trameli_products where name='Pão de queijo'")).rows[0].id;
  const customerLines = JSON.stringify([{ product_id: productId, quantity: 2 }]);
  const manualItems = JSON.stringify([{ name: 'Item manual', quantity: 1, priceCents: 1000 }]);
  const asUser = async id => {
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const customerOrder = (requestId, deliveryDate) => db.query(`select public.trameli_customer_order(
    null,$1::uuid,null,$2::date,'Cliente','', 'Bloco 1','', 'pix_manual',$3::jsonb) id`,
    [requestId, deliveryDate, customerLines]);
  const operatorOrder = (fee = 200) => db.query(`select public.trameli_operator_order(
    null,$1::uuid,null,$2::date,'Cliente manual','','Bloco 2','',$3,$4::jsonb) id`,
    [randomUUID(), dates.future, fee, manualItems]);

  await asUser(customer);
  await assert.rejects(customerOrder(randomUUID(), dates.today), /cutoff exceeded/);
  const placed = await customerOrder(randomUUID(), dates.future);
  const customerOrderId = placed.rows[0].id;
  const stored = (await db.query(`select fee_cents,payment_method_preference
    from public.trameli_orders where id=$1`, [customerOrderId])).rows[0];
  assert.equal(stored.fee_cents, 200);
  assert.equal(stored.payment_method_preference, 'pix_manual');

  const cancellable = (await customerOrder(randomUUID(), dates.future)).rows[0].id;
  await db.query('select public.trameli_cancel_customer_order($1,1)', [cancellable]);
  assert.equal((await db.query('select status from public.trameli_orders where id=$1', [cancellable])).rows[0].status, 'cancelled');

  const expired = (await customerOrder(randomUUID(), dates.future)).rows[0].id;
  await db.exec('reset role');
  await db.query('update public.trameli_orders set delivery_date=$2 where id=$1', [expired, dates.today]);
  await asUser(customer);
  await assert.rejects(db.query('select public.trameli_cancel_customer_order($1,1)', [expired]), /cutoff exceeded/);

  await asUser(operator);
  await assert.rejects(operatorOrder(300), /fee must be R\$ 2\.00/);
  const manualOrderId = (await operatorOrder()).rows[0].id;
  await db.query("select public.trameli_operator_status($1,1,'confirmed')", [manualOrderId]);
  await assert.rejects(db.query("select public.trameli_operator_status($1,2,'received')", [manualOrderId]), /master access required/);
  await assert.rejects(db.query(`select public.trameli_operator_order(
    $1,null,2,$2::date,'Alterado','','Bloco 2','',200,$3::jsonb)`,
    [manualOrderId, dates.future, manualItems]), /only master/);
  await db.query("select public.trameli_operator_status($1,2,'packing')", [manualOrderId]);

  await asUser(master);
  await db.query(`select public.trameli_operator_order(
    $1,null,3,$2::date,'Alterado pelo master','','Bloco 2','',200,$3::jsonb)`,
    [manualOrderId, dates.future, manualItems]);
  await db.query("select public.trameli_operator_status($1,4,'confirmed')", [manualOrderId]);
  const corrected = (await db.query('select customer_name,status,version from public.trameli_orders where id=$1', [manualOrderId])).rows[0];
  assert.equal(corrected.customer_name, 'Alterado pelo master');
  assert.equal(corrected.status, 'confirmed');
  assert.equal(corrected.version, 5);

  await db.exec('set role anon');
  await assert.rejects(db.query(`select public.trameli_customer_order(
    null,null,null,$1::date,'Cliente','','Bloco 1','','pix_manual',$2::jsonb)`,
    [dates.future, customerLines]), /permission denied/);
  console.log('Regras de negócio: corte configurável iniciado em 21h, taxa fixa, forma pretendida e autoridade do master OK.');
} finally {
  await db.close();
}
