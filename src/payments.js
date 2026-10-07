import { PaymentsApi } from './payments-api.js';
import { escapeHtml as esc } from './auth-utils.js';
import { billingReminder } from './billing-cycle.js';
import './payments.css';

const money = cents => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(Number(cents || 0)/100);
const labels = { open:'Em aberto', partial:'Parcialmente pago', paid:'Pago', refunded:'Estornado', refund_due:'Devolução pendente', cancelled:'Cancelado' };
const orderLabels = { received:'A conferir', confirmed:'Conferido', packing:'Em separação', ready:'Pronto', delivered:'Entregue', cancelled:'Cancelado' };
const methods = { pix_manual:'Pix conferido manualmente', cash:'Dinheiro', bank:'Transferência', other:'Acordado com a proprietária' };
const short = id => String(id).slice(0,8);
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR');
const timestamp = value => new Date(value).toLocaleString('pt-BR');
const cents = raw => {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(String(raw).trim())) throw new Error('Informe um valor válido, como 12,50.');
  const [whole,decimals=''] = String(raw).trim().replace(',','.').split('.');
  const value = Number(whole)*100+Number(decimals.padEnd(2,'0'));
  if (!Number.isSafeInteger(value) || value>100000000) throw new Error('Valor fora do limite.');
  return value;
};
const groupKey = row => row.customer_id || `manual:${row.order_id}`;
const metric = (label,value) => `<div><span>${label}</span><strong>${money(value)}</strong></div>`;
const totals = rows => rows.reduce((sum,row) => {
  for (const key of ['total_cents','paid_cents','due_cents','refund_due_cents']) sum[key] += Number(row[key]);
  return sum;
}, {total_cents:0,paid_cents:0,due_cents:0,refund_due_cents:0});

