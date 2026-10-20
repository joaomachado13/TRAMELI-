import { recurringScheduleText } from '../src/recurring-days.js';
import { stages, statusPath, progressOrder } from '../src/operation-flow.js';
import { compareByStreet } from '../src/address-sort.js';
import { supplierGroups, supplierTotals, supplierText, supplierDayCost, downloadSupplierPdf, downloadSeparationPdf, itemCheckKey, filterSupplierGroups, isSandraSupplierItem } from '../src/supplier-checklist.js';
import { closingPeriod } from '../src/billing-cycle.js';
import { costMapFromRows, supplierPeriodReport, supplierPeriodText, periodLabel, formatMoney as formatCost } from '../src/supplier-costs.js';
import { downloadSupplierPeriodPdf } from '../src/supplier-period-pdf.js';

(() => {
const live = window.TrameliLive;
const storageKey = 'trameli-operation-draft-v2';
const printSettingsKey = 'trameli-print-settings-70x33-v1';
try { localStorage.removeItem('trameli-operation-draft-v1'); } catch { /* Storage may be unavailable. */ }
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function parseMoney(value) {
  const raw = String(value).trim().replace(/\s|R\$/gi, '');
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) return null;
  const [whole, decimals = ''] = raw.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 100000000 ? cents : null;
}

function readOrders() {
  if (live) return live.orders.slice();
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed) ? parsed.filter(order => order && typeof order.id === 'string' && Array.isArray(order.items)) : [];
  } catch { return []; }
}

let orders = readOrders();
let editingId = null;
let editingScheduleId = null;
let detailId = null;
let submitting = false;
let requestId = null;
const dateInput = document.getElementById('delivery-date');
const searchInput = document.getElementById('order-search');
const list = document.getElementById('orders-list');
const supplierList = document.getElementById('supplier-list-items');
const supplierTotalsHost = document.getElementById('supplier-list-totals');
const supplierCopy = document.getElementById('copy-supplier-list');
const supplierPdf = document.getElementById('download-supplier-pdf');
const supplierFeedback = document.getElementById('supplier-list-feedback');
const supplierProvider = document.getElementById('supplier-provider');
const separationPdf = document.getElementById('download-separation-pdf');
const separationFeedback = document.getElementById('separation-list-feedback');
const supplierPeriodSelect = document.getElementById('supplier-period');
const supplierPeriodLabel = document.getElementById('supplier-period-label');
const periodKinds = { diario: 'Diário', quinzenal: 'Quinzenal', mensal: 'Mensal' };
// Custos por linha de pedido (somente operação com banco). Pedido sem linha de custo continua "não informado".
const costRows = [];
const costRequested = new Set();
let supplierCostMap = null;
const costsAvailable = () => Boolean(live?.operator && live.catalogUpgradeReady);
const selectedPeriod = () => closingPeriod(dateInput.value, supplierPeriodSelect?.value || 'diario');
async function loadCostsFor(periodOrders) {
  if (!costsAvailable()) return false;
  const missing = periodOrders.map(order => order.id).filter(id => !costRequested.has(id));
  if (!missing.length) return false;
  missing.forEach(id => costRequested.add(id));
  try {
    costRows.push(...await live.orderCostRows(missing));
    supplierCostMap = costMapFromRows(costRows);
    return true;
  } catch (cause) {
    missing.forEach(id => costRequested.delete(id));
    supplierFeedback.textContent = `Não foi possível carregar os custos: ${cause.message}`;
    return false;
  }
}
function resetCosts() { costRows.length = 0; costRequested.clear(); supplierCostMap = null; }
const kanbanFeedback = document.getElementById('kanban-feedback');
const checklistKey = `trameli-supplier-checks-v1:${live?.user?.id || 'demo'}`;
let supplierChecks = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(checklistKey) || '[]');
  if (Array.isArray(saved)) supplierChecks = new Set(saved.filter(key => typeof key === 'string'));
} catch { /* A checklist still works when storage is unavailable. */ }
const movingOrders = new Set();
let draggedId = null;
let suppressClickUntil = 0;
const dialog = document.getElementById('operation-dialog');
const detailDrawer = document.getElementById('order-detail-drawer');
const detailContent = document.getElementById('order-detail-content');
const form = document.getElementById('order-form');
const itemsHost = document.getElementById('form-items');
const catalogHost = document.getElementById('form-catalog');
const selectedProductQuantities = new Map();
const formError = document.getElementById('form-error');
const printSettingsHost = document.getElementById('print-settings');
const historyDialog = live ? document.createElement('dialog') : null;
if (historyDialog) { historyDialog.className = 'history-dialog'; document.body.append(historyDialog); }
const recurringManager = live ? document.createElement('dialog') : null;
if (recurringManager) { recurringManager.className = 'recurring-manager-dialog'; document.body.append(recurringManager); }
let recurringSchedulesCache = [];
const printDefaults = { offsetX: 0, offsetY: 0 };
let printSettings = { ...printDefaults };
try {
  const saved = JSON.parse(localStorage.getItem(printSettingsKey) || '{}');
  for (const key of Object.keys(printDefaults)) {
    const value = Number(saved[key]);
    if (Number.isFinite(value) && value >= -3 && value <= 3 && value * 2 === Math.trunc(value * 2)) printSettings[key] = value;
    printSettingsHost?.querySelector(`[name="${key}"]`)?.setAttribute('value', printSettings[key]);
  }
} catch { /* Use safe print defaults. */ }

function saveOrders() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(orders));
    window.dispatchEvent(new Event('trameli:orders-changed'));
    return true;
  } catch {
    alert('O navegador não conseguiu guardar este pedido. Não feche a página antes de copiar os dados.');
    return false;
  }
}

