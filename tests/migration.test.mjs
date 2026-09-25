import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text unique);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  const migration = await readFile(new URL('../supabase/migrations/202609240001_initial.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  const financeMigration = await readFile(new URL('../supabase/migrations/202609240002_catalog_finance.sql', import.meta.url), 'utf8');
  await db.exec(financeMigration);
  const catalogMigration = await readFile(new URL('../supabase/migrations/202609240003_catalog_seed.sql', import.meta.url), 'utf8');
  await db.exec(catalogMigration);
  const weightMigration = await readFile(new URL('../supabase/migrations/202609250004_weighted_frios.sql', import.meta.url), 'utf8');
  await db.exec(weightMigration);
  const provisionalMigration = await readFile(new URL('../supabase/migrations/202609250005_provisional_costs.sql', import.meta.url), 'utf8');
  await db.exec(provisionalMigration);
  const tables = await db.query(`select tablename from pg_tables where schemaname = 'public' and tablename like 'trameli_%' order by tablename`);
  assert.deepEqual(tables.rows.map(row => row.tablename), [
    'trameli_operators', 'trameli_order_costs', 'trameli_order_events', 'trameli_orders',
    'trameli_product_costs', 'trameli_products', 'trameli_profiles',
  ]);
  await db.exec('set role anon');
  const publicProducts = await db.query('select count(*)::integer as count from public.trameli_products');
  assert.equal(publicProducts.rows[0].count, 79);
  await assert.rejects(db.query('select count(*) from public.trameli_orders'), /permission denied/);
  await assert.rejects(db.query('select count(*) from public.trameli_product_costs'), /permission denied/);
  await assert.rejects(db.query('select public.trameli_is_operator()'), /permission denied/);
  await db.exec('reset role');
  const customerA = '11111111-1111-4111-8111-111111111111';
  const customerB = '22222222-2222-4222-8222-222222222222';
  const operator = '33333333-3333-4333-8333-333333333333';
  await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4),($5,$6)',
    [customerA, 'a@example.test', customerB, 'b@example.test', operator, 'op@example.test']);
  await db.query('insert into public.trameli_operators(user_id) values ($1)', [operator]);
  const product = await db.query(`select id, price_cents from public.trameli_products where name = 'Pão de queijo'`);
  const productId = product.rows[0].id;
  assert.equal(product.rows[0].price_cents, 130);
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [customerA]);
  await assert.rejects(
    db.query('select public.trameli_save_product_cost($1,40,$2)', [productId, 'Teste']),
    /operator access required/,
  );
  const placed = await db.query(`select public.trameli_customer_order(
    null, $1::uuid, null, (now() at time zone 'America/Sao_Paulo')::date + 1,
    'Cliente A', '', 'Bloco 1, apto 10', '', $2::jsonb) as id`, [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    JSON.stringify([{ product_id: productId, quantity: 5, priceCents: 1 }]),
  ]);
  const orderId = placed.rows[0].id;
  const totals = await db.query('select subtotal_cents,fee_cents,total_cents from public.trameli_orders where id = $1', [orderId]);
  assert.equal(Number(totals.rows[0].subtotal_cents), 650);
  assert.equal(Number(totals.rows[0].total_cents), 850);
  const uncataloguedCost = await db.query('select count(*)::integer as count from public.trameli_order_costs');
  assert.equal(uncataloguedCost.rows[0].count, 0);
  await assert.rejects(
    db.query("update public.trameli_orders set customer_name = 'Fraude' where id = $1", [orderId]),
    /permission denied/,
  );
  await assert.rejects(
    db.query('insert into public.trameli_operators(user_id) values ($1)', [customerA]),
    /permission denied/,
  );
  const retry = await db.query(`select public.trameli_customer_order(
    null, $1::uuid, null, (now() at time zone 'America/Sao_Paulo')::date + 1,
    'Cliente A', '', 'Bloco 1, apto 10', '', $2::jsonb) as id`, [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', JSON.stringify([{ product_id: productId, quantity: 5 }]),
  ]);
  assert.equal(retry.rows[0].id, orderId);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [customerB]);
  const invisible = await db.query('select count(*)::integer as count from public.trameli_orders');
  assert.equal(invisible.rows[0].count, 0);
  const invisibleProfile = await db.query('select count(*)::integer as count from public.trameli_profiles');
  assert.equal(invisibleProfile.rows[0].count, 0);
  const invisibleEvents = await db.query('select count(*)::integer as count from public.trameli_order_events');
  assert.equal(invisibleEvents.rows[0].count, 0);
  await assert.rejects(
    db.query('select public.trameli_cancel_customer_order($1,1)', [orderId]),
    /cannot be cancelled/,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operator]);
  await db.query('select public.trameli_save_product_cost($1,40,$2)', [productId, 'Teste']);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [customerA]);
  const future = await db.query(`select public.trameli_customer_order(
    null, $1::uuid, null, (now() at time zone 'America/Sao_Paulo')::date + 1,
    'Cliente A', '', 'Bloco 1, apto 10', '', $2::jsonb) as id`, [
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', JSON.stringify([{ product_id: productId, quantity: 2 }]),
  ]);
  const hiddenCosts = await db.query('select count(*)::integer as count from public.trameli_order_costs');
  assert.equal(hiddenCosts.rows[0].count, 0);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operator]);
  const snapshot = await db.query('select quantity,unit_cost_cents,total_cost_cents from public.trameli_order_costs where order_id = $1', [future.rows[0].id]);
  assert.deepEqual(snapshot.rows.map(row => [row.quantity, row.unit_cost_cents, Number(row.total_cost_cents)]), [[2, 40, 80]]);
  const summary = await db.query('select order_id,missing_count,supplier_total_cents from public.trameli_order_cost_summary() where order_id = $1', [future.rows[0].id]);
  assert.equal(summary.rows[0].missing_count, 0);
  assert.equal(Number(summary.rows[0].supplier_total_cents), 80);
  const olderSummary = await db.query('select missing_count from public.trameli_order_cost_summary() where order_id = $1', [orderId]);
  assert.equal(olderSummary.rows[0].missing_count, 1);
  await db.query('select public.trameli_save_product_cost($1,70,$2)', [productId, 'Teste']);
  const frozen = await db.query('select unit_cost_cents from public.trameli_order_costs where order_id = $1', [future.rows[0].id]);
  assert.equal(frozen.rows[0].unit_cost_cents, 40);
  const visible = await db.query('select count(*)::integer as count from public.trameli_orders');
  assert.equal(visible.rows[0].count, 2);
  const audit = await db.query('select count(*)::integer as count from public.trameli_order_events');
  assert.equal(audit.rows[0].count, 2);
  await db.query('select public.trameli_operator_status($1,1,$2::public.trameli_order_status)', [orderId, 'confirmed']);
  await assert.rejects(
    db.query('select public.trameli_operator_status($1,2,$2::public.trameli_order_status)', [orderId, 'delivered']),
    /invalid status transition/,
  );
  const afterStatus = await db.query('select status,version from public.trameli_orders where id = $1', [orderId]);
  assert.equal(afterStatus.rows[0].status, 'confirmed');
  assert.equal(afterStatus.rows[0].version, 2);
  const afterAudit = await db.query('select count(*)::integer as count from public.trameli_order_events');
  assert.equal(afterAudit.rows[0].count, 3);
  const mozzarella = await db.query("select id,price_cents,unit from public.trameli_products where name = 'Mussarela'");
  assert.equal(mozzarella.rows[0].price_cents, 6999);
  assert.equal(mozzarella.rows[0].unit, 'kg');
  await db.query('select public.trameli_save_product_cost($1,5000,$2)', [mozzarella.rows[0].id, 'Custo por kg']);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [customerA]);
  await assert.rejects(db.query(`select public.trameli_customer_order(
    null, $1::uuid, null, (now() at time zone 'America/Sao_Paulo')::date + 1,
    'Cliente A', '', 'Bloco 1, apto 10', '', $2::jsonb)`, [
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    JSON.stringify([{ product_id: mozzarella.rows[0].id, grams: 75 }]),
  ]), /invalid weight/);
  const weighted = await db.query(`select public.trameli_customer_order(
    null, $1::uuid, null, (now() at time zone 'America/Sao_Paulo')::date + 1,
    'Cliente A', '', 'Bloco 1, apto 10', '', $2::jsonb) as id`, [
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    JSON.stringify([{ product_id: mozzarella.rows[0].id, grams: 50, priceCents: 1 },
      { product_id: mozzarella.rows[0].id, grams: 1000, priceCents: 1 }]),
  ]);
  const weightedOrder = await db.query('select items,subtotal_cents,total_cents from public.trameli_orders where id = $1', [weighted.rows[0].id]);
  assert.equal(Number(weightedOrder.rows[0].subtotal_cents), 7349);
  assert.equal(Number(weightedOrder.rows[0].total_cents), 7549);
  assert.deepEqual(weightedOrder.rows[0].items.map(item => [item.weightGrams, item.priceCents]), [[50, 350], [1000, 6999]]);
  const customerCostRows = await db.query('select count(*)::integer as count from public.trameli_order_costs');
  assert.equal(customerCostRows.rows[0].count, 0);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operator]);
  const weightedCosts = await db.query('select unit_cost_cents,total_cost_cents from public.trameli_order_costs where order_id = $1 order by line_index', [weighted.rows[0].id]);
  assert.deepEqual(weightedCosts.rows.map(row => [row.unit_cost_cents, Number(row.total_cost_cents)]), [[250, 250], [5000, 5000]]);
  const manualWeight = await db.query(`select public.trameli_operator_order(
    null, $1::uuid, null, (now() at time zone 'America/Sao_Paulo')::date + 1,
    'Cliente manual', '', 'Bloco 2', '', 200, $2::jsonb) as id`, [
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    JSON.stringify([{ productId: mozzarella.rows[0].id, name: 'Mussarela',
      quantity: 1, weightGrams: 150, kgPriceCents: 6999, priceCents: 1050 }]),
  ]);
  const manualOrder = await db.query('select subtotal_cents,items from public.trameli_orders where id = $1', [manualWeight.rows[0].id]);
  assert.equal(Number(manualOrder.rows[0].subtotal_cents), 1050);
  assert.equal(manualOrder.rows[0].items[0].weightGrams, 150);
  const manualCost = await db.query('select total_cost_cents from public.trameli_order_costs where order_id = $1', [manualWeight.rows[0].id]);
  assert.equal(Number(manualCost.rows[0].total_cost_cents), 750);
  await db.exec('reset role');
  await db.query('update public.trameli_product_costs set unit_cost_cents = 4374, estimated = true where product_id = $1', [mozzarella.rows[0].id]);
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operator]);
  await db.query('select public.trameli_save_product_cost($1,4374,$2)', [mozzarella.rows[0].id, 'Custo por kg']);
  const stillEstimated = await db.query('select estimated from public.trameli_product_costs where product_id = $1', [mozzarella.rows[0].id]);
  assert.equal(stillEstimated.rows[0].estimated, true);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [customerA]);
  await assert.rejects(db.query('select public.trameli_confirm_product_cost($1)', [mozzarella.rows[0].id]), /operator access required/);
  const provisionalOrder = await db.query(`select public.trameli_customer_order(
    null, $1::uuid, null, (now() at time zone 'America/Sao_Paulo')::date + 1,
    'Cliente A', '', 'Bloco 1, apto 10', '', $2::jsonb) as id`, [
    'abababab-abab-4aba-8aba-abababababab',
    JSON.stringify([{ product_id: mozzarella.rows[0].id, grams: 1000 }]),
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operator]);
  const provisionalSummary = await db.query('select estimated_count,supplier_total_cents from public.trameli_order_cost_summary() where order_id = $1', [provisionalOrder.rows[0].id]);
  assert.equal(provisionalSummary.rows[0].estimated_count, 1);
  assert.equal(Number(provisionalSummary.rows[0].supplier_total_cents), 4374);
  await db.query('select public.trameli_confirm_product_cost($1)', [mozzarella.rows[0].id]);
  const historicalEstimate = await db.query('select estimated from public.trameli_order_costs where order_id = $1', [provisionalOrder.rows[0].id]);
  assert.equal(historicalEstimate.rows[0].estimated, true);
  await assert.rejects(db.query(`select public.trameli_operator_order(
    null, $1::uuid, null, (now() at time zone 'America/Sao_Paulo')::date + 1,
    'Cliente manual', '', 'Bloco 2', '', 200, $2::jsonb)`, [
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    JSON.stringify([{ productId: mozzarella.rows[0].id, name: 'Mussarela',
      quantity: 1, weightGrams: 75, kgPriceCents: 6999, priceCents: 525 }]),
  ]), /invalid weight/);
  console.log('Migração PostgreSQL: OK');
} finally {
  await db.close();
}
