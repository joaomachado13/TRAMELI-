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
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  // The auth release must work before the optional catalog/cost migrations are applied.
  for (const file of ['202609240001_initial.sql', '202609300006_access_roles.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.query('insert into auth.users(id,email,phone) values ($1,$2,null),($3,$4,null),($5,$6,$7)',
    [master, 'master@example.test', operator, 'operator@example.test', customer, 'customer@example.test', '5534999999999']);
  await db.query("insert into public.trameli_operators(user_id,role) values ($1,'master'),($2,'operator')", [master, operator]);
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.trameli_access_role()'), /permission denied/);
  await db.exec('reset role; set role authenticated');
  for (const [user, expectedRole] of [[customer, 'customer'], [operator, 'operator'], [master, 'master']]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    assert.equal((await db.query('select public.trameli_access_role() as role')).rows[0].role, expectedRole);
    assert.equal((await db.query('select public.trameli_is_operator() as ok')).rows[0].ok, expectedRole !== 'customer');
    await assert.rejects(db.query("update public.trameli_operators set role = 'master'"), /permission denied/);
    if (expectedRole !== 'master') {
      await assert.rejects(db.query('select public.trameli_list_team()'), /master/);
      await assert.rejects(db.query("select public.trameli_set_team_role('customer@example.test','master')"), /master/);
      assert.equal((await db.query('select count(*)::int as n from public.trameli_access_events')).rows[0].n, 0);
    }
  }
  assert.equal((await db.query('select * from public.trameli_list_team()')).rows.length, 2);
  await assert.rejects(db.query("select public.trameli_set_team_role('master@example.test','customer')"), /própria/);
  await assert.rejects(db.query("select public.trameli_set_team_role('missing@example.test','master')"), /não encontrada/);
  await assert.rejects(db.query("select public.trameli_set_team_role('customer@example.test','superadmin')"), /inválida/);
  await db.query("select public.trameli_set_team_role('+5534999999999','operator')");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [customer]);
  assert.equal((await db.query('select public.trameli_access_role() as role')).rows[0].role, 'operator');
  await assert.rejects(db.query("select public.trameli_set_team_role('customer@example.test','master')"), /master/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [master]);
  await db.query("select public.trameli_set_team_role('customer@example.test','master')");
  await db.query("select public.trameli_set_team_role('operator@example.test','customer')");
  const events = await db.query('select before_role,after_role from public.trameli_access_events where target_id=$1 order by id', [customer]);
  assert.deepEqual(events.rows.map(row => [row.before_role, row.after_role]), [['customer', 'operator'], ['operator', 'master']]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operator]);
  assert.equal((await db.query('select public.trameli_is_operator() as ok')).rows[0].ok, false);
  console.log('Acessos: master, operadora, cliente, revogação e auditoria OK');
} finally { await db.close(); }
