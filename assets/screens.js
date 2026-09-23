const homeView = document.getElementById('home-view');
const operationView = document.getElementById('operation-view');
const screenView = document.getElementById('screen-view');
const navigation = [...document.querySelectorAll('.nav__item')];
const routes = new Set(['operacao', 'inicio', 'pedidos', 'clientes', 'produtos', 'agenda', 'financeiro', 'relatorios', 'configuracoes']);
const systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let userReducedMotion = false;
try { userReducedMotion = localStorage.getItem('trameli-reduced-motion') === 'true'; } catch { /* Storage may be unavailable on file URLs. */ }
const motionDisabled = () => systemReducedMotion.matches || userReducedMotion;

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
const orderTotal = order => order.items.reduce((sum, item) => sum + item.quantity * item.priceCents, order.feeCents);

function storedOrders() {
  try {
    const parsed = JSON.parse(localStorage.getItem('trameli-operation-draft-v2') || '[]');
    return Array.isArray(parsed) ? parsed.filter(order => order && Array.isArray(order.items)) : [];
  } catch { return []; }
}

document.getElementById('today-date').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date());

function updateOverview() {
  const orders = storedOrders();
  const nextDay = orders.filter(order => order.date === tomorrow());
  const pending = nextDay.filter(order => !order.checked).length;
  const total = nextDay.reduce((sum, order) => sum + orderTotal(order), 0);
  document.getElementById('operational-message').textContent = nextDay.length
    ? `${nextDay.length} ${nextDay.length === 1 ? 'pedido registrado' : 'pedidos registrados'} para amanhã.`
    : 'Ainda não há pedidos registrados para amanhã.';
  document.getElementById('home-order-count').textContent = nextDay.length;
  document.getElementById('home-pending-count').textContent = pending;
  document.getElementById('home-order-total').textContent = currency(total);
  document.getElementById('attention-pending-orders').textContent = `${pending} ${pending === 1 ? 'pedido' : 'pedidos'}`;
  const count = document.getElementById('nav-pending-count');
  count.textContent = pending;
  count.hidden = pending === 0;
  count.setAttribute('aria-label', `${pending} pedidos precisam de atenção`);
  document.querySelector('.notification-button').setAttribute('aria-label', pending ? `${pending} pedidos precisam de atenção` : 'Nenhum pedido pendente');
  document.querySelector('.notification-dot').hidden = pending === 0;
  document.querySelector('.attention-strip').hidden = pending === 0;
  const rows = document.getElementById('home-recent-orders');
  rows.innerHTML = nextDay.slice(-5).reverse().map(order => `<tr><td>—</td><td>${escapeHtml(order.customer)}</td><td>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</td><td>${order.checked ? 'Conferido' : 'A conferir'}</td><td>${currency(orderTotal(order))}</td></tr>`).join('');
  document.getElementById('home-orders-empty').hidden = nextDay.length > 0;
}
updateOverview();
window.addEventListener('trameli:orders-changed', () => {
  updateOverview();
  if (['#pedidos', '#clientes', '#agenda', '#financeiro', '#relatorios'].includes(location.hash)) showRoute(true);
});
window.addEventListener('trameli:catalog-changed', () => { if (location.hash === '#produtos') showRoute(true); });
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

