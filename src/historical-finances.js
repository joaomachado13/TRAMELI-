import './historical-finances.css';
// Historico financeiro avulso. Nao cria pedido, produto ou tarefa de separacao.
const TABLE = 'trameli_historical_finances';
const money = n => (Number(n || 0) / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = v => String(v ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toLowerCase();
const fmt = d => d ? new Date(d+'T12:00:00').toLocaleDateString('pt-BR') : '—';
const isoToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function dateValue(v) {
  if (typeof v === 'number' || /^\d{5}(?:\.\d+)?$/.test(String(v ?? ''))) {
    return new Date(Date.UTC(1899,11,30) + Math.floor(Number(v))*86400000).toISOString().slice(0,10);
  }
  const s=String(v??'').trim(), br=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(br)return br[3]+'-'+br[2].padStart(2,'0')+'-'+br[1].padStart(2,'0');
  return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):'';
}
function validDate(s) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const d=new Date(s+'T12:00:00Z');
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10)===s;
}
function toCents(v) {
  if(typeof v==='number')return Math.round(v*100);
  const s=String(v??'').replace(/[R$\s]/g,'');
  const normalized = s.includes(',') ? s.replace(/\./g,'').replace(',','.') : s;
  return /^\d+(?:\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized)*100) : NaN;
}
function parseCSV(text) {
  const first=(text.split(/\r?\n/)[0]||'');
  const separator=first.includes(';')?';':first.includes('\t')?'\t':',';
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted && text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
    }else if(ch===separator && !quoted){row.push(field);field='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if(row.length || field){row.push(field);rows.push(row);}
  return rows;
}
async function parseXlsx(file) {
  const bin=new Uint8Array(await file.arrayBuffer()), view=new DataView(bin.buffer);
  const u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true);
  let eocd=-1;
  for(let i=bin.length-22;i>=Math.max(0,bin.length-65558);i--)if(u32(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw new Error('Arquivo Excel inválido. Envie .xlsx ou .csv.');
  const total=u16(eocd+10), offset=u32(eocd+16), paths=new Map();
  let ptr=offset;
  for(let i=0;i<total;i++){
    if(u32(ptr)!==0x02014b50)throw new Error('Estrutura XLSX inesperada.');
    const size=u32(ptr+20),method=u16(ptr+10),nameLen=u16(ptr+28),extra=u16(ptr+30),comment=u16(ptr+32),local=u32(ptr+42);
    const path=new TextDecoder().decode(bin.subarray(ptr+46,ptr+46+nameLen));
    paths.set(path,{local,size,method});
    ptr+=46+nameLen+extra+comment;
  }
  async function xml(path) {
    const item=paths.get(path);if(!item)return null;
    const begin=item.local+30+u16(item.local+26)+u16(item.local+28);
    const data=bin.subarray(begin,begin+item.size);
    let bytes=data;
    if(item.method===8) {
      if(!globalThis.DecompressionStream)throw new Error('Seu navegador não consegue ler XLSX. Exporte a planilha como CSV.');
      try { bytes=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
      catch { throw new Error('Não foi possível abrir o XLSX neste navegador. Salve a planilha em CSV.'); }
    } else if(item.method!==0)throw new Error('Compactação Excel incompatível. Use CSV.');
    return new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml');
  }
  const ss=await xml('xl/sharedStrings.xml');
  const shared=ss?[...ss.getElementsByTagName('si')].map(n=>[...n.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
  const sheet=await xml('xl/worksheets/sheet1.xml');
  if(!sheet)throw new Error('Não encontrei a primeira aba da planilha.');
  const result=[];
  for(const r of sheet.getElementsByTagName('row')){
    const row=[],number=Number(r.getAttribute('r'))||result.length+1;
    for(const cell of r.getElementsByTagName('c')){
      const ref=cell.getAttribute('r')||'',letters=ref.match(/^[A-Z]+/)?.[0]||'A';
      let col=0;for(const c of letters)col=col*26+c.charCodeAt(0)-64;col--;
      const v=cell.getElementsByTagName('v')[0]?.textContent??'';
      const type=cell.getAttribute('t');
      row[col]=type==='s'?shared[Number(v)]??'':type==='inlineStr'?[...cell.getElementsByTagName('t')].map(x=>x.textContent).join(''):type==='n'||!type?Number(v):v;
      if(!Number.isFinite(row[col]))row[col]=v;
    }
    result.push({number,values:row});
  }
  return result;
}
function extractedRows(data) {
  const rows=data.map((r,i)=>Array.isArray(r)?{number:i+1,values:r}:r);
  const header=rows.find(r=>r.values.some(v=>norm(v)==='nome')&&r.values.some(v=>norm(v)==='data')&&r.values.some(v=>norm(v)==='valor'));
  if(!header)throw new Error('Cabeçalho não encontrado. Use NOME, DATA, VALOR e, opcionalmente, PAGO.');
  const cols=header.values.map(norm);
  const nameCol=cols.indexOf('nome'),dateCol=cols.indexOf('data'),valueCol=cols.indexOf('valor'),statusCol=cols.findIndex(x=>x==='pago'||x==='status'||x==='situacao');
  const used=new Map(),out=[];
  for(const row of rows.filter(r=>r.number>header.number)){
    const v=row.values,name=String(v[nameCol]??'').trim();
    if(!name && (v[dateCol]==null || v[dateCol]==='') && (v[valueCol]==null || v[valueCol]===''))continue;
    const date=dateValue(v[dateCol]),amount=toCents(v[valueCol]);
    const statusCells=statusCol>=0?[v[statusCol]]:[v[3],v[4]];
    const paid=statusCells.some(x=>['pago','paga','paid','sim','quitado'].includes(norm(x)));
    const key=[norm(name),date,amount].join('|'),nth=(used.get(key)||0)+1;
    used.set(key,nth);
    out.push({number:row.number,name,date,amount,paid,sourceKey:'hist:v1:'+key+':'+nth,customerId:'',state:!name||!validDate(date)||!Number.isInteger(amount)||amount<1||amount>100000000?'invalid':'unmatched',override:false});
  }
  if(!out.length)throw new Error('A planilha não possui lançamentos preenchidos.');
  if(out.length>2000)throw new Error('Importe no máximo 2.000 linhas por arquivo.');
  return out;
}
export function initHistoricalFinances(live) {
  if(!live?.client||!live?.user)return;
  const state={entries:[],profiles:[],draft:[],fileName:'',batchId:'',message:'',error:'',busy:false,loaded:false,loading:null};
  const allowed=!!live.operator;
  const list=()=>state.entries.filter(e=>!e.removed_at);
  const period=(a,b,customer=null)=>list().filter(e=>(!a||e.entry_date>=a)&&(!b||e.entry_date<=b)&&(!customer||e.customer_id===customer));
  const sums=entries=>entries.reduce((t,e)=>{t.total+=Number(e.amount_cents);if(e.status==='paid')t.paid+=Number(e.amount_cents);else t.due+=Number(e.amount_cents);return t;},{total:0,paid:0,due:0});
  const profileName=id=>state.profiles.find(p=>p.user_id===id)?.name||'Cliente';
  const statusLabel=e=>e.status==='paid'?'Pago':'Pendente';
  async function refresh() {
    if(state.loading)return state.loading;
    state.loading=(async()=>{
      try {
        const {data,error}=await live.client.from(TABLE).select('id,customer_id,entry_date,amount_cents,status,origin,original_name,batch_id,source_key,note,paid_at,created_at,removed_at').order('entry_date',{ascending:false}).limit(5000);
        if(error)throw error;
        state.entries=data||[];state.loaded=true;state.error='';
        if(allowed){
          const profiles=await live.client.from('trameli_profiles').select('user_id,name').order('name').limit(2000);
          if(profiles.error)throw profiles.error;
          state.profiles=profiles.data||[];
        }
      }catch(e){state.error=e.code==='42P01'||e.code==='PGRST205'?'É necessário ativar a migração do histórico financeiro.':(e.message||'Falha ao consultar lançamentos históricos.');}
      state.loading=null;
      repaint();
      window.dispatchEvent(new Event('trameli:historical-finances-changed'));
    })();
    return state.loading;
  }
  function customerMarkup() {
    const rows=period(null,null,live.user.id);
    const t=sums(rows);
    return '<section class="payment-panel history-client" data-history-customer><h3>Histórico financeiro anterior ao aplicativo</h3><p>Valores registrados pela Shirley sem detalhamento de produtos. Entram no fechamento da sua quinzena ou mês, mas não são novos pedidos.</p>'+
      (state.error?'<p role="status">'+esc(state.error)+'</p>':'')+
      '<div class="history-totals"><span>Total <strong>'+money(t.total)+'</strong></span><span>Pago <strong>'+money(t.paid)+'</strong></span><span>Em aberto <strong>'+money(t.due)+'</strong></span></div>'+
      (rows.length?'<div class="history-items">'+rows.map(e=>'<div class="history-item"><span>'+fmt(e.entry_date)+' · Histórico financeiro</span><strong>'+money(e.amount_cents)+'</strong><small>'+statusLabel(e)+'</small></div>').join('')+'</div>':'<p>Nenhum lançamento histórico para esta conta.</p>')+
      (t.due?'<p class="history-note">Os valores históricos pendentes devem ser acertados com a Shirley; o Pix automático dos pedidos não inclui esses lançamentos.</p>':'')+'</section>';
  }
  function operationMarkup(day) {
    const rows=period(day,day),t=sums(rows);
    return '<div class="history-operation-head"><div><span class="screen-eyebrow">CONTROLE FINANCEIRO DO DIA</span><h2>Histórico financeiro · '+fmt(day)+'</h2><p>Registros sem produtos, separados das tarefas de produção.</p></div><a href="#financeiro">Gerenciar no Financeiro</a></div>'+
      '<div class="history-totals"><span>Lançado <strong>'+money(t.total)+'</strong></span><span>Pago <strong>'+money(t.paid)+'</strong></span><span>Em aberto <strong>'+money(t.due)+'</strong></span></div>'+
      (rows.length?'<div class="history-items">'+rows.map(e=>'<div class="history-item"><strong>'+esc(profileName(e.customer_id))+'</strong><span>'+money(e.amount_cents)+'</span><small>'+statusLabel(e)+'</small></div>').join('')+'</div>':'<p>Sem histórico financeiro nesta data.</p>');
  }
  function options(selected='') {
    return '<option value="">Selecione o cliente</option>'+state.profiles.map(p=>'<option value="'+esc(p.user_id)+'" '+(p.user_id===selected?'selected':'')+'>'+esc(p.name)+'</option>').join('');
  }
  function previewRows() {
    if(!state.draft.length)return '';
    const counts=state.draft.reduce((t,r)=>(t[r.state]=(t[r.state]||0)+1,t),{});
    const active=state.draft.filter(r=>r.state==='ready').length;
    return '<div class="history-preview"><h3>Conferência antes de importar · '+esc(state.fileName)+'</h3><p>'+state.draft.length+' linhas · '+money(state.draft.reduce((s,r)=>s+(Number.isInteger(r.amount)?r.amount:0),0))+
      ' · '+(counts.ready||0)+' prontas · '+(counts.unmatched||0)+' não identificadas · '+(counts.duplicate||0)+' possíveis duplicadas · '+(counts.invalid||0)+' inválidas</p>'+
      '<div class="history-preview-table"><table><thead><tr><th>Linha</th><th>Nome no arquivo</th><th>Data</th><th>Valor</th><th>Cliente vinculado</th><th>Conferência</th></tr></thead><tbody>'+
      state.draft.map((r,i)=>'<tr><td>'+r.number+'</td><td>'+esc(r.name)+'</td><td>'+esc(fmt(r.date))+'</td><td>'+money(r.amount)+'</td><td>'+
      (r.state==='invalid'?'—':'<select data-history-match="'+i+'">'+options(r.customerId)+'</select>')+
      '</td><td>'+({ready:'Pronto',unmatched:'Vincular cliente',duplicate:'Possível duplicado',invalid:'Dados inválidos',inserted:'Importado',skipped:'Já existia',failed:'Falhou'}[r.state]||r.state)+
      (r.state==='duplicate'?'<label><input type="checkbox" data-history-override="'+i+'" '+(r.override?'checked':'')+'> Importar mesmo assim</label>':'')+
      '</td></tr>').join('')+'</tbody></table></div><button type="button" data-history-import '+(!active||state.busy?'disabled':'')+'>Importar '+active+' lançamento(s) conferido(s)</button>'+
      '<button type="button" data-history-clear>Limpar prévia</button><p>Os não identificados, inválidos e duplicados não entram automaticamente. Reimportações são detectadas.</p></div>';
  }
  function operatorMarkup() {
    if(!allowed)return '';
    const rows=list().slice(0,300),t=sums(list());
    const names=state.profiles.length;
    return '<section class="screen-panel history-operator" data-history-operator><div class="screen-panel__heading"><div><span class="screen-eyebrow">LANÇAMENTOS AVULSOS</span><h2>Histórico financeiro</h2><p>Visível para a Shirley, na operação diária e para o próprio cliente. Não cria pedido, etiqueta nem separação.</p></div></div>'+
      (state.error?'<p role="alert">'+esc(state.error)+'</p>':'')+
      (state.message?'<p class="history-message" role="status">'+esc(state.message)+'</p>':'')+
      '<div class="history-totals"><span>Total <strong>'+money(t.total)+'</strong></span><span>Pago <strong>'+money(t.paid)+'</strong></span><span>Pendente <strong>'+money(t.due)+'</strong></span></div>'+
      '<div class="history-actions"><label>Importar Excel ou CSV <input type="file" accept=".xlsx,.csv" data-history-file></label><p>Confirme os nomes antes de gravar. O Excel pode trazer várias datas no mesmo arquivo.</p></div>'+previewRows()+
      '<details class="history-manual"><summary>+ Novo lançamento financeiro manual</summary><form data-history-manual><label>Cliente<select name="customer" required>'+options()+'</select></label><label>Data<input type="date" name="date" value="'+isoToday()+'" required></label><label>Valor (R$)<input type="text" name="amount" inputmode="decimal" placeholder="12,50" required></label><label>Situação<select name="status"><option value="pending">Pendente</option><option value="paid">Pago</option></select></label><label>Observação (opcional)<input name="note" maxlength="280"></label><button type="submit">Salvar lançamento</button></form></details>'+
      '<h3>Lançamentos cadastrados · '+list().length+'</h3><p>Use “Pago / Pendente” para corrigir a situação. “Anular” remove o registro dos totais, preservando auditoria.</p>'+
      (rows.length?'<div class="history-preview-table"><table><thead><tr><th>Data</th><th>Cliente</th><th>Valor</th><th>Situação</th><th>Origem</th><th>Ação</th></tr></thead><tbody>'+rows.map(e=>'<tr><td>'+fmt(e.entry_date)+'</td><td>'+esc(profileName(e.customer_id))+'</td><td>'+money(e.amount_cents)+'</td><td><button type="button" data-history-status="'+esc(e.id)+'">'+statusLabel(e)+' · alterar</button></td><td>'+esc(e.origin==='excel'?'Excel':'Manual')+'</td><td><button type="button" data-history-void="'+esc(e.id)+'">Anular</button></td></tr>').join('')+'</tbody></table></div>':'<p>Nenhum lançamento salvo ainda.</p>')+
      (names?'':'<p>Carregando clientes…</p>')+'</section>';
  }
  function repaint() {
    document.querySelectorAll('[data-history-customer]').forEach(el=>el.outerHTML=customerMarkup());
    document.querySelectorAll('[data-history-operator]').forEach(el=>el.outerHTML=operatorMarkup());
    const day=document.getElementById('delivery-date')?.value||isoToday();
    document.querySelectorAll('[data-history-operation]').forEach(el=>el.innerHTML=operationMarkup(day));
  }
  function mountOperation() {
    if(!allowed)return;
    const summary=document.querySelector('#operation-view .summary');
    if(!summary)return;
    let el=document.querySelector('[data-history-operation]');
    if(!el){el=document.createElement('section');el.className='history-operation';el.dataset.historyOperation='';summary.insertAdjacentElement('afterend',el);}
    el.innerHTML=operationMarkup(document.getElementById('delivery-date')?.value||isoToday());
  }
  function recalcDraft() {
    const existing=new Set(list().map(e=>e.customer_id+'|'+e.entry_date+'|'+e.amount_cents));
    const imported=new Set(list().map(e=>e.source_key).filter(Boolean));
    for(const r of state.draft) {
      if(r.state==='invalid'||r.state==='inserted'||r.state==='skipped')continue;
      if(!r.customerId){r.state='unmatched';continue;}
      const duplicate=imported.has(r.sourceKey)||existing.has(r.customerId+'|'+r.date+'|'+r.amount);
      r.state=duplicate&&!r.override?'duplicate':'ready';
    }
  }
  async function fileSelected(file) {
    state.message='';state.fileName=file.name;state.batchId=crypto.randomUUID();
    if(file.size>6*1024*1024)throw new Error('O arquivo deve ter no máximo 6 MB.');
    let raw;
    if(/\.csv$/i.test(file.name))raw=parseCSV(await file.text());
    else if(/\.xlsx$/i.test(file.name))raw=await parseXlsx(file);
    else throw new Error('Selecione um arquivo .xlsx ou .csv.');
    state.draft=extractedRows(raw);
    if(!state.profiles.length)await refresh();
    const byName=new Map();
    for(const p of state.profiles){const name=norm(p.name),found=byName.get(name)||[];found.push(p.user_id);byName.set(name,found);}
    for(const r of state.draft)if(r.state!=='invalid'){
      const candidates=byName.get(norm(r.name))||[];
      if(candidates.length===1)r.customerId=candidates[0];
    }
    recalcDraft();repaint();
  }
  async function importChecked(button) {
    const ready=state.draft.filter(r=>r.state==='ready');
    if(!ready.length)return;
    if(!confirm('Importar '+ready.length+' histórico(s) financeiro(s)? Valores pendentes entrarão no fechamento dos clientes.'))return;
    button.disabled=true;state.busy=true;
    let ok=0,skipped=0,failed=0;
    for(let i=0;i<ready.length;i+=100){
      const batch=ready.slice(i,i+100),payload=batch.map(r=>({
        customer_id:r.customerId,entry_date:r.date,amount_cents:r.amount,status:r.paid?'paid':'pending',
        paid_at:r.paid?new Date().toISOString():null,origin:'excel',original_name:r.name,
        batch_id:state.batchId,source_key:r.sourceKey,note:'Importado de '+state.fileName.slice(0,150),
        created_by:live.user.id
      }));
      try {
        const {data,error}=await live.client.from(TABLE).upsert(payload,{onConflict:'source_key',ignoreDuplicates:true}).select('source_key');
        if(error)throw error;
        const inserted=new Set((data||[]).map(d=>d.source_key));
        for(const r of batch){r.state=inserted.has(r.sourceKey)?'inserted':'skipped';if(r.state==='inserted')ok++;else skipped++;}
      }catch(e){for(const r of batch){r.state='failed';failed++;}state.error=e.message||'Falha no lote.';}
    }
    state.message=ok+' importado(s), '+skipped+' já existente(s), '+failed+' com falha. Confira as linhas não resolvidas.';
    state.busy=false;await refresh();
  }
  async function updateEntry(id,values){
    const {error}=await live.client.from(TABLE).update({...values,updated_at:new Date().toISOString()}).eq('id',id).is('removed_at',null);
    if(error)throw error;
    state.message='Lançamento atualizado.';await refresh();
  }
  document.addEventListener('change',async e=>{
    if(e.target.id==='delivery-date')mountOperation();
    if(!allowed)return;
    if(e.target.matches('[data-history-file]')){
      const file=e.target.files?.[0];if(!file)return;
      try{await fileSelected(file);}catch(error){state.error=error.message;state.draft=[];repaint();}
      return;
    }
    if(e.target.matches('[data-history-match]')){
      const r=state.draft[Number(e.target.dataset.historyMatch)];if(!r)return;
      r.customerId=e.target.value;r.override=false;recalcDraft();repaint();
    }
    if(e.target.matches('[data-history-override]')){
      const r=state.draft[Number(e.target.dataset.historyOverride)];if(!r)return;
      r.override=e.target.checked;recalcDraft();repaint();
    }
  });
  document.addEventListener('click',async e=>{
    if(!allowed)return;
    const button=e.target.closest('button');if(!button||state.busy)return;
    if(button.matches('[data-history-clear]')){state.draft=[];state.message='Prévia limpa.';repaint();return;}
    if(button.matches('[data-history-import]')){await importChecked(button);return;}
    try {
      if(button.matches('[data-history-status]')){
        const item=list().find(x=>x.id===button.dataset.historyStatus);if(!item)return;
        await updateEntry(item.id,{status:item.status==='paid'?'pending':'paid',paid_at:item.status==='paid'?null:new Date().toISOString()});
      }
      if(button.matches('[data-history-void]')){
        const item=list().find(x=>x.id===button.dataset.historyVoid);if(!item)return;
        if(!confirm('Anular o lançamento de '+money(item.amount_cents)+' de '+profileName(item.customer_id)+'?'))return;
        await updateEntry(item.id,{removed_at:new Date().toISOString()});
      }
    }catch(error){state.error=error.message;repaint();}
  });
  document.addEventListener('submit',async e=>{
    const form=e.target.closest('[data-history-manual]');if(!form||!allowed)return;
    e.preventDefault();if(state.busy)return;
    const fd=new FormData(form),amt=toCents(fd.get('amount')),date=dateValue(fd.get('date')),customer=String(fd.get('customer')||'');
    if(!state.profiles.some(p=>p.user_id===customer)||!validDate(date)||!Number.isInteger(amt)||amt<1||amt>100000000){state.error='Confira cliente, data e valor.';repaint();return;}
    state.busy=true;
    const paid=fd.get('status')==='paid';
    const payload={customer_id:customer,entry_date:date,amount_cents:amt,status:paid?'paid':'pending',paid_at:paid?new Date().toISOString():null,origin:'manual',original_name:profileName(customer),note:String(fd.get('note')||''),created_by:live.user.id};
    const {error}=await live.client.from(TABLE).insert(payload);
    state.busy=false;
    if(error){state.error=error.message;repaint();return;}
    state.message='Lançamento manual registrado.';await refresh();
  });
  window.addEventListener('trameli:route-rendered',mountOperation);
  window.addEventListener('trameli:payments-refresh',refresh);
  window.TrameliFinancialHistory={refresh,customerMarkup,operatorMarkup,operationMarkup,period,sums,entries:list};
  mountOperation();
  refresh();
}
