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
  // Estas migrations dependem de recursos gerenciados do Supabase que o PGlite
  // local não oferece (pg_net, pg_cron e Vault). Elas têm validação estática
  // própria e já são aplicadas/validadas no Supabase real.
  const supabasePlatformMigrations = new Set([
    '20261026140746_pwa_notifications_foundation.sql',
    '20261026141007_pwa_vapid_server_init.sql',
    '20261026141259_pwa_dispatch_guard.sql',
    '20261026141648_pwa_operator_order_notifications.sql',
    '20261026142242_pwa_rpc_privileges_hardening.sql',
  ]);
  for (const file of (await readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
    if (supabasePlatformMigrations.has(file)) continue;
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
  assert.equal(Number((await db.query('select total_cents from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(1)])).rows[0].total_cents),480,'Edição atualiza a próxima terça já gerada e ainda intacta.');
  const changedAgain={...changed,'2':[{...bread[0],quantity:3}]};
  await save(customers[0],'fixed',changedAgain,ids[0]);
  assert.equal(Number((await db.query('select total_cents from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(1)])).rows[0].total_cents),620,'Outra edição deve atualizar também uma ocorrência sincronizada anteriormente.');
  await save(customers[0],'fixed',changed,ids[0]);
  assert.equal(Number((await db.query('select public.trameli_sync_recurring_future($1) as n',[ids[0]])).rows[0].n),0,'Reconciliar novamente deve ser idempotente.');

  // Preserve manual exceptions, receipts (including partial payments), pending
  // customer payment signals and deliveries that have already been completed.
  await db.exec('reset role');
  const protectedOrders=(await db.query('select id,delivery_date from public.trameli_orders where customer_id=$1 and delivery_date between $2 and $3 order by delivery_date',[customers[0],dateAfter(2),dateAfter(5)])).rows;
  await db.query("update public.trameli_orders set version=version+1,updated_at=updated_at+interval '1 second',edited_at=now() where id=$1",[protectedOrders[0].id]);
  const payment=(await db.query("insert into public.trameli_payments(request_id,request_payload,kind,amount_cents,method,actor_id) values($1,'{}','receipt',100,'cash',$2) returning id",[randomUUID(),operator])).rows[0].id;
  await db.query('insert into public.trameli_payment_allocations(payment_id,order_id,amount_cents,actor_id) values($1,$2,100,$3)',[payment,protectedOrders[1].id,operator]);
  await db.query('insert into public.trameli_payment_intents(request_id,customer_id,order_ids,amount_cents) values($1,$2,$3,1040)',[randomUUID(),customers[0],[protectedOrders[2].id]]);
  await db.query("update public.trameli_orders set status='delivered',version=version+1 where id=$1",[protectedOrders[3].id]);
  const legacyOrder=(await db.query('select id from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(0)])).rows[0];
  await db.query("update public.trameli_orders set updated_at=updated_at+interval '1 second' where id=$1",[legacyOrder.id]);
  protectedOrders.push(legacyOrder);
  const protectedIds=protectedOrders.map(row=>row.id);
  const protectedBefore=JSON.stringify((await db.query('select * from public.trameli_orders where id=any($1::uuid[]) order by id',[protectedIds])).rows);
  await asUser(operator);
  const revised=Object.fromEntries([1,2,3,4,5,6].map(day=>[String(day),[{...bread[0],quantity:7}]]));
  await save(customers[0],'fixed',revised,ids[0]);
  assert.equal(JSON.stringify((await db.query('select * from public.trameli_orders where id=any($1::uuid[]) order by id',[protectedIds])).rows),protectedBefore,'A edição não pode alterar pedidos manuais, pagos, com Pix informado ou entregues.');
  assert.equal(Number((await db.query('select total_cents from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(1)])).rows[0].total_cents),1180,'Ocorrência futura intacta acompanha a nova cesta.');
  // The same safe synchronization applies to fortnightly and monthly plans.
  for(const index of [1,2]){
    await save(customers[index],index===1?'fortnightly':'monthly',revised,ids[index]);
    assert.equal(Number((await db.query('select total_cents from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[index],dateAfter(1)])).rows[0].total_cents),1180);
  }
  await db.exec('reset role');
  await db.query("update public.trameli_recurring_orders set starts_on=(now() at time zone 'America/Sao_Paulo')::date-1 where id=$1",[ids[2]]);
  const history=[];
  for(const shift of [0,1]){
    const order=(await db.query("insert into public.trameli_orders(customer_id,source,request_id,status,customer_name,address,delivery_date,items,subtotal_cents,fee_cents) values($1,'operator',$2,'confirmed','Cliente teste','Rua teste 10',(now() at time zone 'America/Sao_Paulo')::date-$3::integer,$4::jsonb,840,200) returning id",[customers[2],randomUUID(),shift,JSON.stringify(bread)])).rows[0];
    await db.query('insert into public.trameli_recurring_occurrences(schedule_id,delivery_date,order_id) select $1,delivery_date,id from public.trameli_orders where id=$2',[ids[2],order.id]);
    history.push(order.id);
  }
  const historyBefore=JSON.stringify((await db.query('select * from public.trameli_orders where id=any($1::uuid[]) order by id',[history])).rows);
  await asUser(operator);
  await db.query('select public.trameli_sync_recurring_future($1)',[ids[2]]);
  assert.equal(JSON.stringify((await db.query('select * from public.trameli_orders where id=any($1::uuid[]) order by id',[history])).rows),historyBefore,'Hoje e o histórico devem permanecer intactos.');
  await save(customers[0],'fixed',changed,ids[0]);
  await materialize(8);
  assert.equal(Number((await db.query('select total_cents from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(8)])).rows[0].total_cents),480,'A próxima terça usa o novo pedido.');
  const saturdayBasket=[{...bread[0],quantity:4},{name:'Biscoitão teste',quantity:1,priceCents:400}];
  await save(customers[0],'fixed',{...changed,'6':saturdayBasket},ids[0]);
  await materialize(12);
  const saturdayOrder=(await db.query('select items,total_cents from public.trameli_orders where customer_id=$1 and delivery_date=$2',[customers[0],dateAfter(12)])).rows[0];
  assert.deepEqual(saturdayOrder.items,saturdayBasket,'Sábado deve gerar quatro pães e um biscoitão.');
  assert.equal(Number(saturdayOrder.total_cents),1160,'O total de sábado inclui seus próprios itens e a entrega.');
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
  await assert.rejects(db.query('select public.trameli_sync_recurring_future($1)',[ids[0]]),/operator access required/);
  await assert.rejects(db.query('select private.trameli_sync_recurring_future($1)',[ids[0]]),/permission denied/);
  await assert.rejects(db.query("update public.trameli_recurring_orders set items_by_weekday=null"),/permission denied/);
  await db.exec('set role anon');
  await assert.rejects(save(customers[0],'fixed'),/permission denied/);
  console.log('Recorrências por dia: 3 frequências, pesos/totais, reordenação de dias, renovação, idempotência, edição futura, compatibilidade e permissões OK.');
} finally { await db.close(); }