const itemTotal = item => item.quantity * item.priceCents;
const itemLabel = item => window.TrameliOrderMath.itemLabel(item);
const orderSubtotal = order => window.TrameliOrderMath.subtotalCents(order);
const orderTotal = order => window.TrameliOrderMath.totalCents(order);
const orderCode = order => order?.publicCode || '—';
function orderOriginLabel(order) {
  if (order?.source === 'portal') return 'Feito pelo cliente';
  if (order?.source === 'operator') return 'Lançado pela conta da Shirley';
  return 'Origem não identificada';
}
function localOrderCode(createdAt) {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(createdAt)).replace(/\//g, '');
  const prefix = `TR-${date}-`;
  const next = orders.reduce((max, order) => {
    const code = String(order.publicCode || '');
    return code.startsWith(prefix) ? Math.max(max, Number(code.slice(prefix.length)) || 0) : max;
  }, 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}
const statusLabels = { received: 'A conferir', confirmed: 'Conferido', packing: 'Em separação', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' };
const nextStatus = { received: 'confirmed', confirmed: 'ready', packing: 'ready', ready: 'delivered' };
const previousStatus = { confirmed: 'received', packing: 'confirmed', ready: 'confirmed' };
const orderStatus = order => order.status || (order.checked ? 'confirmed' : 'received');
const paymentLabels = { pix_manual: 'Pix', cash: 'Dinheiro', bank: 'Transferência', other: 'Acordado com a proprietária', unspecified: 'Não informado' };
const operationSettingsKey = 'trameli-operation-settings-v1';

function operationRolloverTime() {
  if (live?.settings?.rollover_time) return String(live.settings.rollover_time).slice(0, 5);
  if (window.TrameliSettings?.rolloverTime) return window.TrameliSettings.rolloverTime;
  try {
    const value = JSON.parse(localStorage.getItem(operationSettingsKey) || '{}').rolloverTime;
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '13:30';
  } catch { return '13:30'; }
}

function saoPauloClock() {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function suggestedOperationDate() {
  const clock = saoPauloClock();
  const today = `${clock.year}-${String(clock.month).padStart(2, '0')}-${String(clock.day).padStart(2, '0')}`;
  const [hour, minute] = operationRolloverTime().split(':').map(Number);
  const afterRollover = clock.hour * 60 + clock.minute >= hour * 60 + minute;
  const todayPending = orders.some(order => order.date === today && !['delivered', 'cancelled'].includes(orderStatus(order)));
  let candidate;
  if (!afterRollover || todayPending) candidate = today;
  else {
    const nextDate = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + 1));
    candidate = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDate.getUTCDate()).padStart(2, '0')}`;
  }
  const deliveryDate = new Date(candidate + 'T12:00:00');
  if (deliveryDate.getDay() === 0) deliveryDate.setDate(deliveryDate.getDate() + 1);
  return `${deliveryDate.getFullYear()}-${String(deliveryDate.getMonth() + 1).padStart(2, '0')}-${String(deliveryDate.getDate()).padStart(2, '0')}`;
}

dateInput.value = suggestedOperationDate();

function addItem(item = {}) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = '<label>Produto <input class="item-name" list="catalog-products" maxlength="90" placeholder="Nome do item" required></label><label class="item-quantity-label">Qtd. <input class="item-quantity" type="number" inputmode="numeric" min="1" max="999" step="1" value="1" required></label><label class="item-weight-label" hidden>Peso (g) <input class="item-weight" type="number" inputmode="numeric" min="50" max="4950" step="50" value="50"></label><label><span class="item-price-label">Preço unit. (R$)</span> <input class="item-price" inputmode="decimal" placeholder="0,00" required></label><button class="remove-item" type="button" aria-label="Remover item">×</button>';
  row.querySelector('.item-name').value = item.name || '';
  row.querySelector('.item-quantity').value = item.quantity || 1;
  row.querySelector('.item-weight').value = item.weightGrams || 50;
  row.querySelector('.item-price').value = item.priceCents == null ? '' : ((item.kgPriceCents ?? item.priceCents) / 100).toFixed(2).replace('.', ',');
  function syncItemMode(resetPrice = false) {
    const product = window.TrameliCatalog?.findByName(row.querySelector('.item-name').value);
    const isWeighted = product?.unit === 'kg';
    row.dataset.productId = isWeighted ? product.id : '';
    row.dataset.weighted = String(isWeighted);
    row.querySelector('.item-weight-label').hidden = !isWeighted;
    row.querySelector('.item-quantity-label').hidden = isWeighted;
    row.querySelector('.item-quantity').disabled = isWeighted;
    row.querySelector('.item-weight').disabled = !isWeighted;
    row.querySelector('.item-price-label').textContent = isWeighted ? 'Preço/kg (R$)' : 'Preço unit. (R$)';
    if (resetPrice && product) row.querySelector('.item-price').value = (product.priceCents / 100).toFixed(2).replace('.', ',');
    updateFormTotal();
  }
  row.querySelector('.item-name').addEventListener('change', event => {
    syncItemMode(true);
  });
  row.querySelector('.remove-item').addEventListener('click', () => {
    if (itemsHost.children.length === 1) return;
    row.remove();
    updateFormTotal();
  });
  row.addEventListener('input', updateFormTotal);
  itemsHost.append(row);
  syncItemMode();
}

function customerProfiles() {
  if (live) {
    return (window.TrameliPayments?.api?.profiles || [])
      .filter(profile => profile?.user_id && profile?.name)
      .slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
  return (window.TrameliClients?.list() || []).map(client => ({
    user_id: client.customerId || client.key || client.name,
    name: client.name, phone: client.phone || '', address: client.address || '',
  })).filter(profile => profile.user_id && profile.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
function syncSelectedCustomer() {
  const profile = customerProfiles().find(item => item.user_id === form.elements.customerId.value);
  form.elements.phone.value = profile?.phone || '';
  form.elements.address.value = profile?.address || '';
}
function fillCustomerOptions(selectedId = '', selectedName = '') {
  const profiles = customerProfiles();
  const select = form.elements.customerId;
  select.innerHTML = '<option value="">Selecione um cliente…</option>' + profiles.map(profile =>
    '<option value="' + escapeHtml(profile.user_id) + '">' + escapeHtml(profile.name) + '</option>'
  ).join('');
  let target = profiles.find(profile => profile.user_id === selectedId);
  if (!target && selectedName) target = profiles.find(profile => profile.name.trim().toLocaleLowerCase('pt-BR') === selectedName.trim().toLocaleLowerCase('pt-BR'));
  select.value = target?.user_id || '';
  syncSelectedCustomer();
  select.disabled = profiles.length === 0;
}
function renderProductCatalog() {
  const products = (live?.products || window.TrameliCatalog?.list() || [])
    .filter(product => product.active && Number.isSafeInteger(product.priceCents) && product.priceCents >= 0)
    .slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  catalogHost.innerHTML = products.length ? products.map(product => {
    const quantity = selectedProductQuantities.get(product.id) || 0;
    const weighted = product.unit === 'kg';
    const image = product.image ? '<img src="' + escapeHtml(product.image) + '" alt="" loading="lazy">' : '<span class="admin-product-card__placeholder">PD</span>';
    const price = weighted ? money(product.priceCents) + ' / kg' : money(product.priceCents);
    const amount = weighted ? (quantity ? (quantity * 50) + ' g' : '0 g') : quantity;
    return '<article class="admin-product-card' + (quantity ? ' is-selected' : '') + '" data-product-card="' + escapeHtml(product.id) + '">' +
      '<div class="admin-product-card__photo">' + image + '</div><div class="admin-product-card__body"><strong>' + escapeHtml(product.name) +
      '</strong><small>' + price + '</small><div class="admin-product-card__controls"><button type="button" data-product-step="-1" data-product-id="' + escapeHtml(product.id) + '" aria-label="Diminuir ' + escapeHtml(product.name) + '"' + (quantity ? '' : ' disabled') + '>−</button><span>' + amount +
      '</span><button type="button" data-product-step="1" data-product-id="' + escapeHtml(product.id) + '" aria-label="Adicionar ' + escapeHtml(product.name) + '">+</button></div></div></article>';
  }).join('') : '<p class="admin-product-empty">Não há produtos ativos no catálogo.</p>';
}
function formItems() {
  if (!catalogHost.hidden) {
    const products = live?.products || window.TrameliCatalog?.list() || [];
    return [...selectedProductQuantities.entries()].map(([id, quantity]) => {
      const product = products.find(item => item.id === id && item.active);
      if (!product || quantity < 1) return null;
      if (product.unit === 'kg') {
        const weightGrams = quantity * 50;
        return { productId: product.id, name: product.name, quantity: 1,
          weightGrams, kgPriceCents: product.priceCents,
          priceCents: window.TrameliOrderMath.weightPriceCents(product.priceCents, weightGrams) };
      }
      return { productId: product.id, name: product.name, quantity, priceCents: product.priceCents };
    }).filter(Boolean);
  }
  return [...itemsHost.children].map(row => {
    const name = row.querySelector('.item-name').value.trim();
    const enteredPrice = parseMoney(row.querySelector('.item-price').value);
    if (row.dataset.weighted === 'true') {
      const weightGrams = Number(row.querySelector('.item-weight').value);
      return { productId: row.dataset.productId, name, quantity: 1, weightGrams,
        kgPriceCents: enteredPrice, priceCents: enteredPrice === null ? null
          : window.TrameliOrderMath.weightPriceCents(enteredPrice, weightGrams) };
    }
    return { name, quantity: Number(row.querySelector('.item-quantity').value), priceCents: enteredPrice };
  });
}
function updateFormTotal() {
  const fee = parseMoney(form.elements.fee.value || '2,00');
  const items = formItems();
  const valid = fee !== null && items.every(item => Number.isInteger(item.quantity) && item.quantity > 0
    && item.priceCents !== null && (item.weightGrams === undefined || (Number.isInteger(item.weightGrams)
      && item.weightGrams >= 50 && item.weightGrams <= 4950 && item.weightGrams % 50 === 0)));
  const productsTotal = items.reduce((sum, item) => sum + itemTotal(item), 0);
  const hasItems = items.length > 0 && items.some(item => item.name && item.priceCents !== null && item.quantity > 0);
  document.getElementById('form-subtotal').textContent = !hasItems ? money(0) : valid ? money(productsTotal) : '—';
  document.getElementById('form-delivery-summary').hidden = !hasItems;
  document.getElementById('form-total').textContent = !hasItems ? money(0) : valid ? money(productsTotal + fee) : '—';
}
function openForm(order = null, schedule = null, makeRecurring = false) {
  editingId = makeRecurring ? null : order?.id || null;
  editingScheduleId = schedule?.id || null;
  requestId = schedule?.request_id || (order && !makeRecurring ? null : crypto.randomUUID());
  form.reset();
  formError.hidden = true;
  itemsHost.replaceChildren();
  selectedProductQuantities.clear();
  form.elements.date.value = schedule ? dateInput.value : order?.date || dateInput.value;
  form.elements.fee.value = ((schedule?.fee_cents ?? 200) / 100).toFixed(2).replace('.', ',');
  fillCustomerOptions(schedule?.customer_id || order?.customerId || '', order?.customer || '');
  form.elements.notes.value = schedule?.notes || order?.notes || '';
  form.elements.recurrence.value = schedule?.recurrence || (makeRecurring ? 'fixed' : 'once');
  form.elements.recurrence.disabled = Boolean(order && !makeRecurring);
  form.elements.recurrence.querySelector('option[value="once"]').disabled = Boolean(schedule || makeRecurring);
  const weekdaysFieldset = document.getElementById('recurrence-weekdays');
  const selectedWeekdays = new Set((schedule?.weekdays || [1, 2, 3, 4, 5, 6]).map(Number));
  form.querySelectorAll('input[name="weekdays"]').forEach(input => { input.checked = selectedWeekdays.has(Number(input.value)); });
  if (weekdaysFieldset) weekdaysFieldset.hidden = form.elements.recurrence.value === 'once';
  catalogHost.hidden = Boolean(order);
  itemsHost.hidden = !order;
  document.getElementById('add-item').hidden = !order;
  if (order) {
    (order.items || [{}]).forEach(addItem);
  } else {
    if (schedule) {
      const products = live?.products || window.TrameliCatalog?.list() || [];
      for (const line of schedule.items || []) {
        const baseName = String(line.name || '').replace(/\s+\(\d{2,4}\s*g\)$/i, '').trim();
        const product = products.find(candidate => candidate.active && candidate.id === line.productId)
          || products.find(candidate => candidate.active && candidate.name === baseName)
          || products.filter(candidate => candidate.active && baseName.startsWith(candidate.name)).sort((a, b) => b.name.length - a.name.length)[0];
        if (!product) continue;
        const grams = Number(line.weightGrams || String(line.name || '').match(/\((\d{2,4})\s*g\)/i)?.[1] || 50);
        const quantity = product.unit === 'kg' ? Math.max(1, Math.min(99, Math.round(grams / 50)))
          : Math.max(1, Math.min(999, Number(line.quantity) || 1));
        selectedProductQuantities.set(product.id, quantity);
      }
    }
    renderProductCatalog();
  }
  document.getElementById('dialog-title').textContent = schedule ? 'Editar pedido recorrente' : makeRecurring ? 'Transformar pedido em recorrente' : order ? 'Editar pedido' : 'Novo pedido';
  updateFormTotal();
  dialog.showModal();
  form.elements.customerId.focus();
}

async function showRecurringManager() {
  if (!recurringManager) {
    alert('A gestão de recorrências exige conexão com o banco de dados.');
    return;
  }
  recurringManager.innerHTML = '<div class="recurring-manager__head"><div><p class="eyebrow">OPERAÇÃO</p><h2>Pedidos recorrentes</h2></div><button type="button" data-recurring-close aria-label="Fechar">×</button></div><p class="recurring-manager__help">Cada data gera no máximo uma ocorrência. Quinzenal renova no fechamento dos dias 15 e fim do mês; mensal renova no fim de cada mês. Fixo diário não depende do fechamento.</p><p class="recurring-manager__feedback" role="status">Carregando…</p><div class="recurring-manager__list"></div>';
  if (!recurringManager.open) recurringManager.showModal();
  const feedback = recurringManager.querySelector('.recurring-manager__feedback');
  const host = recurringManager.querySelector('.recurring-manager__list');
  try {
    recurringSchedulesCache = await live.recurringSchedules();
    const requests = await live.recurringRequests();
    const profiles = new Map(customerProfiles().map(profile => [profile.user_id, profile]));
    const names = { fixed: 'Fixo por dias da semana', fortnightly: 'Quinzenal (fechamento)', monthly: 'Mensal (fechamento)' };
    const weekdayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const pendingRequests = requests.filter(request => request.status === 'pending');
    const requestMarkup = pendingRequests.length ? '<h3 class="recurring-manager__section-title">Solicitações dos clientes</h3>' + pendingRequests.map(request => {
      const customer = profiles.get(request.customer_id);
      const order = orders.find(item => item.id === request.order_id);
      const dayNames = (request.weekdays || []).map(day => weekdayNames[Number(day)]).filter(Boolean).join(', ');
      const itemNames = (order?.items || []).map(item => item.weightGrams ? item.name + ' (' + item.weightGrams + ' g)' : item.name).join(' · ');
      return '<article class="recurring-manager__item"><div><strong>' + escapeHtml(customer?.name || order?.customer || 'Cliente cadastrado') + '</strong><span>Solicitou: ' + escapeHtml(dayNames) + '</span><small>Pedido de origem: ' + escapeHtml(itemNames || 'itens não disponíveis') + '</small></div><div class="recurring-manager__actions"><button type="button" data-recurring-review="' + escapeHtml(request.id) + '" data-approve="true">Aprovar</button><button type="button" data-recurring-review="' + escapeHtml(request.id) + '" data-approve="false">Recusar</button></div></article>';
    }).join('') : '<p class="recurring-manager__empty">Nenhuma solicitação pendente dos clientes.</p>';
    const scheduleMarkup = recurringSchedulesCache.length ? recurringSchedulesCache.map(schedule => {
      const customer = profiles.get(schedule.customer_id);
      const itemNames = recurringScheduleText(schedule).join('; ');
      const period = schedule.recurrence === 'fixed' ? 'Sem fechamento' : 'Ciclo até ' + new Date(schedule.cycle_ends_on + 'T12:00:00').toLocaleDateString('pt-BR');
      const dayNames = (schedule.weekdays || [1,2,3,4,5,6]).map(day => weekdayNames[Number(day)]).filter(Boolean).join(', ');
      return '<article class="recurring-manager__item"><div><strong>' + escapeHtml(customer?.name || 'Cliente cadastrado') + '</strong><span>' + escapeHtml(names[schedule.recurrence] || schedule.recurrence) + ' · ' + escapeHtml(period) + '</span><small>Dias: ' + escapeHtml(dayNames) + '</small><small>' + escapeHtml(itemNames) + '</small><small>' + (schedule.active ? 'Ativo' : 'Pausado') + '</small></div><div class="recurring-manager__actions"><button type="button" data-recurring-edit="' + escapeHtml(schedule.id) + '" ' + (schedule.active ? '' : 'disabled') + '>Editar</button><button type="button" data-recurring-active="' + escapeHtml(schedule.id) + '" data-active="' + String(!schedule.active) + '">' + (schedule.active ? 'Pausar' : 'Reativar') + '</button><button type="button" data-recurring-delete="' + escapeHtml(schedule.id) + '">Excluir</button></div></article>';
    }).join('') : '<p class="recurring-manager__empty">Ainda não há pedidos recorrentes cadastrados.</p>';
    host.innerHTML = requestMarkup + '<h3 class="recurring-manager__section-title">Programações recorrentes</h3>' + scheduleMarkup;
    feedback.textContent = '';
  } catch (cause) {
    feedback.textContent = 'Não foi possível carregar as recorrências: ' + cause.message;
  }
}

function selectedOrders() {
  return orders.filter(order => order.date === dateInput.value && orderStatus(order) !== 'cancelled').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const printedLabelsKey = 'trameli-printed-label-order-ids-v1';
let pendingPrintOrderIds = [];
function printedIdsForDate(date = dateInput.value) {
  try { const state = JSON.parse(localStorage.getItem(printedLabelsKey) || '{}'); return new Set(Array.isArray(state[date]) ? state[date] : []); }
  catch { return new Set(); }
}
function rememberPrintedOrders() {
  if (!pendingPrintOrderIds.length || !dateInput.value) return;
  try {
    const state = JSON.parse(localStorage.getItem(printedLabelsKey) || '{}');
    const current = new Set(Array.isArray(state[dateInput.value]) ? state[dateInput.value] : []);
    pendingPrintOrderIds.forEach(id => current.add(id));
    state[dateInput.value] = [...current];
    localStorage.setItem(printedLabelsKey, JSON.stringify(state));
  } catch { /* Printing still works if storage is unavailable. */ }
}
window.addEventListener('beforeprint', rememberPrintedOrders);

function openLabelPrintDialog() {
  const dayOrders = selectedOrders();
  if (!dayOrders.length) { alert('Não há pedidos para imprimir na data selecionada.'); return; }
  let dialog = document.getElementById('label-print-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'label-print-dialog';
    dialog.className = 'form-dialog';
    dialog.setAttribute('aria-labelledby', 'label-print-title');
    dialog.innerHTML = `<form method="dialog" class="label-print-dialog__form">
      <p class="eyebrow">ETIQUETAS</p><h2 id="label-print-title">O que deseja imprimir?</h2>
      <p class="section-description" id="label-print-summary"></p>
      <div class="label-print-dialog__actions">
        <button class="button button--primary" type="button" data-label-print="new">Imprimir pedidos em Novo</button>
        <button class="button button--quiet" type="button" data-label-print="all">Imprimir todos os pedidos</button>
        <button class="button button--quiet" type="button" data-label-print="choose">Selecionar pedidos</button>
      </div>
      <fieldset id="label-print-selection" hidden><legend>Selecione as etiquetas</legend><div id="label-print-orders"></div><button class="button button--primary" type="button" data-label-print="selected">Imprimir selecionados</button></fieldset>
      <div class="dialog-actions"><button class="button button--quiet" type="submit">Fechar</button></div>
    </form>`;
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) { dialog.close(); return; }
      const button = event.target.closest('[data-label-print]');
      if (!button) return;
      const available = selectedOrders();
      const printed = printedIdsForDate();
      let chosen = [];
      if (button.dataset.labelPrint === 'new') chosen = available.filter(order => orderStatus(order) === 'received').sort(compareByStreet);
      else if (button.dataset.labelPrint === 'all') chosen = available;
      else if (button.dataset.labelPrint === 'choose') {
        dialog.querySelector('#label-print-selection').hidden = false;
        dialog.querySelector('#label-print-orders').innerHTML = available.map(order => `<label class="label-print-dialog__order"><input type="checkbox" value="${escapeHtml(order.id)}" checked><span>${escapeHtml(order.customer)}</span><small>${escapeHtml(order.publicCode || '')} · ${money(orderTotal(order))}</small></label>`).join('');
        return;
      } else if (button.dataset.labelPrint === 'selected') {
        const ids = new Set([...dialog.querySelectorAll('#label-print-orders input:checked')].map(input => input.value));
        chosen = available.filter(order => ids.has(order.id));
      }
      if (!chosen.length) { alert(button.dataset.labelPrint === 'new' ? 'Não há pedidos na etapa Novo para imprimir nesta data.' : 'Selecione pelo menos um pedido.'); return; }
      pendingPrintOrderIds = chosen.map(order => order.id);
      dialog.close();
      if (preparePrint(chosen)) window.print();
    });
  }
  const newCount = dayOrders.filter(order => orderStatus(order) === 'received').length;
  const unprinted = dayOrders.filter(order => !printedIdsForDate().has(order.id)).length;
  dialog.querySelector('#label-print-summary').textContent = `${dayOrders.length} pedidos ativos nesta data; ${newCount} em Novo; ${unprinted} ainda não registrados em uma impressão.`;
  dialog.querySelector('#label-print-selection').hidden = true;
  dialog.showModal();
}

function checklistGroups() { return supplierGroups(orders, dateInput.value, supplierChecks, costsAvailable() ? (supplierCostMap || new Map()) : null); }
function repasseGroups() { return filterSupplierGroups(checklistGroups(), supplierProvider?.value || 'divano'); }
function periodOrders(period) { return orders.filter(order => order.date >= period.from && order.date <= period.to && orderStatus(order) !== 'cancelled'); }
function refreshPeriodLabel() {
  if (!supplierPeriodLabel) return;
  const period = selectedPeriod();
  supplierPeriodLabel.textContent = `${periodKinds[period.kind] || 'Diário'}: ${periodLabel(period.from, period.to)}`;
}

function renderSupplierList() {
  const validKeys = new Set(orders.filter(order => orderStatus(order) !== 'cancelled').flatMap(order => order.items.map((_, index) => itemCheckKey(order, index))));
  const retained = new Set([...supplierChecks].filter(key => validKeys.has(key)));
  if (retained.size !== supplierChecks.size) {
    supplierChecks = retained;
    try { localStorage.setItem(checklistKey, JSON.stringify([...supplierChecks])); } catch { /* Optional checklist persistence. */ }
  }
  const allGroups = checklistGroups();
  const groups = filterSupplierGroups(allGroups, supplierProvider?.value || 'divano');
  const totals = supplierTotals(groups);
  if (supplierTotalsHost) supplierTotalsHost.innerHTML = totals.length
    ? `<ul>${totals.map(product => `<li><strong>${product.grams ? `${product.grams} g` : `${product.quantity}×`}</strong><span>${escapeHtml(product.name)}</span>${product.hasCost ? `<em class="supplier-cost">${product.costMissing ? 'custo não informado' : escapeHtml(formatCost(product.costCents))}</em>` : ''}</li>`).join('')}</ul>${(() => { const day = supplierDayCost(groups); return day.withCosts ? `<p class="supplier-cost-total"><strong>Total a pagar à padaria (custo): ${escapeHtml(formatCost(day.totalCents))}</strong>${day.missing ? ` · ${day.missing} item(ns) sem custo, total incompleto` : ''}</p>` : ''; })()}`
    : '<p class="supplier-list__empty">Nenhum item nesta data.</p>';
  if (supplierList) supplierList.innerHTML = '';
  supplierList?.querySelectorAll('[data-supplier-check-order]').forEach(input => {
    const order = groups.flatMap(group => group.orders).find(order => order.id === input.dataset.supplierCheckOrder);
    input.indeterminate = !order.checked && order.lines.some(line => line.checked);
  });
  const hasExport = selectedPeriod().kind === 'diario' ? groups.length > 0 : periodOrders(selectedPeriod()).length > 0;
  if (separationPdf) separationPdf.disabled = !allGroups.some(group => group.orders.some(order => order.lines.length));
  supplierCopy.disabled = !hasExport;
  // Mantenha o botão de PDF clicável nos períodos agregados para que a própria ação informe se faltam pedidos ou custos, em vez de parecer que não responde.
  if (supplierPdf && !supplierPdf.dataset.busy) supplierPdf.disabled = selectedPeriod().kind === 'diario' && !hasExport;
  refreshPeriodLabel();
  if (costsAvailable() && groups.length) {
    const dayOrders = orders.filter(order => order.date === dateInput.value && orderStatus(order) !== 'cancelled');
    loadCostsFor(dayOrders).then(changed => { if (changed) renderSupplierList(); });
  }
}

function render() {
  const dayOrders = selectedOrders();
  const displayOrders = dayOrders.slice();
  const filtered = displayOrders.filter(order => {
    const query = searchInput.value.trim().toLocaleLowerCase('pt-BR');
    return !query || [order.customer, order.address, ...order.items.map(item => item.name)].some(value => value.toLocaleLowerCase('pt-BR').includes(query));
  });
  const summary = window.TrameliOrderMath.summarizeDay(orders, dateInput.value);
  document.getElementById('total-orders').textContent = summary.count;
  document.getElementById('pending-orders').textContent = summary.pending;
  document.getElementById('completed-orders').textContent = dayOrders.filter(order => orderStatus(order) === 'delivered').length;
  document.getElementById('grand-total').textContent = money(summary.totalCents);
  const selectedLabel = new Date(`${dateInput.value}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const rollover = operationRolloverTime();
  const suggested = suggestedOperationDate();
  document.getElementById('operation-day-hint').textContent = dateInput.value === suggested
    ? `Dia priorizado pela operação. Virada configurada para ${rollover}.`
    : `Visualizando ${selectedLabel}. Virada configurada para ${rollover}.`;
  renderSupplierList();

  if (!filtered.length && displayOrders.length) {
    list.innerHTML = '<div class="empty-state operation-empty"><span aria-hidden="true">⌕</span><h3>Nenhum pedido encontrado</h3><p>Tente buscar por outro nome, endereço ou produto.</p></div>';
    return;
  }

  const card = order => {
    const state = orderStatus(order);
    const itemCount = order.items.reduce((sum, item) => sum + (item.weightGrams ? 1 : item.quantity), 0);
    const busy = movingOrders.has(order.id);
    const destinations = stages.filter(stage => statusPath(state, stage.key, !live || live.role === 'master').length);
    const movable = destinations.length > 0 && !busy;
    return `<article class="kanban-card${busy ? ' is-moving' : ''}" data-card-id="${escapeHtml(order.id)}" aria-busy="${busy}"><button class="order-card order-card--${state}" type="button" data-action="open" data-id="${escapeHtml(order.id)}" draggable="${movable}" aria-label="Abrir pedido de ${escapeHtml(order.customer)}"><span class="order-card__top"><span class="order-card__id">#${escapeHtml(orderCode(order))}</span><span class="status status--${state === 'packing' || state === 'ready' ? 'confirmed' : state}">${escapeHtml(statusLabels[state === 'packing' || state === 'ready' ? 'confirmed' : state])}</span></span>${order.editedAt ? '<span class="order-edited-badge" role="status">EDITADO</span>' : ''}<small class="order-card__origin">${escapeHtml(orderOriginLabel(order))}</small><strong class="order-card__customer">${escapeHtml(order.customer)}</strong><span class="order-card__meta">${itemCount} ${itemCount === 1 ? 'item' : 'itens'} · ${money(orderTotal(order))}</span><span class="order-card__delivery">Entrega ${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>${order.notes ? '<span class="order-card__alert">Tem observação</span>' : ''}<span class="order-card__open">Ver pedido <span aria-hidden="true">→</span></span></button>${destinations.length ? `<div class="kanban-card__move"><button type="button" class="kanban-drag-handle" data-drag-id="${escapeHtml(order.id)}" aria-label="Arrastar pedido de ${escapeHtml(order.customer)}" aria-describedby="kanban-help" ${busy ? 'disabled' : ''}><span aria-hidden="true">⠿</span></button><label><span class="sr-only">Mover pedido de ${escapeHtml(order.customer)} para</span><select data-move-id="${escapeHtml(order.id)}" ${busy ? 'disabled' : ''}><option value="">${busy ? 'Movendo…' : 'Mover para…'}</option>${destinations.map(stage => `<option value="${stage.key}">${stage.title}</option>`).join('')}</select></label></div>` : ''}</article>`;
  };
  const columns = stages.filter(column => ['received', 'confirmed', 'delivered'].includes(column.key));
  const collapsedColumns = new Set();
  try { const saved = JSON.parse(localStorage.getItem('trameli-kanban-collapsed-v1') || '[]'); if (Array.isArray(saved)) saved.forEach(key => collapsedColumns.add(key)); } catch { /* Use expanded columns. */ }
  const activeOrders = displayOrders.filter(order => orderStatus(order) !== 'cancelled');
  const deliveredOrders = activeOrders.filter(order => orderStatus(order) === 'delivered');
  const bulkDisabled = !activeOrders.some(order => orderStatus(order) !== 'delivered');
  list.innerHTML = `<div class="kanban-toolbar"><span>${activeOrders.length} pedidos ativos · ${deliveredOrders.length} entregues</span><button class="button button--primary" type="button" data-kanban-bulk-deliver ${bulkDisabled ? 'disabled' : ''}>Marcar todos como entregues</button></div><div class="kanban" aria-label="Pedidos por etapa">${columns.map(column => {
    const columnOrders = filtered.filter(order => column.key === 'confirmed' ? ['confirmed','packing','ready'].includes(orderStatus(order)) : column.key === orderStatus(order));
    const collapsed = collapsedColumns.has(column.key);
    const deliveredPercent = activeOrders.length ? Math.round(deliveredOrders.length / activeOrders.length * 100) : 0;
    const summary = column.key === 'received'
      ? `${columnOrders.length} aguardando conferência`
      : column.key === 'confirmed'
        ? `${columnOrders.length} em andamento`
        : `${deliveredOrders.length} de ${activeOrders.length} entregues · ${deliveredPercent}%`;
    return `<section class="kanban-column kanban-column--${column.key}${collapsed ? ' is-collapsed' : ''}" data-drop-status="${column.key}" aria-labelledby="kanban-${column.key}"><header><div class="kanban-column__heading"><h3 id="kanban-${column.key}">${column.title}</h3><p>${column.note}</p>${collapsed ? `<div class="kanban-column__summary">${summary}</div>${column.key === 'delivered' ? `<div class="kanban-progress" role="progressbar" aria-label="Progresso das entregas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${deliveredPercent}"><span style="width:${deliveredPercent}%"></span></div>` : ''}` : ''}</div><div class="kanban-column__tools"><strong aria-label="${columnOrders.length} pedidos">${columnOrders.length}</strong><button type="button" class="kanban-collapse" data-kanban-collapse="${column.key}" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expandir' : 'Recolher'} coluna ${column.title}">${collapsed ? '＋' : '−'}</button></div></header><div class="kanban-column__cards">${columnOrders.length ? columnOrders.map(card).join('') : `<p class="kanban-empty">${displayOrders.length ? 'Nenhum pedido nesta etapa.' : column.key === 'received' ? 'Os novos pedidos aparecerão aqui.' : 'Nada por aqui ainda.'}</p>`}</div></section>`;
  }).join('')}</div>${displayOrders.length ? '' : '<div class="operation-first-order"><p>O dia ainda está em branco.</p><button class="button button--primary" type="button" data-action="new">+ Lançar primeiro pedido</button></div>'}`;

  if (detailDrawer.open) {
    const current = orders.find(order => order.id === detailId && order.date === dateInput.value && orderStatus(order) !== 'cancelled');
    if (current) renderOrderDetail(current); else detailDrawer.close();
  }
}

function detailActions(order) {
  const state = orderStatus(order);
  const master = !live || live.role === 'master';
  const canCorrect = state === 'received' || master;
  return `<div class="order-detail__actions">${nextStatus[state] ? `<button class="button button--primary" type="button" data-action="toggle" data-id="${escapeHtml(order.id)}">Avançar para ${escapeHtml(statusLabels[nextStatus[state]].toLowerCase())} →</button>` : ''}${previousStatus[state] && master ? `<button class="button button--quiet" type="button" data-action="back" data-id="${escapeHtml(order.id)}">Voltar para ${escapeHtml(statusLabels[previousStatus[state]].toLowerCase())}</button>` : ''}${!['delivered', 'cancelled'].includes(state) && canCorrect ? `<button class="button button--quiet" type="button" data-action="edit" data-id="${escapeHtml(order.id)}">Editar pedido</button>` : ''}${live?.operator && order.customerId && state !== 'cancelled' ? `<button class="button button--quiet" type="button" data-action="make-recurring" data-id="${escapeHtml(order.id)}">Tornar recorrente</button>` : ''}${live ? `<button class="button button--quiet" type="button" data-action="history" data-id="${escapeHtml(order.id)}">Ver histórico</button>` : ''}${!['delivered', 'cancelled'].includes(state) && canCorrect ? `<button class="order-detail__danger" type="button" data-action="delete" data-id="${escapeHtml(order.id)}">Cancelar pedido</button>` : ''}${live?.role === 'master' ? `<button class="order-detail__danger" type="button" data-action="destroy" data-id="${escapeHtml(order.id)}">Excluir definitivamente</button>` : ''}</div>`;
}

function renderOrderDetail(order) {
  const state = orderStatus(order);
  const itemRows = order.items.map(item => `<li><span><strong>${escapeHtml(itemLabel(item))}</strong><small>${money(item.priceCents)}${item.weightGrams ? '' : ' cada'}</small></span><strong>${money(itemTotal(item))}</strong></li>`).join('');
  detailContent.innerHTML = `<div class="order-detail"><header class="order-detail__header"><div><p class="eyebrow">PEDIDO #${escapeHtml(orderCode(order))}</p><h2 id="order-detail-title">${escapeHtml(order.customer)}</h2><span class="status status--${state}">${escapeHtml(statusLabels[state])}</span><small class="order-detail__origin">${escapeHtml(orderOriginLabel(order))}</small></div><button class="order-detail__close" type="button" data-action="close-detail" aria-label="Fechar detalhes">×</button></header><div class="order-detail__body"><section class="order-detail__section"><h3>Entrega</h3><p><strong>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong></p><p>${escapeHtml(order.address)}</p>${order.phone ? `<p><a href="tel:${escapeHtml(order.phone)}">${escapeHtml(order.phone)}</a></p>` : '<p class="order-detail__muted">Telefone não informado</p>'}</section><section class="order-detail__section"><div class="order-detail__section-heading"><h3>Itens</h3><span>${order.items.length} ${order.items.length === 1 ? 'linha' : 'linhas'}</span></div><ul class="order-detail__items">${itemRows}</ul><div class="order-detail__totals"><p><span>Produtos</span><strong>${money(orderSubtotal(order))}</strong></p><p><span>Entrega</span><strong>${money(order.feeCents)}</strong></p><p><span>Total</span><strong>${money(orderTotal(order))}</strong></p></div></section><div class="order-detail__grid"><section class="order-detail__section"><h3>Pagamento</h3><p>${escapeHtml(paymentLabels[order.paymentMethod || 'unspecified'] || order.paymentMethod)}</p><small>A forma escolhida não confirma recebimento.</small></section><section class="order-detail__section"><h3>Observação</h3><p>${order.notes ? escapeHtml(order.notes) : '<span class="order-detail__muted">Nenhuma observação.</span>'}</p></section></div></div>${detailActions(order)}</div>`;
}