const pages = {
  pedidos: () => {
    const orders = storedOrders().slice().sort((a, b) => b.date.localeCompare(a.date));
    const pending = orders.filter(order => !order.checked).length;
    const list = orders.length ? `<div class="screen-records">${orders.map(order => `<article class="screen-order-row"><div class="screen-order-row__primary"><span class="screen-kicker">${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</span><strong>${escapeHtml(order.customer)}</strong><small>${order.items.map(item => `${item.quantity}× ${escapeHtml(item.name)}`).join(' · ')}</small></div><div class="screen-order-row__delivery"><span>Endereço</span><strong>${escapeHtml(order.address)}</strong></div><div class="screen-order-row__amount"><strong>${currency(orderTotal(order))}</strong><span class="screen-badge screen-badge--${order.checked ? 'green' : 'neutral'}">${order.checked ? 'Conferido' : 'A conferir'}</span></div></article>`).join('')}</div>` : empty('Nenhum pedido cadastrado. Os pedidos lançados na Operação diária aparecerão aqui.', 'Lançar pedido');
    return `${intro('Acompanhamento', 'Pedidos', 'Uma visão dos pedidos lançados na operação.')}
      <div class="screen-metrics">${metric('Pedidos', orders.length, 'No navegador')}${metric('A conferir', pending, 'Ainda pendentes')}${metric('Total', currency(orders.reduce((sum, order) => sum + orderTotal(order), 0)), 'Valor dos pedidos')}</div>
      ${panel('Todos os pedidos', list)}`;
  },
  clientes: () => `${intro('Relacionamento', 'Clientes', 'Cadastre clientes para reutilizar nome e endereço nos próximos pedidos. Contas do portal virão depois.')}${panel('Clientes', window.TrameliClients.render(storedOrders()))}`,
  produtos: () => `${intro('Catálogo', 'Produtos', 'Cadastre os itens e preços confirmados. Eles ficarão disponíveis no lançamento de pedidos.')}${panel('Catálogo de produtos', window.TrameliCatalog.render())}`,
  agenda: () => {
    const groups = new Map();
    storedOrders().forEach(order => { const day = groups.get(order.date) || []; day.push(order); groups.set(order.date, day); });
    const days = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return `${intro('Planejamento', 'Agenda', 'Pedidos agrupados pela data de entrega. Horários ainda não são registrados.')}
      <div class="screen-metrics">${metric('Datas com pedidos', days.length, 'No navegador')}${metric('Pedidos', storedOrders().length, 'A entregar ou conferir')}</div>
      ${panel('Entregas por dia', days.length ? `<div class="agenda-days">${days.map(([date, orders]) => `<section class="agenda-day"><h3>${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3><span>${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}</span><ul>${orders.map(order => `<li><strong>${escapeHtml(order.customer)}</strong><small>${escapeHtml(order.address)}</small><span>${order.checked ? 'Conferido' : 'A conferir'}</span></li>`).join('')}</ul></section>`).join('')}</div>` : empty('Nenhuma data com pedidos. Ao lançar um pedido, ele aparecerá no dia escolhido.', 'Lançar pedido'))}`;
  },
  financeiro: () => {
    const orders = storedOrders();
    const products = orders.reduce((sum, order) => sum + order.items.reduce((subtotal, item) => subtotal + item.quantity * item.priceCents, 0), 0);
    const fees = orders.reduce((sum, order) => sum + order.feeCents, 0);
    return `${intro('Valores', 'Financeiro', 'Resumo dos valores dos pedidos. Pagamentos e repasse serão etapas separadas.')}
      <div class="screen-metrics">${metric('Produtos', currency(products), 'Valor lançado')}${metric('Taxas de entrega', currency(fees), 'Valor lançado')}${metric('Total dos pedidos', currency(products + fees), 'Não é valor recebido')}</div>
      ${panel('Conferência financeira', `<div class="screen-callout">Estes são valores cobrados nos pedidos cadastrados neste navegador. Ainda não sabemos quais foram pagos nem a fórmula do repasse à padaria.</div>${orders.length ? '<a class="screen-action" href="#pedidos">Ver pedidos →</a>' : empty('Nenhum valor para conferir. Lance um pedido para começar.', 'Lançar pedido')}`)}`;
  },
  relatorios: () => `${intro('Análise', 'Relatórios', 'Escolha um intervalo para resumir pedidos cadastrados neste navegador.')}
    ${panel('Extrato de pedidos', `<div class="report-filters"><label>De<input id="report-from" type="date"></label><label>Até<input id="report-to" type="date"></label></div><div id="report-results" aria-live="polite"></div><p class="report-note">Este é um extrato de pedidos, não de pagamentos. Os relatórios financeiros virão quando registrarmos recebimentos e repasses.</p>`)}`,
  configuracoes: () => `${intro('Preferências', 'Configurações', 'Ajustes da interface e futuras regras da operação.')}<div class="settings-grid">${panel('Movimento', `<div class="settings-row settings-row--motion"><span>Movimento da interface</span><button type="button" class="motion-toggle" aria-pressed="${!motionDisabled()}" ${systemReducedMotion.matches ? 'disabled' : ''}>${systemReducedMotion.matches ? 'Reduzido pelo sistema' : motionDisabled() ? 'Desativado' : 'Ativado'}</button></div>`)}${panel('Dados da operação', empty('Catálogo, entregas, pagamentos e acessos serão configurados por partes. Nenhuma regra fictícia será aplicada.'))}</div>`,
};

function renderReportResults() {
  const host = document.getElementById('report-results');
  if (!host) return;
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;
  if (from && to && from > to) { host.innerHTML = '<p class="report-note">A data inicial precisa ser anterior à data final.</p>'; return; }
  const orders = storedOrders().filter(order => (!from || order.date >= from) && (!to || order.date <= to));
  const total = orders.reduce((sum, order) => sum + orderTotal(order), 0);
  const days = new Map();
  orders.forEach(order => { const day = days.get(order.date) || { count: 0, total: 0 }; day.count++; day.total += orderTotal(order); days.set(order.date, day); });
  host.innerHTML = `<div class="report-summary"><div><span>Pedidos no período</span><strong>${orders.length}</strong></div><div><span>Total dos pedidos</span><strong>${currency(total)}</strong></div></div>${days.size ? `<div class="report-days">${[...days.entries()].sort((a,b) => b[0].localeCompare(a[0])).map(([date, day]) => `<div><span>${new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')}</span><span>${day.count} ${day.count === 1 ? 'pedido' : 'pedidos'}</span><strong>${currency(day.total)}</strong></div>`).join('')}</div>` : '<p class="screen-empty">Nenhum pedido neste período.</p>'}`;
}

let activeRoute = null;
let routeRevision = 0;
const menuButton = document.querySelector('.mobile-menu-button');
const menuOverlay = document.querySelector('.menu-overlay');

function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  menuOverlay.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
}

