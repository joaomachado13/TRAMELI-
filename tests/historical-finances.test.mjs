import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/historical-finances.js', import.meta.url), 'utf8')
  .replace("import './historical-finances.css';", '')
  .replace('export function initHistoricalFinances', 'function initHistoricalFinances');
const context = {};
runInNewContext(source + '\nglobalThis.helpers={extractedRows,dateValue,toCents,validDate,parseCSV,norm};', context);
const h=context.helpers;

test('planilha de 16/10 e 17/10 com campo fixo e pago isolados', () => {
  const entries=h.extractedRows([
    ['NOME','DATA','VALOR',null,null],
    ['ANA',46311,18,'Fixo',null],
    ['LAYLA',46311,7.6,'Fixo','pago'],
    ['ANA',46312,18,null,null],
    ['ANA',46312,18,null,null]
  ]);
  assert.equal(entries.length,4);
  assert.equal(entries[0].date,'2026-10-16');
  assert.equal(entries[2].date,'2026-10-17');
  assert.equal(entries[0].amount,1800);
  assert.equal(entries[1].amount,760);
  assert.equal(entries[0].paid,false);
  assert.equal(entries[1].paid,true);
  assert.notEqual(entries[2].sourceKey,entries[3].sourceKey);
  assert.equal(entries.reduce((sum,e)=>sum+e.amount,0),6160);
});
test('csv aceita valor brasileiro, acentos e aspas', () => {
  const csv=h.parseCSV('NOME;DATA;VALOR;STATUS\n"JOÃO; LIMA";17/10/2026;12,50;pago');
  const entries=h.extractedRows(csv);
  assert.equal(entries[0].name,'JOÃO; LIMA');
  assert.equal(entries[0].date,'2026-10-17');
  assert.equal(entries[0].amount,1250);
  assert.equal(entries[0].paid,true);
  assert.equal(h.norm(' Flávia  Newell '),'flavia newell');
});
test('valores ou datas invalidos exigem revisao', () => {
  const entries=h.extractedRows([
    ['NOME','DATA','VALOR'],
    ['FLÁVIA','31/02/2026','12,00'],
    ['JORGE','16/10/2026','-7,00']
  ]);
  assert.equal(entries[0].state,'invalid');
  assert.equal(entries[1].state,'invalid');
});
test('sem coluna obrigatoria nao pode importar', () => {
  assert.throws(()=>h.extractedRows([['NOME','ENDEREÇO','VALOR'],['A','Rua',12]]));
});
test('historico nao afeta producao e rls protege visualizacao', () => {
  const migration=readFileSync(new URL('../supabase/migrations/202610270001_historical_finances.sql',import.meta.url),'utf8');
  const grace=readFileSync(new URL('../supabase/migrations/202610270002_historical_closing.sql',import.meta.url),'utf8');
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/customer_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(migration,/trameli_is_operator\(\)/);
  assert.match(grace,/open_history as \(/);
  assert.match(grace,/historical_due_cents/);
});