function openOrderDetail(order) {
  detailId = order.id;
  renderOrderDetail(order);
  if (!detailDrawer.open) detailDrawer.showModal();
}

async function moveOrder(id, target) {
  const order = orders.find(item => item.id === id);
  if (!order || movingOrders.has(id)) return;
  const master = !live || live.role === 'master';
  if (!statusPath(orderStatus(order), target, master).length) {
    kanbanFeedback.textContent = 'Esta mudança não está disponível. Pedidos entregues ficam finalizados; somente Master pode voltar etapas.';
    return;
  }
  movingOrders.add(id);
  kanbanFeedback.textContent = `Movendo pedido de ${order.customer}…`;
  render();
  try {
    if (live) {
      await progressOrder(order, target, {
        master, setStatus: (current, state) => live.setStatus(current, state),
        getOrder: id => live.orders.find(item => item.id === id),
      });
      orders = readOrders();
    } else {
      const previous = orders;
      orders = orders.map(item => item.id === id ? { ...item, status: target, checked: target !== 'received', editedAt: target === 'confirmed' ? null : item.editedAt } : item);
      if (!saveOrders()) { orders = previous; throw new Error('Não foi possível salvar a movimentação neste navegador.'); }
    }
    kanbanFeedback.textContent = `Pedido de ${order.customer} movido para ${statusLabels[target]}.`;
  } catch (cause) {
    if (live) {
      try { await live.load(true); } catch { /* Preserve the last confirmed state. */ }
      orders = readOrders();
    }
    kanbanFeedback.textContent = `A movimentação não foi concluída: ${cause.message} Confira a etapa exibida no card.`;
  } finally {
    movingOrders.delete(id);
    render();
  }
}

