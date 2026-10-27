import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/historical-finances.js', import.meta.url), 'utf8')
  .replace("import './historical-finances.css';", '')
  .replace('export function initHistoricalFinances', 'function initHistoricalFinances');
const context = {};
runInNewContext(source + '\nglobalThis.helpers={extractedRows,dateValue,toCents,validDate,parseCSV,norm,decodeXlsxCell,updateHistorySection};', context);
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

test('historico pendente aparece imediatamente e oferece Pix antecipado separado', () => {
  const customer=readFileSync(new URL('../src/historical-finances.js',import.meta.url),'utf8');
  const pix=readFileSync(new URL('../src/manual-pix.js',import.meta.url),'utf8');
  const payments=readFileSync(new URL('../src/payments.js',import.meta.url),'utf8');
  assert.match(customer,/data-history-pix/);
  assert.match(customer,/t\.due\?/);
  assert.match(customer,/mesmo antes do fechamento/);
  assert.match(pix,/async function payHistorical\(/);
  assert.match(pix,/pixForAmount\(config\.payload,amount\)/);
  assert.match(pix,/data-history-pix/);
  assert.match(pix,/Já paguei · Avisar pelo WhatsApp/);
  assert.match(pix,/shownOrderIds=\[\];shownAmount=amount;shownOrderText='Histórico financeiro';intentRequestId=null/);
  assert.match(payments,/combinedDue=t\.due_cents\+historyTotals\.due/);
});

test('XLSX da Shirley: textos compartilhados sao reconhecidos como cabecalhos e nomes, sem virar numeros', () => {
  // O arquivo real usa t="s" + sharedStrings.xml. Os indices sao 0,1,2...
  const shared=['NOME','DATA','VALOR','FLÁVIA NEWELL ','Fixo','pago','LAYLA'];
  const header=[0,1,2].map(v=>h.decodeXlsxCell('s',String(v),shared));
  const first=[h.decodeXlsxCell('s','3',shared),h.decodeXlsxCell(null,'46311',shared),h.decodeXlsxCell(null,'18',shared),h.decodeXlsxCell('s','4',shared),h.decodeXlsxCell(null,'',shared)];
  const second=[h.decodeXlsxCell('s','6',shared),h.decodeXlsxCell(null,'46312',shared),h.decodeXlsxCell(null,'7.6',shared),undefined,h.decodeXlsxCell('s','5',shared)];
  assert.deepEqual(Array.from(header),['NOME','DATA','VALOR']);
  const result=h.extractedRows([header,first,second]);
  assert.equal(result.length,2);
  assert.equal(result[0].name,'FLÁVIA NEWELL');
  assert.equal(result[0].date,'2026-10-16');
  assert.equal(result[0].amount,1800);
  assert.equal(result[0].paid,false);
  assert.equal(result[1].date,'2026-10-17');
  assert.equal(result[1].amount,760);
  assert.equal(result[1].paid,true);
});

test('renderizacao do historico nao usa outerHTML e conserva host, rolagem e formulario aberto', () => {
  const before={scrollTop:420}, after={scrollTop:0};
  const manual={open:false};
  const host={
    isConnected:true,stage:0,_html:'antes',
    get innerHTML(){return this._html;},
    set innerHTML(value){this._html=value;this.stage=1;},
    set outerHTML(_value){throw new Error('O elemento foi removido durante blur');},
    querySelector(selector){
      if(selector==='.history-manual')return this.stage===0?{open:true}:manual;
      return null;
    },
    querySelectorAll(selector){
      if(selector==='.history-preview-table')return this.stage===0?[before]:[after];
      return [];
    }
  };
  context.document={
    createElement(tag){
      assert.equal(tag,'template');
      return {
        content:{firstElementChild:null},
        set innerHTML(markup){
          const match=markup.match(/^<section[^>]*>([\s\S]*)<\/section>$/);
          this.content.firstElementChild=match?{innerHTML:match[1]}:null;
        }
      };
    }
  };
  h.updateHistorySection(host,'<section data-history-operator><p>Pronto para importar</p></section>');
  assert.equal(host.innerHTML,'<p>Pronto para importar</p>');
  assert.equal(host.isConnected,true);
  assert.equal(after.scrollTop,420);
  assert.equal(manual.open,true);

  const disconnected={
    isConnected:false,
    set innerHTML(_){throw new Error('Tentou alterar nodo desconectado');}
  };
  h.updateHistorySection(disconnected,'<section>outro</section>');
  const historySrc=readFileSync(new URL('../src/historical-finances.js',import.meta.url),'utf8');
  assert.doesNotMatch(historySrc,/el\.outerHTML\s*=/);
});