function renderRoute(route) {
  const isHome = route === 'inicio';
  const isOperation = route === 'operacao';
  homeView.hidden = !isHome;
  operationView.hidden = !isOperation;
  screenView.hidden = isHome || isOperation;
  if (!isHome && !isOperation) screenView.innerHTML = pages[route]();
  if (route === 'relatorios') renderReportResults();
  const operationDialog = document.getElementById('operation-dialog');
  if (!isOperation && operationDialog.open) operationDialog.close();
  navigation.forEach(link => {
    const active = link.getAttribute('href') === `#${route}`;
    link.classList.toggle('btn', active);
    link.classList.toggle('lnk', !active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const current = navigation.find(link => link.getAttribute('href') === `#${route}`);
  document.title = `${current?.querySelector('.nav__label')?.textContent.trim() || 'Operação diária'} — Trameli`;
  setMenu(false);
  scrollTo(0, 0);
  activeRoute = route;
}

function animateRouteIn(route) {
  if (!window.gsap || motionDisabled()) return;
  const view = route === 'inicio' ? homeView : route === 'operacao' ? operationView : screenView;
  const targets = view.querySelectorAll(route === 'inicio'
    ? '.hero, .kpi-card, .attention-strip, .content-grid .panel, .bottom-grid > *'
    : route === 'operacao' ? '.intro, .summary-card, .ledger-note, .orders-section' : '.screen-hero, .screen-metric, .screen-panel');
  window.gsap.fromTo(targets, { autoAlpha: 0, y: 9 }, { autoAlpha: 1, y: 0, duration: 0.28, stagger: 0.025, ease: 'power2.out', clearProps: 'opacity,visibility,transform' });
}

function showRoute(force = false) {
  const requested = decodeURIComponent(location.hash.slice(1)) || 'operacao';
  const route = routes.has(requested) ? requested : 'operacao';
  if (route === activeRoute && !force) { setMenu(false); return; }
  const revision = ++routeRevision;
  const previous = activeRoute;
  const finish = () => { if (revision !== routeRevision) return; renderRoute(route); if (previous !== null && !force) animateRouteIn(route); };
  if (previous !== null && !force && window.gsap && !motionDisabled()) {
    const outgoing = previous === 'inicio' ? homeView : previous === 'operacao' ? operationView : screenView;
    const children = outgoing.querySelectorAll('.hero, .kpi-card, .attention-strip, .content-grid .panel, .bottom-grid > *, .screen-hero, .screen-metric, .screen-panel, .intro, .summary-card, .ledger-note, .orders-section');
    window.gsap.killTweensOf(children);
    window.gsap.set(children, { clearProps: 'opacity,visibility,transform' });
    window.gsap.killTweensOf(outgoing);
    window.gsap.to(outgoing, { autoAlpha: 0, y: -6, duration: 0.12, ease: 'power1.in', onComplete: () => { window.gsap.set(outgoing, { clearProps: 'opacity,visibility,transform' }); finish(); } });
  } else finish();
}

menuButton.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
menuOverlay.addEventListener('click', () => setMenu(false));
navigation.forEach(link => link.addEventListener('click', () => setMenu(false)));
window.addEventListener('resize', () => { if (innerWidth > 760) setMenu(false); });
window.addEventListener('hashchange', () => showRoute());
document.querySelector('.notification-button').addEventListener('click', () => { location.hash = 'operacao'; });
document.addEventListener('click', event => {
  const toggle = event.target.closest('.motion-toggle');
  if (!toggle || systemReducedMotion.matches) return;
  userReducedMotion = !userReducedMotion;
  try { localStorage.setItem('trameli-reduced-motion', String(userReducedMotion)); } catch { /* Applies this session. */ }
  syncMotionPreference();
});
document.addEventListener('change', event => {
  if (event.target.id === 'report-from' || event.target.id === 'report-to') renderReportResults();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenu(false); });
showRoute();