function clearDrag() {
  draggedId = null;
  list.querySelector('.kanban')?.classList.remove('is-drag-active');
  list.querySelectorAll('.is-dragging,.is-drop-target,.is-drop-allowed').forEach(element => {
    element.classList.remove('is-dragging', 'is-drop-target', 'is-drop-allowed');
  });
}

function beginDrag(id) {
  const order = orders.find(item => item.id === id);
  if (!order || movingOrders.has(id)) return false;
  draggedId = id;
  list.querySelector('.kanban')?.classList.add('is-drag-active');
  list.querySelectorAll('[data-drop-status]').forEach(column => {
    column.classList.toggle('is-drop-allowed', statusPath(orderStatus(order), column.dataset.dropStatus, !live || live.role === 'master').length > 0);
  });
  list.querySelectorAll('[data-card-id]').forEach(card => card.classList.toggle('is-dragging', card.dataset.cardId === id));
  return true;
}

function dragTarget(element) {
  const column = element?.closest('[data-drop-status]');
  list.querySelectorAll('.is-drop-target').forEach(current => current.classList.remove('is-drop-target'));
  if (!column?.classList.contains('is-drop-allowed')) return null;
  column.classList.add('is-drop-target');
  return column.dataset.dropStatus;
}

list.addEventListener('dragstart', event => {
  const card = event.target.closest('.order-card[draggable="true"]');
  if (!card || !beginDrag(card.dataset.id)) { event.preventDefault(); return; }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', card.dataset.id);
});
list.addEventListener('dragover', event => {
  if (!draggedId) return;
  const target = dragTarget(event.target);
  if (target) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
});
list.addEventListener('dragleave', event => {
  if (!list.contains(event.relatedTarget)) list.querySelectorAll('.is-drop-target').forEach(column => column.classList.remove('is-drop-target'));
});
list.addEventListener('drop', event => {
  if (!draggedId) return;
  event.preventDefault();
  const target = dragTarget(event.target);
  const id = draggedId;
  const matches = event.dataTransfer.getData('text/plain') === id;
  clearDrag();
  suppressClickUntil = Date.now() + 350;
  if (matches && target) moveOrder(id, target);
});
list.addEventListener('dragend', () => { clearDrag(); suppressClickUntil = Date.now() + 350; });
list.addEventListener('click', async event => {
  const toggle = event.target.closest('[data-kanban-collapse]');
  if (toggle) {
    const key = toggle.dataset.kanbanCollapse, column = toggle.closest('.kanban-column');
    const collapsed = column.classList.toggle('is-collapsed');
    toggle.textContent = collapsed ? '＋' : '−'; toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', (collapsed ? 'Expandir' : 'Recolher') + ' coluna ' + key);
    try { const saved = JSON.parse(localStorage.getItem('trameli-kanban-collapsed-v1') || '[]'); const keys = new Set(Array.isArray(saved) ? saved : []); collapsed ? keys.add(key) : keys.delete(key); localStorage.setItem('trameli-kanban-collapsed-v1', JSON.stringify([...keys])); } catch { /* Temporary collapse still works. */ }
    return;
  }
  if (event.target.closest('[data-kanban-bulk-deliver]')) {
    const pending = orders.filter(order => order.date === dateInput.value && orderStatus(order) !== 'cancelled' && orderStatus(order) !== 'delivered');
    if (!pending.length) { kanbanFeedback.textContent = 'Todos os pedidos ativos desta data já estão entregues.'; return; }
    if (!window.confirm('Marcar os ' + pending.length + ' pedidos ainda não entregues desta data como Entregue? Cada alteração será registrada no histórico.')) return;
    const button = list.querySelector('[data-kanban-bulk-deliver]'); if (button) button.disabled = true;
    let completed = 0, failed = 0;
    for (const order of pending) {
      await moveOrder(order.id, 'delivered');
      if (orderStatus(orders.find(current => current.id === order.id) || {}) === 'delivered') completed++; else failed++;
    }
    kanbanFeedback.textContent = failed ? 'Concluído parcialmente: ' + completed + ' entregues, ' + failed + ' com falha. Confira as etapas.' : 'Pronto! ' + completed + ' pedidos foram marcados como entregues.';
    render(); return;
  }
});
list.addEventListener('change', event => {
  const select = event.target.closest('[data-move-id]');
  if (select?.value) moveOrder(select.dataset.moveId, select.value);
});

