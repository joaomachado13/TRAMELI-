import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const master = '11111111-1111-4111-8111-111111111111';
const operator = '22222222-2222-4222-8222-222222222222';
const customer = '33333333-3333-4333-8333-333333333333';
try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key, email text, phone text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for (const file of ['202609240001_initial.sql', '202609300006_access_roles.sql', '20261020172855_product_featured_position.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.query('insert into auth.users(id) values ($1),($2),($3)', [master, operator, customer]);
  await db.query("insert into public.trameli_operators(user_id,role) values ($1,'master'),($2,'operator')", [master, operator]);
  const product = (await db.query("insert into public.trameli_products(name,price_cents) values ('Pão teste',140) returning id")).rows[0].id;
  const asUser = async id => { await db.exec('reset role; set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); };
  await asUser(customer);
  await assert.rejects(db.query('select public.trameli_set_product_featured($1,1)', [product]), /operação/);
  await assert.rejects(db.query('update public.trameli_products set featured_position=1 where id=$1', [product]), /permission denied/);
  await asUser(operator);
  await db.query('select public.trameli_set_product_featured($1,2)', [product]);
  assert.equal((await db.query('select featured_position from public.trameli_products where id=$1', [product])).rows[0].featured_position, 2);
  await assert.rejects(db.query('select public.trameli_set_product_featured($1,21)', [product]), /1 a 20/);
  await asUser(master);
  await db.query('select public.trameli_set_product_featured($1,1)', [product]);
  await db.exec('set role anon');
  assert.equal((await db.query('select featured_position from public.trameli_products where id=$1', [product])).rows[0].featured_position, 1);
  await assert.rejects(db.query('select public.trameli_set_product_featured($1,null)', [product]), /permission denied/);
  await asUser(master);
  await db.query('select public.trameli_set_product_featured($1,null)', [product]);
  assert.equal((await db.query('select featured_position,price_cents from public.trameli_products where id=$1', [product])).rows[0].featured_position, null);
  assert.equal((await db.query('select price_cents from public.trameli_products where id=$1', [product])).rows[0].price_cents, 140);
  console.log('Vitrine no banco: seleção, reordenação, remoção e permissões de operação/cliente OK.');
} finally { await db.close(); }
