import { PaymentsApi } from './payments-api.js';
import { escapeHtml as esc } from './auth-utils.js';
import './payments.css';

const money = cents => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(Number(cents || 0)/100);
const labels = { open:'Em aberto', partial:'Parcialmente pago', paid:'Pago', refunded:'Estornado', refund_due:'Devolução pendente', cancelled:'Cancelado' };
const orderLabels = { received:'A conferir', confirmed:'Conferido', packing:'Em separação', ready:'Pronto', delivered:'Entregue', cancelled:'Cancelado' };
const methods = { pix_manual:'Pix conferido manualmente', cash:'Dinheiro', bank:'Transferência', other:'Outro' };
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
  function customerRender() {
    return `<section class="payment-panel"><h2>Minha conta corrente</h2><p>Entregar um pedido não significa que ele foi pago. Aqui aparecem os recebimentos conferidos pela operação.</p><div data-payment-content="customer">${warning()?`<p role="status">${esc(warning())}</p>`:customerContent()}</div></section>`;
  }
  function customerContent() {
    // An operator opening the storefront must not see other customers in "Minha conta".
    const rows=api.balances.filter(row=>row.customer_id===live.user.id);
    return rows.length?`${accountSummary(rows)}${window.TrameliPix && rows.some(row=>Number(row.due_cents)>0) ? '<div class="payment-actions"><button type="button" data-pix-order="selected">Pagar pedidos selecionados com Pix</button><button type="button" data-pix-order="all">Pagar todo o saldo com Pix</button></div>' : ''}${orderTable(rows,false,true)}${statement(rows)}`:'<p>Você ainda não tem pedidos vinculados a esta conta.</p>';
  }
  function operatorContent() {
    if (warning()) return `<p role="status">${esc(warning())}</p><button type="button" data-pay-refresh>Verificar novamente</button>`;
    const reversed=new Set(api.payments.map(p=>p.reverses_id).filter(Boolean));
    const allocated=new Set(api.allocations.map(a=>a.payment_id));
    const unknown=api.payments.filter(p=>p.kind==='receipt'&&!allocated.has(p.id)&&!reversed.has(p.id));
    const receipts=api.payments.filter(p=>p.kind==='receipt').sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
    const intents=(api.intents||[]).filter(item=>item.status==='pending').sort((a,b)=>b.created_at.localeCompare(a.created_at));
    return `${accountSummary(api.balances)}<div class="payment-actions"><label>Conta do cliente<select data-payment-group><option value="">Selecione uma conta ou pedido manual</option>${options()}</select></label><button type="button" data-pay-account>Ver extrato / registrar pagamento</button><button type="button" data-pay-unknown>Registrar recebimento não identificado</button></div>
      <p>Pedidos manuais sem conta ficam separados por pedido. Pix aqui é conferido manualmente; não há cobrança ou confirmação bancária automática.</p>
      <h3>Avisos “já paguei” (${intents.length})</h3>${intents.length?`<ul class="payment-log">${intents.map(item=>`<li><span>${timestamp(item.created_at)} · ${money(item.amount_cents)}<small>Pedidos ${item.order_ids.map(id=>`#${short(id)}`).join(' · ')} · ainda não confirmado</small></span><span><button type="button" data-intent-open="${item.customer_id}">Conferir conta</button><button type="button" data-intent-dismiss="${item.id}">Encerrar aviso</button></span></li>`).join('')}</ul>`:'<p>Nenhum cliente avisou pagamento pendente de conferência.</p>'}
      <h3>Não identificados (${unknown.length})</h3>${unknown.length?`<ul class="payment-log">${unknown.map(p=>`<li><span>${timestamp(p.recorded_at)} · ${money(p.amount_cents)}<small>${esc(p.reference || 'Sem referência')} · ${esc(p.note)}</small></span><button type="button" data-pay-identify="${p.id}">Vincular à conta selecionada</button></li>`).join('')}</ul>`:'<p>Nenhum recebimento aguardando identificação.</p>'}
      <details><summary>Recebimentos registrados (${receipts.length})</summary><ul class="payment-log">${receipts.map(p=>`<li><span>${timestamp(p.recorded_at)} · ${money(p.amount_cents)}<small>${methods[p.method]} · ${esc(p.reference || 'Sem referência')} · ${esc(p.note)}</small><small>${api.allocations.filter(a=>a.payment_id===p.id).map(a=>`#${short(a.order_id)}: ${money(a.amount_cents)}`).join(' · ') || 'Sem pedido identificado'}</small></span>${reversed.has(p.id)?'<strong>Estornado</strong>':`<button type="button" data-pay-refund="${p.id}">Registrar devolução integral</button>`}</li>`).join('')}</ul></details>`;
  }
  function render() {
    return `${window.TrameliPix?.render() || ''}<section class="screen-panel payment-panel"><h2>Recebimentos e conta corrente</h2><div data-payment-content="operator">${operatorContent()}</div></section>
      <section class="screen-panel payment-panel"><h2>Fechamento diário</h2><p>Guarda uma fotografia do dia. Correções posteriores não apagam fechamentos anteriores.</p><div class="payment-actions"><label>Data<input type="date" data-closing-day value="${selectedDay}" max="${today()}"></label><button type="button" data-day-preview>Atualizar resumo</button><button type="button" data-day-close>Fechar dia</button></div><div data-day-summary aria-live="polite"></div><div data-day-history></div></section>`;
  }
  function refreshContent() {
    document.querySelectorAll('[data-payment-content]').forEach(host=>{host.innerHTML=warning()?`<p role="status">${esc(warning())}</p><button type="button" data-pay-refresh>Verificar novamente</button>`:host.dataset.paymentContent==='customer'?customerContent():operatorContent();});
    document.querySelectorAll('[data-day-close],[data-day-preview]').forEach(button=>button.disabled=!!warning());
  }
  async function refresh() { if(api) await api.load(); refreshContent(); }
  function open(body) { dialog.innerHTML=`<button type="button" data-payment-close class="payment-close" aria-label="Fechar">×</button>${body}`; dialog.showModal(); }
  const formFooter = label => `<p class="payment-error" role="alert"></p><button type="submit">${label}</button>`;
  async function openAccount(paymentId=null) {
    await refresh();
    if(warning()) {notify(warning());return;}
    const rows=api.balances.filter(row=>groupKey(row)===selectedGroup);
    if(!rows.length) {notify('Selecione primeiro uma conta ou pedido manual.');return;}
    const existing=paymentId?api.payments.find(p=>p.id===paymentId):null;
    open(`<h2>${esc(groupLabel(rows[0]))}</h2>${accountSummary(rows)}<form data-payment-form="${existing?'identify':'receipt'}" data-payment-id="${existing?.id||''}">
      <p>${existing?`Selecione pedidos completos até totalizar exatamente ${money(existing.amount_cents)}.`:'Selecione um ou mais pedidos. Cada pedido será quitado pelo saldo integral atual.'}</p>
      ${orderTable(rows,true)}<button type="button" data-fill-balances>Selecionar todos os saldos em aberto</button><p>Total a registrar: <strong data-allocation-total>R$ 0,00</strong></p>
      ${existing?'':`<label>Forma de recebimento<select name="method">${methodOptions}</select></label><label>Referência / comprovante (opcional)<input name="reference" maxlength="120"></label><label>Observação interna (opcional)<textarea name="note" maxlength="280"></textarea></label>`}
      <label class="payment-check"><input type="checkbox" required> Conferi o recebimento fora da Trameli.</label>${formFooter(existing?'Vincular recebimento':'Registrar pagamento')}</form>${statement(rows)}`);
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
      dialog.close();notify('Registro salvo no banco.');
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
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.matches('[data-payment-close]')){if(!dialog.querySelector('[data-busy]'))dialog.close();return;}
    if(button.matches('[data-fill-balances]')){dialog.querySelectorAll('[data-allocation]').forEach(input=>input.checked=true);dialog.dispatchEvent(new Event('change'));return;}
    if(button.matches('[data-pay-refresh]')){await refresh();await previewDay();return;}
    if(!button.matches('[data-pay-account],[data-pay-identify],[data-pay-unknown],[data-pay-refund],[data-day-preview],[data-day-close],[data-intent-open],[data-intent-dismiss]'))return;
    if(warning()){notify(warning());return;}
    if(!live.operator)return;
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
  window.TrameliPayments={render,customerRender,refresh,previewDay,api};
  window.addEventListener('trameli:orders-changed',()=>{if(document.querySelector('[data-payment-content]'))refresh();});
  window.addEventListener('trameli:payments-refresh',()=>refresh());
  refresh();
}