// A dedicated handle lets touch users drag without blocking normal page scrolling.
list.addEventListener('pointerdown', event => {
  const handle = event.target.closest('[data-drag-id]');
  if (!handle || handle.disabled || event.button !== 0) return;
  const id = handle.dataset.dragId;
  const pointerId = event.pointerId;
  const startX = event.clientX, startY = event.clientY;
  let x = startX, y = startY, ghost = null, frame = null, active = false;
  handle.setPointerCapture(pointerId);
  const tick = () => {
    const board = list.querySelector('.kanban');
    if (board) {
      const bounds = board.getBoundingClientRect();
      if (x < bounds.left + 48) board.scrollLeft -= 12;
      if (x > bounds.right - 48) board.scrollLeft += 12;
    }
    if (y < 70) window.scrollBy(0, -12);
    if (y > innerHeight - 70) window.scrollBy(0, 12);
    dragTarget(document.elementFromPoint(x, y));
    frame = requestAnimationFrame(tick);
  };
  const move = current => {
    if (current.pointerId !== pointerId) return;
    x = current.clientX; y = current.clientY;
    if (!active && Math.hypot(x - startX, y - startY) > 8) {
      if (!beginDrag(id)) return;
      active = true;
      ghost = handle.closest('.kanban-card').cloneNode(true);
      ghost.className = 'kanban-drag-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      document.body.append(ghost);
      frame = requestAnimationFrame(tick);
    }
    if (ghost) ghost.style.transform = `translate(${x + 12}px,${y + 12}px)`;
  };
  const finish = current => {
    if (current.pointerId !== pointerId) return;
    const target = active && current.type === 'pointerup' ? dragTarget(document.elementFromPoint(x, y)) : null;
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', finish);
    handle.removeEventListener('lostpointercapture', finish);
    cancelAnimationFrame(frame);
    ghost?.remove();
    clearDrag();
    if (active) suppressClickUntil = Date.now() + 350;
    if (target) moveOrder(id, target);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
});

async function openHistory(order) {
  if (!live || !historyDialog) return;
  try {
    const events = await live.orderEvents(order.id);
    historyDialog.innerHTML = `<div class="history-dialog__content"><button type="button" class="history-dialog__close" aria-label="Fechar">×</button><h2>Histórico do pedido</h2><p>${escapeHtml(order.customer)} · #${escapeHtml(orderCode(order))}</p><ol>${events.map(entry => {
      const before = entry.before_state;
      const after = entry.after_state;
      const change = !before ? 'Pedido criado' : before.status !== after.status ? `Estado: ${statusLabels[before.status] || before.status} → ${statusLabels[after.status] || after.status}` : 'Dados ou valores ajustados';
      return `<li><time>${new Date(entry.happened_at).toLocaleString('pt-BR')}</time><strong>${escapeHtml(change)}</strong><small>Conta: ${escapeHtml(entry.actor_id?.slice(0, 8) || 'sistema')}</small></li>`;
    }).join('')}</ol></div>`;
    historyDialog.querySelector('button').addEventListener('click', () => historyDialog.close());
    historyDialog.showModal();
  } catch (cause) { alert(`Não foi possível carregar o histórico: ${cause.message}`); }
}

// Pedido com pagamento vinculado: o Master decide se o pagamento fica registrado ou sai junto com o pedido.
function askPaymentMode(order) {
  return new Promise(resolve => {
    const dialogEl = document.createElement('dialog');
    dialogEl.className = 'payment-mode-dialog';
    dialogEl.innerHTML = `<form method="dialog"><h3>Este pedido tem pagamento vinculado</h3><p>Pedido de <strong>${escapeHtml(order.customer)}</strong>. O que fazer com o pagamento?</p><div class="payment-mode-dialog__actions"><button class="button button--primary" value="keep">Excluir o pedido e manter o pagamento</button><button class="button button--quiet order-detail__danger" value="delete">Excluir o pedido e o pagamento</button><button class="button button--quiet" value="">Voltar</button></div><small>Manter: o dinheiro continua registrado como recebimento sem pedido e pode ser vinculado a outro. Excluir os dois: o recebimento deixa de existir no sistema. Fechamentos diários já salvos não mudam.</small></form>`;
    document.body.append(dialogEl);
    dialogEl.addEventListener('close', () => { const value = dialogEl.returnValue; dialogEl.remove(); resolve(value === 'keep' || value === 'delete' ? value : null); });
    dialogEl.showModal();
  });
}

async function handleOrderAction(button) {
  if (button.dataset.action === 'new') { openForm(); return; }
  const order = orders.find(item => item.id === button.dataset.id);
  if (!order) return;
  if (movingOrders.has(order.id)) return;
  if (button.dataset.action === 'open') { openOrderDetail(order); return; }
  if (button.dataset.action === 'history') { await openHistory(order); return; }
  if (button.dataset.action === 'edit') { detailDrawer.close(); openForm(order); return; }
  if (button.dataset.action === 'make-recurring') {
    if (!live?.operator || !order.customerId || orderStatus(order) === 'cancelled') return;
    detailDrawer.close();
    openForm(order, null, true);
    return;
  }
  if (button.dataset.action === 'destroy') {
    if (live?.role !== 'master' || !confirm(`Excluir definitivamente o pedido de ${order.customer}? Esta ação não pode ser desfeita.`)) return;
    try {
      await window.TrameliAccount?.ensureMasterAal2?.();
      try { await live.deleteOrder(order.id, 'none'); }
      catch (cause) {
        if (!/pagamentos vinculados/i.test(cause.message || '')) throw cause;
        const mode = await askPaymentMode(order);
        if (!mode) return;
        await live.deleteOrder(order.id, mode);
      }
      orders = readOrders(); detailDrawer.close(); render();
    } catch (cause) { alert(`O pedido não foi excluído: ${cause.message}`); }
    return;
  }
  if (button.dataset.action === 'delete' && !confirm(`Cancelar o pedido de ${order.customer}? O registro ficará no histórico.`)) return;
  const previous = orders;
  const state = button.dataset.action === 'delete' ? 'cancelled' : button.dataset.action === 'back' ? previousStatus[orderStatus(order)] : nextStatus[orderStatus(order)];
  if (!state || ['cancelled', 'delivered'].includes(orderStatus(order))) return;
  if (button.dataset.action !== 'delete') { await moveOrder(order.id, state); return; }
  if (live) {
    try { await live.setStatus(order, state); orders = readOrders(); render(); }
    catch (cause) { alert(`O pedido não foi alterado: ${cause.message}`); }
    return;
  }
  orders = orders.map(item => item.id === order.id ? { ...item, status: state, checked: state !== 'received' } : item);
  if (!saveOrders()) { orders = previous; return; }
  render();
}

function preparePrint(orderSelection = null) {
  const dayOrders = orderSelection || selectedOrders();
  if (!dayOrders.length) { alert('Não há pedidos para imprimir na data selecionada.'); return false; }
  const printHost = document.getElementById('print-document');

  try {
    const saved = JSON.parse(localStorage.getItem(printSettingsKey) || '{}');
    for (const key of Object.keys(printDefaults)) {
      const value = Number(saved[key]);
      if (Number.isFinite(value) && value >= -3 && value <= 3 && value * 2 === Math.trunc(value * 2)) printSettings[key] = value;
    }
  } catch { /* Keep the last valid settings. */ }
  printHost.style.setProperty('--print-offset-x', `${printSettings.offsetX}mm`);
  printHost.style.setProperty('--print-offset-y', `${printSettings.offsetY}mm`);

  // Novo padrão: um cartão por pedido. Não divide mais o pedido em 1/2, 2/2 etc.
  // A dimensão final pode ser refinada quando o modelo/papel da mini impressora for confirmado.
  const renderOrder = (order, position) => {
    const items = Array.isArray(order.items) ? order.items : [];
    return '<article class="print-label print-label--order">' +
      '<div class="print-label__content">' +
      '<div class="print-label__top"><strong>' + escapeHtml(order.customer) + '</strong><span>' +
      escapeHtml(order.publicCode || String(position + 1).padStart(2, '0')) + '</span></div>' +
      (order.address ? '<p class="print-label__address">' + escapeHtml(order.address) + '</p>' : '') +
      '<ul>' + items.map(item => '<li><strong>' + escapeHtml(String(item.quantity ?? '')) + '×</strong> ' + escapeHtml(itemLabel(item).replace(/^\\s*\\d+(?:[.,]\\d+)?\\s*[x×]?\\s*/i, '')) + '</li>').join('') + '</ul>' +
      (order.notes ? '<small>Obs.: ' + escapeHtml(order.notes) + '</small>' : '') +
      '<footer>Total: ' + money(orderTotal(order)) + '</footer>' +
      '</div></article>';
  };

  printHost.innerHTML = '<section class="print-sheet print-sheet--orders">' +
    dayOrders.map(renderOrder).join('') + '</section>';
  return true;
}

document.getElementById('new-order').addEventListener('click', () => { location.hash = '#portal-shirley'; });
form.elements.recurrence.addEventListener('change', () => {
  const weekdaysFieldset = document.getElementById('recurrence-weekdays');
  if (weekdaysFieldset) weekdaysFieldset.hidden = form.elements.recurrence.value === 'once';
});
document.getElementById('manage-recurring-orders').addEventListener('click', showRecurringManager);
if (recurringManager) recurringManager.addEventListener('click', async event => {
  if (event.target.closest('[data-recurring-close]')) { recurringManager.close(); return; }
  const reviewButton = event.target.closest('[data-recurring-review]');
  if (reviewButton) {
    reviewButton.disabled = true;
    try {
      await live.reviewRecurringRequest(reviewButton.dataset.recurringReview, reviewButton.dataset.approve === 'true');
      orders = readOrders();
      await showRecurringManager();
      const currentFeedback = recurringManager.querySelector('.recurring-manager__feedback');
      if (currentFeedback) currentFeedback.textContent = reviewButton.dataset.approve === 'true'
        ? 'Solicitação aprovada; programação recorrente criada.' : 'Solicitação recusada.';
    } catch (cause) {
      const currentFeedback = recurringManager.querySelector('.recurring-manager__feedback');
      if (currentFeedback) currentFeedback.textContent = 'Não foi possível analisar a solicitação: ' + cause.message;
      reviewButton.disabled = false;
    }
    return;
  }
  const editButton = event.target.closest('[data-recurring-edit]');
  if (editButton) {
    const schedule = recurringSchedulesCache.find(item => item.id === editButton.dataset.recurringEdit);
    if (!schedule) return;
    recurringManager.close();
    if (schedule.items_by_weekday) {
      location.hash = '#portal-shirley';
      window.dispatchEvent(new CustomEvent('trameli:shirley-edit-schedule', { detail: schedule }));
      return;
    }
    openForm(null, schedule);
    return;
  }
  const deleteButton = event.target.closest('[data-recurring-delete]');
  if (deleteButton) {
    const scheduleId = deleteButton.dataset.recurringDelete;
    if (!window.confirm('Excluir esta programação e todos os pedidos já gerados por ela? Os pedidos manuais e de outras programações não serão afetados. Os registros de pagamentos serão preservados, mas deixarão de ficar vinculados aos pedidos excluídos.')) return;
    deleteButton.disabled = true;
    try {
      const removedCount = await live.deleteRecurringSchedule(scheduleId);
      orders = readOrders();
      render();
      await showRecurringManager();
      const feedback = recurringManager.querySelector('.recurring-manager__feedback');
      if (feedback) feedback.textContent = 'Programação excluída. ' + removedCount + ' pedido(s) gerado(s) removido(s); registros de pagamentos preservados.';
    } catch (cause) {
      const feedback = recurringManager.querySelector('.recurring-manager__feedback');
      if (feedback) feedback.textContent = 'Não foi possível excluir a programação: ' + cause.message;
    } finally {
      if (deleteButton.isConnected) deleteButton.disabled = false;
    }
    return;
  }
  const activeButton = event.target.closest('[data-recurring-active]');
  if (activeButton) {
    activeButton.disabled = true;
    try {
      await live.setRecurringScheduleActive(activeButton.dataset.recurringActive, activeButton.dataset.active === 'true');
      await showRecurringManager();
    } catch (cause) {
      const feedback = recurringManager.querySelector('.recurring-manager__feedback');
      if (feedback) feedback.textContent = 'Não foi possível alterar a recorrência: ' + cause.message;
    } finally { activeButton.disabled = false; }
  }
});
document.getElementById('add-item').addEventListener('click', () => addItem());
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
document.getElementById('cancel-dialog').addEventListener('click', () => dialog.close());
form.elements.customerId.addEventListener('change', syncSelectedCustomer);
catalogHost.addEventListener('click', event => {
  const button = event.target.closest('[data-product-step][data-product-id]');
  if (!button) return;
  const id = button.dataset.productId;
  const product = (live?.products || window.TrameliCatalog?.list() || []).find(item => item.id === id);
  if (!product) return;
  const current = selectedProductQuantities.get(id) || 0;
  const next = Math.max(0, Math.min(product.unit === 'kg' ? 99 : 999, current + Number(button.dataset.productStep)));
  if (next) selectedProductQuantities.set(id, next); else selectedProductQuantities.delete(id);
  renderProductCatalog();
  updateFormTotal();
});
form.elements.fee.addEventListener('input', updateFormTotal);
dateInput.addEventListener('change', async () => {
  if (live?.operator && dateInput.value) {
    try { await live.materializeRecurringOrders(dateInput.value); orders = readOrders(); }
    catch (cause) { kanbanFeedback.textContent = 'Não foi possível gerar os pedidos recorrentes: ' + cause.message; }
  }
  render();
});
searchInput.addEventListener('input', render);
const businessLabel = () => live?.settings?.business_name || window.TrameliSettings?.businessName || 'Pão Doce';
async function buildPeriodReport() {
  const period = selectedPeriod();
  if (!costsAvailable()) throw new Error('Os custos só ficam disponíveis com o banco conectado e a migração de custos aplicada.');
  const inPeriod = periodOrders(period);
  if (!inPeriod.length) throw new Error('Não há pedidos neste período.');
  await loadCostsFor(inPeriod);
  const report = supplierPeriodReport(orders, supplierCostMap || new Map(), period.from, period.to, live?.products || [], item => (supplierProvider?.value || 'divano') === 'sandra' ? isSandraSupplierItem(item.name) : !isSandraSupplierItem(item.name));
  if (!report.orderCount) throw new Error('Não há itens dessa padaria neste período.');
  return { period, report };
}
supplierPeriodSelect?.addEventListener('change', () => { supplierFeedback.textContent = ''; renderSupplierList(); });
supplierCopy.addEventListener('click', async () => {
  let content;
  try {
    if (selectedPeriod().kind === 'diario') {
      const groups = repasseGroups();
      if (!groups.length) throw new Error('Não há itens dessa padaria nesta data.');
      content = supplierText(groups, dateInput.value);
    } else {
      const { period, report } = await buildPeriodReport();
      content = supplierPeriodText(report, periodKinds[period.kind], businessLabel());
    }
  } catch (cause) { supplierFeedback.textContent = cause.message; return; }
  try {
    await navigator.clipboard.writeText(content);
    supplierFeedback.textContent = 'Lista copiada. Confira as quantidades e os custos antes de enviar.';
  } catch {
    supplierFeedback.textContent = 'Não foi possível copiar automaticamente neste navegador.';
  }
});
supplierList.addEventListener('change', event => {
  const input = event.target.closest('input[type="checkbox"]');
  if (!input) return;
  const orderId = input.dataset.supplierCheckOrder || input.dataset.id;
  const order = orders.find(order => order.id === orderId);
  if (!order) return;
  const index = input.dataset.supplierCheckItem;
  const indices = index === undefined ? order.items.map((_, index) => index) : [Number(index)];
  for (const position of indices) {
    const key = itemCheckKey(order, position);
    if (input.checked) supplierChecks.add(key); else supplierChecks.delete(key);
  }
  try {
    const currentKeys = new Set(orders.flatMap(order => order.items.map((_, index) => itemCheckKey(order, index))));
    supplierChecks = new Set([...supplierChecks].filter(key => currentKeys.has(key)));
    localStorage.setItem(checklistKey, JSON.stringify([...supplierChecks]));
    supplierFeedback.textContent = 'Conferência salva neste navegador. Marcar itens não altera a etapa do pedido.';
  } catch { supplierFeedback.textContent = 'A conferência está marcada, mas este navegador não conseguiu salvá-la. Baixe o PDF antes de sair.'; }
  renderSupplierList();
  [...supplierList?.querySelectorAll('input') || []].find(current => index === undefined
    ? current.dataset.supplierCheckOrder === orderId
    : current.dataset.id === orderId && current.dataset.supplierCheckItem === index)?.focus({ preventScroll: true });
});

async function generateSeparationPdf() {
  if (!separationPdf || separationPdf.dataset.busy) return;
  separationPdf.dataset.busy = 'true'; separationPdf.disabled = true;
  if (separationFeedback) separationFeedback.textContent = 'Gerando PDF de separação…';
  try {
    const groups = checklistGroups();
    if (!groups.length) throw new Error('Não há itens dessa padaria para separar na data selecionada.');
    await downloadSeparationPdf(groups, dateInput.value, businessLabel(), 'Lista única');
    if (separationFeedback) separationFeedback.textContent = 'PDF de separação baixado. Clientes ordenados por endereço/rua e depois por nome; sem valores financeiros.';
  } catch (error) {
    if (separationFeedback) separationFeedback.textContent = `Não foi possível gerar a lista: ${error.message}`;
  } finally {
    delete separationPdf.dataset.busy;
    if (separationPdf) separationPdf.disabled = false;
    renderSupplierList();
  }
}
separationPdf?.addEventListener('click', generateSeparationPdf);
supplierProvider?.addEventListener('change', () => { supplierFeedback.textContent = ''; renderSupplierList(); });

supplierPdf?.addEventListener('click', async () => {
  if (supplierPdf.dataset.busy) return;
  supplierPdf.dataset.busy = 'true'; supplierPdf.disabled = true;
  supplierFeedback.textContent = 'Gerando PDF…';
  try {
    if (selectedPeriod().kind === 'diario') {
      const groups = repasseGroups();
      if (!groups.length) throw new Error('Não há itens dessa padaria nesta data.');
      const exportDate = dateInput.value;
      if (costsAvailable()) await loadCostsFor(orders.filter(order => order.date === exportDate && orderStatus(order) !== 'cancelled'));
      await downloadSupplierPdf(checklistGroups(), exportDate, businessLabel());
      supplierFeedback.textContent = costsAvailable()
        ? 'PDF de repasse baixado com a lista consolidada por material e os valores de custo.'
        : 'PDF de repasse baixado com a lista consolidada por material. Os custos só aparecem com o banco conectado.';
    } else {
      const { period, report } = await buildPeriodReport();
      await downloadSupplierPeriodPdf(report, periodKinds[period.kind], businessLabel());
      supplierFeedback.textContent = `PDF ${periodKinds[period.kind].toLowerCase()} baixado (${periodLabel(period.from, period.to)}) com itens, custo por dia e total.${report.missingLines ? ` Atenção: ${report.missingLines} item(ns) sem custo cadastrado.` : ''}`;
    }
  } catch (error) { supplierFeedback.textContent = `Não foi possível gerar o PDF: ${error.message}`; }
  finally { delete supplierPdf.dataset.busy; renderSupplierList(); }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const items = formItems();
  const feeCents = 200;
  const customerId = form.elements.customerId.value;
  const customerProfile = customerProfiles().find(profile => profile.user_id === customerId);
  const customer = customerProfile?.name || '';
  const address = customerProfile?.address || '';
  const phone = customerProfile?.phone || '';
  const recurrence = editingScheduleId ? form.elements.recurrence.value : editingId ? 'once' : form.elements.recurrence.value;
  const weekdays = [...new Set([...form.querySelectorAll('input[name="weekdays"]:checked')].map(input => Number(input.value)))].sort((a, b) => a - b);
  const sundayDelivery = Boolean(form.elements.date.value)
    && new Date(form.elements.date.value + 'T12:00:00').getDay() === 0;
  if (!customerId || !customer || !address || !form.elements.date.value || sundayDelivery || (recurrence !== 'once' && !weekdays.length) || !items.length
    || items.some(item => !item.name || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999
      || !Number.isInteger(item.priceCents) || item.priceCents < 0
      || (item.weightGrams !== undefined && (!Number.isInteger(item.weightGrams) || item.weightGrams < 50 || item.weightGrams > 4950 || item.weightGrams % 50 !== 0)))) {
    formError.textContent = sundayDelivery ? 'Não fazemos entregas aos domingos. Escolha outra data.' : (recurrence !== 'once' && !weekdays.length) ? 'Selecione pelo menos um dia para a recorrência.' : 'Selecione um cliente cadastrado e pelo menos um produto com quantidade válida.';
    formError.hidden = false;
    return;
  }
  if (recurrence !== 'once' && !live) {
    formError.textContent = 'A repetição automática exige conexão com o banco de dados.';
    formError.hidden = false;
    return;
  }
  const previous = orders.find(order => order.id === editingId);
  if (!editingId && recurrence === 'once') {
    const duplicate = orders.find(order => order.customerId === customerId && order.date === form.elements.date.value
      && orderStatus(order) !== 'cancelled');
    if (duplicate) {
      formError.textContent = 'Este cliente já tem um pedido para essa data. Abra o pedido existente e escolha Editar pedido.';
      formError.hidden = false;
      return;
    }
  }
  const createdAt = previous?.createdAt || new Date().toISOString();
  const order = {
    id: editingId || (live ? null : (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)),
    publicCode: previous?.publicCode || (live ? '' : localOrderCode(createdAt)),
    version: previous?.version || null,
    createdAt,
    checked: false,
    status: 'received',
    editedAt: previous ? new Date().toISOString() : null,
    customerId, customer, address, phone,
    date: form.elements.date.value, feeCents, items, notes: form.elements.notes.value.trim(),
  };
  if (live) {
    submitting = true;
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      if (recurrence === 'once') {
        await live.saveOperatorOrder(order, requestId, customerId);
      } else {
        await live.saveRecurringOrder({
          customerId, recurrence, startDate: order.date, notes: order.notes, feeCents, weekdays,
          items: items.map(item => item.weightGrams !== undefined
            ? ({ productId: item.productId, name: item.name, quantity: item.quantity, weightGrams: item.weightGrams, kgPriceCents: item.kgPriceCents, priceCents: item.priceCents })
            : ({ name: item.name, quantity: item.quantity, priceCents: item.priceCents })),
        }, requestId, editingScheduleId);
        await live.materializeRecurringOrders(order.date);
      }
      orders = readOrders();
      dateInput.value = order.date;
      searchInput.value = '';
      dialog.close();
      render();
    } catch (cause) { formError.textContent = `Não foi possível salvar: ${cause.message}`; formError.hidden = false; }
    finally { submitting = false; submitButton.disabled = false; }
    return;
  }
  const next = editingId ? orders.map(item => item.id === editingId ? order : item) : [...orders, order];
  const old = orders;
  orders = next;
  if (!saveOrders()) { orders = old; return; }
  dateInput.value = order.date;
  searchInput.value = '';
  dialog.close();
  render();
});

