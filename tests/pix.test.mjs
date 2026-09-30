import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import QRCode from 'qrcode';
import { crc16,fields,validatePixTemplate,pixForAmount } from '../src/pix-code.js';
// Public fictitious example from BCB Manual 2.10, section 2.6.3; NEVER a real destination.
export const example='00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
assert.equal(crc16('123456789'),'29B1');
assert.equal(validatePixTemplate(example).receiver,'Fulano de Tal');
const valued=pixForAmount(example,3749);
assert.equal(fields(valued).get('54'),'37.49');
assert.equal(fields(valued).get('26'),fields(example).get('26'));
assert.equal(crc16(valued.slice(0,-4)),valued.slice(-4));
assert.equal(fields(pixForAmount(example,1)).get('54'),'0.01');
for(const value of [0,-1,1.5,NaN,100000001])assert.throws(()=>pixForAmount(example,value));
const resign=text=>text.slice(0,-4)+crc16(text.slice(0,-4));
const invalid=[example.slice(0,-1)+'0',example.slice(0,-9),valued,
 resign(example.replace('000201','000201010212')),
 resign(example.replace('0136123e4567','2536123e4567')),
 resign(example.replace('5802BR','5802US')),
 resign(example.replace('62070503***','62070503!!!')),
 resign(example.replace('62070503***','62070503***8001x')),
 resign(example.replace('52040000','5204000055042.00'))];
for(const code of invalid)assert.throws(()=>validatePixTemplate(code));
assert.match(await QRCode.toDataURL(valued),/^data:image\/png;base64,/);
const db=new PGlite({extensions:{pgcrypto}});
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;
 create schema auth;create table auth.users(id uuid primary key,email text,phone text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const name of (await readdir(dir)).filter(name=>/00[1-9]_.*\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const master=randomUUID(),operator=randomUUID(),customer=randomUUID();
 await db.query('insert into auth.users(id) values($1),($2),($3)',[master,operator,customer]);
 await db.query("insert into trameli_operators(user_id,role) values($1,'master'),($2,'operator')",[master,operator]);
 const user=async id=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
 const save=(payload,enabled,version)=>db.query('select trameli_save_pix_settings($1,$2,$3,$4)',[payload,'Titular de teste',enabled,version]);
 await user(customer);
 assert.equal((await db.query('select * from trameli_pix_settings')).rows.length,0);
 await assert.rejects(save(example,true,0),/Master/);
 await user(operator);await assert.rejects(save(example,true,0),/Master/);
 await user(master);
 for(const payload of invalid)await assert.rejects(save(payload,true,0));
 await save(example,true,0);
 await assert.rejects(save(example,true,0),/outra sessão/);
 assert.equal((await db.query('select * from trameli_pix_settings_events')).rows.length,1);
 await user(customer);
 assert.equal((await db.query('select payload from trameli_pix_settings')).rows[0].payload,example);
 assert.equal((await db.query('select * from trameli_pix_settings_events')).rows.length,0);
 await assert.rejects(db.query('update trameli_pix_settings set enabled=false'),/permission denied/);
 await assert.rejects(db.query('select trameli_validate_pix($1)',[example]),/permission denied/);
 await user(master);await save('',false,1);
 assert.equal((await db.query('select count(*)::int n from trameli_payments')).rows[0].n,0,'Configuring QR must not record money');
 await user(customer);assert.equal((await db.query('select * from trameli_pix_settings')).rows.length,0);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from trameli_pix_settings'),/permission denied/);
 console.log('Pix: exemplo BCB/CRC, valor exato, chave preservada, rejeição de códigos incompatíveis, RLS Master, histórico e nenhum lançamento financeiro OK.');
}finally{await db.close();}
