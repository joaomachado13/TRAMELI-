import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const master=randomUUID(),customer=randomUUID();
const migrations=[
  '202609240001_initial.sql','202609240002_catalog_finance.sql','202609240003_catalog_seed.sql',
  '202609250004_weighted_frios.sql','202609250005_provisional_costs.sql','202609300006_access_roles.sql',
  '202609300007_payment_ledger.sql','202609300008_favorites.sql','202609300009_manual_pix.sql',
  '202610010010_security_hardening.sql','20261001130152_approved_business_rules.sql',
  '20261001170448_free_operational_followups.sql',
];

try {
  await db.exec(`create role anon nologin;create role authenticated nologin;
    create schema auth;create table auth.users(id uuid primary key,email text,phone text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  for(const file of migrations) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  await db.query('insert into auth.users(id) values($1),($2)',[master,customer]);
  await db.query("insert into public.trameli_operators(user_id,role) values($1,'master')",[master]);
  const product=(await db.query("select id,name from public.trameli_products where active order by name limit 1")).rows[0];
  const dates=(await db.query("select ((now() at time zone 'America/Sao_Paulo')::date+2)::text future")).rows[0];
  const asUser=async id=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};

  await asUser(master);
  await db.query(`select public.trameli_save_product_operational(
    $1,$2,'Teste','unidade',null,1000,true,null,'',$3::date,$3::date,null)`,[product.id,product.name,dates.future]);
  assert.ok(Number((await db.query('select count(*) n from public.trameli_product_events where product_id=$1',[product.id])).rows[0].n)>0);

  await asUser(customer);
  const lines=JSON.stringify([{product_id:product.id,quantity:1}]);
  await assert.rejects(db.query(`select public.trameli_customer_order(
    null,$1::uuid,null,$2::date,'Cliente','','Rua 1','','pix_manual',$3::jsonb)`,[randomUUID(),dates.future,lines]),/indisponível/);

  await db.exec('reset role');
  await db.query('update public.trameli_products set unavailable_from=null,unavailable_until=null where id=$1',[product.id]);
  await asUser(customer);
  const orderId=(await db.query(`select public.trameli_customer_order(
    null,$1::uuid,null,$2::date,'Cliente','','Rua 1','','pix_manual',$3::jsonb) id`,[randomUUID(),dates.future,lines])).rows[0].id;
  const intentId=(await db.query('select public.trameli_signal_pix_payment($1,$2::uuid[]) id',[randomUUID(),[orderId]])).rows[0].id;
  assert.ok(intentId);
  assert.equal((await db.query('select status from public.trameli_payment_intents where id=$1',[intentId])).rows[0].status,'pending');

  await asUser(master);
  await db.query("select public.trameli_resolve_payment_intent($1,'dismissed')",[intentId]);
  assert.equal((await db.query('select status from public.trameli_payment_intents where id=$1',[intentId])).rows[0].status,'dismissed');
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.trameli_audit_product()'),/permission denied/);
  console.log('Pendências gratuitas: histórico, indisponibilidade e aviso Pix manual OK.');
} finally { await db.close(); }
