import { formatCustomerName } from './customer-display.js';
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
const proofPath = reference => String(reference || '').startsWith('receipt:') ? String(reference).slice(8) : '';
const totals = rows => rows.reduce((sum,row) => {
  for (const key of ['total_cents','paid_cents','due_cents','refund_due_cents']) sum[key] += Number(row[key]);
  return sum;
}, {total_cents:0,paid_cents:0,due_cents:0,refund_due_cents:0});

export function initPayments(live) {
  const api = live ? new PaymentsApi(live) : null;
  const orderCode = id => live?.orders?.find(order => order.id === id)?.publicCode || '—';
  let selectedDay=today(), selectedGroup='', selectedOrderIds=null, dayRevision=0;
  const dialog=document.createElement('dialog'); dialog.className='payment-dialog';
  dialog.setAttribute('aria-label','Recebimentos e conta do cliente'); document.body.append(dialog);
  const status=document.createElement('p'); status.className='payment-notice'; status.setAttribute('role','status'); status.hidden=true; document.body.append(status);
  function notify(message) { status.textContent=message; status.hidden=false; clearTimeout(notify.timer); notify.timer=setTimeout(()=>{status.hidden=true;},12000); }
  const warning = () => !api ? 'Pagamentos reais exigem conexão com o Supabase. Este modo local não registra recebimentos.'
    : api.error || (api.ready === null ? 'Carregando pagamentos…' : api.ready === false ? 'Ative a migração 007 para começar a registrar pagamentos.' : '');
  const groups = () => [...new Map((api?.balances || []).map(row=>[groupKey(row),row])).entries()];
  const groupLabel = row => `${formatCustomerName(row.customer_name)}${row.customer_id ? ` · conta ${short(row.customer_id)}` : ` · pedido manual #${orderCode(row.order_id)} (sem conta vinculada)`}`;
  const options = () => groups().map(([key,row])=>`<option value="${esc(key)}" ${key===selectedGroup?'selected':''}>${esc(groupLabel(row))}</option>`).join('');
  const methodOptions = Object.entries(methods).map(([key,name])=>`<option value="${key}">${name}</option>`).join('');
  const accountSummary = rows => {
    const t=totals(rows);
    return `<div class="payment-metrics">${metric('Compras (exclui cancelados)',t.total_cents)}${metric('Pago, descontadas devoluções',t.paid_cents)}${metric('Em aberto',t.due_cents)}${metric('A devolver',t.refund_due_cents)}</div>`;
  };
  const orderTable = (rows, editable=false, selectable=false) => `<div class="payment-table-wrap"><table class="payment-table"><thead><tr><th>Pedido / entrega</th><th>Valor</th><th>Pago</th><th>Em aberto</th><th>Financeiro</th>${editable?'<th>Quitar agora</th>':selectable?'<th>Selecionar</th>':''}</tr></thead><tbody>${rows.map(row=>`<tr><td>#${orderCode(row.order_id)}<small>${dateLabel(row.delivery_date)} · ${esc(orderLabels[row.order_status] || row.order_status)}</small></td><td>${money(row.total_cents)}</td><td>${money(row.paid_cents)}</td><td>${money(row.due_cents)}</td><td>${labels[row.payment_status]}${!editable && window.TrameliPix && row.customer_id===live.user.id && Number(row.due_cents)>0 ? `<button type="button" data-pix-order="${esc(row.order_id)}">Pagar só este com Pix</button>` : ''}${Number(row.refund_due_cents)>0?`<small>A devolver ${money(row.refund_due_cents)}</small>`:''}</td>${editable?`<td>${Number(row.due_cents)>0?`<label class="payment-check"><input type="checkbox" data-allocation="${esc(row.order_id)}" data-due="${row.due_cents}"> ${money(row.due_cents)}</label>`:'—'}</td>`:selectable?`<td>${Number(row.due_cents)>0?`<input type="checkbox" data-pix-select="${esc(row.order_id)}" aria-label="Selecionar pedido ${orderCode(row.order_id)} por ${money(row.due_cents)}">`:'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
  const statement = rows => {
    const ids=new Set(rows.map(row=>row.order_id));
    const entries=(api?.statement||[]).filter(entry=>ids.has(entry.order_id)).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
    return `<h3>Extrato de recebimentos e devoluções</h3>${entries.length?`<ul class="payment-log">${entries.map(entry=>`<li><span>${timestamp(entry.recorded_at)} · #${orderCode(entry.order_id)}<small>${entry.kind==='refund'?'Devolução registrada':'Recebimento'} · ${methods[entry.method]}</small></span><strong>${entry.kind==='refund'?'−':''}${money(entry.amount_cents)}</strong></li>`).join('')}</ul>`:'<p>Nenhum pagamento registrado para estes pedidos.</p>'}`;
  };
  const customerStatement = rows => {
    const ids=new Set(rows.map(row=>row.order_id));
    const entries=(api?.statement||[]).filter(entry=>ids.has(entry.order_id)).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
    return `<details class="payment-customer-history"><summary>Ver histórico de pagamentos e devoluções</summary>${entries.length?`<ul class="payment-log">${entries.map(entry=>`<li><span>${timestamp(entry.recorded_at)} · #${orderCode(entry.order_id)}<small>${entry.kind==='refund'?'Devolução registrada':'Pagamento confirmado'} · ${methods[entry.method]}</small></span><strong>${entry.kind==='refund'?'−':''}${money(entry.amount_cents)}</strong></li>`).join('')}</ul>`:'<p>Ainda não há pagamentos confirmados para estes pedidos.</p>'}</details>`;
  };
  const customerStatusClass = status => ['paid','refunded'].includes(status) ? 'is-done' : status==='partial' ? 'is-partial' : status==='refund_due' ? 'is-refund' : 'is-open';
  const customerOrders = (rows, allowSelection=true, allowRowPay=true) => `<div class="payment-customer-orders">${rows.map(row=>{
    const due=Number(row.due_cents), paid=Number(row.paid_cents), refundable=Number(row.refund_due_cents);
    return `<article class="payment-order-card ${due>0?'has-balance':'is-settled'}">
      <div class="payment-order-card__select">${due>0&&allowSelection?`<input type="checkbox" data-pix-select="${esc(row.order_id)}" data-due="${due}" aria-label="Selecionar pedido ${orderCode(row.order_id)} por ${money(due)}">`:due>0?'<span class="payment-order-card__dot" aria-hidden="true"></span>':'<span aria-hidden="true">✓</span>'}</div>
      <div class="payment-order-card__main">
        <div class="payment-order-card__heading"><div><strong>Pedido #${orderCode(row.order_id)}</strong><small>Entrega ${dateLabel(row.delivery_date)} · ${esc(orderLabels[row.order_status] || row.order_status)}</small></div><span class="payment-status ${customerStatusClass(row.payment_status)}">${esc(labels[row.payment_status] || row.payment_status)}</span></div>
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
    return `<section class="payment-panel payment-customer"><span class="payment-customer__eyebrow">PAGAMENTOS</span><h2>Meus pagamentos</h2><p class="payment-customer__intro">Veja o que já foi confirmado e o que ainda falta pagar. O pagamento só aparece como concluído depois que a operação confere o recebimento.</p><div data-payment-content="customer">${warning()?`<p role="status">${esc(warning())}</p>`:customerContent()}</div></section>` + (window.TrameliFinancialHistory?.customerMarkup() || '');
  }
  function upcomingRecurringMarkup() {
    const tomorrow = new Date(`${today()}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate()+1); const tomorrowKey = tomorrow.toISOString().slice(0,10);
    const upcoming=Array.isArray(api?.upcoming)?api.upcoming.filter(row=>row.order_id && row.delivery_date && row.delivery_date > tomorrowKey):[];
    if(!upcoming.length) return '';
    return `<section class="payment-upcoming"><h3>Pedidos recorrentes agendados</h3><p>Estes pedidos estão programados. O pagamento fica disponível na véspera da entrega; os pedidos mais distantes continuam agendados.</p><div class="payment-customer-orders">${upcoming.map(row=>`<article class="payment-order-card payment-order-card--upcoming"><div class="payment-order-card__main"><div class="payment-order-card__heading"><div><strong>Pedido #${esc(row.public_code||String(row.order_id).slice(0,8))}</strong><small>Entrega ${dateLabel(row.delivery_date)}</small></div><span class="payment-status is-open">Agendado</span></div><div class="payment-order-card__values"><div><span>Valor previsto</span><strong>${money(row.total_cents)}</strong></div><div><span>Pagamento</span><strong>Na véspera da entrega</strong></div></div></div></article>`).join('')}</div></section>`;
  }
  function customerContent() {
    // An operator opening the storefront must not see other customers in "Minha conta".
    const rows=api.balances.filter(row=>row.customer_id===live.user.id);
    const historyRows=window.TrameliFinancialHistory?.period(null,null,live.user.id) || [];
    const historyTotals=window.TrameliFinancialHistory?.sums(historyRows) || {total:0,paid:0,due:0};
    const upcomingMarkup=upcomingRecurringMarkup();
    if(!rows.length&&!historyRows.length) return upcomingMarkup || '<div class="payment-customer-empty"><strong>Nenhum pagamento pendente.</strong><p>Seus pagamentos aparecerão aqui.</p></div>';
    const t=totals(rows), openRows=rows.filter(row=>Number(row.due_cents)>0);
    const combinedDue=t.due_cents+historyTotals.due;
    const combinedTotal=t.total_cents+historyTotals.total;
    const combinedPaid=t.paid_cents+historyTotals.paid;
    const historyPending=historyRows.filter(entry=>entry.status==='pending');
    const pixReady=window.TrameliPix && openRows.length>0;
    const billingFrequency=['mensal','quinzenal'].includes(live.profile?.billing_frequency) ? live.profile.billing_frequency : 'quinzenal';
    const reminder=billingReminder([...rows, ...historyPending.map(entry=>({delivery_date:entry.entry_date,due_cents:entry.amount_cents}))],today(),billingFrequency);
    const reminderDate=reminder.deadline?dateLabel(reminder.deadline):'';
    const closingDate=reminder.closingDate?dateLabel(reminder.closingDate):'';
    const reminderClass=reminder.state==='overdue'?'is-overdue':reminder.state==='today'?'is-today':'is-upcoming';
    const frequencyLabel=billingFrequency==='mensal'?'FECHAMENTO MENSAL':'FECHAMENTO QUINZENAL';
    const reminderMarkup=reminder.state==='clear'?'':`<aside class="payment-deadline ${reminderClass}" role="status"><div><span>${frequencyLabel}</span><strong>${esc(reminder.message)}</strong><small>${money(reminder.dueCents)} neste fechamento · fecha ${closingDate} · pagar até ${reminderDate}</small></div>${reminder.days!==null&&reminder.days<=7?'<span class="payment-deadline__pulse" aria-hidden="true">!</span>':''}</aside>`;
    const historyNotice = historyTotals.due > 0 ? `<aside class="history-note">Os ${money(historyTotals.due)} de histórico pendente já estão incluídos no saldo total e no fechamento. Se quiser adiantar o pagamento, use o botão de Pix do histórico logo abaixo. A Shirley confirma a baixa depois de conferir o recebimento.</aside>` : '';
    return `${historyNotice}${reminderMarkup}<div class="payment-customer-hero ${combinedDue>0?'has-due':'is-clear'}">
      <div class="payment-customer-hero__balance"><span>${combinedDue>0?'Saldo em aberto · pedidos + histórico':'Tudo certo por aqui'}</span><strong>${combinedDue>0?money(combinedDue):'R$ 0,00'}</strong><p>${combinedDue>0?`${openRows.length} pedido(s) e ${historyPending.length} lançamento(s) histórico(s) pendentes.`:'Nenhum valor pendente nesta conta.'}</p></div>
      <div class="payment-customer-hero__details"><div><span>Total da conta</span><strong>${money(combinedTotal)}</strong></div><div><span>Já confirmado</span><strong>${money(combinedPaid)}</strong></div>${historyRows.length?`<div><span>Histórico pendente</span><strong>${money(historyTotals.due)}</strong></div>`:''}${t.refund_due_cents>0?`<div class="is-refund"><span>A devolver</span><strong>${money(t.refund_due_cents)}</strong></div>`:''}</div>
      ${pixReady?`<button type="button" class="payment-pay-all" data-pix-order="all">${openRows.length===1?'Pagar este pedido':'Pagar pedidos com Pix'} · ${money(t.due_cents)}</button>`:''}
    </div>
    ${pixReady?`<div class="payment-how"><div><span>1</span><p><strong>Escolha</strong><small>Pague tudo de uma vez ou selecione pedidos específicos.</small></p></div><div><span>2</span><p><strong>Faça o Pix</strong><small>Confira o valor e o titular no aplicativo do seu banco.</small></p></div><div><span>3</span><p><strong>Aguarde a conferência</strong><small>Depois do aviso, a operação confirma o recebimento.</small></p></div></div>`:''}
    <div class="payment-customer-list-head"><div><span>SEUS PEDIDOS</span><h3>${openRows.length?'Escolha o que deseja pagar':'Pedidos desta conta'}</h3><p>${openRows.length>1?'Marque mais de um pedido para gerar um único Pix com a soma dos saldos.':openRows.length===1?'Você pode pagar este pedido diretamente pelo botão abaixo.':'Consulte os valores já confirmados.'}</p></div></div>
    ${customerOrders(rows,openRows.length>1,openRows.length>1)}
    ${pixReady && openRows.length>1?`<div class="payment-selection-bar" data-payment-selection><div><span>Seleção</span><strong data-payment-selection-summary>Nenhum pedido selecionado</strong></div><button type="button" data-pix-order="selected" disabled>Pagar selecionados</button></div>`:''}
    ${customerStatement(rows)}${upcomingMarkup}`;
  }
  function operatorContent() {
    if (warning()) return `<p role="status">${esc(warning())}</p><button type="button" data-pay-refresh>Verificar novamente</button>`;
    const reversed=new Set(api.payments.map(p=>p.reverses_id).filter(Boolean));
    const intents=(api.intents||[]).filter(item=>item.status==='pending');
    const ledger=api.payments.filter(p=>p.kind==='receipt'||p.kind==='refund').sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
    const unidentified=ledger.filter(p=>p.kind==='receipt'&&!api.allocations.some(a=>a.payment_id===p.id)).length;
    const history=ledger.map(p=>{
      const allocations=api.allocations.filter(a=>a.payment_id===p.id);
      const names=[...new Set(allocations.map(a=>api.balances.find(row=>row.order_id===a.order_id)?.customer_name).filter(Boolean))];
      const codes=allocations.map(a=>orderCode(a.order_id));
      const actor=api.profiles.find(profile=>profile.user_id===p.actor_id)?.name||(p.actor_id?'Operação':'Sistema');
      const isRefund=p.kind==='refund';
      const isUnidentified=!isRefund&&!allocations.length;
      const status=isRefund?'Devolução registrada':isUnidentified?'Pagamento não identificado':reversed.has(p.id)?'Estornado':'Recebimento confirmado';
      return `<li class="payment-ledger-entry"><div class="payment-ledger-entry__top"><strong>${timestamp(p.recorded_at)}</strong><strong>${isRefund?'−':''}${money(p.amount_cents)}</strong></div><div class="payment-ledger-entry__details"><span>${esc(names.map(formatCustomerName).join(', ')||'Cliente não identificado')}</span><small>${methods[p.method]||p.method} · ${codes.length?codes.map(code=>`#${esc(code)}`).join(' · '):'Sem pedido vinculado'} · Conferido por ${esc(actor)}</small><span class="payment-ledger-entry__status ${isUnidentified?'is-unidentified':''}">${status}</span></div><div class="payment-history-actions">${proofPath(p.reference)?`<button type="button" data-operator-proof="${esc(proofPath(p.reference))}">Comprovante</button>`:''}${isUnidentified?`<button type="button" data-pay-identify="${p.id}">Vincular a pedido</button>`:''}${!isRefund&&!reversed.has(p.id)?`<button type="button" data-pay-refund="${p.id}">Devolução</button>`:''}</div></li>`;
    }).join('');
    return `<div class="payment-client-first payment-client-first--simple"><div><span class="screen-eyebrow">PAGAMENTOS</span><h3>${intents.length ? `${intents.length} ${intents.length===1?'pagamento informado':'pagamentos informados'}` : 'Nenhum pagamento aguardando conferência'}</h3><p>A conferência é feita no perfil do cliente. ${unidentified ? `${unidentified} lançamento(s) ainda sem pedido vinculado.` : ''}</p></div><button class="screen-primary" type="button" data-payment-go-clients>Ver clientes</button></div>
    <section class="payment-ledger-history"><div class="payment-ledger-history__heading"><div><h3>Histórico de pagamentos</h3><p>Confirmações e devoluções registradas no sistema, com data, valor, pedido e responsável.</p></div><button type="button" data-pay-refresh>Atualizar</button></div><ul class="payment-log">${history||'<li><span>Nenhum pagamento registrado ainda.</span></li>'}</ul></section>`;
  }

  function render() {
    return `${window.TrameliPix?.render() || ''}<section class="screen-panel payment-panel"><div class="screen-panel__heading"><div><span class="screen-eyebrow">PENDÊNCIAS</span><h2>Recebimentos</h2></div></div><div data-payment-content="operator">${operatorContent()}</div></section>
      <section class="screen-panel payment-panel payment-closing"><div class="screen-panel__heading"><div><span class="screen-eyebrow">CONTROLE</span><h2>Fechamento diário</h2></div></div><div class="payment-actions"><label>Data<input type="date" data-closing-day value="${selectedDay}" max="${today()}"></label><button type="button" data-day-preview>Ver resumo</button><button type="button" data-day-close>Fechar dia</button></div><div data-day-summary aria-live="polite"></div><div data-day-history></div></section>` + (window.TrameliFinancialHistory?.operatorMarkup() || '');
  }
  function refreshContent() {
    document.querySelectorAll('[data-payment-content]').forEach(host=>{host.innerHTML=warning()?`<p role="status">${esc(warning())}</p><button type="button" data-pay-refresh>Verificar novamente</button>`:host.dataset.paymentContent==='customer'?customerContent():operatorContent();});
    document.querySelectorAll('[data-day-close],[data-day-preview]').forEach(button=>button.disabled=!!warning());
    updateCustomerSelection();
  }
  let refreshPromise = null;
  async function refresh() {
    // Uma só consulta por vez: renderizações simultâneas não criam uma fila de requisições.
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (api) await api.load();
      if (live && !live.operator) await live.refreshPurchaseStatus?.();
      refreshContent();
    })();
    try { await refreshPromise; }
    finally { refreshPromise = null; }
  }
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
  async function openForCustomer({customerId=null,customerName='',intentId=null,orderIds=[]}={}) {
    await refresh();
    if(warning()){notify(warning());return;}
    selectedOrderIds = new Set(orderIds || []);
    const row=api.balances.find(item=>customerId&&item.customer_id===customerId)
      || api.balances.find(item=>selectedOrderIds.has(item.order_id))
      || api.balances.find(item=>String(item.customer_name||'').trim().toLocaleLowerCase('pt-BR')===String(customerName||'').trim().toLocaleLowerCase('pt-BR'));
    if(!row){notify('Este cliente ainda não tem pedidos com saldo financeiro.');return;}
    selectedGroup=groupKey(row);
    await openAccount(null,intentId);
  }
  function open(body) { dialog.innerHTML=`<button type="button" data-payment-close class="payment-close" aria-label="Fechar">×</button>${body}`; dialog.showModal(); }
  const formFooter = label => `<p class="payment-error" role="alert"></p><button type="submit">${label}</button>`;
  const reviewOrders = rows => {
    const openRows=rows.filter(row=>Number(row.due_cents)>0);
    return `<div class="payment-review-orders">${openRows.map(row=>`<label class="payment-review-order">
      <input type="checkbox" data-allocation="${esc(row.order_id)}" data-due="${Number(row.due_cents)}">
      <span><strong>Pedido #${orderCode(row.order_id)}</strong><small>${dateLabel(row.delivery_date)} · ${esc(orderLabels[row.order_status] || row.order_status)}</small></span>
      <strong>${money(row.due_cents)}</strong>
    </label>`).join('')}</div>`;
  };
  const identifyOrders = (rows, paymentAmountCents) => `<div class="payment-review-orders">${rows.filter(row=>Number(row.due_cents)>0).map(row=>`<label class="payment-review-order payment-review-order--identify">
    <input type="checkbox" data-allocation="${esc(row.order_id)}" data-due="${Number(row.due_cents)}">
    <span><strong>Pedido #${orderCode(row.order_id)}</strong><small>${dateLabel(row.delivery_date)} · saldo ${money(row.due_cents)}</small></span>
    <span class="payment-identify-amount"><small>Valor vinculado (R$)</small><input type="number" data-identify-amount="${esc(row.order_id)}" min="0.01" max="${(Number(row.due_cents)/100).toFixed(2)}" step="0.01" value="${(Math.min(Number(row.due_cents),Number(paymentAmountCents))/100).toFixed(2)}" disabled></span>
  </label>`).join('')}</div>`;
  async function openAccount(paymentId=null,intentId=null) {
    await refresh();
    if(warning()) {notify(warning());return;}
    const rows=api.balances.filter(row=>selectedOrderIds?.size ? selectedOrderIds.has(row.order_id) || (row.customer_id && groupKey(row)===selectedGroup) : groupKey(row)===selectedGroup);
    if(!rows.length) {notify('Não encontrei pedidos financeiros para este cliente.');return;}
    const existing=paymentId?api.payments.find(p=>p.id===paymentId):null;
    const intent=intentId?(api.intents||[]).find(item=>item.id===intentId&&item.status==='pending'):null;
    const openRows=rows.filter(row=>Number(row.due_cents)>0);
    if(!openRows.length&&!existing){notify('Este cliente não tem saldo em aberto.');return;}

    const informed=intent?money(intent.amount_cents):'';
    const intro=intent
      ? `O cliente informou <strong>${informed}</strong>. Confira no banco e confirme os pedidos pagos.`
      : 'Selecione os pedidos que foram pagos e dê baixa.';
    open(`<div class="payment-dialog__heading payment-dialog__heading--clean"><div><span class="screen-eyebrow">CONFERIR PAGAMENTO</span><h2>${esc(formatCustomerName(rows[0].customer_name))}</h2><p>${intro}</p></div></div>
      <form class="payment-review-form" data-payment-form="${existing?'identify':'receipt'}" data-payment-id="${existing?.id||''}" data-intent-id="${intent?.id||''}">
        ${reviewOrders(rows)}
        <div class="payment-review-footer">
          <span>Total selecionado</span>
          <strong data-allocation-total>R$ 0,00</strong>
        </div>
        ${intent?'':`<label class="payment-method-simple">Recebido por<select name="method"><option value="pix_manual">Pix</option><option value="cash">Dinheiro</option><option value="other">Acordado com a proprietária</option></select></label>`}
        <details class="payment-proof-optional">
          <summary>Anexar comprovante (opcional)</summary>
          <label>Arquivo<input type="file" name="operatorProof" accept="image/jpeg,image/png,application/pdf"></label>
          <small>JPG, PNG ou PDF · até 5 MB</small>
        </details>
        <p class="payment-error" role="alert"></p>
        <button class="payment-confirm-primary" type="submit">${intent?'Confirmar pagamento':'Dar baixa'}</button>
      </form>`);
    const preferred=new Set(intent?.order_ids || openRows.map(row=>row.order_id));
    dialog.querySelectorAll('[data-allocation]').forEach(input=>{input.checked=preferred.has(input.dataset.allocation);});
    dialog.dispatchEvent(new Event('change'));
  }

  async function openIdentifyPayment(paymentId) {
    await refresh();
    if (warning()) { notify(warning()); return; }
    const payment = api.payments.find(item => item.id === paymentId && item.kind === 'receipt');
    if (!payment) { notify('Pagamento não encontrado.'); return; }
    if (api.allocations.some(item => item.payment_id === paymentId)) { notify('Este pagamento já está vinculado a pedidos.'); return; }
    const openRows = api.balances.filter(row => Number(row.due_cents) > 0);
    const groups = [...new Map(openRows.map(row => [groupKey(row), row])).entries()];
    if (!groups.length) { notify('Não há pedidos com saldo em aberto para vincular este pagamento.'); return; }
    const firstGroup = groups[0][0];
    open(`<div class="payment-dialog__heading payment-dialog__heading--clean"><div><span class="screen-eyebrow">IDENTIFICAR RECEBIMENTO</span><h2>${money(payment.amount_cents)}</h2><p>Escolha o cliente e selecione pedidos que somem exatamente o valor recebido.</p></div></div><form class="payment-review-form" data-payment-form="identify" data-payment-id="${payment.id}" data-unidentified="true" data-amount-cents="${payment.amount_cents}"><label class="payment-method-simple">Cliente<select name="identifyGroup" data-identify-customer>${groups.map(([key,row])=>`<option value="${esc(key)}">${esc(groupLabel(row))}</option>`).join('')}</select></label><div data-identify-orders>${identifyOrders(openRows.filter(row=>groupKey(row)===firstGroup),payment.amount_cents)}</div><div class="payment-review-footer"><span>Valor selecionado</span><strong data-allocation-total>R$ 0,00</strong></div><p class="payment-error" role="alert"></p><button class="payment-confirm-primary" type="submit">Vincular pagamento</button></form>`);
    dialog.dispatchEvent(new Event('change'));
  }
  function snapshotHtml(s) {
    return `<p>${s.orders} pedidos · ${s.delivered} entregues · ${s.cancelled} cancelados · ${s.pending} pendentes</p><div class="payment-metrics">${metric('Produtos',s.products_cents)}${metric('Entregas (separadas)',s.delivery_cents)}${metric('Total dos pedidos',s.total_cents)}${metric('Histórico financeiro do dia',s.historical_total_cents || 0)}${metric('Histórico pago',s.historical_paid_cents || 0)}${metric('Histórico em aberto',s.historical_due_cents || 0)}${metric('Total de pedidos + histórico',Number(s.total_cents || 0)+Number(s.historical_total_cents || 0))}${metric('Recebido para estes pedidos',s.paid_for_orders_cents)}${metric('Em aberto nestes pedidos',s.due_cents)}${metric('A devolver',s.refund_due_cents)}${metric('Padaria — custo conhecido',s.supplier_cents)}<div><span>Lucro bruto dos produtos</span><strong>${s.profit_cents==null?'Pendente':money(s.profit_cents)}</strong></div>${metric('Recebimentos registrados nesta data',s.received_on_day_cents)}${metric('Destes, Pix manual',s.pix_manual_on_day_cents)}${metric('Devoluções registradas nesta data',s.refunded_on_day_cents)}${metric('Recebimentos líquidos nesta data',s.net_received_on_day_cents)}</div><p>${s.missing_cost_items} itens sem custo; ${s.estimated_cost_items} com custo estimado. Recebimentos por data de registro podem pertencer a pedidos de outras datas. Todos os recebimentos desta versão são manuais.</p>`;
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
  async function uploadOperatorProof(form) {
    const file=form.elements.operatorProof?.files?.[0];
    if(!file)return '';
    if(!live?.operator||!live?.user?.id)throw new Error('Anexo disponível somente para a operação.');
    if(!['image/jpeg','image/png','application/pdf'].includes(file.type)||file.size>5242880)throw new Error('Use JPG, PNG ou PDF de até 5 MB.');
    const ext={'image/jpeg':'jpg','image/png':'png','application/pdf':'pdf'}[file.type];
    const path=`${live.user.id}/operacao/${new Date().toISOString().slice(0,7)}/${crypto.randomUUID()}.${ext}`;
    const upload=await live.client.storage.from('trameli-payment-receipts').upload(path,file,{contentType:file.type,upsert:false});
    if(upload.error)throw upload.error;
    return path;
  }
  dialog.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-payment-form]'); if(!form)return; event.preventDefault();
    if(form.dataset.busy)return;
    const errorHost=form.querySelector('.payment-error'), button=form.querySelector('[type=submit]');
    errorHost.textContent='';
    try {
      if(!form.reportValidity())return;
      form.dataset.busy='true';button.disabled=true;
      let name,args;
      if(form.dataset.paymentForm==='refund') {
        name='trameli_refund_payment';args=requestArgs(form,{p_payment_id:form.dataset.paymentId,p_reason:form.elements.reason.value.trim()});
      } else {
        const lines=[...form.querySelectorAll('[data-allocation]:checked')].map(input=>{
        const amountInput=form.dataset.unidentified==='true'?form.querySelector(`[data-identify-amount="${input.dataset.allocation}"]`):null;
        const amount_cents=amountInput?Math.round(Number(amountInput.value)*100):Number(input.dataset.due);
        if(!Number.isInteger(amount_cents)||amount_cents<1||amount_cents>Number(input.dataset.due)) throw new Error(`O valor vinculado ao pedido #${orderCode(input.dataset.allocation)} precisa estar entre R$ 0,01 e ${money(Number(input.dataset.due))}.`);
        return {order_id:input.dataset.allocation,amount_cents};
      });
        if(form.dataset.paymentForm==='identify') {
          if(form.dataset.unidentified==='true' && lines.reduce((sum,line)=>sum+line.amount_cents,0)!==Number(form.dataset.amountCents)) throw new Error(`Os pedidos selecionados precisam totalizar ${money(Number(form.dataset.amountCents))}.`);
          name='trameli_identify_payment';args={p_payment_id:form.dataset.paymentId,p_lines:lines};
        }
        else {
          const amount=form.dataset.paymentForm==='unknown'?cents(form.elements.amount.value):lines.reduce((s,l)=>s+l.amount_cents,0);
          if(!amount)throw new Error('Informe um valor maior que zero.');
          const isIntent=Boolean(form.dataset.intentId);
          const attachment=await uploadOperatorProof(form);
          name='trameli_record_payment';args=requestArgs(form,{p_amount_cents:amount,p_method:isIntent?'pix_manual':(form.elements.method?.value||'pix_manual'),p_reference:attachment?`receipt:${attachment}`:(isIntent?'Pagamento informado pelo cliente':''),p_note:'',p_lines:lines});
        }
      }
      await api.call(name,args);
      if(form.dataset.intentId) {
        await api.call('trameli_resolve_payment_intent',{p_intent_id:form.dataset.intentId,p_status:'reviewed'});
      }
      dialog.close();notify(form.dataset.paymentForm==='identify'?'Pagamento identificado e vinculado aos pedidos.':form.dataset.intentId?'Pagamento conferido e baixado.':'Registro salvo no banco.');
      await api.load(true);refreshContent();await previewDay();
    } catch(error){errorHost.textContent=error.message||'Não foi possível registrar. Verifique a conexão.';}
    finally{delete form.dataset.busy;button.disabled=false;}
  });
  dialog.addEventListener('change',event=>{
    if(event.target.matches('[data-identify-customer]')) {
      const host=dialog.querySelector('[data-identify-orders]');
      const form=dialog.querySelector('[data-payment-form]');
      if(host) host.innerHTML=identifyOrders(api.balances.filter(row=>groupKey(row)===event.target.value && Number(row.due_cents)>0),Number(form?.dataset.amountCents||0));
    }
    if(event.target.matches('[data-allocation]')) {
      const amountInput=dialog.querySelector(`[data-identify-amount="${event.target.dataset.allocation}"]`);
      if(amountInput) amountInput.disabled=!event.target.checked;
    }
    const total=dialog.querySelector('[data-allocation-total]');if(!total)return;
    const form=dialog.querySelector('[data-payment-form]');
    total.textContent=money([...dialog.querySelectorAll('[data-allocation]:checked')].reduce((sum,input)=>{
      const amountInput=form?.dataset.unidentified==='true'?form.querySelector(`[data-identify-amount="${input.dataset.allocation}"]`):null;
      return sum+(amountInput?Math.round(Number(amountInput.value)*100):Number(input.dataset.due));
    },0));
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
    if(button.matches('[data-operator-proof]')){
      try{
        const {data,error}=await live.client.storage.from('trameli-payment-receipts').createSignedUrl(button.dataset.operatorProof,300);
        if(error)throw error;
        window.open(data.signedUrl,'_blank','noopener,noreferrer');
      }catch(error){notify(error.message||'Não foi possível abrir o comprovante.');}
      return;
    }
    if(button.matches('[data-pay-identify]')) { await openIdentifyPayment(button.dataset.payIdentify); return; }
    if(!button.matches('[data-pay-refund],[data-day-preview],[data-day-close]'))return;
    if(warning()){notify(warning());return;}
    if(!live.operator)return;
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
  window.TrameliPayments={render,customerRender,refresh,previewDay,openForCustomer,api};
  window.addEventListener('trameli:orders-changed',()=>{if(document.querySelector('[data-payment-content]'))refresh();});
  window.addEventListener('trameli:payments-refresh',()=>refresh());
  window.addEventListener('trameli:historical-finances-changed',()=>{ if(document.querySelector('[data-payment-content]')) refreshContent(); });
  refresh();
}
