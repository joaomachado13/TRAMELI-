import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const db = new PGlite({ extensions: { pgcrypto } });
const operator = randomUUID(), customers = [randomUUID(),randomUUID(),randomUUID()];
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
  for (const file of (await readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(new URL(file, dir), 'utf8')); }
    catch (cause) { throw new Error(`${file}: ${cause.message}`); }
  }
  for(const id of [operator,...customers]) await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query("insert into public.trameli_operators(user_id,role) values($1,'operator')",[operator]);
  for(const id of customers) await db.query("insert into public.trameli_profiles(user_id,name,address) values($1,'Cliente teste','Rua teste 10')",[id]);
  const cheeseId=(await db.query("insert into public.trameli_products(name,unit,price_cents) values('Queijo teste','kg',10000) returning id")).rows[0].id;
  const monday=(await db.query("select (date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)+interval '2 months')::date + ((8-extract(dow from (date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)+interval '2 months')::date)::int)%7) as day")).rows[0].day;
  const dateAfter=days=>{const d=new Date(monday);d.setUTCHours(12,0,0,0);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  const asUser=async id=>{await db.exec('reset role; set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
  const bread=[{name:'Pão teste',quantity:6,priceCents:140}];
  const combo=[...bread,{productId:cheeseId,name:'Queijo teste',quantity:1,weightGrams:150,kgPriceCents:10000,priceCents:1500}];
  const daily=Object.fromEntries([1,2,3,4,5,6].map(day=>[String(day),day%2?bread:combo]));
  const save=(customer,recurrence,plan=daily,id=null,request=randomUUID(),days=[1,2,3,4,5,6])=>db.query(`select public.trameli_save_recurring_order_daily($1,$2,$3,$4,$5,true,'',200,$6::jsonb,$7::smallint[],$8::jsonb) as id`,[id,request,customer,recurrence,dateAfter(0),JSON.stringify(bread),days,plan===null?null:JSON.stringify(plan)]);
  const materialize=async days=>Number((await db.query('select public.trameli_materialize_recurring_orders($1) as count',[dateAfter(days)])).rows[0].count);
  await asUser(customers[0]);
  await assert.rejects(save(customers[0],'fixed'),/operator access required/);
  await assert.rejects(db.query('select private.trameli_recurring_items($1::jsonb)',[JSON.stringify(bread)]),/permission denied/);
  await asUser(operator);
  const ids=[];
  for(const [index,recurrence] of ['fixed','fortnightly','monthly'].entries()){
    const request=randomUUID();
    const id=(await save(customers[index],recurrence,daily,null,request)).rows[0].id;ids.push(id);
    assert.equal((await save(customers[index],recurrence,{'1':combo},null,request)).rows[0].id,id,'Repetir a requisição deve preservar o pedido original.');
    assert.equal((await db.query(`select jsonb_array_length(items_by_weekday->'2') as n from public.trameli_recurring_orders where id=$1`,[id])).rows[0].n,2);
  }
  for(let day=0;day<6;day++){
    assert.equal(await materialize(day),3);
    assert.equal(await materialize(day),0,'Reabrir uma data não deve duplicar pedidos.');
    const rows=(await db.query('select items,total_cents from public.trameli_orders where delivery_date=$1',[dateAfter(day)])).rows;
    assert.equal(rows.length,3);
    for(const order of rows){
      assert.equal(order.items.length,day%2?2:1);
      assert.equal(Number(order.total_cents),day%2?2540:1040);
      if(day%2)assert.equal(order.items[1].weightGrams,150);
    }
  }
  assert.equal(await materialize(6),0,'Domingo permanece sem entregas.');
  const saved=JSON.stringify((await db.query('select items_by_weekday from public.trameli_recurring_orders where id=$1',[ids[0]])).rows[0].items_by_weekday);
  for(const invalid of [{...daily,'2':[]},{...daily,'0':bread},{'1':bread},[],{...daily,'2':[{...combo[1],weightGrams:51}]}]){
    await assert.rejects(save(customers[0],'fixed',invalid,ids[0]));
    assert.equal(JSON.stringify((await db.query('select items_by_weekday from public.trameli_recurring_orders where id=$1',[ids[0]])).rows[0].items_by_weekday),saved,'Falha deve reverter toda a edição.');
  }
  await assert.rejects(save(customers[0],'fixed',daily,ids[0],randomUUID(),[1,null]),/segunda a sábado/);
  await assert.rejects(db.query(`select public.trameli_save_recurring_order_with_days($1,$2,$3,'fixed',$4,true,'',200,$5::jsonb,array[1]::smallint[])`,[ids[0],randomUUID(),customers[0],dateAfter(0),JSON.stringify(bread)]),/Portal da Shirley/);
  const changed={...daily,'2':[{...bread[0],quantity:2}]};
  await save(customers[0],'fixed',changed,ids[0]);
  assert.equal(await materialize(1),0);
  assert.equal(Number((await db.query('select total_cents from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(1)])).rows[0].total_cents),2540,'Edição não reescreve ocorrência existente.');
  await materialize(8);
  assert.equal(Number((await db.query('select total_cents from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(8)])).rows[0].total_cents),480,'A próxima terça usa o novo pedido.');
  await save(customers[0],'fixed',null,ids[0],randomUUID(),[1,3]);
  assert.equal((await db.query('select items_by_weekday from public.trameli_recurring_orders where id=$1',[ids[0]])).rows[0].items_by_weekday,null);
  await materialize(15);
  assert.equal((await db.query('select id from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(15)])).rows.length,0,'Dias desmarcados não devem gerar pedido.');
  await materialize(35);
  for(const id of ids.slice(1))assert.ok((await db.query('select cycle_ends_on >= $2::date as renewed from public.trameli_recurring_orders where id=$1',[id,dateAfter(35)])).rows[0].renewed,'O ciclo de cobrança deve renovar sem perder a variação por dia.');
  await db.query(`select public.trameli_save_recurring_order_with_days($1,$2,$3,'fixed',$4,true,'',200,$5::jsonb,array[4]::smallint[])`,[ids[0],randomUUID(),customers[0],dateAfter(0),JSON.stringify(bread)]);
  await materialize(43);
  assert.equal((await db.query('select id from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(43)])).rows.length,0,'O caminho antigo também deve respeitar os dias escolhidos.');
  await materialize(45);
  assert.equal(Number((await db.query('select total_cents from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(45)])).rows[0].total_cents),1040,'Programação comum continua funcionando pelo caminho antigo.');
  await asUser(customers[0]);
  await assert.rejects(db.query("update public.trameli_recurring_orders set items_by_weekday=null"),/permission denied/);
  await db.exec('set role anon');
  await assert.rejects(save(customers[0],'fixed'),/permission denied/);
  console.log('Recorrências por dia: 3 frequências, pesos/totais, reordenação de dias, renovação, idempotência, edição futura, compatibilidade e permissões OK.');
} finally { await db.close(); }
