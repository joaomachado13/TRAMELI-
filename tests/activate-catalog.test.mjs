import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { officialPhotos } from '../src/product-photos.js';

const db = new PGlite({ extensions: { pgcrypto } });
const master = '11111111-1111-4111-8111-111111111111';
try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key, email text, phone text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  // Reproduce the real installation order: initial schema, Master, then catalog.
  for (const file of ['202609240001_initial.sql', '202609300006_access_roles.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.query('insert into auth.users(id,email) values ($1,$2)', [master, 'master@example.test']);
  await db.query("insert into public.trameli_operators(user_id,role) values ($1,'master')", [master]);
  const bundle = await readFile(new URL('../supabase/activate-catalog.sql', import.meta.url), 'utf8');
  assert.equal((bundle.match(/^begin;$/gm) || []).length, 1);
  assert.equal((bundle.match(/^commit;$/gm) || []).length, 1);

  // Simulated end-of-import failure must also roll back schema and seed changes.
  await assert.rejects(db.exec(bundle.replace('<> 81', '<> 9999')), /Contagem inesperada/);
  await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('public.trameli_product_costs') as t")).rows[0].t, null);
  assert.equal((await db.query('select count(*)::int as n from public.trameli_products')).rows[0].n, 0);

  await db.exec(bundle);
  const actual = (await db.query('select * from public.trameli_products')).rows;
  const { products } = JSON.parse(await readFile(new URL('../data/client-products.json', import.meta.url), 'utf8'));
  assert.equal(actual.length, 81);
  assert.equal(actual.filter(p => p.active).length, 79);
  for (const product of products) {
    const row = actual.find(item => item.id === product.id);
    assert.ok(row, product.name);
    assert.equal(row.name, product.name);
    assert.equal(row.price_cents, product.priceCents);
    assert.equal(row.unit, product.unit);
    assert.equal(row.active, product.active);
    assert.equal(row.image_url, officialPhotos.find(photo => photo.productId === product.id)?.image || null);
  }
  assert.equal((await db.query('select count(*)::int as n from public.trameli_product_costs')).rows[0].n, 0);
  assert.equal((await db.query('select role from public.trameli_operators where user_id=$1', [master])).rows[0].role, 'master');
  await db.exec('set role anon');
  assert.equal((await db.query('select count(*)::int as n from public.trameli_products')).rows[0].n, 79);
  await assert.rejects(db.query('select * from public.trameli_product_costs'), /permission denied/);
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [master]);
  assert.equal((await db.query('select public.trameli_access_role() as role')).rows[0].role, 'master');
  assert.equal((await db.query('select * from public.trameli_list_team()')).rows.length, 1);
  await db.exec('reset role');
  await assert.rejects(db.exec(bundle), /Estrutura de custos já instalada/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from public.trameli_products')).rows[0].n, 81);
  console.log('Pacote único: 81 produtos, 79 ativos, 16 fotos, Master preservado, rollback e reaplicação protegidos.');
} finally { await db.close(); }
