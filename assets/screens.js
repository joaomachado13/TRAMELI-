const homeView = document.getElementById('home-view');
const live = window.TrameliLive;
const operationView = document.getElementById('operation-view');
const screenView = document.getElementById('screen-view');
const portalView = document.getElementById('portal-view');
const appShell = document.querySelector('.app-shell');
const navigation = [...document.querySelectorAll('.nav__item')];
const routes = new Set(['operacao', 'inicio', 'pendencias', 'pedidos', 'clientes', 'produtos', 'agenda', 'financeiro', 'relatorios', 'configuracoes', 'loja']);
const systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let userReducedMotion = false;
try { userReducedMotion = localStorage.getItem('trameli-reduced-motion') === 'true'; } catch { /* Storage may be unavailable on file URLs. */ }
const motionDisabled = () => systemReducedMotion.matches || userReducedMotion;
const motion = window.TrameliMotion;
const settingsDefaults = { businessName: 'Trameli', contact: '', primaryColor: '#244d32', accentColor: '#b6c780', surfaceColor: '#f5f1e8', rolloverTime: '13:30', cutoffTime: '22:30', deliveryFeeCents: 200 };
function readSettings() {
  const remote = live?.settings;
  if (remote) return { businessName: remote.business_name, contact: remote.contact, primaryColor: remote.primary_color, accentColor: remote.accent_color, surfaceColor: remote.surface_color, rolloverTime: String(remote.rollover_time).slice(0, 5), cutoffTime: String(remote.cutoff_time).slice(0, 5), deliveryFeeCents: Number(remote.delivery_fee_cents) };
  try { return { ...settingsDefaults, ...JSON.parse(localStorage.getItem('trameli-operation-settings-v1') || '{}') }; } catch { return { ...settingsDefaults }; }
}
function applySettings() {
  const settings = readSettings();
  window.TrameliSettings = settings;
  document.documentElement.style.setProperty('--trameli-primary', settings.primaryColor);
  document.documentElement.style.setProperty('--trameli-accent', settings.accentColor);
  document.documentElement.style.setProperty('--trameli-surface', settings.surfaceColor);
  document.querySelectorAll('.brand__name').forEach(node => { node.textContent = settings.businessName; });
  const portalBrand = document.querySelector('.portal-brand');
  if (portalBrand?.firstChild) portalBrand.firstChild.nodeValue = settings.businessName;
}
applySettings();
window.addEventListener('trameli:settings-changed', applySettings);
window.addEventListener('trameli:profile-changed', () => showRoute(true));

function syncMotionPreference() {
  document.body.classList.toggle('motion-off', motionDisabled());
  const toggle = document.querySelector('.motion-toggle');
  if (!toggle) return;
  toggle.disabled = systemReducedMotion.matches;
  toggle.setAttribute('aria-pressed', String(!motionDisabled()));
  toggle.textContent = systemReducedMotion.matches ? 'Reduzido pelo sistema' : motionDisabled() ? 'Desativado' : 'Ativado';
}
syncMotionPreference();
systemReducedMotion.addEventListener('change', syncMotionPreference);

