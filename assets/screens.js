import { formatCustomerName, normalizeSearch } from '../src/customer-display.js';
import { pageHeader, metricCard as metric, card as panel, feedback, statusBadge, listRow, revenueChart, balanceProgress } from '../src/staff-components.js';
import { billingDeadlineForDelivery } from '../src/billing-cycle.js';
const homeView = document.getElementById('home-view');
const live = window.TrameliLive;
const operationView = document.getElementById('operation-view');
const screenView = document.getElementById('screen-view');
const portalView = document.getElementById('portal-view');
const shirleyPortalView = document.getElementById('shirley-portal-view');
const appShell = document.querySelector('.app-shell');
const navigation = [...document.querySelectorAll('.nav__item')];
const routes = new Set(['operacao', 'portal-shirley', 'inicio', 'pendencias', 'notificacoes', 'pedidos', 'clientes', 'produtos', 'agenda', 'financeiro', 'relatorios', 'configuracoes', 'loja']);
const systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let userReducedMotion = false;
try { userReducedMotion = localStorage.getItem('trameli-reduced-motion') === 'true'; } catch { /* Storage may be unavailable on file URLs. */ }
const motionDisabled = () => systemReducedMotion.matches || userReducedMotion;
const motion = window.TrameliMotion;
const settingsDefaults = { businessName: 'Pão Doce', contact: '', primaryColor: '#8F3D22', accentColor: '#EBBFA1', surfaceColor: '#FBF0E4', rolloverTime: '13:30', cutoffTime: '21:00', deliveryFeeCents: 200 };
// Atualiza apenas a apresentação dos valores oficiais antigos, sem gravar dados.
function identitySettings(settings) {
  const colors = {
    primaryColor: [['#244d32', '#9e432c'], '#8F3D22'],
    accentColor: [['#b6c780', '#e8b8a6'], '#EBBFA1'],
    surfaceColor: [['#f5f1e8', '#f7f2ea'], '#FBF0E4'],
  };
  const result = { ...settings };
  for (const [key, [previous, current]] of Object.entries(colors)) {
    if (previous.includes(String(result[key]).toLowerCase())) result[key] = current;
  }
  return result;
}
function readSettings() {
  const remote = live?.settings;
  if (remote) return identitySettings({ businessName: remote.business_name, contact: remote.contact, primaryColor: remote.primary_color, accentColor: remote.accent_color, surfaceColor: remote.surface_color, rolloverTime: String(remote.rollover_time).slice(0, 5), cutoffTime: String(remote.cutoff_time).slice(0, 5), deliveryFeeCents: Number(live?.commercialTerms?.deliveryFeeCents ?? remote.delivery_fee_cents) });
  try { return identitySettings({ ...settingsDefaults, ...JSON.parse(localStorage.getItem('trameli-operation-settings-v1') || '{}') }); } catch { return { ...settingsDefaults }; }
}
function applySettings() {
  const settings = readSettings();
  window.TrameliSettings = settings;
  document.documentElement.style.setProperty('--trameli-primary', settings.primaryColor);
  document.documentElement.style.setProperty('--trameli-accent', settings.accentColor);
  document.documentElement.style.setProperty('--trameli-surface', settings.surfaceColor);
  document.documentElement.style.setProperty('--color-primary', settings.primaryColor);
  document.documentElement.style.setProperty('--color-primary-soft', settings.accentColor);
  document.documentElement.style.setProperty('--color-background', settings.surfaceColor);
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
const orderCode = order => order?.publicCode || '—';
const paymentOrderCode = id => orderCode((live?.orders || []).find(order => order.id === id) || { id });
const reportCustomerKey = order => order.customerId || `manual:${String(order.customer || '').trim().toLocaleLowerCase('pt-BR')}`;
const orderState = order => order.status || (order.checked ? 'confirmed' : 'received');
const orderStateLabel = order => ({ received: 'A conferir', confirmed: 'Conferido', packing: 'Em separação', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' })[orderState(order)] || 'A conferir';
const activeOrders = () => storedOrders().filter(order => orderState(order) !== 'cancelled');
const financeMath = window.TrameliFinanceMath;
const financeRange = { from: '', to: '', period: '1' };
const reportRange = { from: '', to: '' };
const orderFilters = { query: '', customer: 'all', status: 'all', payment: 'all', from: '', to: '', sort: 'newest', expanded: false };
const agendaState = { mode: 'calendar', selected: '' };
const reportState = { type: 'financial', period: 'month', customer: 'all', generated: false };
let reportBillingCustomers = [];
const reportScopeName = () => reportState.customer === 'all' ? 'Todos os clientes' : formatCustomerName(activeOrders().find(order => reportCustomerKey(order) === reportState.customer)?.customer) || 'Cliente selecionado';
const reportPeriodLabel = () => `${reportRange.from ? new Date(`${reportRange.from}T12:00:00`).toLocaleDateString('pt-BR') : 'Início'} — ${reportRange.to ? new Date(`${reportRange.to}T12:00:00`).toLocaleDateString('pt-BR') : 'Hoje'} · ${reportScopeName()}`;
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
  const operationDay = clock.hour * 60 + clock.minute >= rolloverHour * 60 + rolloverMinute ? shiftDate(today, 1) : today;
  const nextDay = orders.filter(order => order.date === operationDay && orderState(order) !== 'delivered');
  const pending = orders.filter(order => orderState(order) === 'received').length;
  const todayDeliveries = orders.filter(order => order.date === today && orderState(order) !== 'delivered');
  const upcoming = orders.filter(order => order.date >= today && orderState(order) !== 'delivered')
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const api = window.TrameliPayments?.api;
  const balances = api?.ready && !api.error ? api.balances : null;
  const due = balances?.reduce((sum, row) => sum + Number(row.due_cents || 0), 0) || 0;
  const dueOrders = balances?.filter(row => Number(row.due_cents) > 0).length || 0;
  const paymentIntents = api?.ready ? (api.intents || []).filter(item => item.status === 'pending').length : 0;
  const missingCosts = live?.operator ? (window.TrameliCatalog?.list() || []).filter(item => item.active && item.costCents == null).length : 0;
  const attentionTotal = pending + todayDeliveries.length + dueOrders + paymentIntents + missingCosts;
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
  count.textContent = pending;
  count.hidden = pending === 0;
  count.setAttribute('aria-label', pending ? `${pending} ${pending === 1 ? 'pedido aguarda' : 'pedidos aguardam'} conferência` : 'Nenhum pedido aguardando conferência');
  const notificationButton = document.querySelector('.notification-button');
  const notificationCount = document.querySelector('.notification-count');
  notificationButton.setAttribute('aria-label', pending ? `${pending} ${pending === 1 ? 'pedido novo aguarda' : 'pedidos novos aguardam'} conferência` : 'Nenhum pedido novo');
  notificationButton.title = pending ? 'Abrir pedidos novos' : 'Ver pendências';
  if (notificationCount) {
    notificationCount.textContent = pending > 99 ? '99+' : String(pending);
    notificationCount.hidden = pending === 0;
  }
  document.querySelector('.attention-strip').hidden = pending === 0 && !todayDeliveries.length && !dueOrders && !paymentIntents && !!balances;
  const rows = document.getElementById('home-recent-orders');
  rows.innerHTML = nextDay.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map(order => `<tr data-open-order="${escapeHtml(order.id)}" tabindex="0" role="button" aria-label="Abrir pedido de ${escapeHtml(formatCustomerName(order.customer))}"><td><span class="home-order-code">#${escapeHtml(orderCode(order))}</span></td><td>${escapeHtml(formatCustomerName(order.customer))}</td><td>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</td><td>${orderStateLabel(order)}</td><td>${currency(orderTotal(order))}<small>Inclui ${currency(order.feeCents || 0)} de entrega</small></td></tr>`).join('');
  document.getElementById('home-orders-empty').hidden = nextDay.length > 0;
  document.getElementById('home-deliveries').innerHTML = upcoming.slice(0, 4).map(order => `<li><span class="delivery-list__dot" aria-hidden="true"></span><time datetime="${escapeHtml(order.date)}">${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</time><div><strong>${escapeHtml(formatCustomerName(order.customer))}</strong><small>${escapeHtml(orderStateLabel(order))} · #${escapeHtml(orderCode(order))}</small></div></li>`).join('');
  document.getElementById('home-deliveries-empty').hidden = upcoming.length > 0;
  const actions = [];
  const priority = (title, count, href, icon, subtitle = '') => `<li>${listRow({ title, subtitle, avatar: icon, href, badge: statusBadge(String(count),'warning') })}</li>`;
  if (pending) actions.push(priority('Pedidos a conferir', pending, '#operacao', '▣'));
  if (todayDeliveries.length) actions.push(priority('Entregas previstas para hoje', todayDeliveries.length, '#agenda', '▦'));
  if (dueOrders) actions.push(priority('Pedidos em aberto', dueOrders, '#financeiro', '$', currency(due)));
  if (paymentIntents) actions.push(priority('Pagamentos informados', paymentIntents, '#clientes', '$'));
  if (missingCosts) actions.push(priority('Produtos sem custo', missingCosts, '#produtos', '□'));
  if (!balances) actions.push(`<li>${listRow({ title: 'Conferir disponibilidade dos saldos', avatar: '$', href: '#financeiro' })}</li>`);
  document.getElementById('home-next-actions').innerHTML = actions.length ? `<ul class="home-next-list">${actions.join('')}</ul>` : feedback({ title: 'Nenhuma pendência nos pedidos e recebimentos atuais.' });
}
updateOverview();
const canPassiveRefresh = () => !document.querySelector('dialog[open]') && !document.activeElement?.matches('input,select,textarea,[contenteditable="true"]');
function refreshRouteWhenIdle(routesToRefresh) {
  if (!routesToRefresh.includes(location.hash)) return;
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    if (dialog.dataset.routeRefreshPending !== 'true') {
      dialog.dataset.routeRefreshPending = 'true';
      dialog.addEventListener('close', () => {
        delete dialog.dataset.routeRefreshPending;
        if (routesToRefresh.includes(location.hash)) showRoute(true);
      }, { once: true });
    }
    return;
  }
  const active = document.activeElement;
  if (active?.matches('input,select,textarea,[contenteditable="true"]')) {
    if (active.dataset.routeRefreshPending !== 'true') {
      active.dataset.routeRefreshPending = 'true';
      active.addEventListener('blur', () => {
        delete active.dataset.routeRefreshPending;
        if (routesToRefresh.includes(location.hash)) showRoute(true);
      }, { once: true });
    }
    return;
  }
  showRoute(true);
}
window.addEventListener('trameli:orders-changed', () => {
  updateOverview();
  refreshRouteWhenIdle(['#pendencias', '#pedidos', '#agenda', '#financeiro', '#relatorios']);
});
window.addEventListener('trameli:payments-changed', updateOverview);
window.addEventListener('trameli:historical-finances-changed', () => {
  updateOverview();
  if (location.hash === '#financeiro') renderCostSummary('finance-cost-summary', financeRange.from || null, financeRange.to || null);
  if (location.hash === '#relatorios' && reportState.generated) renderReportResults();
});
window.addEventListener('trameli:catalog-changed', () => { updateOverview(); refreshRouteWhenIdle(['#produtos','#pendencias']); });
window.addEventListener('trameli:clients-changed', () => { refreshRouteWhenIdle(['#clientes']); });

function intro(eyebrow, title, description, actions = '') {
  return pageHeader({ title, actions });
}
function empty(message, link = '') {
  return feedback({ title: message, action: link ? `<a class="staff-button staff-button--secondary" href="#operacao">${escapeHtml(link)} ↗</a>` : '' });
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
  notificacoes: () => window.TrameliNotifications?.renderOperator?.()
    || '<div class="friendly-empty"><strong>Carregando notificações…</strong><span>A central ficará disponível em instantes.</span></div>',
  pendencias: () => {
    const received=activeOrders().filter(order=>orderState(order)==='received');
    const api=window.TrameliPayments?.api;
    const due=(api?.balances||[]).filter(row=>Number(row.due_cents)>0);
    const intents=(api?.intents||[]).filter(item=>item.status==='pending');
    const products=window.TrameliCatalog?.list()||[];
    const missing=products.filter(item=>item.active&&item.costCents==null);
    const day=tomorrow();
    const unavailable=products.filter(item=>item.active&&item.unavailableFrom&&day>=item.unavailableFrom&&day<=item.unavailableUntil);
    const list = (items, message) => items.length ? `<div class="staff-record-list">${items.join('')}</div>` : feedback({ title: message });
    return `${intro('', 'Pendências', '')}<div class="screen-metrics">${metric('Pedidos a conferir',received.length,'Todos os dias')}${metric('Saldos em aberto',due.length,'Pedidos')}${metric('Avisos Pix',intents.length,'Aguardando conferência')}${metric('Custos pendentes',missing.length,'Produtos ativos')}</div>
      ${panel('Pedidos a conferir', list(received.map(order => listRow({ title: formatCustomerName(order.customer), subtitle: `#${orderCode(order)} · ${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}`, avatar: '▣', badge: statusBadge('A conferir','warning'), value: currency(orderTotal(order)), attributes: `data-open-order="${escapeHtml(order.id)}"` })), 'Nenhum pedido aguardando conferência.'))}
      ${panel('Saldos em aberto', list(due.map(item => listRow({ title: formatCustomerName(item.customer_name), subtitle: `#${paymentOrderCode(item.order_id)}`, avatar: '$', badge: statusBadge('Em aberto','danger'), value: currency(item.due_cents), href: '#clientes' })), 'Nenhum saldo em aberto carregado.'))}
      ${panel('Avisos Pix', list(intents.map(item => listRow({ title: item.customer_name ? formatCustomerName(item.customer_name) : 'Pagamento informado', subtitle: 'Confira o recebimento no cadastro do cliente', avatar: '$', badge: statusBadge('A conferir','warning'), value: currency(item.amount_cents), href: '#clientes' })), 'Nenhum aviso Pix aguardando conferência.'))}
      ${missing.length || unavailable.length ? panel('Catálogo', list([...missing.map(item => listRow({ title: item.name, subtitle: 'Custo pendente', avatar: '□', href: '#produtos' })), ...unavailable.map(item => listRow({ title: item.name, subtitle: 'Indisponível amanhã', avatar: '□', href: '#produtos' }))], 'Nenhuma pendência de catálogo.')) : ''}`;
  },
  pedidos: () => {
    const all = storedOrders();
    const customers = [...new Set(all.map(order => order.customer))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const paymentLabels = { pix_manual: 'Pix', cash: 'Dinheiro', other: 'Acordado com a proprietária', bank: 'Transferência', unspecified: 'Não informado' };
    const normalized = normalizeSearch(orderFilters.query);
    const orders = all.filter(order => (!normalized || [order.id, orderCode(order), order.customer, order.address, ...order.items.map(item => item.name)].some(value => normalizeSearch(value).includes(normalized)))
      && (orderFilters.customer === 'all' || order.customer === orderFilters.customer)
      && (orderFilters.status === 'all' || orderState(order) === orderFilters.status)
      && (orderFilters.payment === 'all' || (order.paymentMethod || 'unspecified') === orderFilters.payment)
      && (!orderFilters.from || order.date >= orderFilters.from) && (!orderFilters.to || order.date <= orderFilters.to))
      .sort((a, b) => orderFilters.sort === 'oldest' ? a.date.localeCompare(b.date) : orderFilters.sort === 'value' ? orderTotal(b) - orderTotal(a) : b.date.localeCompare(a.date));
    const active = all.filter(order => orderState(order) !== 'cancelled');
    const pending = active.filter(order => orderState(order) === 'received').length;
    const rows = orders.length ? `<div class="orders-browser"><div class="orders-browser__head"><span>Pedido</span><span>Cliente</span><span>Entrega</span><span>Itens</span><span>Valor</span><span>Pagamento</span><span>Status</span></div>${orders.map(order => `<button type="button" class="orders-browser__row" data-open-order="${escapeHtml(order.id)}"><span><strong>#${escapeHtml(orderCode(order))}</strong><small>${new Date(order.createdAt).toLocaleDateString('pt-BR')}</small></span><strong>${escapeHtml(formatCustomerName(order.customer))}</strong><span>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</span><span>${order.items.reduce((sum, item) => sum + (item.weightGrams ? 1 : item.quantity), 0)}</span><strong>${currency(orderTotal(order))}</strong><span>${escapeHtml(paymentLabels[order.paymentMethod || 'unspecified'] || 'Não informado')}</span>${statusBadge(orderStateLabel(order), orderState(order) === 'received' ? 'warning' : orderState(order) === 'delivered' ? 'success' : orderState(order) === 'cancelled' ? 'neutral' : 'info', 'screen-badge')}</button>`).join('')}</div>` : feedback({ title: 'Nenhum pedido encontrado.', description: 'Ajuste os filtros ou registre um novo pedido.' });
    return `${intro('Acompanhamento', 'Pedidos', '', '<button class="screen-primary" type="button" data-new-order>+ Novo pedido</button>')}
      <div class="screen-metrics screen-metrics--compact">${metric('Pedidos ativos', active.length, 'Todos os períodos')}${metric('A conferir', pending, 'Pedem ação')}${metric('Valor ativo', currency(active.reduce((sum, order) => sum + orderTotal(order), 0)), 'Exclui cancelados')}</div>
      <section class="screen-panel"><div class="record-toolbar record-toolbar--orders"><label>Buscar<input id="orders-search" type="search" value="${escapeHtml(orderFilters.query)}" placeholder="Cliente, produto ou ID"></label><label>Cliente<select data-order-filter="customer"><option value="all">Todos</option>${customers.map(value => `<option value="${escapeHtml(value)}" ${orderFilters.customer === value ? 'selected' : ''}>${escapeHtml(formatCustomerName(value))}</option>`).join('')}</select></label><label>Status<select data-order-filter="status"><option value="all">Todos</option>${Object.entries({ received: 'A conferir', confirmed: 'Conferido', packing: 'Em separação', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' }).map(([value, label]) => `<option value="${value}" ${orderFilters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Pagamento<select data-order-filter="payment"><option value="all">Todos</option>${Object.entries(paymentLabels).filter(([value]) => value !== 'bank').map(([value, label]) => `<option value="${value}" ${orderFilters.payment === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><details class="staff-more-filters" data-more-filters ${orderFilters.expanded ? 'open' : ''}><summary>Mais filtros</summary><div class="staff-more-filters__panel"><label>De<input data-order-filter="from" type="date" value="${orderFilters.from}"></label><label>Até<input data-order-filter="to" type="date" value="${orderFilters.to}"></label><label>Ordenar<select data-order-filter="sort"><option value="newest">Mais recentes</option><option value="oldest" ${orderFilters.sort === 'oldest' ? 'selected' : ''}>Mais antigos</option><option value="value" ${orderFilters.sort === 'value' ? 'selected' : ''}>Maior valor</option></select></label></div></details></div>${rows}</section>`;
  },
  clientes: () => `${intro('Relacionamento', 'Clientes', 'Pedidos, saldo e pagamento de cada cliente.', live ? '' : '<button class="screen-primary" type="button" data-client-action="new">+ Novo cliente</button>')}${panel('', window.TrameliClients.render(storedOrders()))}`,
  produtos: () => `${intro('Catálogo', 'Produtos', 'Navegue pelo catálogo e abra cada produto para editar informações.', '<a class="staff-button staff-button--ghost" href="#loja">Ver portal ↗</a><button class="screen-primary" type="button" data-catalog-action="new">+ Produto</button>')}${productIntelligence()}${panel('Catálogo de produtos', window.TrameliCatalog.render())}`,
  agenda: () => {
    const groups = new Map();
    activeOrders().forEach(order => { const day = groups.get(order.date) || []; day.push(order); groups.set(order.date, day); });
    const days = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (!agendaState.selected || !groups.has(agendaState.selected)) agendaState.selected = groups.has(saoPauloToday()) ? saoPauloToday() : days[0]?.[0] || '';
    const selectedOrders = groups.get(agendaState.selected) || [];
    const orderRows = orders => `<div class="agenda-order-list">${orders.map(order => listRow({ title: formatCustomerName(order.customer), subtitle: `#${orderCode(order)} · ${order.items.length} ${order.items.length === 1 ? 'linha' : 'linhas'}`, avatar: '▣', value: currency(orderTotal(order)), badge: statusBadge(orderStateLabel(order), orderState(order) === 'received' ? 'warning' : orderState(order) === 'delivered' ? 'success' : 'info'), attributes: `data-open-order="${escapeHtml(order.id)}"` })).join('')}</div>`;
    const calendar = days.length ? `<div class="agenda-calendar">${days.map(([date, orders]) => `<button type="button" data-agenda-day="${date}" aria-pressed="${agendaState.selected === date}"><span>${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' })}</span><strong>${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</strong><small>${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}</small></button>`).join('')}</div><section class="agenda-selected"><div class="screen-panel__heading"><h2>${new Date(`${agendaState.selected}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2><span>${selectedOrders.length} pedidos</span></div>${orderRows(selectedOrders)}</section>` : empty('Nenhuma entrega programada.', 'Lançar pedido');
    const list = days.length ? `<div class="agenda-groups">${days.map(([date, orders]) => `<section><div><strong>${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong><span>${orders.length}</span></div>${orderRows(orders)}</section>`).join('')}</div>` : empty('Nenhuma entrega programada.', 'Lançar pedido');
    return `${intro('Planejamento', 'Agenda', 'Escolha um dia e abra apenas o pedido que deseja consultar.')}<div class="view-toggle" aria-label="Visualização da agenda"><button type="button" data-agenda-mode="calendar" aria-pressed="${agendaState.mode === 'calendar'}">Calendário</button><button type="button" data-agenda-mode="list" aria-pressed="${agendaState.mode === 'list'}">Lista</button></div><section class="screen-panel">${agendaState.mode === 'calendar' ? calendar : list}</section>`;
  },
  financeiro: () => {
    if (!financeRange.from && !financeRange.to) financeRange.from = financeRange.to = saoPauloToday();
    return `${intro('', 'Financeiro', '')}<div class="finance-presets" role="group" aria-label="Período financeiro">${[['1','Hoje'],['7','7 dias'],['15','15 dias']].map(([days,label]) => `<button type="button" data-finance-days="${days}" aria-pressed="${financeRange.period === days}">${label}</button>`).join('')}<button type="button" data-finance-custom aria-pressed="${financeRange.period === 'custom'}">Personalizado</button></div>
    <div class="report-filters finance-custom-dates" ${financeRange.period === 'custom' ? '' : 'hidden'}><label>De<input id="finance-from" type="date" value="${financeRange.from}"></label><label>Até<input id="finance-to" type="date" value="${financeRange.to}"></label></div><div id="finance-cost-summary" aria-live="polite"></div>`;
  },
  relatorios: () => {
    const allCustomers = new Map(activeOrders().map(order => [reportCustomerKey(order), { key: reportCustomerKey(order), name: order.customer }]));
    for (const entry of window.TrameliFinancialHistory?.entries() || []) {
      const profile = window.TrameliPayments?.api?.profiles?.find(p => p.user_id === entry.customer_id);
      if (profile && !allCustomers.has(entry.customer_id)) allCustomers.set(entry.customer_id, { key: entry.customer_id, name: profile.name });
    }
    const customers = [...allCustomers.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return `${intro('Documentos', 'Relatórios', 'Gere relatórios gerais ou filtre por um cliente específico.')}
      <section class="report-generator"><div class="report-generator__form"><label>Tipo de relatório<select id="report-type"><option value="financial" ${reportState.type === 'financial' ? 'selected' : ''}>Resumo financeiro</option><option value="sales" ${reportState.type === 'sales' ? 'selected' : ''}>Vendas</option><option value="customers" ${reportState.type === 'customers' ? 'selected' : ''}>Clientes</option><option value="billing" ${reportState.type === 'billing' ? 'selected' : ''}>Cobrança detalhada</option><option value="products" ${reportState.type === 'products' ? 'selected' : ''}>Produtos</option><option value="orders" ${reportState.type === 'orders' ? 'selected' : ''}>Pedidos</option><option value="deliveries" ${reportState.type === 'deliveries' ? 'selected' : ''}>Entregas</option></select></label><label>Período<select id="report-period"><option value="today" ${reportState.period === 'today' ? 'selected' : ''}>Hoje</option><option value="week" ${reportState.period === 'week' ? 'selected' : ''}>Últimos 7 dias</option><option value="fortnight" ${reportState.period === 'fortnight' ? 'selected' : ''}>Últimos 15 dias</option><option value="month" ${reportState.period === 'month' ? 'selected' : ''}>Últimos 30 dias</option><option value="custom" ${reportState.period === 'custom' ? 'selected' : ''}>Personalizado</option></select></label><label>Cliente<select id="report-customer"><option value="all" ${reportState.customer === 'all' ? 'selected' : ''}>Todos os clientes</option>${customers.map(customer => `<option value="${escapeHtml(customer.key)}" ${reportState.customer === customer.key ? 'selected' : ''}>${escapeHtml(formatCustomerName(customer.name))}</option>`).join('')}</select></label><div class="report-custom-dates" ${reportState.period === 'custom' ? '' : 'hidden'}><label>De<input id="report-from" type="date" value="${reportRange.from}"></label><label>Até<input id="report-to" type="date" value="${reportRange.to}"></label></div><button class="screen-primary" type="button" data-report-generate>Gerar relatório</button></div><div id="report-results" class="report-preview" aria-live="polite">${reportState.generated ? '' : '<div class="friendly-empty"><strong>Nenhum relatório gerado.</strong><span>Escolha um tipo, período e cliente para começar.</span></div>'}</div></section>`;
  },
  configuracoes: () => {
    const operation = readSettings(); let print = {};
    try { print = JSON.parse(localStorage.getItem('trameli-print-settings-70x33-v1') || '{}'); } catch { /* Defaults below. */ }
    const tabs = [['geral','Geral'],['aparencia','Aparência'],['pedidos','Pedidos'],['entregas','Entregas'],['pagamentos','Pagamentos'],['catalogo','Catálogo'],['impressao','Impressão'],['aplicativo','Aplicativo'],['acessos','Equipe e acessos'],['conta','Conta']];
    const content = {
      geral: `<form class="settings-form" data-settings-form="general"><label>Nome da operação<input name="businessName" value="${escapeHtml(operation.businessName || 'Pão Doce')}" maxlength="80"></label><label>WhatsApp da loja<input name="contact" type="tel" value="${escapeHtml(operation.contact || '')}" maxlength="24" placeholder="(34) 99999-9999"></label><small>Usado em dúvidas e comprovantes dos clientes.</small><div class="settings-row settings-row--motion"><span>Movimento da interface</span><button type="button" class="motion-toggle" aria-pressed="${!motionDisabled()}" ${systemReducedMotion.matches ? 'disabled' : ''}>${systemReducedMotion.matches ? 'Reduzido pelo sistema' : motionDisabled() ? 'Desativado' : 'Ativado'}</button></div><button class="screen-primary" type="submit">Salvar</button></form>`,
      aparencia: `<form class="settings-form settings-colors" data-settings-form="appearance"><label>Cor principal<input name="primaryColor" type="color" value="${escapeHtml(operation.primaryColor)}"></label><label>Cor de destaque<input name="accentColor" type="color" value="${escapeHtml(operation.accentColor)}"></label><label>Fundo claro<input name="surfaceColor" type="color" value="${escapeHtml(operation.surfaceColor)}"></label><button class="screen-primary" type="submit">Salvar aparência</button></form>`,
      pedidos: `<form class="settings-form" data-settings-form="orders"><label>Horário de virada operacional<input name="rolloverTime" type="time" value="${escapeHtml(operation.rolloverTime)}" required></label><p>A tela passa a priorizar o próximo dia somente quando os pedidos de hoje estiverem resolvidos.</p><label>Horário de corte do cliente<input name="cutoffTime" type="time" value="${escapeHtml(operation.cutoffTime || '21:00')}" required></label><small>O cliente pode criar, alterar ou cancelar pedidos até este horário no dia anterior à entrega.</small><button class="screen-primary" type="submit">Salvar</button></form>`,
      entregas: `<div class="settings-form"><label>Taxa padrão<input value="R$ 2,00" disabled></label><p>A taxa está protegida pelo cálculo dos pedidos para impedir divergências.</p></div>`,
      pagamentos: `<div class="settings-form"><h3>Meios aceitos</h3><label class="settings-check"><input type="checkbox" checked disabled> Pix</label><label class="settings-check"><input type="checkbox" checked disabled> Dinheiro</label><label class="settings-check"><input type="checkbox" checked disabled> Acordado com a proprietária</label><p>Transferência bancária não aparece mais no checkout.</p></div>`,
      catalogo: `<div class="settings-form"><p>Categorias, preços, custos, fotos e disponibilidade são gerenciados diretamente em Produtos.</p><a class="screen-primary" href="#produtos">Abrir produtos</a>${live?.role === 'master' ? '<button class="entity-danger" type="button" data-purge-orders>Excluir todos os pedidos de teste</button><small>Remove pedidos, pagamentos e fechamentos. Produtos e clientes permanecem.</small>' : ''}</div>`,
      impressao: `<form class="settings-form" data-settings-form="print"><label>Deslocamento horizontal (mm)<input name="offsetX" type="number" min="-3" max="3" step="0.5" value="${Number(print.offsetX || 0)}"></label><label>Deslocamento vertical (mm)<input name="offsetY" type="number" min="-3" max="3" step="0.5" value="${Number(print.offsetY || 0)}"></label><p>Folha adesiva A4 (210 × 297 mm): 27 etiquetas por folha, em 3 colunas × 9 linhas. Cada etiqueta mede 70 × 33 mm. Imprima em papel A4, em tamanho real (100%), sem “ajustar à página”, e desative cabeçalhos e rodapés do navegador. Use os deslocamentos para calibrar a posição do conteúdo sem alterar o tamanho das etiquetas.</p><button class="screen-primary" type="submit">Salvar</button></form>`,
      aplicativo: window.TrameliNotifications?.renderPwaSettings?.('operator')
        || '<div class="friendly-empty"><strong>Aplicativo indisponível.</strong><span>Recarregue a página para carregar os recursos do PWA.</span></div>',
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
    host.innerHTML = feedback({ title: 'Confira o período', description: 'A data inicial precisa ser anterior à data final.', kind: 'error' });
    return;
  }
  const rangedOrders = inRange(activeOrders(), from, to);
  const orders = rangedOrders.filter(order => reportState.customer === 'all' || reportCustomerKey(order) === reportState.customer);
  const historical = ['financial','billing'].includes(reportState.type)
    ? (window.TrameliFinancialHistory?.period(from,to) || []).filter(item => reportState.customer === 'all' || item.customer_id === reportState.customer)
    : [];
  const historicSums = window.TrameliFinancialHistory?.sums(historical) || { total:0, paid:0, due:0 };
  const total = orders.reduce((sum, order) => sum + orderTotal(order), 0) + historicSums.total;
  const title = ({ financial: 'Resumo financeiro', sales: 'Vendas', customers: 'Clientes', billing: 'Cobrança detalhada', products: 'Produtos', orders: 'Pedidos', deliveries: 'Entregas' })[reportState.type];
  const period = reportPeriodLabel();
  reportBillingCustomers = [];
  let detail = '';
  if (reportState.type === 'customers') {
    const rows = new Map();
    orders.forEach(order => { const key = reportCustomerKey(order); const row = rows.get(key) || { name: order.customer, count: 0, total: 0 }; row.count++; row.total += orderTotal(order); rows.set(key, row); });
    detail = `<div class="report-table">${[...rows.values()].sort((a, b) => b.total - a.total).map(row => `<div><strong>${escapeHtml(formatCustomerName(row.name))}</strong><span>${row.count} pedidos</span><strong>${currency(row.total)}</strong></div>`).join('')}</div>`;
  } else if (reportState.type === 'billing') {
    const balances = window.TrameliPayments?.api?.balances || [];
    const balanceByOrder = new Map(balances.map(row => [row.order_id, row]));
    const customers = new Map();
    orders.forEach(order => {
      const key = reportCustomerKey(order);
      const entry = customers.get(key) || { key, name: order.customer, orders: [], total: 0, paid: 0, due: 0, reconciled: true };
      const balance = balanceByOrder.get(order.id);
      const orderValue = orderTotal(order);
      const paid = balance ? Number(balance.paid_cents || 0) : 0;
      const due = balance ? Number(balance.due_cents || 0) : orderValue;
      entry.orders.push({ order, paid, due, reconciled: Boolean(balance) });
      entry.total += orderValue; entry.paid += paid; entry.due += due;
      if (!balance) entry.reconciled = false;
      customers.set(key, entry);
    });
    for (const item of historical) {
      const key=item.customer_id;
      const profile=window.TrameliPayments?.api?.profiles?.find(p => p.user_id===key);
      const entry=customers.get(key) || { key, name:profile?.name||item.original_name, orders:[], history:[], total:0, paid:0, due:0, reconciled:true };
      entry.history ||= [];
      entry.history.push(item);
      entry.total += Number(item.amount_cents);
      if(item.status==='paid') entry.paid += Number(item.amount_cents); else entry.due += Number(item.amount_cents);
      customers.set(key,entry);
    }
    const sortedCustomers = [...customers.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    reportBillingCustomers = sortedCustomers;
    const cards = sortedCustomers.map(customer => {
      const orderRows = customer.orders.slice().sort((a, b) => a.order.date.localeCompare(b.order.date)).map(({ order, paid, due, reconciled }) => {
        const paymentStatus = !reconciled ? 'A conferir' : due <= 0 ? 'Pago' : paid > 0 ? 'Parcial' : 'Em aberto';
        const items = order.items.map(item => {
          const lineTotal = item.weightGrams ? Number(item.priceCents || 0) : Number(item.quantity || 0) * Number(item.priceCents || 0);
          return `<li><span>${escapeHtml(window.TrameliOrderMath.itemLabel(item))}</span><strong>${currency(lineTotal)}</strong></li>`;
        }).join('');
        return `<section class="billing-order"><header><div><strong>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</strong><small>#${escapeHtml(orderCode(order))} · vence ${new Date(`${billingDeadlineForDelivery(order.date)}T12:00:00`).toLocaleDateString('pt-BR')}</small></div><span class="screen-badge ${due <= 0 ? 'screen-badge--green' : 'screen-badge--amber'}">${paymentStatus}</span></header><ul>${items}</ul><footer><span>Total <strong>${currency(orderTotal(order))}</strong></span><span>Pago <strong>${currency(paid)}</strong></span><span>Em aberto <strong>${currency(due)}</strong></span></footer></section>`;
      }).join('');
      const historicalRows = (customer.history || []).map(item => {
        const paid=item.status==='paid'?Number(item.amount_cents):0;
        const due=item.status==='paid'?0:Number(item.amount_cents);
        return `<section class="billing-order"><header><div><strong>${new Date(`${item.entry_date}T12:00:00`).toLocaleDateString('pt-BR')}</strong><small>Histórico financeiro (sem produtos)</small></div><span class="screen-badge ${due===0?'screen-badge--green':'screen-badge--amber'}">${due===0?'Pago':'Em aberto'}</span></header><ul><li><span>Lançamento anterior ao aplicativo</span><strong>${currency(item.amount_cents)}</strong></li></ul><footer><span>Total <strong>${currency(item.amount_cents)}</strong></span><span>Pago <strong>${currency(paid)}</strong></span><span>Em aberto <strong>${currency(due)}</strong></span></footer></section>`;
      }).join('');
      return `<article class="billing-customer" data-billing-customer="${escapeHtml(customer.key)}"><header class="billing-customer__head"><label><input type="checkbox" data-billing-select value="${escapeHtml(customer.key)}" checked> <span><strong>${escapeHtml(formatCustomerName(customer.name))}</strong><small>${customer.orders.length} ${customer.orders.length === 1 ? 'pedido' : 'pedidos'} no período${(customer.history||[]).length ? ` · ${(customer.history||[]).length} histórico(s)` : ''}</small></span></label><button type="button" data-billing-only="${escapeHtml(customer.key)}">PDF deste cliente</button></header><div class="billing-customer__totals"><span>Compras <strong>${currency(customer.total)}</strong></span><span>Pago <strong>${currency(customer.paid)}</strong></span><span>Em aberto <strong>${currency(customer.due)}</strong></span></div>${customer.reconciled ? '' : '<p class="report-note">Há pedido sem saldo conciliado; confira o Financeiro antes de cobrar.</p>'}${orderRows}${historicalRows}</article>`;
    }).join('');
    detail = `<div class="billing-toolbar"><div><strong>Quem vai no PDF?</strong><span>Marque um, vários ou todos os clientes.</span></div><button type="button" data-billing-select-all>Selecionar todos</button><button type="button" data-billing-clear>Limpar seleção</button></div><div class="billing-report-customers">${cards}</div>`;
  } else if (reportState.type === 'financial') {
    detail = `<div class="report-table">${orders.slice().sort((a, b) => b.date.localeCompare(a.date)).map(order => `<div><strong>#${escapeHtml(orderCode(order))} · ${escapeHtml(formatCustomerName(order.customer))}</strong><span>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')} · Pedido</span><strong>${currency(orderTotal(order))}</strong></div>`).join('')}${historical.map(e => `<div><strong>${escapeHtml(window.TrameliPayments?.api?.profiles?.find(p=>p.user_id===e.customer_id)?.name || e.original_name)}</strong><span>${new Date(`${e.entry_date}T12:00:00`).toLocaleDateString('pt-BR')} · Histórico financeiro · ${e.status==='paid'?'Pago':'Pendente'}</span><strong>${currency(e.amount_cents)}</strong></div>`).join('')}</div>`;
  } else if (reportState.type === 'products') {
    const rows = new Map();
    orders.forEach(order => order.items.forEach(item => { const row = rows.get(item.name) || { quantity: 0, total: 0 }; row.quantity += item.weightGrams ? 1 : item.quantity; row.total += item.quantity * item.priceCents; rows.set(item.name, row); }));
    detail = `<div class="report-table">${[...rows.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, row]) => `<div><strong>${escapeHtml(name)}</strong><span>${row.quantity} itens</span><strong>${currency(row.total)}</strong></div>`).join('')}</div>`;
  } else {
    detail = `<div class="report-table">${orders.slice().sort((a, b) => b.date.localeCompare(a.date)).map(order => `<div><strong>#${escapeHtml(orderCode(order))} · ${escapeHtml(formatCustomerName(order.customer))}</strong><span>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')} · ${orderStateLabel(order)}</span><strong>${currency(orderTotal(order))}</strong></div>`).join('')}</div>`;
  }
  const body = `<article class="generated-report"><header><div><span>PÃO DOCE · RELATÓRIO</span><h2>${title}</h2><p>${period}</p></div><strong>${orders.length} pedidos · ${historical.length} históricos</strong></header><div class="report-summary"><div><span>Pedidos</span><strong>${orders.length}</strong></div>${['billing','financial'].includes(reportState.type) ? `<div><span>Histórico financeiro</span><strong>${currency(historicSums.total)}</strong></div><div><span>Histórico em aberto</span><strong>${currency(historicSums.due)}</strong></div>` : ''}<div><span>Valor total</span><strong>${currency(total)}</strong></div></div>${orders.length || historical.length ? detail : '<div class="friendly-empty"><strong>Nenhum dado neste período.</strong><span>Escolha outro intervalo para gerar o relatório.</span></div>'}</article>`;
  host.innerHTML = `${body}<div class="report-actions"><button class="screen-primary" type="button" data-report-print ${orders.length || historical.length ? '' : 'disabled'}>Baixar PDF</button><button type="button" data-report-generate>Atualizar relatório</button></div>`;
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
    const history = window.TrameliFinancialHistory?.period(from, to) || [];
    const historyTotals = window.TrameliFinancialHistory?.sums(history) || {total:0,paid:0,due:0};
    const received = balances.reduce((sum, row) => sum + Number(row.paid_cents || 0), 0) + historyTotals.paid;
    const due = balances.reduce((sum, row) => sum + Number(row.due_cents || 0), 0) + historyTotals.due;
    const days = new Map();
    orders.forEach(order => days.set(order.date, (days.get(order.date) || 0) + orderTotal(order)));
    history.forEach(entry => days.set(entry.entry_date, (days.get(entry.entry_date) || 0) + Number(entry.amount_cents)));
    const bars = revenueChart([...days.entries()], currency);
    return `<div class="finance-headline">${metric('Vendas + histórico', currency(summary.customerCents + summary.deliveryCents + historyTotals.total), `${orders.length} pedidos · ${history.length} registros financeiros`)}${metric('Recebido', live ? currency(received) : '—', live ? 'Recebimentos conferidos' : 'Requer conexão')}${metric('Em aberto', live ? currency(due) : '—', live ? `${balances.filter(row => Number(row.due_cents) > 0).length} pedidos · ${history.filter(e=>e.status==='pending').length} históricos` : 'Requer conexão')}${metric('Lucro bruto', summary.profitCents === null ? 'Pendente' : currency(summary.profitCents), summary.profitCents === null ? 'Há custo realmente ausente' : 'Produtos vendidos − custo da padaria')}</div><div class="finance-charts"><section><div class="screen-panel__heading"><h2>Pedidos + lançamentos históricos por dia</h2></div>${bars}</section><section><div class="screen-panel__heading"><h2>Recebido × em aberto</h2></div>${live ? balanceProgress(received, due, currency) : feedback({ title: 'Conecte a operação.', description: 'Os recebimentos aparecem quando a conexão está disponível.' })}</section></div><details class="finance-help"><summary>Como estes valores são calculados?</summary><p>${escapeHtml(note)}</p><p>Taxas de entrega no período: ${currency(summary.deliveryCents)}. Elas não entram no lucro bruto dos produtos.</p></details>`;
  };
  const request = ++costRequest;
  if (from && to && from > to) {
    host.innerHTML = feedback({ title: 'Confira o período', description: 'A data inicial precisa ser anterior à data final.', kind: 'error' });
    return;
  }
  if (!live?.operator) {
    host.innerHTML = overview(initial, 'Custos, recebimentos e lucro confiável ficam disponíveis somente na conta da operação conectada.');
    return;
  }
  host.innerHTML = feedback({ title: 'Carregando resumo financeiro', description: 'Consultando os custos dos pedidos.', kind: 'loading' });
  try {
    const rows = await live.costSummary(from, to);
    if (request !== costRequest || !document.getElementById(hostId)) return;
    const summary = financeMath.summarizeFinancials(orders, rows);
    const note = summary.missingItems
      ? `${summary.missingItems} ${summary.missingItems === 1 ? 'item está sem custo' : 'itens estão sem custo'}${summary.estimatedItems ? ` e ${summary.estimatedItems} com custo estimado` : ''}. O valor da padaria é parcial; não feche o lucro nem o repasse com este total.`
      : summary.estimatedItems
        ? `Lucro bruto calculado com os custos atualmente cadastrados no catálogo. ${summary.estimatedItems} ${summary.estimatedItems === 1 ? 'item veio de pedido antigo' : 'itens vieram de pedidos antigos'}.`
        : 'Lucro bruto dos produtos = valor dos clientes − valor da padaria. Recebimento e lucro são indicadores separados.';
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
const persistentNavigation = matchMedia('(min-width: 1024px)');
const sidebarStorageKey = 'trameli-sidebar-collapsed-v1';

function sidebarIsCollapsed() {
  return document.body.classList.contains('sidebar-collapsed');
}

function setSidebarCollapsed(collapsed, persist = true) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
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
  const isShirleyPortal = route === 'portal-shirley';
  portalView.hidden = !isPortal;
  shirleyPortalView.hidden = !isShirleyPortal;
  appShell.hidden = isPortal;
  document.body.classList.toggle('portal-mode', isPortal);
  document.body.classList.toggle('staff-mode', !isPortal);
  document.body.classList.toggle('shirley-portal-mode', isShirleyPortal);
  if (isPortal) {
    document.title = `Peça para amanhã — ${readSettings().businessName}`;
    navigation.forEach(link => {
      const active = link.getAttribute('href') === `#${route}`;
      link.classList.toggle('btn', active);
      link.classList.toggle('lnk', !active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    setMenu(false);
    if (!preserveScroll) motion.scrollTo(0, false);
    activeRoute = route;
    window.dispatchEvent(new Event('trameli:portal-open'));
    window.dispatchEvent(new CustomEvent('trameli:route-rendered', { detail: { route } }));
    return;
  }
  const isHome = route === 'inicio';
  const isOperation = route === 'operacao';
  homeView.hidden = !isHome;
  operationView.hidden = !isOperation;
  screenView.hidden = isHome || isOperation || isShirleyPortal;
  if (!isHome && !isOperation && !isShirleyPortal) { motion.reset(screenView); screenView.innerHTML = pages[route](); }
  if (isShirleyPortal) window.dispatchEvent(new Event('trameli:shirley-portal-open'));
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
        if (panel && settingsTab === 'acessos') panel.outerHTML = window.TrameliAccount.renderMfa();
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
  window.dispatchEvent(new CustomEvent('trameli:route-rendered', { detail: { route } }));
}

function animateRouteIn(route) {
  if (motionDisabled()) return;
  motion.enter(route === 'inicio' ? homeView : route === 'operacao' ? operationView : route === 'portal-shirley' ? shirleyPortalView : screenView);
}

function showRoute(force = false) {
  // Normalize a rota antes de qualquer listener do portal sincronizar o frame.
  // Renderizar a loja mantendo um hash interno fazia o próximo listener expor
  // a sidebar e ocultar o portal, deixando o cliente em uma tela vazia.
  if (live && !live.operator && location.hash !== '#loja') {
    history.replaceState(history.state, '', `${location.pathname}${location.search}#loja`);
  }
  const requested = decodeURIComponent(location.hash.slice(1)) || 'loja';
  const route = live && !live.operator ? 'loja' : routes.has(requested) ? requested : 'loja';
  if (route === activeRoute && !force) { ++routeRevision; motion.cancelTransition(); setMenu(false); return; }
  const revision = ++routeRevision;
  const previous = activeRoute;
  const finish = () => { if (revision !== routeRevision) return; renderRoute(route, force && previous === route); if (previous !== null && !force && route !== 'loja') animateRouteIn(route); else motion.refresh(); };
  if (previous !== null && previous !== 'loja' && route !== 'loja' && !force && !motionDisabled()) {
    const outgoing = previous === 'inicio' ? homeView : previous === 'operacao' ? operationView : previous === 'portal-shirley' ? shirleyPortalView : screenView;
    const style = ({ inicio: 'curve', operacao: 'swipe', pedidos: 'swipe', clientes: 'swipe', produtos: 'diagonal', agenda: 'wave', financeiro: 'curve', relatorios: 'diagonal', configuracoes: 'wave', pendencias: 'curve', notificacoes: 'curve' })[route] || 'curve';
    motion.leave(outgoing, finish, { style });
  } else { motion.cancelTransition(); finish(); }
}

function setReportPeriod() {
  const to = saoPauloToday();
  if (reportState.period === 'today') reportRange.from = reportRange.to = to;
  if (reportState.period === 'week') { reportRange.from = shiftDate(to, -6); reportRange.to = to; }
  if (reportState.period === 'fortnight') { reportRange.from = shiftDate(to, -14); reportRange.to = to; }
  if (reportState.period === 'month') { reportRange.from = shiftDate(to, -29); reportRange.to = to; }
}

const globalSearchInput = document.getElementById('global-search-input');
const globalSearchResults = document.getElementById('global-search-results');
function renderGlobalSearch() {
  const query = normalizeSearch(globalSearchInput.value);
  if (query.length < 2) { globalSearchResults.hidden = true; globalSearchInput.setAttribute('aria-expanded', 'false'); return; }
  const orders = storedOrders().filter(order => [order.id, order.customer, ...order.items.map(item => item.name)].some(value => normalizeSearch(value).includes(query))).slice(0, 4);
  const clients = [...new Set([...window.TrameliClients.list().map(client => client.name), ...storedOrders().map(order => order.customer)])].filter(name => normalizeSearch(name).includes(query)).slice(0, 4);
  const products = (window.TrameliCatalog?.list() || []).filter(product => normalizeSearch(product.name).includes(query)).slice(0, 4);
  const group = (title, rows) => rows.length ? `<section><h3>${title}</h3>${rows.join('')}</section>` : '';
  globalSearchResults.innerHTML = group('Pedidos', orders.map(order => `<button type="button" data-global-order="${escapeHtml(order.id)}"><span>#${escapeHtml(orderCode(order))} · ${escapeHtml(formatCustomerName(order.customer))}</span><small>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</small></button>`)) + group('Clientes', clients.map(name => `<button type="button" data-global-client="${escapeHtml(name)}"><span>${escapeHtml(formatCustomerName(name))}</span><small>Abrir clientes</small></button>`)) + group('Produtos', products.map(product => `<button type="button" data-global-product="${escapeHtml(product.id)}"><span>${escapeHtml(product.name)}</span><small>${currency(product.priceCents)}</small></button>`)) || '<p>Nenhum resultado encontrado.</p>';
  globalSearchResults.hidden = false;
  globalSearchInput.setAttribute('aria-expanded', 'true');
}

try { setSidebarCollapsed(localStorage.getItem(sidebarStorageKey) === 'true', false); } catch { setSidebarCollapsed(false, false); }
menuButtons.forEach(button => button.addEventListener('click', () => {
  if (navigationIsPersistent() && button.classList.contains('mobile-menu-button')) setSidebarCollapsed(!sidebarIsCollapsed());
  else setMenu(!document.body.classList.contains('menu-open'));
}));
menuOverlay.addEventListener('click', () => setMenu(false));
navigation.forEach(link => link.addEventListener('click', () => setMenu(false)));
persistentNavigation.addEventListener('change', () => {
  setMenu(false);
  if (!persistentNavigation.matches) return;
  try { setSidebarCollapsed(localStorage.getItem(sidebarStorageKey) === 'true', false); } catch { setSidebarCollapsed(false, false); }
});
menuPanel.addEventListener('click', event => {
  if (event.target.closest('a, button, input, select, textarea, [role="button"]')) return;
  if (navigationIsPersistent() && sidebarIsCollapsed()) setSidebarCollapsed(false);
});
menuPanel.addEventListener('keydown', event => {
  if (event.target !== menuPanel || !navigationIsPersistent() || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  setSidebarCollapsed(false);
});
document.addEventListener('click', event => {
  if (menuPanel.contains(event.target) || event.target.closest('.mobile-menu-button, .portal-menu-button')) return;
  if (navigationIsPersistent() && !sidebarIsCollapsed()) setSidebarCollapsed(true);
  else if (!navigationIsPersistent() && document.body.classList.contains('menu-open')) setMenu(false);
});
window.addEventListener('hashchange', () => showRoute());
document.querySelector('.notification-button').addEventListener('click', () => { location.hash = 'notificacoes'; });
document.addEventListener('click', async event => {
  // Ações delegadas da operação não recebem cliques da loja, nem de clientes.
  if ((live && !live.operator) || event.target.closest('#portal-view, #portal-floating-host, #portal-success-screen')) return;
  if (event.target.closest('[data-finance-custom]')) { financeRange.period = 'custom'; showRoute(true); return; }
  const openOrder = event.target.closest('[data-open-order]');
  if (openOrder) { window.TrameliOperation?.openOrder(openOrder.dataset.openOrder); return; }
  const newOrder = event.target.closest('[data-new-order]');
  if (newOrder && appShell.contains(newOrder)) { location.hash = '#portal-shirley'; return; }
  const agendaMode = event.target.closest('[data-agenda-mode]');
  if (agendaMode) { agendaState.mode = agendaMode.dataset.agendaMode; showRoute(true); return; }
  const agendaDay = event.target.closest('[data-agenda-day]');
  if (agendaDay) { agendaState.selected = agendaDay.dataset.agendaDay; showRoute(true); return; }
  const settingsButton = event.target.closest('[data-settings-tab]');
  if (settingsButton) { settingsTab = settingsButton.dataset.settingsTab; showRoute(true); return; }
  const reportGenerate = event.target.closest('[data-report-generate]');
  if (reportGenerate) {
    reportGenerate.disabled = true;
    const originalLabel = reportGenerate.textContent;
    reportGenerate.textContent = 'Gerando...';
    try {
      reportState.type = document.getElementById('report-type')?.value || reportState.type;
      reportState.period = document.getElementById('report-period')?.value || reportState.period;
      reportState.customer = document.getElementById('report-customer')?.value || 'all';
      if (reportState.period !== 'custom') setReportPeriod();
      else { reportRange.from = document.getElementById('report-from')?.value || ''; reportRange.to = document.getElementById('report-to')?.value || ''; }
      if (live) await live.load(true);
      if (reportState.type === 'billing') await window.TrameliPayments?.refresh?.();
      reportState.generated = true;
      renderReportResults();
    } catch (cause) {
      const host = document.getElementById('report-results');
      if (host) host.innerHTML = feedback({ title: 'Não foi possível gerar o relatório.', description: cause.message || 'Tente novamente.', kind: 'error' });
    } finally {
      reportGenerate.disabled = false;
      reportGenerate.textContent = originalLabel;
    }
    return;
  }
  const billingAll = event.target.closest('[data-billing-select-all]');
  if (billingAll) { document.querySelectorAll('[data-billing-select]').forEach(input => { input.checked = true; }); return; }
  const billingClear = event.target.closest('[data-billing-clear]');
  if (billingClear) { document.querySelectorAll('[data-billing-select]').forEach(input => { input.checked = false; }); return; }
  const billingOnly = event.target.closest('[data-billing-only]');
  if (billingOnly) {
    document.querySelectorAll('[data-billing-select]').forEach(input => { input.checked = input.value === billingOnly.dataset.billingOnly; });
    document.querySelector('[data-report-print]')?.click();
    return;
  }
  const reportPrint = event.target.closest('[data-report-print]');
  if (reportPrint) {
    let preview = document.querySelector('#report-results .generated-report');
    if (!preview) return;
    let clone = preview.cloneNode(true);
    let selectedBillingKeys = null;
    if (reportState.type === 'billing') {
      const selected = new Set([...document.querySelectorAll('[data-billing-select]:checked')].map(input => input.value));
      if (!selected.size) { alert('Selecione ao menos um cliente para gerar o PDF.'); return; }
      selectedBillingKeys = selected;
      clone.querySelectorAll('[data-billing-customer]').forEach(card => { if (!selected.has(card.dataset.billingCustomer)) card.remove(); });
      clone.querySelectorAll('.billing-toolbar, [data-billing-only], [data-billing-select]').forEach(node => node.remove());
    }
    reportPrint.disabled = true;
    const originalLabel = reportPrint.textContent;
    reportPrint.textContent = 'Preparando PDF...';
    try {
      const title = ({ financial: 'Resumo financeiro', sales: 'Vendas', customers: 'Clientes', billing: 'Cobrança detalhada', products: 'Produtos', orders: 'Pedidos', deliveries: 'Entregas' })[reportState.type];
      const period = reportPeriodLabel();
      const { downloadReportPdf } = await import('../src/report-pdf.js');
      await downloadReportPdf({
        title,
        period,
        text: clone.innerText,
        billingCustomers: reportState.type === 'billing' ? reportBillingCustomers.filter(customer => selectedBillingKeys?.has(customer.key)).map(customer => ({
          name: customer.name, totalCents: customer.total, paidCents: customer.paid, dueCents: customer.due,
          orders: customer.orders.map(({ order, paid, due, reconciled }) => ({
            date: order.date, code: orderCode(order), dueDate: billingDeadlineForDelivery(order.date),
            status: !reconciled ? 'A conferir' : due <= 0 ? 'Pago' : paid > 0 ? 'Parcial' : 'Em aberto',
            totalCents: orderTotal(order), paidCents: paid, dueCents: due,
            items: order.items.map(item => ({ label: window.TrameliOrderMath.itemLabel(item), amountCents: item.weightGrams ? Number(item.priceCents || 0) : Number(item.quantity || 0) * Number(item.priceCents || 0) })),
          })).concat((customer.history || []).map(entry => ({
            date: entry.entry_date, code: 'HIST', dueDate: billingDeadlineForDelivery(entry.entry_date),
            status: entry.status === 'paid' ? 'Pago' : 'Em aberto',
            totalCents: Number(entry.amount_cents),
            paidCents: entry.status === 'paid' ? Number(entry.amount_cents) : 0,
            dueCents: entry.status === 'paid' ? 0 : Number(entry.amount_cents),
            items: [{ label: 'Histórico financeiro (sem produtos discriminados)', amountCents: Number(entry.amount_cents) }],
          }))),
        })) : null,
        businessName: readSettings().businessName || 'Pão Doce',
        filename: `trameli-${reportState.type}-${reportRange.from || 'inicio'}-${reportRange.to || saoPauloToday()}`,
      });
    } catch (cause) {
      alert(`Não foi possível baixar o PDF: ${cause.message || 'erro inesperado'}`);
    } finally {
      reportPrint.disabled = false;
      reportPrint.textContent = originalLabel;
    }
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
    financeRange.period = String(days);
    financeRange.from = shiftDate(to, 1 - days);
    financeRange.to = to;
    const fromInput = document.getElementById('finance-from'), toInput = document.getElementById('finance-to');
    if (fromInput && toInput) { fromInput.value = financeRange.from; toInput.value = financeRange.to; }
    document.querySelector('.finance-custom-dates').hidden = true;
    document.querySelectorAll('[data-finance-days], [data-finance-custom]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.financeDays === financeRange.period)));
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
document.addEventListener('toggle', event => {
  if (event.target.matches('[data-more-filters]')) orderFilters.expanded = event.target.open;
}, true);
document.addEventListener('change', event => {
  const orderFilter = event.target.closest('[data-order-filter]');
  if (orderFilter) { orderFilters[orderFilter.dataset.orderFilter] = orderFilter.value; showRoute(true); return; }
  if (event.target.id === 'report-period') {
    reportState.period = event.target.value;
    const custom = document.querySelector('.report-custom-dates');
    if (custom) custom.hidden = reportState.period !== 'custom';
  }
  if (event.target.id === 'report-type') reportState.type = event.target.value;
  if (event.target.id === 'report-customer') {
    reportState.customer = event.target.value;
    if (reportState.generated) renderReportResults();
  }
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
      const values = form.dataset.settingsForm === 'orders' ? { rolloverTime: data.get('rolloverTime'), cutoffTime: data.get('cutoffTime') }
        : form.dataset.settingsForm === 'appearance' ? { primaryColor: data.get('primaryColor'), accentColor: data.get('accentColor'), surfaceColor: data.get('surfaceColor') }
          : { businessName: data.get('businessName'), contact: data.get('contact') };
      if (form.dataset.settingsForm === 'general' && values.contact) {
        const digits = String(values.contact).replace(/\D/g, '').replace(/^0+/, '');
        if (![10,11,12,13].includes(digits.length)) throw new Error('Informe o WhatsApp da loja com DDD.');
      }
      const next = { ...current, ...values };
      if (live) {
        await window.TrameliAccount?.ensureMasterAal2?.();
        await live.saveSettings(next);
      } else localStorage.setItem('trameli-operation-settings-v1', JSON.stringify(next));
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
  try { await window.TrameliAccount?.ensureMasterAal2?.(); const count = await live.purgeTestOrders(); alert(`${count} pedidos de teste foram excluídos.`); showRoute(true); }
  catch (cause) { alert(`Não foi possível limpar a base: ${cause.message}`); }
  finally { button.disabled = false; }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (navigationIsPersistent()) setSidebarCollapsed(true);
  else setMenu(false);
});
showRoute();

document.addEventListener('keydown', event => { if (event.target.matches('tr[data-open-order]') && ['Enter',' '].includes(event.key)) { event.preventDefault(); event.target.click(); } });