list.addEventListener('click', event => {
  if (Date.now() < suppressClickUntil) { event.preventDefault(); return; }
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  handleOrderAction(button);
});

detailDrawer.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'close-detail') { detailDrawer.close(); return; }
  handleOrderAction(button);
});
detailDrawer.addEventListener('close', () => { detailId = null; });

document.getElementById('print-orders')?.addEventListener('click', openLabelPrintDialog);
printSettingsHost?.addEventListener('change', event => {
  const input = event.target.closest('input[name]');
  if (!input) return;
  if (!(input.name in printDefaults)) return;
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < -3 || value > 3 || value * 2 !== Math.trunc(value * 2)) { input.value = printSettings[input.name]; return; }
  printSettings[input.name] = value;
  try { localStorage.setItem(printSettingsKey, JSON.stringify(printSettings)); } catch { /* Printing still works. */ }
});

render();
if (live?.operator && dateInput.value) {
  live.materializeRecurringOrders(dateInput.value).then(() => { orders = readOrders(); render(); })
    .catch(cause => { kanbanFeedback.textContent = 'Não foi possível carregar pedidos recorrentes: ' + cause.message; });
}
window.addEventListener('trameli:orders-changed', () => { resetCosts(); orders = readOrders(); render(); });
window.addEventListener('storage', event => {
  if (event.key === storageKey) { orders = readOrders(); render(); }
  if (event.key === checklistKey) {
    try { const saved = JSON.parse(event.newValue || '[]'); supplierChecks = new Set(Array.isArray(saved) ? saved : []); renderSupplierList(); } catch { /* Ignore invalid storage. */ }
  }
});
function openNewOrder(prefill = {}) {
  const showForm = () => {
    openForm();
    fillCustomerOptions('', prefill.customer || '');
    form.elements.date.value = prefill.date || dateInput.value;
    form.elements.notes.value = prefill.notes || '';
    if (Array.isArray(prefill.items) && prefill.items.length) {
      const products = live?.products || window.TrameliCatalog?.list() || [];
      for (const item of prefill.items) {
        const product = products.find(candidate => candidate.active && candidate.name.toLocaleLowerCase('pt-BR') === String(item.name || '').toLocaleLowerCase('pt-BR'));
        if (product) selectedProductQuantities.set(product.id, Math.min(product.unit === 'kg' ? 99 : 999, Math.max(1, Number(item.quantity) || 1)));
      }
      renderProductCatalog();
      updateFormTotal();
    }
  };
  if (location.hash === '#operacao' && !document.getElementById('operation-view').hidden) {
    showForm();
    return;
  }
  const onRoute = event => {
    if (event.detail?.route !== 'operacao') return;
    window.removeEventListener('trameli:route-rendered', onRoute);
    showForm();
  };
  window.addEventListener('trameli:route-rendered', onRoute);
  location.hash = '#operacao';
}
function openOrderById(id) {
  orders = readOrders();
  const order = orders.find(item => item.id === id);
  if (order) openOrderDetail(order);
}
window.addEventListener('trameli:new-order', event => openNewOrder(event.detail || {}));
window.TrameliOperation = { preparePrint, openOrder: openOrderById, openNew: openNewOrder };
})();