const currency = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const tomorrow = () => { const date = new Date(); date.setDate(date.getDate() + 1); return dateKey(date); };
const orderTotal = order => window.TrameliOrderMath.totalCents(order);
const orderState = order => order.status || (order.checked ? 'confirmed' : 'received');
const orderStateLabel = order => ({ received: 'A conferir', confirmed: 'Conferido', packing: 'Em separação', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' })[orderState(order)] || 'A conferir';
const activeOrders = () => storedOrders().filter(order => orderState(order) !== 'cancelled');
const financeMath = window.TrameliFinanceMath;
const financeRange = { from: '', to: '' };
const reportRange = { from: '', to: '' };
const orderFilters = { query: '', customer: 'all', status: 'all', payment: 'all', from: '', to: '', sort: 'newest' };
const agendaState = { mode: 'calendar', selected: '' };
const reportState = { type: 'financial', period: 'month', generated: false };
let settingsTab = 'geral';
const inRange = (orders, from, to) => orders.filter(order => (!from || order.date >= from) && (!to || order.date <= to));
const saoPauloToday = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const shiftDate = (value, days) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

function storedOrders() {
  if (live) return live.orders.slice();
  try {
    const parsed = JSON.parse(localStorage.getItem('trameli-operation-draft-v2') || '[]');
    return Array.isArray(parsed) ? parsed.filter(order => order && Array.isArray(order.items)) : [];
  } catch { return []; }
}

document.getElementById('today-date').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date());

function updateOverview() {
  const orders = activeOrders();
  const today = saoPauloToday();
  const rollover = readSettings().rolloverTime;
  const clock = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const [rolloverHour, rolloverMinute] = rollover.split(':').map(Number);
  const todayPending = orders.some(order => order.date === today && !['delivered', 'cancelled'].includes(orderState(order)));
  const operationDay = clock.hour * 60 + clock.minute >= rolloverHour * 60 + rolloverMinute && !todayPending ? shiftDate(today, 1) : today;
  const nextDay = orders.filter(order => order.date === operationDay && orderState(order) !== 'delivered');
  const pending = orders.filter(order => orderState(order) === 'received').length;
  const todayDeliveries = orders.filter(order => order.date === today && orderState(order) !== 'delivered');
  const upcoming = orders.filter(order => order.date >= today && orderState(order) !== 'delivered')
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const api = window.TrameliPayments?.api;
  const balances = api?.ready && !api.error ? api.balances : null;
  const due = balances?.reduce((sum, row) => sum + Number(row.due_cents || 0), 0) || 0;
  const dueOrders = balances?.filter(row => Number(row.due_cents) > 0).length || 0;
  const allocations = new Set(api?.allocations.map(row => row.payment_id) || []);
  const unknownReceipts = api?.ready ? api.payments.filter(row => row.kind === 'receipt' && !allocations.has(row.id) && !api.payments.some(refund => refund.reverses_id === row.id)).length : 0;
  const paymentIntents = api?.ready ? (api.intents || []).filter(item => item.status === 'pending').length : 0;
  const missingCosts = live?.operator ? (window.TrameliCatalog?.list() || []).filter(item => item.active && item.costCents == null).length : 0;
  const attentionTotal = pending + todayDeliveries.length + dueOrders + unknownReceipts + paymentIntents + missingCosts;
  document.getElementById('operational-message').textContent = attentionTotal ? `${attentionTotal} ${attentionTotal === 1 ? 'item precisa' : 'itens precisam'} da sua atenção.` : 'Tudo certo por aqui. Nenhuma pendência importante.';
  document.getElementById('home-order-count').textContent = nextDay.length;
  document.getElementById('home-order-count').parentElement.querySelector('.kpi-card__context').textContent = nextDay.length ? `${nextDay.length} ${nextDay.length === 1 ? 'pedido registrado' : 'pedidos registrados'}` : 'Nenhum registrado';
  document.getElementById('home-pending-count').textContent = pending;
  document.getElementById('home-pending-count').parentElement.querySelector('.kpi-card__context').textContent = pending ? `${pending} ${pending === 1 ? 'pedido pendente' : 'pedidos pendentes'}` : 'Nenhum pendente';
  document.getElementById('home-delivery-count').textContent = todayDeliveries.length;
  document.getElementById('home-delivery-context').textContent = todayDeliveries.length ? 'Ainda previstas para hoje' : 'Nenhuma pendente hoje';
  document.getElementById('home-order-total').textContent = balances ? currency(due) : '—';
  document.getElementById('home-order-total').parentElement.querySelector('.kpi-card__context').textContent = balances ? `${dueOrders} ${dueOrders === 1 ? 'pedido pendente' : 'pedidos pendentes'}` : 'Saldos indisponíveis';
  const count = document.getElementById('nav-pending-count');
  count.textContent = attentionTotal;
  count.hidden = attentionTotal === 0;
  count.setAttribute('aria-label', `${attentionTotal} pendências precisam de atenção`);
  document.querySelector('.notification-button').setAttribute('aria-label', attentionTotal ? `${attentionTotal} pendências precisam de atenção` : 'Nenhuma pendência');
  document.querySelector('.notification-dot').hidden = attentionTotal === 0;
  document.querySelector('.attention-strip').hidden = pending === 0 && !todayDeliveries.length && !dueOrders && !unknownReceipts && !!balances;
  const rows = document.getElementById('home-recent-orders');
  rows.innerHTML = nextDay.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map(order => `<tr><td>#${escapeHtml(order.id.slice(0, 8))}</td><td>${escapeHtml(order.customer)}</td><td>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</td><td>${orderStateLabel(order)}</td><td>${currency(orderTotal(order))}<small>Inclui ${currency(order.feeCents || 0)} de entrega</small></td></tr>`).join('');
  document.getElementById('home-orders-empty').hidden = nextDay.length > 0;
  document.getElementById('home-deliveries').innerHTML = upcoming.slice(0, 4).map(order => `<li><span class="delivery-list__dot" aria-hidden="true"></span><time datetime="${escapeHtml(order.date)}">${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</time><div><strong>${escapeHtml(order.customer)}</strong><small>${escapeHtml(orderStateLabel(order))} · #${escapeHtml(order.id.slice(0, 8))}</small></div></li>`).join('');
  document.getElementById('home-deliveries-empty').hidden = upcoming.length > 0;
  const actions = [];
  if (pending) actions.push(`<li><a href="#operacao">${pending} ${pending === 1 ? 'pedido para conferir' : 'pedidos para conferir'} →</a></li>`);
  if (todayDeliveries.length) actions.push(`<li><a href="#agenda">${todayDeliveries.length} ${todayDeliveries.length === 1 ? 'entrega prevista' : 'entregas previstas'} para hoje →</a></li>`);
  if (dueOrders) actions.push(`<li><a href="#financeiro">${dueOrders} ${dueOrders === 1 ? 'pedido em aberto' : 'pedidos em aberto'} · ${currency(due)} →</a></li>`);
  if (unknownReceipts) actions.push(`<li><a href="#financeiro">${unknownReceipts} ${unknownReceipts === 1 ? 'recebimento sem identificação' : 'recebimentos sem identificação'} →</a></li>`);
  if (paymentIntents) actions.push(`<li><a href="#financeiro">${paymentIntents} ${paymentIntents === 1 ? 'aviso “já paguei” para conferir' : 'avisos “já paguei” para conferir'} →</a></li>`);
  if (missingCosts) actions.push(`<li><a href="#produtos">${missingCosts} ${missingCosts === 1 ? 'produto sem custo' : 'produtos sem custo'} →</a></li>`);
  if (!balances) actions.push('<li><a href="#financeiro">Conferir disponibilidade dos saldos no Financeiro →</a></li>');
  document.getElementById('home-next-actions').innerHTML = actions.length ? `<ul class="home-next-list">${actions.join('')}</ul>` : '<div class="home-next-list"><p>Nenhuma pendência nos pedidos e recebimentos atuais.</p></div>';
}
updateOverview();
window.addEventListener('trameli:orders-changed', () => {
  updateOverview();
  if (['#pendencias', '#pedidos', '#clientes', '#agenda', '#financeiro', '#relatorios'].includes(location.hash)) showRoute(true);
});
window.addEventListener('trameli:payments-changed', updateOverview);
window.addEventListener('trameli:catalog-changed', () => { updateOverview(); if (['#produtos','#pendencias'].includes(location.hash)) showRoute(true); });
window.addEventListener('trameli:clients-changed', () => { if (location.hash === '#clientes') showRoute(true); });

function intro(eyebrow, title, description) {
  return `<header class="screen-hero"><div><p class="screen-eyebrow">${eyebrow}</p><h1 class="h1">${title}</h1><p class="screen-description">${description}</p></div></header>`;
}
function metric(label, value, note) {
  return `<article class="screen-metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}
function panel(title, body) {
  return `<section class="screen-panel"><div class="screen-panel__heading"><h2>${title}</h2></div>${body}</section>`;
}
function empty(message, link = '') {
  return `<div class="screen-empty"><p>${message}</p>${link ? `<a href="#operacao">${link} ↗</a>` : ''}</div>`;
}
function productIntelligence() {
  const products = window.TrameliCatalog?.list() || [];
  const stats = new Map(products.map(product => [product.id, { product, units: 0, revenue: 0, cost: 0, known: true }]));
  activeOrders().forEach(order => order.items.forEach(item => {
    const product = products.find(entry => entry.id === item.productId) || products.find(entry => entry.name === item.name);
    if (!product) return;
    const row = stats.get(product.id);
    row.units += item.weightGrams ? 1 : item.quantity;
    row.revenue += item.quantity * item.priceCents;
    if (product.costCents == null) row.known = false;
    else row.cost += item.weightGrams ? Math.round(product.costCents * item.weightGrams / 1000) : product.costCents * item.quantity;
  }));
  const rows = [...stats.values()].filter(row => row.units > 0).map(row => ({ ...row, profit: row.known ? row.revenue - row.cost : null, margin: row.known && row.revenue ? Math.round((row.revenue - row.cost) * 100 / row.revenue) : null }));
  const top = (key, known = false) => rows.filter(row => !known || row[key] != null).sort((a, b) => b[key] - a[key])[0];
  const item = (label, row, value) => `<article class="insight-card"><span>${label}</span>${row ? `<strong>${escapeHtml(row.product.name)}</strong><small>${value(row)}</small>` : '<strong>Sem dados</strong><small>Os pedidos formarão este indicador.</small>'}</article>`;
  return `<section class="product-insights" aria-label="Inteligência de produtos">${item('Mais pedido', top('units'), row => `${row.units} ${row.units === 1 ? 'item' : 'itens'}`)}${item('Maior faturamento', top('revenue'), row => currency(row.revenue))}${item('Maior lucro', top('profit', true), row => currency(row.profit))}${item('Maior margem', top('margin', true), row => `${row.margin}% de margem`)}</section>`;
}

const pages = {
  pendencias: () => {
    const received=activeOrders().filter(order=>orderState(order)==='received');
    const api=window.TrameliPayments?.api;
    const due=(api?.balances||[]).filter(row=>Number(row.due_cents)>0);
    const allocated=new Set((api?.allocations||[]).map(row=>row.payment_id));
    const unknown=(api?.payments||[]).filter(row=>row.kind==='receipt'&&!allocated.has(row.id)&&!(api?.payments||[]).some(refund=>refund.reverses_id===row.id));
    const intents=(api?.intents||[]).filter(item=>item.status==='pending');
    const products=window.TrameliCatalog?.list()||[];
    const missing=products.filter(item=>item.active&&item.costCents==null);
    const day=tomorrow();
    const unavailable=products.filter(item=>item.active&&item.unavailableFrom&&day>=item.unavailableFrom&&day<=item.unavailableUntil);
    const list=(items,emptyText)=>items.length?`<ul class="home-next-list">${items.join('')}</ul>`:`<p>${emptyText}</p>`;
    return `${intro('Atenção centralizada','Pendências','Tudo que exige conferência humana, sem transformar aviso em confirmação automática.')}
      <div class="screen-metrics">${metric('Pedidos a conferir',received.length,'Todos os dias')}${metric('Saldos em aberto',due.length,'Pedidos')}${metric('Avisos Pix',intents.length,'Ainda não confirmados')}${metric('Custos pendentes',missing.length,'Produtos ativos')}</div>
      ${panel('Pedidos a conferir',list(received.map(order=>`<li><a href="#operacao">#${escapeHtml(order.id.slice(0,8))} · ${escapeHtml(order.customer)} · ${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')} →</a></li>`),'Nenhum pedido aguardando conferência.'))}
      ${panel('Financeiro',list([...intents.map(item=>`<li><a href="#financeiro">Aviso “já paguei” · ${currency(item.amount_cents)} · ainda não confirmado →</a></li>`),...unknown.map(item=>`<li><a href="#financeiro">Recebimento sem identificação · ${currency(item.amount_cents)} →</a></li>`),...due.map(item=>`<li><a href="#financeiro">#${escapeHtml(item.order_id.slice(0,8))} · ${escapeHtml(item.customer_name)} · ${currency(item.due_cents)} em aberto →</a></li>`)],'Nenhuma pendência financeira carregada.'))}
      ${panel('Catálogo',list([...missing.map(item=>`<li><a href="#produtos">${escapeHtml(item.name)} · custo pendente →</a></li>`),...unavailable.map(item=>`<li><a href="#produtos">${escapeHtml(item.name)} · indisponível amanhã →</a></li>`)],'Nenhuma pendência de catálogo para amanhã.'))}`;
  },
  pedidos: () => {
    const all = storedOrders();
    const customers = [...new Set(all.map(order => order.customer))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const paymentLabels = { pix_manual: 'Pix', cash: 'Dinheiro', other: 'A combinar', bank: 'Transferência', unspecified: 'Não informado' };
    const normalized = orderFilters.query.trim().toLocaleLowerCase('pt-BR');
    const orders = all.filter(order => (!normalized || [order.id, order.customer, order.address, ...order.items.map(item => item.name)].some(value => String(value).toLocaleLowerCase('pt-BR').includes(normalized)))
      && (orderFilters.customer === 'all' || order.customer === orderFilters.customer)
      && (orderFilters.status === 'all' || orderState(order) === orderFilters.status)
      && (orderFilters.payment === 'all' || (order.paymentMethod || 'unspecified') === orderFilters.payment)
      && (!orderFilters.from || order.date >= orderFilters.from) && (!orderFilters.to || order.date <= orderFilters.to))
      .sort((a, b) => orderFilters.sort === 'oldest' ? a.date.localeCompare(b.date) : orderFilters.sort === 'value' ? orderTotal(b) - orderTotal(a) : b.date.localeCompare(a.date));
    const active = all.filter(order => orderState(order) !== 'cancelled');
    const pending = active.filter(order => orderState(order) === 'received').length;
    const rows = orders.length ? `<div class="orders-browser"><div class="orders-browser__head"><span>Pedido</span><span>Cliente</span><span>Entrega</span><span>Itens</span><span>Valor</span><span>Pagamento</span><span>Status</span></div>${orders.map(order => `<button type="button" class="orders-browser__row" data-open-order="${escapeHtml(order.id)}"><span><strong>#${escapeHtml(order.id.slice(0, 8))}</strong><small>${new Date(order.createdAt).toLocaleDateString('pt-BR')}</small></span><strong>${escapeHtml(order.customer)}</strong><span>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</span><span>${order.items.reduce((sum, item) => sum + (item.weightGrams ? 1 : item.quantity), 0)}</span><strong>${currency(orderTotal(order))}</strong><span>${escapeHtml(paymentLabels[order.paymentMethod || 'unspecified'] || 'Não informado')}</span><span class="screen-badge screen-badge--${orderState(order) === 'received' ? 'amber' : orderState(order) === 'cancelled' ? 'neutral' : 'green'}">${orderStateLabel(order)}</span></button>`).join('')}</div>` : '<div class="friendly-empty"><strong>Nenhum pedido encontrado.</strong><span>Ajuste os filtros ou registre um novo pedido.</span></div>';
    return `${intro('Acompanhamento', 'Pedidos', 'Encontre um pedido e abra somente o detalhe de que precisa.')}
      <div class="screen-metrics screen-metrics--compact">${metric('Pedidos ativos', active.length, 'Todos os períodos')}${metric('A conferir', pending, 'Pedem ação')}${metric('Valor ativo', currency(active.reduce((sum, order) => sum + orderTotal(order), 0)), 'Exclui cancelados')}</div>
      <section class="screen-panel"><div class="record-toolbar record-toolbar--orders"><label>Buscar<input id="orders-search" type="search" value="${escapeHtml(orderFilters.query)}" placeholder="Cliente, produto ou ID"></label><label>Cliente<select data-order-filter="customer"><option value="all">Todos</option>${customers.map(value => `<option value="${escapeHtml(value)}" ${orderFilters.customer === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label><label>Status<select data-order-filter="status"><option value="all">Todos</option>${Object.entries({ received: 'A conferir', confirmed: 'Conferido', packing: 'Em separação', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' }).map(([value, label]) => `<option value="${value}" ${orderFilters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Pagamento<select data-order-filter="payment"><option value="all">Todos</option>${Object.entries(paymentLabels).filter(([value]) => value !== 'bank').map(([value, label]) => `<option value="${value}" ${orderFilters.payment === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>De<input data-order-filter="from" type="date" value="${orderFilters.from}"></label><label>Até<input data-order-filter="to" type="date" value="${orderFilters.to}"></label><label>Ordenar<select data-order-filter="sort"><option value="newest">Mais recentes</option><option value="oldest" ${orderFilters.sort === 'oldest' ? 'selected' : ''}>Mais antigos</option><option value="value" ${orderFilters.sort === 'value' ? 'selected' : ''}>Maior valor</option></select></label><button class="screen-primary" type="button" data-new-order>+ Novo pedido</button></div>${rows}</section>`;
  },
  clientes: () => `${intro('Relacionamento', 'Clientes', 'Busque, consulte o histórico e registre um novo pedido sem sair do perfil.')}${panel('Clientes', window.TrameliClients.render(storedOrders()))}`,
  produtos: () => `${intro('Catálogo', 'Produtos', 'Navegue pelo catálogo e abra cada produto para editar informações.')}${productIntelligence()}${panel('Catálogo de produtos', window.TrameliCatalog.render())}`,
  agenda: () => {
    const groups = new Map();
    activeOrders().forEach(order => { const day = groups.get(order.date) || []; day.push(order); groups.set(order.date, day); });
    const days = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (!agendaState.selected || !groups.has(agendaState.selected)) agendaState.selected = groups.has(saoPauloToday()) ? saoPauloToday() : days[0]?.[0] || '';
    const selectedOrders = groups.get(agendaState.selected) || [];
    const orderRows = orders => `<div class="agenda-order-list">${orders.map(order => `<button type="button" data-open-order="${escapeHtml(order.id)}"><span><strong>${escapeHtml(order.customer)}</strong><small>#${escapeHtml(order.id.slice(0, 8))} · ${order.items.length} ${order.items.length === 1 ? 'linha' : 'linhas'}</small></span><span>${currency(orderTotal(order))}</span><span class="screen-badge screen-badge--${orderState(order) === 'received' ? 'amber' : 'green'}">${orderStateLabel(order)}</span></button>`).join('')}</div>`;
    const calendar = days.length ? `<div class="agenda-calendar">${days.map(([date, orders]) => `<button type="button" data-agenda-day="${date}" aria-pressed="${agendaState.selected === date}"><span>${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' })}</span><strong>${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</strong><small>${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}</small></button>`).join('')}</div><section class="agenda-selected"><div class="screen-panel__heading"><h2>${new Date(`${agendaState.selected}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2><span>${selectedOrders.length} pedidos</span></div>${orderRows(selectedOrders)}</section>` : empty('Nenhuma entrega programada.', 'Lançar pedido');
    const list = days.length ? `<div class="agenda-groups">${days.map(([date, orders]) => `<section><div><strong>${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong><span>${orders.length}</span></div>${orderRows(orders)}</section>`).join('')}</div>` : empty('Nenhuma entrega programada.', 'Lançar pedido');
    return `${intro('Planejamento', 'Agenda', 'Escolha um dia e abra apenas o pedido que deseja consultar.')}<div class="view-toggle" aria-label="Visualização da agenda"><button type="button" data-agenda-mode="calendar" aria-pressed="${agendaState.mode === 'calendar'}">Calendário</button><button type="button" data-agenda-mode="list" aria-pressed="${agendaState.mode === 'list'}">Lista</button></div><section class="screen-panel">${agendaState.mode === 'calendar' ? calendar : list}</section>`;
  },
  financeiro: () => `${intro('Resultado da operação', 'Financeiro', 'Quatro números primeiro; os lançamentos e fechamentos ficam nos detalhes.')}
    <div class="finance-presets" aria-label="Períodos rápidos"><button type="button" data-finance-days="1">Hoje</button><button type="button" data-finance-days="7">Últimos 7 dias</button><button type="button" data-finance-days="15">Últimos 15 dias</button></div>
    <div class="report-filters"><label>De<input id="finance-from" type="date" value="${financeRange.from}"></label><label>Até<input id="finance-to" type="date" value="${financeRange.to}"></label></div>
    <div id="finance-cost-summary" aria-live="polite"></div>`,
  relatorios: () => `${intro('Documentos', 'Relatórios', 'Escolha o que precisa, gere um resumo e salve em PDF.')}
    <section class="report-generator"><div class="report-generator__form"><label>Tipo de relatório<select id="report-type"><option value="financial" ${reportState.type === 'financial' ? 'selected' : ''}>Resumo financeiro</option><option value="sales" ${reportState.type === 'sales' ? 'selected' : ''}>Vendas</option><option value="customers" ${reportState.type === 'customers' ? 'selected' : ''}>Clientes</option><option value="products" ${reportState.type === 'products' ? 'selected' : ''}>Produtos</option><option value="orders" ${reportState.type === 'orders' ? 'selected' : ''}>Pedidos</option><option value="deliveries" ${reportState.type === 'deliveries' ? 'selected' : ''}>Entregas</option></select></label><label>Período<select id="report-period"><option value="today">Hoje</option><option value="week">Últimos 7 dias</option><option value="month" ${reportState.period === 'month' ? 'selected' : ''}>Últimos 30 dias</option><option value="custom" ${reportState.period === 'custom' ? 'selected' : ''}>Personalizado</option></select></label><div class="report-custom-dates" ${reportState.period === 'custom' ? '' : 'hidden'}><label>De<input id="report-from" type="date" value="${reportRange.from}"></label><label>Até<input id="report-to" type="date" value="${reportRange.to}"></label></div><button class="screen-primary" type="button" data-report-generate>Gerar relatório</button></div><div id="report-results" class="report-preview" aria-live="polite">${reportState.generated ? '' : '<div class="friendly-empty"><strong>Nenhum relatório gerado.</strong><span>Escolha um tipo e um período para começar.</span></div>'}</div></section>`,
  configuracoes: () => {
    const operation = readSettings(); let print = {};
    try { print = JSON.parse(localStorage.getItem('trameli-print-settings-70x33-v1') || '{}'); } catch { /* Defaults below. */ }
    const tabs = [['geral','Geral'],['aparencia','Aparência'],['pedidos','Pedidos'],['entregas','Entregas'],['pagamentos','Pagamentos'],['catalogo','Catálogo'],['impressao','Impressão'],['acessos','Equipe e acessos'],['conta','Conta']];
    const content = {
      geral: `<form class="settings-form" data-settings-form="general"><label>Nome da operação<input name="businessName" value="${escapeHtml(operation.businessName || 'Trameli')}" maxlength="80"></label><label>Contato<input name="contact" value="${escapeHtml(operation.contact || '')}" maxlength="80" placeholder="Telefone ou WhatsApp"></label><div class="settings-row settings-row--motion"><span>Movimento da interface</span><button type="button" class="motion-toggle" aria-pressed="${!motionDisabled()}" ${systemReducedMotion.matches ? 'disabled' : ''}>${systemReducedMotion.matches ? 'Reduzido pelo sistema' : motionDisabled() ? 'Desativado' : 'Ativado'}</button></div><button class="screen-primary" type="submit">Salvar</button></form>`,
      aparencia: `<form class="settings-form settings-colors" data-settings-form="appearance"><label>Cor principal<input name="primaryColor" type="color" value="${escapeHtml(operation.primaryColor)}"></label><label>Cor de destaque<input name="accentColor" type="color" value="${escapeHtml(operation.accentColor)}"></label><label>Fundo claro<input name="surfaceColor" type="color" value="${escapeHtml(operation.surfaceColor)}"></label><button class="screen-primary" type="submit">Salvar aparência</button></form>`,
      pedidos: `<form class="settings-form" data-settings-form="orders"><label>Horário de virada operacional<input name="rolloverTime" type="time" value="${escapeHtml(operation.rolloverTime)}" required></label><p>A tela passa a priorizar o próximo dia somente quando os pedidos de hoje estiverem resolvidos.</p><label>Horário de corte do cliente<input type="time" value="22:30" disabled></label><small>Regra protegida pelo cálculo dos pedidos.</small><button class="screen-primary" type="submit">Salvar</button></form>`,
      entregas: `<div class="settings-form"><label>Taxa padrão<input value="R$ 2,00" disabled></label><p>A taxa está protegida pelo cálculo dos pedidos para impedir divergências.</p></div>`,
      pagamentos: `<div class="settings-form"><h3>Meios aceitos</h3><label class="settings-check"><input type="checkbox" checked disabled> Pix</label><label class="settings-check"><input type="checkbox" checked disabled> Dinheiro</label><label class="settings-check"><input type="checkbox" checked disabled> A combinar</label><p>Transferência bancária não aparece mais no checkout.</p></div>`,
      catalogo: `<div class="settings-form"><p>Categorias, preços, custos, fotos e disponibilidade são gerenciados diretamente em Produtos.</p><a class="screen-primary" href="#produtos">Abrir produtos</a>${live?.role === 'master' ? '<button class="entity-danger" type="button" data-purge-orders>Excluir todos os pedidos de teste</button><small>Remove pedidos, pagamentos e fechamentos. Produtos e clientes permanecem.</small>' : ''}</div>`,
      impressao: `<form class="settings-form" data-settings-form="print"><label>Deslocamento horizontal (mm)<input name="offsetX" type="number" min="-3" max="3" step="0.5" value="${Number(print.offsetX || 0)}"></label><label>Deslocamento vertical (mm)<input name="offsetY" type="number" min="-3" max="3" step="0.5" value="${Number(print.offsetY || 0)}"></label><p>Etiqueta atual: 70 × 33 mm, folha A4.</p><button class="screen-primary" type="submit">Salvar</button></form>`,
      acessos: '<div class="settings-slot" data-account-slot="team"><div class="friendly-empty"><strong>Equipe disponível na versão conectada.</strong><span>Entre como Master para administrar acessos.</span></div></div>',
      conta: '<div class="settings-slot" data-account-slot="account"><div class="friendly-empty"><strong>Perfil disponível após o login.</strong><span>Nome, telefone, endereço e senha ficam reunidos aqui.</span></div></div>',
    };
    return `${intro('Preferências', 'Configurações', 'Regras e ajustes organizados fora das telas de trabalho.')}<div class="settings-shell"><nav class="settings-tabs" aria-label="Categorias de configuração">${tabs.map(([value, label]) => `<button type="button" data-settings-tab="${value}" aria-pressed="${settingsTab === value}">${label}</button>`).join('')}</nav><section class="screen-panel settings-content"><div class="screen-panel__heading"><h2>${tabs.find(([value]) => value === settingsTab)?.[1]}</h2></div>${content[settingsTab]}</section></div> <p class="settings-feedback" role="status"></p>`;
  },
};

function renderReportResults() {
  const host = document.getElementById('report-results');
  if (!host) return;
  const { from, to } = reportRange;
  if (from && to && from > to) {
    host.innerHTML = '<p class="report-note">A data inicial precisa ser anterior à data final.</p>';
    return;
  }
  const orders = inRange(activeOrders(), from, to);
  const total = orders.reduce((sum, order) => sum + orderTotal(order), 0);
  const title = ({ financial: 'Resumo financeiro', sales: 'Vendas', customers: 'Clientes', products: 'Produtos', orders: 'Pedidos', deliveries: 'Entregas' })[reportState.type];
  const period = `${from ? new Date(`${from}T12:00:00`).toLocaleDateString('pt-BR') : 'Início'} — ${to ? new Date(`${to}T12:00:00`).toLocaleDateString('pt-BR') : 'Hoje'}`;
  let detail = '';
  if (reportState.type === 'customers') {
    const rows = new Map();
    orders.forEach(order => { const row = rows.get(order.customer) || { count: 0, total: 0 }; row.count++; row.total += orderTotal(order); rows.set(order.customer, row); });
    detail = `<div class="report-table">${[...rows.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, row]) => `<div><strong>${escapeHtml(name)}</strong><span>${row.count} pedidos</span><strong>${currency(row.total)}</strong></div>`).join('')}</div>`;
  } else if (reportState.type === 'products') {
    const rows = new Map();
    orders.forEach(order => order.items.forEach(item => { const row = rows.get(item.name) || { quantity: 0, total: 0 }; row.quantity += item.weightGrams ? 1 : item.quantity; row.total += item.quantity * item.priceCents; rows.set(item.name, row); }));
    detail = `<div class="report-table">${[...rows.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, row]) => `<div><strong>${escapeHtml(name)}</strong><span>${row.quantity} itens</span><strong>${currency(row.total)}</strong></div>`).join('')}</div>`;
  } else {
    detail = `<div class="report-table">${orders.slice().sort((a, b) => b.date.localeCompare(a.date)).map(order => `<div><strong>#${escapeHtml(order.id.slice(0, 8))} · ${escapeHtml(order.customer)}</strong><span>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')} · ${orderStateLabel(order)}</span><strong>${currency(orderTotal(order))}</strong></div>`).join('')}</div>`;
  }
  const body = `<article class="generated-report"><header><div><span>TRAMELI · RELATÓRIO</span><h2>${title}</h2><p>${period}</p></div><strong>${orders.length} pedidos</strong></header><div class="report-summary"><div><span>Pedidos</span><strong>${orders.length}</strong></div><div><span>Valor total</span><strong>${currency(total)}</strong></div></div>${orders.length ? detail : '<div class="friendly-empty"><strong>Nenhum dado neste período.</strong><span>Escolha outro intervalo para gerar o relatório.</span></div>'}</article>`;
  host.innerHTML = `${body}<div class="report-actions"><button class="screen-primary" type="button" data-report-print ${orders.length ? '' : 'disabled'}>Baixar PDF</button><button type="button" data-report-generate>Atualizar relatório</button></div>`;
  let sheet = document.getElementById('report-print-sheet');
  if (!sheet) { sheet = document.createElement('div'); sheet.id = 'report-print-sheet'; document.body.append(sheet); }
  sheet.innerHTML = body;
}

let costRequest = 0;
async function renderCostSummary(hostId, from = null, to = null) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const orders = inRange(activeOrders(), from, to);
  const initial = financeMath.summarizeFinancials(orders, null);
  const overview = (summary, note) => {
    const balances = (window.TrameliPayments?.api?.balances || []).filter(row => (!from || row.delivery_date >= from) && (!to || row.delivery_date <= to));
    const received = balances.reduce((sum, row) => sum + Number(row.paid_cents || 0), 0);
    const due = balances.reduce((sum, row) => sum + Number(row.due_cents || 0), 0);
    const days = new Map();
    orders.forEach(order => days.set(order.date, (days.get(order.date) || 0) + orderTotal(order)));
    const max = Math.max(1, ...days.values());
    const bars = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-10).map(([date, value]) => `<div><span style="--bar:${Math.max(5, Math.round(value * 100 / max))}%"></span><small>${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</small><strong>${currency(value)}</strong></div>`).join('');
    const totalBalance = Math.max(1, received + due);
    return `<div class="finance-headline">${metric('Vendas', currency(summary.customerCents + summary.deliveryCents), `${orders.length} pedidos`)}${metric('Recebido', live ? currency(received) : '—', live ? 'Recebimentos conferidos' : 'Requer conexão')}${metric('Em aberto', live ? currency(due) : '—', live ? `${balances.filter(row => Number(row.due_cents) > 0).length} pedidos` : 'Requer conexão')}${metric(summary.estimatedItems ? 'Resultado provisório' : 'Resultado', summary.profitCents === null ? 'Pendente' : currency(summary.profitCents), summary.profitCents === null ? 'Faltam custos' : 'Lucro bruto dos produtos')}</div><div class="finance-charts"><section><div class="screen-panel__heading"><h2>Faturamento por dia</h2></div>${bars ? `<div class="bar-chart">${bars}</div>` : '<div class="friendly-empty"><strong>Sem vendas no período.</strong></div>'}</section><section><div class="screen-panel__heading"><h2>Recebido × em aberto</h2></div>${live ? `<div class="balance-chart" style="--received:${Math.round(received * 100 / totalBalance)}%"><div><span>Recebido</span><strong>${currency(received)}</strong></div><div><span>Em aberto</span><strong>${currency(due)}</strong></div></div>` : '<div class="friendly-empty"><strong>Conecte a operação.</strong><span>Recebimentos reais não são simulados localmente.</span></div>'}</section></div><details class="finance-help"><summary>Como estes valores são calculados?</summary><p>${escapeHtml(note)}</p><p>Taxas de entrega no período: ${currency(summary.deliveryCents)}. Elas não entram no lucro bruto dos produtos.</p></details>`;
  };
  const request = ++costRequest;
  if (from && to && from > to) {
    host.innerHTML = '<p class="report-note">A data inicial precisa ser anterior à data final.</p>';
    return;
  }
  if (!live?.operator) {
    host.innerHTML = overview(initial, 'Custos, recebimentos e lucro confiável ficam disponíveis somente na conta da operação conectada.');
    return;
  }
  host.innerHTML = overview(initial, 'Calculando custo da padaria…');
  try {
    const rows = await live.costSummary(from, to);
    if (request !== costRequest || !document.getElementById(hostId)) return;
    const summary = financeMath.summarizeFinancials(orders, rows);
    const note = summary.missingItems
      ? `${summary.missingItems} ${summary.missingItems === 1 ? 'item está sem custo' : 'itens estão sem custo'}${summary.estimatedItems ? ` e ${summary.estimatedItems} com custo estimado` : ''}. O valor da padaria é parcial; não feche o lucro nem o repasse com este total.`
      : summary.estimatedItems
        ? `${summary.estimatedItems} ${summary.estimatedItems === 1 ? 'item usa custo estimado' : 'itens usam custo estimado'}. Confirme o preço de compra com a padaria antes de fechar lucro ou repasse.`
        : 'Lucro bruto dos produtos = valor dos clientes − valor da padaria. Não representa dinheiro já recebido nem lucro líquido.';
    host.innerHTML = overview(summary, note);
  } catch (cause) {
    if (request === costRequest && document.getElementById(hostId)) host.innerHTML = overview(initial, `Custos indisponíveis: ${cause.message}`);
  }
}

let activeRoute = null;
let routeRevision = 0;
const menuButtons = [...document.querySelectorAll('.mobile-menu-button, .portal-menu-button')];
const menuOverlay = document.querySelector('.menu-overlay');
const menuPanel = document.getElementById('main-navigation-panel');
const persistentNavigation = matchMedia('(min-width: 1100px)');
const sidebarStorageKey = 'trameli-sidebar-collapsed-v1';

function sidebarIsCollapsed() {
  return document.body.classList.contains('sidebar-collapsed');
}

function setSidebarCollapsed(collapsed, persist = true) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const closeButton = document.querySelector('.nav__close');
  closeButton?.setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
  closeButton?.setAttribute('aria-expanded', String(!collapsed));
  menuButtons.forEach(button => {
    if (!button.classList.contains('mobile-menu-button')) return;
    button.setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
    button.setAttribute('aria-expanded', String(!collapsed));
  });
  if (persist) localStorage.setItem(sidebarStorageKey, String(collapsed));
}

function navigationIsPersistent() {
  return persistentNavigation.matches && !document.body.classList.contains('portal-mode');
}

function setMenu(open) {
  const overlayOpen = open && !navigationIsPersistent();
  const accessible = overlayOpen || navigationIsPersistent();
  document.body.classList.toggle('menu-open', overlayOpen);
  menuOverlay.hidden = !overlayOpen;
  menuPanel.inert = !accessible;
  menuPanel.setAttribute('aria-hidden', String(!accessible));
  menuButtons.forEach(button => {
    button.setAttribute('aria-expanded', String(overlayOpen));
    button.setAttribute('aria-label', overlayOpen ? 'Fechar menu' : 'Abrir menu');
  });
  motion?.menu(overlayOpen);
}
window.TrameliMenu = { close: () => setMenu(false) };

function renderRoute(route, preserveScroll = false) {
  const isPortal = route === 'loja';
  portalView.hidden = !isPortal;
  appShell.hidden = isPortal;
  document.body.classList.toggle('portal-mode', isPortal);
  if (isPortal) {
    document.title = `Peça para amanhã — ${readSettings().businessName}`;
    navigation.forEach(link => {
      const active = link.getAttribute('href') === '#loja';
      link.classList.toggle('btn', active);
      link.classList.toggle('lnk', !active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    setMenu(false);
    if (!preserveScroll) motion.scrollTo(0, false);
    activeRoute = route;
    window.dispatchEvent(new Event('trameli:portal-open'));
    return;
  }
  const isHome = route === 'inicio';
  const isOperation = route === 'operacao';
  homeView.hidden = !isHome;
  operationView.hidden = !isOperation;
  screenView.hidden = isHome || isOperation;
  if (!isHome && !isOperation) { motion.reset(screenView); screenView.innerHTML = pages[route](); }
  if (route === 'relatorios' && reportState.generated) renderReportResults();
  if (route === 'financeiro') renderCostSummary('finance-cost-summary', financeRange.from || null, financeRange.to || null);
  if (route === 'financeiro' && window.TrameliPayments) {
    screenView.insertAdjacentHTML('beforeend', window.TrameliPayments.render());
    window.TrameliPayments.refresh().then(() => { renderCostSummary('finance-cost-summary', financeRange.from || null, financeRange.to || null); window.TrameliPayments.previewDay(); });
  }
  if (route === 'configuracoes' && window.TrameliAccount) {
    const slot = screenView.querySelector('[data-account-slot]');
    if (slot) slot.innerHTML = window.TrameliAccount.render(settingsTab === 'acessos' ? 'team' : 'account');
    if (settingsTab === 'acessos') {
      window.TrameliAccount.refreshTeam();
      window.TrameliAccount.refreshMfa?.().then(() => {
        const panel = screenView.querySelector('[data-mfa-panel]');
        if (panel && settingsTab === 'acessos') panel.outerHTML = window.TrameliAccount.render('team').match(/<div class="account-panel" data-mfa-panel>[\s\S]*?<\/div>(?=<div class="account-panel">)/)?.[0] || panel.outerHTML;
      }).catch(() => {});
    }
  }
  const operationDialog = document.getElementById('operation-dialog');
  if (!isOperation && operationDialog.open) operationDialog.close();
  navigation.forEach(link => {
    const active = link.getAttribute('href') === `#${route}`;
    link.classList.toggle('btn', active);
    link.classList.toggle('lnk', !active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const current = navigation.find(link => link.getAttribute('href') === `#${route}`);
  document.title = `${current?.querySelector('.nav__label')?.textContent.trim() || 'Operação diária'} — ${readSettings().businessName}`;
  setMenu(false);
  if (!preserveScroll) motion.scrollTo(0, false);
  activeRoute = route;
}

function animateRouteIn(route) {
  if (motionDisabled()) return;
  motion.enter(route === 'inicio' ? homeView : route === 'operacao' ? operationView : screenView);
}

function showRoute(force = false) {
  const requested = decodeURIComponent(location.hash.slice(1)) || 'operacao';
  const route = live && !live.operator ? 'loja' : routes.has(requested) ? requested : 'operacao';
  if (route === activeRoute && !force) { setMenu(false); return; }
  const revision = ++routeRevision;
  const previous = activeRoute;
  const finish = () => { if (revision !== routeRevision) return; renderRoute(route, force && previous === route); if (previous !== null && !force && route !== 'loja') animateRouteIn(route); else motion.refresh(); };
  if (previous !== null && previous !== 'loja' && route !== 'loja' && !force && !motionDisabled()) {
    const outgoing = previous === 'inicio' ? homeView : previous === 'operacao' ? operationView : screenView;
    motion.leave(outgoing, finish);
  } else finish();
}

function setReportPeriod() {
  const to = saoPauloToday();
  if (reportState.period === 'today') reportRange.from = reportRange.to = to;
  if (reportState.period === 'week') { reportRange.from = shiftDate(to, -6); reportRange.to = to; }
  if (reportState.period === 'month') { reportRange.from = shiftDate(to, -29); reportRange.to = to; }
}

const globalSearchInput = document.getElementById('global-search-input');
const globalSearchResults = document.getElementById('global-search-results');
function renderGlobalSearch() {
  const query = globalSearchInput.value.trim().toLocaleLowerCase('pt-BR');
  if (query.length < 2) { globalSearchResults.hidden = true; globalSearchInput.setAttribute('aria-expanded', 'false'); return; }
  const orders = storedOrders().filter(order => [order.id, order.customer, ...order.items.map(item => item.name)].some(value => String(value).toLocaleLowerCase('pt-BR').includes(query))).slice(0, 4);
  const clients = [...new Set([...window.TrameliClients.list().map(client => client.name), ...storedOrders().map(order => order.customer)])].filter(name => name.toLocaleLowerCase('pt-BR').includes(query)).slice(0, 4);
  const products = (window.TrameliCatalog?.list() || []).filter(product => product.name.toLocaleLowerCase('pt-BR').includes(query)).slice(0, 4);
  const group = (title, rows) => rows.length ? `<section><h3>${title}</h3>${rows.join('')}</section>` : '';
  globalSearchResults.innerHTML = group('Pedidos', orders.map(order => `<button type="button" data-global-order="${escapeHtml(order.id)}"><span>#${escapeHtml(order.id.slice(0, 8))} · ${escapeHtml(order.customer)}</span><small>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</small></button>`)) + group('Clientes', clients.map(name => `<button type="button" data-global-client="${escapeHtml(name)}"><span>${escapeHtml(name)}</span><small>Abrir clientes</small></button>`)) + group('Produtos', products.map(product => `<button type="button" data-global-product="${escapeHtml(product.id)}"><span>${escapeHtml(product.name)}</span><small>${currency(product.priceCents)}</small></button>`)) || '<p>Nenhum resultado encontrado.</p>';
  globalSearchResults.hidden = false;
  globalSearchInput.setAttribute('aria-expanded', 'true');
}

try { setSidebarCollapsed(localStorage.getItem(sidebarStorageKey) === 'true', false); } catch { setSidebarCollapsed(false, false); }
menuButtons.forEach(button => button.addEventListener('click', () => {
  if (navigationIsPersistent() && button.classList.contains('mobile-menu-button')) setSidebarCollapsed(!sidebarIsCollapsed());
  else setMenu(!document.body.classList.contains('menu-open'));
}));
document.querySelector('.nav__close').addEventListener('click', () => {
  if (navigationIsPersistent()) setSidebarCollapsed(!sidebarIsCollapsed());
  else setMenu(false);
});
menuOverlay.addEventListener('click', () => setMenu(false));
navigation.forEach(link => link.addEventListener('click', () => setMenu(false)));
persistentNavigation.addEventListener('change', () => {
  setMenu(false);
  if (!persistentNavigation.matches) return;
  try { setSidebarCollapsed(localStorage.getItem(sidebarStorageKey) === 'true', false); } catch { setSidebarCollapsed(false, false); }
});
appShell.addEventListener('click', event => {
  if (!navigationIsPersistent() || sidebarIsCollapsed() || event.target.closest('.mobile-menu-button')) return;
  setSidebarCollapsed(true);
});
menuPanel.addEventListener('click', () => {
  if (navigationIsPersistent() && sidebarIsCollapsed()) setSidebarCollapsed(false);
});
window.addEventListener('hashchange', () => showRoute());
document.querySelector('.notification-button').addEventListener('click', () => { location.hash = 'pendencias'; });
document.addEventListener('click', event => {
  const openOrder = event.target.closest('[data-open-order]');
  if (openOrder) { window.TrameliOperation?.openOrder(openOrder.dataset.openOrder); return; }
  if (event.target.closest('[data-new-order]')) { window.TrameliOperation?.openNew(); return; }
  const agendaMode = event.target.closest('[data-agenda-mode]');
  if (agendaMode) { agendaState.mode = agendaMode.dataset.agendaMode; showRoute(true); return; }
  const agendaDay = event.target.closest('[data-agenda-day]');
  if (agendaDay) { agendaState.selected = agendaDay.dataset.agendaDay; showRoute(true); return; }
  const settingsButton = event.target.closest('[data-settings-tab]');
  if (settingsButton) { settingsTab = settingsButton.dataset.settingsTab; showRoute(true); return; }
  const reportGenerate = event.target.closest('[data-report-generate]');
  if (reportGenerate) {
    reportState.type = document.getElementById('report-type')?.value || reportState.type;
    reportState.period = document.getElementById('report-period')?.value || reportState.period;
    if (reportState.period !== 'custom') setReportPeriod();
    else { reportRange.from = document.getElementById('report-from')?.value || ''; reportRange.to = document.getElementById('report-to')?.value || ''; }
    reportState.generated = true;
    renderReportResults();
    return;
  }
  if (event.target.closest('[data-report-print]')) {
    document.body.classList.add('report-printing');
    addEventListener('afterprint', () => document.body.classList.remove('report-printing'), { once: true });
    window.print();
    return;
  }
  const globalOrder = event.target.closest('[data-global-order]');
  if (globalOrder) { globalSearchResults.hidden = true; globalSearchInput.value = ''; window.TrameliOperation?.openOrder(globalOrder.dataset.globalOrder); return; }
  const globalClient = event.target.closest('[data-global-client]');
  if (globalClient) { globalSearchResults.hidden = true; globalSearchInput.value = ''; location.hash = '#clientes'; setTimeout(() => { const input = document.getElementById('client-search'); if (input) { input.value = globalClient.dataset.globalClient; input.dispatchEvent(new Event('input', { bubbles: true })); } }, 300); return; }
  const globalProduct = event.target.closest('[data-global-product]');
  if (globalProduct) { globalSearchResults.hidden = true; globalSearchInput.value = ''; window.TrameliCatalog?.open(globalProduct.dataset.globalProduct); return; }
  if (!event.target.closest('.global-search')) { globalSearchResults.hidden = true; globalSearchInput.setAttribute('aria-expanded', 'false'); }
  const financePreset = event.target.closest('[data-finance-days]');
  if (financePreset) {
    const days = Number(financePreset.dataset.financeDays);
    const to = saoPauloToday();
    financeRange.from = shiftDate(to, 1 - days);
    financeRange.to = to;
    const fromInput = document.getElementById('finance-from'), toInput = document.getElementById('finance-to');
    if (fromInput && toInput) { fromInput.value = financeRange.from; toInput.value = financeRange.to; }
    renderCostSummary('finance-cost-summary', financeRange.from, financeRange.to);
    return;
  }
  const toggle = event.target.closest('.motion-toggle');
  if (!toggle || systemReducedMotion.matches) return;
  userReducedMotion = !userReducedMotion;
  try { localStorage.setItem('trameli-reduced-motion', String(userReducedMotion)); } catch { /* Applies this session. */ }
  syncMotionPreference();
  motion.setReduced(userReducedMotion);
});
document.addEventListener('change', event => {
  const orderFilter = event.target.closest('[data-order-filter]');
  if (orderFilter) { orderFilters[orderFilter.dataset.orderFilter] = orderFilter.value; showRoute(true); return; }
  if (event.target.id === 'report-period') {
    reportState.period = event.target.value;
    const custom = document.querySelector('.report-custom-dates');
    if (custom) custom.hidden = reportState.period !== 'custom';
  }
  if (event.target.id === 'report-type') reportState.type = event.target.value;
  if (event.target.id === 'report-from' || event.target.id === 'report-to') {
    reportRange[event.target.id === 'report-from' ? 'from' : 'to'] = event.target.value;
    if (reportState.generated) renderReportResults();
  }
  if (event.target.id === 'finance-from' || event.target.id === 'finance-to') {
    financeRange[event.target.id === 'finance-from' ? 'from' : 'to'] = event.target.value;
    renderCostSummary('finance-cost-summary', financeRange.from || null, financeRange.to || null);
  }
});
document.addEventListener('input', event => {
  if (event.target === globalSearchInput) { renderGlobalSearch(); return; }
  if (event.target.id === 'orders-search') {
    orderFilters.query = event.target.value;
    showRoute(true);
    const input = document.getElementById('orders-search');
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(orderFilters.query.length, orderFilters.query.length);
  }
});
document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-settings-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const feedback = document.querySelector('.settings-feedback');
  try {
    if (form.dataset.settingsForm === 'print') {
      localStorage.setItem('trameli-print-settings-70x33-v1', JSON.stringify({ offsetX: Number(data.get('offsetX')), offsetY: Number(data.get('offsetY')) }));
    } else {
      const current = readSettings();
      const values = form.dataset.settingsForm === 'orders' ? { rolloverTime: data.get('rolloverTime') }
        : form.dataset.settingsForm === 'appearance' ? { primaryColor: data.get('primaryColor'), accentColor: data.get('accentColor'), surfaceColor: data.get('surfaceColor') }
          : { businessName: data.get('businessName'), contact: data.get('contact') };
      const next = { ...current, ...values };
      if (live) await live.saveSettings(next); else localStorage.setItem('trameli-operation-settings-v1', JSON.stringify(next));
      applySettings();
    }
    if (feedback) feedback.textContent = live ? 'Configurações salvas para todos os aparelhos.' : 'Configurações salvas neste aparelho.';
  } catch (cause) { if (feedback) feedback.textContent = `Não foi possível salvar: ${cause.message}`; }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-purge-orders]');
  if (!button || live?.role !== 'master') return;
  if (!confirm('Excluir TODOS os pedidos, pagamentos e fechamentos de teste? Esta ação não pode ser desfeita.')) return;
  if (prompt('Para confirmar, digite EXCLUIR PEDIDOS') !== 'EXCLUIR PEDIDOS') return;
  button.disabled = true;
  try { const count = await live.purgeTestOrders(); alert(`${count} pedidos de teste foram excluídos.`); showRoute(true); }
  catch (cause) { alert(`Não foi possível limpar a base: ${cause.message}`); }
  finally { button.disabled = false; }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenu(false); });
showRoute();