export function initPayments(live) {
  const api = live ? new PaymentsApi(live) : null;
  let selectedDay=today(), selectedGroup='', dayRevision=0;
  const dialog=document.createElement('dialog'); dialog.className='payment-dialog';
  dialog.setAttribute('aria-label','Recebimentos e conta do cliente'); document.body.append(dialog);
  const status=document.createElement('p'); status.className='payment-notice'; status.setAttribute('role','status'); status.hidden=true; document.body.append(status);
  function notify(message) { status.textContent=message; status.hidden=false; clearTimeout(notify.timer); notify.timer=setTimeout(()=>{status.hidden=true;},12000); }
  const warning = () => !api ? 'Pagamentos reais exigem conexão com o Supabase. Este modo local não registra recebimentos.'
    : api.error || (api.ready === null ? 'Carregando pagamentos…' : api.ready === false ? 'Ative a migração 007 para começar a registrar pagamentos.' : '');
  const groups = () => [...new Map((api?.balances || []).map(row=>[groupKey(row),row])).entries()];
  const groupLabel = row => `${row.customer_name}${row.customer_id ? ` · conta ${short(row.customer_id)}` : ` · pedido manual #${short(row.order_id)} (sem conta vinculada)`}`;
  const options = () => groups().map(([key,row])=>`<option value="${esc(key)}" ${key===selectedGroup?'selected':''}>${esc(groupLabel(row))}</option>`).join('');
  const methodOptions = Object.entries(methods).map(([key,name])=>`<option value="${key}">${name}</option>`).join('');
  const accountSummary = rows => {
    const t=totals(rows);
    return `<div class="payment-metrics">${metric('Compras (exclui cancelados)',t.total_cents)}${metric('Pago, descontadas devoluções',t.paid_cents)}${metric('Em aberto',t.due_cents)}${metric('A devolver',t.refund_due_cents)}</div>`;
  };
  const orderTable = (rows, editable=false, selectable=false) => `<div class="payment-table-wrap"><table class="payment-table"><thead><tr><th>Pedido / entrega</th><th>Valor</th><th>Pago</th><th>Em aberto</th><th>Financeiro</th>${editable?'<th>Quitar agora</th>':selectable?'<th>Selecionar</th>':''}</tr></thead><tbody>${rows.map(row=>`<tr><td>#${short(row.order_id)}<small>${dateLabel(row.delivery_date)} · ${esc(orderLabels[row.order_status] || row.order_status)}</small></td><td>${money(row.total_cents)}</td><td>${money(row.paid_cents)}</td><td>${money(row.due_cents)}</td><td>${labels[row.payment_status]}${!editable && window.TrameliPix && row.customer_id===live.user.id && Number(row.due_cents)>0 ? `<button type="button" data-pix-order="${esc(row.order_id)}">Pagar só este com Pix</button>` : ''}${Number(row.refund_due_cents)>0?`<small>A devolver ${money(row.refund_due_cents)}</small>`:''}</td>${editable?`<td>${Number(row.due_cents)>0?`<label class="payment-check"><input type="checkbox" data-allocation="${esc(row.order_id)}" data-due="${row.due_cents}"> ${money(row.due_cents)}</label>`:'—'}</td>`:selectable?`<td>${Number(row.due_cents)>0?`<input type="checkbox" data-pix-select="${esc(row.order_id)}" aria-label="Selecionar pedido ${short(row.order_id)} por ${money(row.due_cents)}">`:'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
  const statement = rows => {
    const ids=new Set(rows.map(row=>row.order_id));
    const entries=(api?.statement||[]).filter(entry=>ids.has(entry.order_id)).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
    return `<h3>Extrato de recebimentos e devoluções</h3>${entries.length?`<ul class="payment-log">${entries.map(entry=>`<li><span>${timestamp(entry.recorded_at)} · #${short(entry.order_id)}<small>${entry.kind==='refund'?'Devolução registrada':'Recebimento'} · ${methods[entry.method]}</small></span><strong>${entry.kind==='refund'?'−':''}${money(entry.amount_cents)}</strong></li>`).join('')}</ul>`:'<p>Nenhum pagamento registrado para estes pedidos.</p>'}`;
  };
  const customerStatement = rows => {
    const ids=new Set(rows.map(row=>row.order_id));
    const entries=(api?.statement||[]).filter(entry=>ids.has(entry.order_id)).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
    return `<details class="payment-customer-history"><summary>Ver histórico de pagamentos e devoluções</summary>${entries.length?`<ul class="payment-log">${entries.map(entry=>`<li><span>${timestamp(entry.recorded_at)} · #${short(entry.order_id)}<small>${entry.kind==='refund'?'Devolução registrada':'Pagamento confirmado'} · ${methods[entry.method]}</small></span><strong>${entry.kind==='refund'?'−':''}${money(entry.amount_cents)}</strong></li>`).join('')}</ul>`:'<p>Ainda não há pagamentos confirmados para estes pedidos.</p>'}</details>`;
  };
  const customerStatusClass = status => ['paid','refunded'].includes(status) ? 'is-done' : status==='partial' ? 'is-partial' : status==='refund_due' ? 'is-refund' : 'is-open';
  const customerOrders = (rows, allowSelection=true, allowRowPay=true) => `<div class="payment-customer-orders">${rows.map(row=>{
    const due=Number(row.due_cents), paid=Number(row.paid_cents), refundable=Number(row.refund_due_cents);
    return `<article class="payment-order-card ${due>0?'has-balance':'is-settled'}">
      <div class="payment-order-card__select">${due>0&&allowSelection?`<input type="checkbox" data-pix-select="${esc(row.order_id)}" data-due="${due}" aria-label="Selecionar pedido ${short(row.order_id)} por ${money(due)}">`:due>0?'<span class="payment-order-card__dot" aria-hidden="true"></span>':'<span aria-hidden="true">✓</span>'}</div>
      <div class="payment-order-card__main">
        <div class="payment-order-card__heading"><div><strong>Pedido #${short(row.order_id)}</strong><small>Entrega ${dateLabel(row.delivery_date)} · ${esc(orderLabels[row.order_status] || row.order_status)}</small></div><span class="payment-status ${customerStatusClass(row.payment_status)}">${esc(labels[row.payment_status] || row.payment_status)}</span></div>
        <div class="payment-order-card__values"><div><span>Total</span><strong>${money(row.total_cents)}</strong></div><div><span>Já confirmado</span><strong>${money(paid)}</strong></div><div class="payment-order-card__due"><span>${due>0?'Falta pagar':'Saldo'}</span><strong>${due>0?money(due):'Quitado'}</strong></div></div>
        ${refundable>0?`<p class="payment-refund-note">Há ${money(refundable)} para devolver neste pedido.</p>`:''}
      </div>
      <div class="payment-order-card__action">${window.TrameliPix && due>0 && allowRowPay?`<button type="button" class="payment-order-pix" data-pix-order="${esc(row.order_id)}">Pagar só este pedido</button>`:''}</div>
    </article>`;
  }).join('')}</div>`;
  function updateCustomerSelection() {
    document.querySelectorAll('[data-payment-selection]').forEach(host=>{
      const checked=[...document.querySelectorAll('[data-payment-content="customer"] [data-pix-select]:checked')];
      const amount=checked.reduce((sum,input)=>sum+Number(input.dataset.due||0),0);
      const count=checked.length;
      const summary=host.querySelector('[data-payment-selection-summary]');
      const button=host.querySelector('[data-pix-order="selected"]');
      if(summary) summary.textContent=count ? `${count} ${count===1?'pedido selecionado':'pedidos selecionados'} · ${money(amount)}` : 'Nenhum pedido selecionado';
      if(button) {
        button.disabled=!count;
        button.textContent=count ? `Pagar selecionados · ${money(amount)}` : 'Pagar selecionados';
      }
      host.classList.toggle('has-selection',Boolean(count));
    });
  }
  function customerRender() {
    return `<section class="payment-panel payment-customer"><span class="payment-customer__eyebrow">PAGAMENTOS</span><h2>Meus pagamentos</h2><p class="payment-customer__intro">Veja o que já foi confirmado e o que ainda falta pagar. O pagamento só aparece como concluído depois que a operação confere o recebimento.</p><div data-payment-content="customer">${warning()?`<p role="status">${esc(warning())}</p>`:customerContent()}</div></section>`;
  }
  function customerContent() {
    // An operator opening the storefront must not see other customers in "Minha conta".
    const rows=api.balances.filter(row=>row.customer_id===live.user.id);
    if(!rows.length) return '<div class="payment-customer-empty"><strong>Nenhum pagamento pendente.</strong><p>Quando você tiver pedidos vinculados à sua conta, o resumo aparecerá aqui.</p></div>';
    const t=totals(rows), openRows=rows.filter(row=>Number(row.due_cents)>0);
    const pixReady=window.TrameliPix && openRows.length>0;
    const reminder=billingReminder(rows,today());
    const reminderDate=reminder.deadline?dateLabel(reminder.deadline):'';
    const reminderClass=reminder.state==='overdue'?'is-overdue':reminder.state==='today'?'is-today':'is-upcoming';
    const reminderMessage=reminder.state==='clear'?''
      : reminder.days!==null && reminder.days>7
        ? `Próximo fechamento em ${reminderDate}.`
        : reminder.message;
    const reminderMarkup=reminder.state==='clear'?'':`<aside class="payment-deadline ${reminderClass}" role="status"><div><span>FECHAMENTO QUINZENAL</span><strong>${esc(reminderMessage)}</strong><small>${money(reminder.dueCents)} previstos para este fechamento · vencimento ${reminderDate}</small></div>${reminder.days!==null&&reminder.days<=7?'<span class="payment-deadline__pulse" aria-hidden="true">!</span>':''}</aside>`;
    return `${reminderMarkup}<div class="payment-customer-hero ${t.due_cents>0?'has-due':'is-clear'}">
      <div class="payment-customer-hero__balance"><span>${t.due_cents>0?'Saldo em aberto':'Tudo certo por aqui'}</span><strong>${t.due_cents>0?money(t.due_cents):'R$ 0,00'}</strong><p>${t.due_cents>0?`Você tem ${openRows.length} ${openRows.length===1?'pedido aguardando pagamento':'pedidos aguardando pagamento'}.`:'Todos os pagamentos destes pedidos já foram confirmados.'}</p></div>
      <div class="payment-customer-hero__details"><div><span>Total em pedidos</span><strong>${money(t.total_cents)}</strong></div><div><span>Já confirmado</span><strong>${money(t.paid_cents)}</strong></div>${t.refund_due_cents>0?`<div class="is-refund"><span>A devolver</span><strong>${money(t.refund_due_cents)}</strong></div>`:''}</div>
      ${pixReady?`<button type="button" class="payment-pay-all" data-pix-order="all">${openRows.length===1?'Pagar agora':'Pagar saldo total'} · ${money(t.due_cents)}</button>`:''}
    </div>
    ${pixReady?`<div class="payment-how"><div><span>1</span><p><strong>Escolha</strong><small>Pague tudo de uma vez ou selecione pedidos específicos.</small></p></div><div><span>2</span><p><strong>Faça o Pix</strong><small>Confira o valor e o titular no aplicativo do seu banco.</small></p></div><div><span>3</span><p><strong>Aguarde a conferência</strong><small>Depois do aviso, a operação confirma o recebimento.</small></p></div></div>`:''}
    <div class="payment-customer-list-head"><div><span>SEUS PEDIDOS</span><h3>${openRows.length?'Escolha o que deseja pagar':'Pedidos desta conta'}</h3><p>${openRows.length>1?'Marque mais de um pedido para gerar um único Pix com a soma dos saldos.':openRows.length===1?'Você pode pagar este pedido diretamente pelo botão abaixo.':'Consulte os valores já confirmados.'}</p></div></div>
    ${customerOrders(rows,openRows.length>1,openRows.length>1)}
    ${pixReady && openRows.length>1?`<div class="payment-selection-bar" data-payment-selection><div><span>Seleção</span><strong data-payment-selection-summary>Nenhum pedido selecionado</strong></div><button type="button" data-pix-order="selected" disabled>Pagar selecionados</button></div>`:''}
    ${customerStatement(rows)}`;
  }
  function operatorContent() {
    if (warning()) return `<p role="status">${esc(warning())}</p><button type="button" data-pay-refresh>Verificar novamente</button>`;
    const reversed=new Set(api.payments.map(p=>p.reverses_id).filter(Boolean));
    const allocated=new Set(api.allocations.map(a=>a.payment_id));
    const unknown=api.payments.filter(p=>p.kind==='receipt'&&!allocated.has(p.id)&&!reversed.has(p.id));
    const receipts=api.payments.filter(p=>p.kind==='receipt').sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
    const intents=(api.intents||[]).filter(item=>item.status==='pending');
    return `<div class="payment-client-first">
      <div><span class="screen-eyebrow">FLUXO PRINCIPAL</span><h3>Conferência por cliente</h3><p>Quando um cliente informa que pagou ou envia comprovante, a Trameli já sabe quem é. A conferência agora fica no perfil dele em <strong>Clientes</strong>.</p></div>
      <button class="screen-primary" type="button" data-payment-go-clients>Ir para Clientes${intents.length ? ` · ${intents.length} para conferir` : ''}</button>
    </div>
    <div class="payment-exception-summary">
      <article><span>Aguardando conferência</span><strong>${intents.length}</strong><small>identificados e organizados por cliente</small></article>
      <article><span>Sem cliente vinculado</span><strong>${unknown.length}</strong><small>somente lançamentos realmente sem identificação</small></article>
    </div>
    ${unknown.length ? `<details class="payment-worklist"><summary>Recebimentos sem cliente vinculado (${unknown.length})</summary><p>Use esta área apenas quando o dinheiro entrou fora do fluxo normal e ainda não sabemos de qual cliente é.</p><div class="payment-actions"><label>Vincular à conta<select data-payment-group><option value="">Selecione o cliente</option>${options()}</select></label></div><ul class="payment-log">${unknown.map(p=>`<li><span>${timestamp(p.recorded_at)} · ${money(p.amount_cents)}<small>${esc(p.reference || 'Sem referência')} · ${esc(p.note)}</small></span><button type="button" data-pay-identify="${p.id}">Vincular</button></li>`).join('')}</ul></details>` : ''}
    <details class="payment-worklist"><summary>Histórico financeiro</summary>${accountSummary(api.balances)}<h3>Recebimentos registrados (${receipts.length})</h3><ul class="payment-log">${receipts.map(p=>`<li><span>${timestamp(p.recorded_at)} · ${money(p.amount_cents)}<small>${methods[p.method]} · ${esc(p.reference || 'Sem referência')} · ${esc(p.note)}</small><small>${api.allocations.filter(a=>a.payment_id===p.id).map(a=>`#${short(a.order_id)}: ${money(a.amount_cents)}`).join(' · ') || 'Sem pedido vinculado'}</small></span>${reversed.has(p.id)?'<strong>Estornado</strong>':`<button type="button" data-pay-refund="${p.id}">Registrar devolução</button>`}</li>`).join('')}</ul></details>
    <div class="payment-manual-entry"><span>Recebeu um valor fora do portal e ainda não sabe de quem é?</span><button type="button" data-pay-unknown>Registrar valor sem cliente</button></div>`;
  }
  function render() {
    return `${window.TrameliPix?.render() || ''}<section class="screen-panel payment-panel"><div class="screen-panel__heading"><div><span class="screen-eyebrow">PENDÊNCIAS</span><h2>Recebimentos</h2></div></div><div data-payment-content="operator">${operatorContent()}</div></section>
      <section class="screen-panel payment-panel payment-closing"><div class="screen-panel__heading"><div><span class="screen-eyebrow">CONTROLE</span><h2>Fechamento diário</h2></div></div><div class="payment-actions"><label>Data<input type="date" data-closing-day value="${selectedDay}" max="${today()}"></label><button type="button" data-day-preview>Ver resumo</button><button type="button" data-day-close>Fechar dia</button></div><div data-day-summary aria-live="polite"></div><div data-day-history></div></section>`;
  }
  function refreshContent() {
    document.querySelectorAll('[data-payment-content]').forEach(host=>{host.innerHTML=warning()?`<p role="status">${esc(warning())}</p><button type="button" data-pay-refresh>Verificar novamente</button>`:host.dataset.paymentContent==='customer'?customerContent():operatorContent();});
    document.querySelectorAll('[data-day-close],[data-day-preview]').forEach(button=>button.disabled=!!warning());
    updateCustomerSelection();
  }
  async function refresh() { if(api) await api.load(); refreshContent(); }
  async function openReceipt(receiptId) {
    if(!api || !live?.operator){notify('Comprovante disponível somente para a operação.');return;}
    const receipt=api.receipts.find(item=>item.id===receiptId);
    if(!receipt){notify('Comprovante não encontrado.');return;}
    try {
      const {data,error}=await live.client.storage.from('trameli-payment-receipts').createSignedUrl(receipt.storage_path,300);
      if(error)throw error;
      window.open(data.signedUrl,'_blank','noopener,noreferrer');
    } catch(error) { notify(error.message||'Não foi possível abrir o comprovante.'); }
  }
  async function openForCustomer({customerId=null,customerName='',intentId=null}={}) {
    await refresh();
    if(warning()){notify(warning());return;}
    const row=api.balances.find(item=>customerId&&item.customer_id===customerId)
      || api.balances.find(item=>String(item.customer_name||'').trim().toLocaleLowerCase('pt-BR')===String(customerName||'').trim().toLocaleLowerCase('pt-BR'));
    if(!row){notify('Este cliente ainda não tem pedidos com saldo financeiro.');return;}
    selectedGroup=groupKey(row);
    await openAccount(null,intentId);
  }
  function open(body) { dialog.innerHTML=`<button type="button" data-payment-close class="payment-close" aria-label="Fechar">×</button>${body}`; dialog.showModal(); }
  const formFooter = label => `<p class="payment-error" role="alert"></p><button type="submit">${label}</button>`;
  async function openAccount(paymentId=null,intentId=null) {
    await refresh();
    if(warning()) {notify(warning());return;}
    const rows=api.balances.filter(row=>groupKey(row)===selectedGroup);
    if(!rows.length) {notify('Não encontrei pedidos financeiros para este cliente.');return;}
    const existing=paymentId?api.payments.find(p=>p.id===paymentId):null;
    const intent=intentId?(api.intents||[]).find(item=>item.id===intentId&&item.status==='pending'):null;
    const proof=intent?(api.receipts||[]).find(item=>item.intent_id===intent.id):null;
    const title=intent?'Conferir pagamento':existing?'Vincular recebimento':'Registrar pagamento';
    const intro=intent
      ? `O cliente informou um pagamento de <strong>${money(intent.amount_cents)}</strong>. Confira o comprovante ou o recebimento no banco e confirme abaixo.`
      : existing
        ? `Este valor entrou sem cliente vinculado. Selecione os pedidos corretos até totalizar ${money(existing.amount_cents)}.`
        : 'Selecione os pedidos quitados e confirme o recebimento.';
    open(`<div class="payment-dialog__heading"><div><span class="screen-eyebrow">CLIENTE</span><h2>${esc(rows[0].customer_name)}</h2><p>${intro}</p></div>${proof?`<button type="button" data-receipt-open="${proof.id}">Abrir comprovante</button>`:''}</div>
      ${accountSummary(rows)}
      <form data-payment-form="${existing?'identify':'receipt'}" data-payment-id="${existing?.id||''}" data-intent-id="${intent?.id||''}">
        <h3>${title}</h3>
        ${orderTable(rows,true)}
        <button type="button" data-fill-balances>Selecionar todo o saldo em aberto</button>
        <p class="payment-register-total">Total que será baixado: <strong data-allocation-total>R$ 0,00</strong></p>
        ${existing?'':`<label>Forma de recebimento<select name="method">${methodOptions}</select></label><label>Referência (opcional)<input name="reference" maxlength="120" value="${intent?'Pagamento informado pelo cliente':''}"></label><label>Observação interna (opcional)<textarea name="note" maxlength="280"></textarea></label>`}
        <label class="payment-check payment-confirm-check"><input type="checkbox" required> Conferi no banco/comprovante e este valor foi realmente recebido.</label>
        ${formFooter(existing?'Vincular e dar baixa':intent?'Confirmar e dar baixa':'Registrar e dar baixa')}
      </form>${statement(rows)}`);
    if(intent){
      const orderIds=new Set(intent.order_ids||[]);
      dialog.querySelectorAll('[data-allocation]').forEach(input=>{input.checked=orderIds.has(input.dataset.allocation);});
      dialog.dispatchEvent(new Event('change'));
    }
  }
  function snapshotHtml(s) {
    return `<p>${s.orders} pedidos · ${s.delivered} entregues · ${s.cancelled} cancelados · ${s.pending} pendentes</p><div class="payment-metrics">${metric('Produtos',s.products_cents)}${metric('Entregas (separadas)',s.delivery_cents)}${metric('Total dos pedidos',s.total_cents)}${metric('Recebido para estes pedidos',s.paid_for_orders_cents)}${metric('Em aberto nestes pedidos',s.due_cents)}${metric('A devolver',s.refund_due_cents)}${metric('Padaria — custo conhecido',s.supplier_cents)}<div><span>${s.estimated_cost_items?'Lucro provisório dos produtos':'Lucro bruto dos produtos'}</span><strong>${s.profit_cents==null?'Pendente':money(s.profit_cents)}</strong></div>${metric('Recebimentos registrados nesta data',s.received_on_day_cents)}${metric('Destes, Pix manual',s.pix_manual_on_day_cents)}${metric('Devoluções registradas nesta data',s.refunded_on_day_cents)}${metric('Recebimentos líquidos nesta data',s.net_received_on_day_cents)}</div><p>${s.missing_cost_items} itens sem custo; ${s.estimated_cost_items} com custo estimado. Recebimentos por data de registro podem pertencer a pedidos de outras datas. Todos os recebimentos desta versão são manuais.</p>`;
  }
  async function previewDay() {
    const rev=++dayRevision, day=selectedDay, host=document.querySelector('[data-day-summary]');
    if(!host)return;
    if(warning()){host.textContent=warning();return;}
    host.textContent='Carregando fechamento…';
    try {
      const result=await api.call('trameli_day_snapshot',{p_day:day});
      const {data,error}=await live.client.from('trameli_daily_closings').select('id,revision,closed_at,snapshot').eq('day',day).order('revision',{ascending:false});
      if(error)throw error;
      if(rev!==dayRevision || !host.isConnected)return;
      host.innerHTML=snapshotHtml(result);
      document.querySelector('[data-day-history]').innerHTML=`<h3>Fechamentos salvos</h3>${data.length?data.map(c=>`<details><summary>Revisão ${c.revision} · ${timestamp(c.closed_at)}</summary>${snapshotHtml(c.snapshot)}</details>`).join(''):'<p>Ainda não há fechamento salvo para esta data.</p>'}`;
    } catch(error){if(rev===dayRevision&&host.isConnected)host.textContent=`Não foi possível carregar: ${error.message}`;}
  }
  const requestArgs = (form,args) => {
    const payload=JSON.stringify(args);
    if(form.dataset.payload!==payload){form.dataset.payload=payload;form.dataset.requestId=crypto.randomUUID();}
    return {p_request_id:form.dataset.requestId,...args};
  };
  dialog.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-payment-form]'); if(!form)return; event.preventDefault();
    if(form.dataset.busy)return;
    const errorHost=form.querySelector('.payment-error'), button=form.querySelector('[type=submit]');
    errorHost.textContent='';
    try {
      if(!form.reportValidity())return;
      let name,args;
      if(form.dataset.paymentForm==='refund') {
        name='trameli_refund_payment';args=requestArgs(form,{p_payment_id:form.dataset.paymentId,p_reason:form.elements.reason.value.trim()});
      } else {
        const lines=[...form.querySelectorAll('[data-allocation]:checked')].map(input=>({order_id:input.dataset.allocation,amount_cents:Number(input.dataset.due)}));
        if(form.dataset.paymentForm==='identify') {name='trameli_identify_payment';args={p_payment_id:form.dataset.paymentId,p_lines:lines};}
        else {
          const amount=form.dataset.paymentForm==='unknown'?cents(form.elements.amount.value):lines.reduce((s,l)=>s+l.amount_cents,0);
          if(!amount)throw new Error('Informe um valor maior que zero.');
          name='trameli_record_payment';args=requestArgs(form,{p_amount_cents:amount,p_method:form.elements.method.value,p_reference:form.elements.reference.value.trim(),p_note:form.elements.note.value.trim(),p_lines:lines});
        }
      }
      form.dataset.busy='true';button.disabled=true;
      await api.call(name,args);
      if(form.dataset.intentId) {
        await api.call('trameli_resolve_payment_intent',{p_intent_id:form.dataset.intentId,p_status:'reviewed'});
      }
      dialog.close();notify(form.dataset.intentId?'Pagamento conferido e baixado.':'Registro salvo no banco.');
      await api.load(true);refreshContent();await previewDay();
    } catch(error){errorHost.textContent=error.message||'Não foi possível registrar. Verifique a conexão.';}
    finally{delete form.dataset.busy;button.disabled=false;}
  });
  dialog.addEventListener('change',()=>{
    const total=dialog.querySelector('[data-allocation-total]');if(!total)return;
    total.textContent=money([...dialog.querySelectorAll('[data-allocation]:checked')].reduce((sum,input)=>sum+Number(input.dataset.due),0));
  });
  document.addEventListener('change',event=>{
    if(event.target.matches('[data-payment-group]'))selectedGroup=event.target.value;
    if(event.target.matches('[data-closing-day]')){selectedDay=event.target.value;previewDay();}
    if(event.target.matches('[data-pix-select]'))updateCustomerSelection();
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.matches('[data-payment-close]')){if(!dialog.querySelector('[data-busy]'))dialog.close();return;}
    if(button.matches('[data-fill-balances]')){dialog.querySelectorAll('[data-allocation]').forEach(input=>input.checked=true);dialog.dispatchEvent(new Event('change'));return;}
    if(button.matches('[data-pay-refresh]')){await refresh();await previewDay();return;}
    if(button.matches('[data-payment-go-clients]')){location.hash='#clientes';return;}
    if(!button.matches('[data-pay-account],[data-pay-identify],[data-pay-unknown],[data-pay-refund],[data-day-preview],[data-day-close],[data-intent-open],[data-intent-dismiss],[data-receipt-open]'))return;
    if(warning()){notify(warning());return;}
    if(!live.operator)return;
    if(button.matches('[data-receipt-open]')){button.disabled=true;try{await openReceipt(button.dataset.receiptOpen);}finally{button.disabled=false;}return;}
    if(button.matches('[data-intent-open]')){const row=api.balances.find(item=>item.customer_id===button.dataset.intentOpen);if(!row){notify('A conta deste cliente não foi encontrada.');return;}selectedGroup=groupKey(row);await openAccount();return;}
    if(button.matches('[data-intent-dismiss]')){if(!confirm('Encerrar este aviso sem confirmar automaticamente o pagamento?'))return;try{await api.call('trameli_resolve_payment_intent',{p_intent_id:button.dataset.intentDismiss,p_status:'dismissed'});await api.load(true);refreshContent();notify('Aviso encerrado. Nenhum pagamento foi criado.');}catch(error){notify(error.message);}return;}
    if(button.matches('[data-pay-account]')){await openAccount();return;}
    if(button.matches('[data-pay-identify]')){await openAccount(button.dataset.payIdentify);return;}
    if(button.matches('[data-pay-unknown]')){open(`<h2>Recebimento não identificado</h2><p>Fica pendente de vinculação. Não quita nenhum pedido automaticamente.</p><form data-payment-form="unknown"><label>Valor recebido (R$)<input name="amount" inputmode="decimal" required></label><label>Forma<select name="method">${methodOptions}</select></label><label>Referência<input name="reference" maxlength="120"></label><label>Observação interna<textarea name="note" maxlength="280"></textarea></label><label class="payment-check"><input type="checkbox" required> Conferi que o dinheiro foi recebido.</label>${formFooter('Registrar recebimento')}</form>`);return;}
    if(button.matches('[data-pay-refund]')){const p=api.payments.find(p=>p.id===button.dataset.payRefund);if(!p)return;open(`<h2>Registrar devolução de ${money(p.amount_cents)}</h2><p>Esta ação registra uma devolução integral já realizada fora da Trameli. Não transfere dinheiro e preserva o lançamento original.</p><form data-payment-form="refund" data-payment-id="${p.id}"><label>Motivo<textarea name="reason" minlength="3" maxlength="280" required></textarea></label><label class="payment-check"><input type="checkbox" required> Confirmei a devolução integral ao cliente.</label>${formFooter('Registrar devolução integral')}</form>`);return;}
    if(button.matches('[data-day-preview]')){await previewDay();return;}
    if(button.matches('[data-day-close]')){
      if(!selectedDay||selectedDay>today()){notify('Escolha hoje ou uma data anterior.');return;}
      if(!confirm(`Salvar uma fotografia de ${dateLabel(selectedDay)}? Pendências e custos desconhecidos continuarão sinalizados.`))return;
      button.disabled=true;
      try {const args=requestArgs(button,{p_day:selectedDay});await api.call('trameli_close_day',args);delete button.dataset.payload;notify('Fechamento salvo. Correções futuras gerarão outra revisão.');await previewDay();}
      catch(error){notify(error.message);}
      finally{button.disabled=false;}
    }
  });
  dialog.addEventListener('cancel',event=>{if(dialog.querySelector('[data-busy]'))event.preventDefault();});
  window.TrameliPayments={render,customerRender,refresh,previewDay,openForCustomer,openReceipt,api};
  window.addEventListener('trameli:orders-changed',()=>{if(document.querySelector('[data-payment-content]'))refresh();});
  window.addEventListener('trameli:payments-refresh',()=>refresh());
  refresh();
}
