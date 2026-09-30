import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { rebuildCart, frequentProductIds } from '../src/shopping-math.js';

const products=[
  {id:'bread',name:'Pão',priceCents:140,unit:'unidade',active:true},
  {id:'cheese',name:'Mussarela',priceCents:6999,unit:'kg',active:true},
  {id:'off',name:'Indisponível',priceCents:500,unit:'unidade',active:false},
];
const order={feeCents:100,items:[
  {productId:'bread',name:'Pão',priceCents:100,quantity:2},
  {productId:'cheese',name:'Mussarela',kgPriceCents:6000,weightGrams:200,quantity:1},
  {productId:'off',name:'Indisponível',priceCents:500,quantity:1},
  {productId:'deleted',name:'Pão',priceCents:100,quantity:1},
]};
const original=structuredClone(order);
const rebuilt=rebuildCart(order,products);
assert.deepEqual(rebuilt.cart,{bread:2,cheese:4});
assert.equal(rebuilt.notices.length,5);
assert.deepEqual(order,original,'Reordering must not change old order');
assert.deepEqual(rebuildCart({items:[{name:'Pão',quantity:2,priceCents:140}]},products).cart,{bread:2});
assert.deepEqual(rebuildCart({items:[{name:'Pão',quantity:2}]},[...products,{...products[0],id:'duplicate'}]).cart,{});
for(const item of [
  {productId:'cheese',quantity:1,weightGrams:75},
  {productId:'cheese',quantity:2,weightGrams:100},
  {productId:'bread',quantity:1,weightGrams:100},
  {productId:'bread',quantity:-1},
])assert.deepEqual(rebuildCart({items:[item]},products).cart,{});
assert.equal(rebuildCart({items:[{productId:'bread',quantity:1000}]},products).cart.bread,99);
const old={items:[{productId:'bread'}, {productId:'bread'},{productId:'off'}]};
assert.deepEqual(frequentProductIds([old],products),[]);
assert.deepEqual(frequentProductIds([old,old,{...old,status:'cancelled'}],products),['bread']);

const db=new PGlite({extensions:{pgcrypto}});
try{
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,email text,phone text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const name of (await readdir(dir)).filter(name=>/00[1-6]_.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  const bundle=await readFile(new URL('../supabase/activate-payments-shopping.sql',import.meta.url),'utf8');
  await db.exec(bundle);
  await assert.rejects(db.exec(bundle),/já foi aplicada/);
  await db.exec('rollback');
  const a=randomUUID(),b=randomUUID();
  await db.query('insert into auth.users(id) values($1),($2)',[a,b]);
  const product=(await db.query("insert into trameli_products(name,price_cents) values('Favorito teste',100) returning id")).rows[0].id;
  const user=async id=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
  const toggle=value=>db.query('select trameli_set_favorite($1,$2)',[product,value]);
  await user(a);
  await toggle(true);await toggle(true);
  assert.equal((await db.query('select * from trameli_favorites')).rows.length,1);
  await assert.rejects(db.query('insert into trameli_favorites(user_id,product_id) values($1,$2)',[b,product]),/permission denied/);
  await user(b);
  assert.equal((await db.query('select * from trameli_favorites')).rows.length,0);
  await toggle(false);
  await toggle(true);
  assert.equal((await db.query('select * from trameli_favorites')).rows[0].user_id,b);
  await user(a);
  assert.equal((await db.query('select * from trameli_favorites')).rows.length,1);
  await toggle(false);
  assert.equal((await db.query('select * from trameli_favorites')).rows.length,0);
  await db.exec('reset role');
  await db.query('update trameli_products set active=false where id=$1',[product]);
  await user(a);
  await assert.rejects(toggle(true),/indisponível/);
  await user(b);await toggle(false);
  await db.exec('reset role;set role anon');
  await assert.rejects(toggle(true),/permission denied/);
  await assert.rejects(db.query('select * from trameli_favorites'),/permission denied/);
  console.log('Recompra: preços atuais, pesos, indisponíveis, limite e histórico preservado. Favoritos: isolamento/RLS e escrita protegida OK.');
}finally{await db.close();}
