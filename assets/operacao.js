import { stages, statusPath, progressOrder } from '../src/operation-flow.js';
import { supplierGroups, supplierTotals, supplierText, downloadSupplierPdf, itemCheckKey } from '../src/supplier-checklist.js';

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
const formError = document.getElementById('form-error');
const printSettingsHost = document.getElementById('print-settings');
const historyDialog = live ? document.createElement('dialog') : null;
if (historyDialog) { historyDialog.className = 'history-dialog'; document.body.append(historyDialog); }
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
const statusLabels = { received: 'A conferir', confirmed: 'Conferido', packing: 'Em separação', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' };
const nextStatus = { received: 'confirmed', confirmed: 'packing', packing: 'ready', ready: 'delivered' };
const previousStatus = { confirmed: 'received', packing: 'confirmed', ready: 'packing' };
const orderStatus = order => order.status || (order.checked ? 'confirmed' : 'received');
const paymentLabels = { pix_manual: 'Pix', cash: 'Dinheiro', bank: 'Transferência', other: 'A combinar', unspecified: 'Não informado' };
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
  if (!afterRollover || todayPending) return today;
  const next = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
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

function formItems() {
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
  const fee = parseMoney(form.elements.fee.value);
  const items = formItems();
  const valid = fee !== null && items.every(item => Number.isInteger(item.quantity) && item.quantity > 0
    && item.priceCents !== null && (item.weightGrams === undefined || (Number.isInteger(item.weightGrams)
      && item.weightGrams >= 50 && item.weightGrams <= 4950 && item.weightGrams % 50 === 0)));
  const productsTotal = items.reduce((sum, item) => sum + itemTotal(item), 0);
  const hasItems = items.some(item => item.name && item.priceCents !== null && item.quantity > 0);
  document.getElementById('form-subtotal').textContent = !hasItems ? money(0) : valid ? money(productsTotal) : '—';
  document.getElementById('form-delivery-summary').hidden = !hasItems;
  document.getElementById('form-total').textContent = !hasItems ? money(0) : valid ? money(productsTotal + fee) : '—';
}

function openForm(order = null) {
  editingId = order?.id || null;
  requestId = order ? null : crypto.randomUUID();
  form.reset();
  formError.hidden = true;
  itemsHost.replaceChildren();
  form.elements.date.value = order?.date || dateInput.value;
  form.elements.fee.value = '2,00';
  form.elements.customer.value = order?.customer || '';
  form.elements.phone.value = order?.phone || '';
  form.elements.address.value = order?.address || '';
  form.elements.notes.value = order?.notes || '';
  (order?.items || [{}]).forEach(addItem);
  document.getElementById('dialog-title').textContent = order ? 'Editar pedido' : 'Novo pedido';
  updateFormTotal();
  dialog.showModal();
  form.elements.customer.focus();
}

function selectedOrders() {
  return orders.filter(order => order.date === dateInput.value && orderStatus(order) !== 'cancelled').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function checklistGroups() { return supplierGroups(orders, dateInput.value, supplierChecks); }

function renderSupplierList() {
  const validKeys = new Set(orders.filter(order => orderStatus(order) !== 'cancelled').flatMap(order => order.items.map((_, index) => itemCheckKey(order, index))));
  const retained = new Set([...supplierChecks].filter(key => validKeys.has(key)));
  if (retained.size !== supplierChecks.size) {
    supplierChecks = retained;
    try { localStorage.setItem(checklistKey, JSON.stringify([...supplierChecks])); } catch { /* Optional checklist persistence. */ }
  }
  const groups = checklistGroups();
  const totals = supplierTotals(groups);
  if (supplierTotalsHost) supplierTotalsHost.innerHTML = totals.length
    ? `<ul>${totals.map(product => `<li><strong>${product.grams ? `${product.grams} g` : `${product.quantity}×`}</strong><span>${escapeHtml(product.name)}</span></li>`).join('')}</ul>`
    : '<p class="supplier-list__empty">Nenhum item nesta data.</p>';
  supplierList.innerHTML = groups.length ? groups.map(group => `<section class="supplier-client"><header><h3>${escapeHtml(group.customer)}</h3><p>${escapeHtml(group.address)}</p></header>${group.orders.map(order => `<article class="supplier-order${order.checked ? ' is-complete' : ''}" data-supplier-order="${escapeHtml(order.id)}"><label class="supplier-order__heading"><input type="checkbox" data-supplier-check-order="${escapeHtml(order.id)}" ${order.checked ? 'checked' : ''}><strong>Pedido #${escapeHtml(order.id.slice(0, 8))}</strong><span>${order.lines.filter(line => line.checked).length}/${order.lines.length} itens conferidos</span></label><ul>${order.lines.map((line, index) => `<li><label class="supplier-item${line.checked ? ' is-complete' : ''}"><input type="checkbox" data-supplier-check-item="${index}" data-id="${escapeHtml(order.id)}" ${line.checked ? 'checked' : ''}><span>${escapeHtml(line.label)}</span></label></li>`).join('')}</ul>${order.notes ? `<p class="supplier-order__notes">Observação: ${escapeHtml(order.notes)}</p>` : ''}</article>`).join('')}</section>`).join('') : '<p class="supplier-list__empty">Nenhum pedido nesta data.</p>';
  supplierList.querySelectorAll('[data-supplier-check-order]').forEach(input => {
    const order = groups.flatMap(group => group.orders).find(order => order.id === input.dataset.supplierCheckOrder);
    input.indeterminate = !order.checked && order.lines.some(line => line.checked);
  });
  supplierCopy.disabled = !groups.length;
  if (supplierPdf && !supplierPdf.dataset.busy) supplierPdf.disabled = !groups.length;
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
    return `<article class="kanban-card${busy ? ' is-moving' : ''}" data-card-id="${escapeHtml(order.id)}" aria-busy="${busy}"><button class="order-card order-card--${state}" type="button" data-action="open" data-id="${escapeHtml(order.id)}" draggable="${movable}" aria-label="Abrir pedido de ${escapeHtml(order.customer)}"><span class="order-card__top"><span class="order-card__id">#${escapeHtml(order.id.slice(0, 8))}</span><span class="status status--${state}">${escapeHtml(statusLabels[state])}</span></span><strong class="order-card__customer">${escapeHtml(order.customer)}</strong><span class="order-card__meta">${itemCount} ${itemCount === 1 ? 'item' : 'itens'} · ${money(orderTotal(order))}</span><span class="order-card__delivery">Entrega ${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>${order.notes ? '<span class="order-card__alert">Tem observação</span>' : ''}<span class="order-card__open">Ver pedido <span aria-hidden="true">→</span></span></button>${destinations.length ? `<div class="kanban-card__move"><button type="button" class="kanban-drag-handle" data-drag-id="${escapeHtml(order.id)}" aria-label="Arrastar pedido de ${escapeHtml(order.customer)}" aria-describedby="kanban-help" ${busy ? 'disabled' : ''}><span aria-hidden="true">⠿</span></button><label><span class="sr-only">Mover pedido de ${escapeHtml(order.customer)} para</span><select data-move-id="${escapeHtml(order.id)}" ${busy ? 'disabled' : ''}><option value="">${busy ? 'Movendo…' : 'Mover para…'}</option>${destinations.map(stage => `<option value="${stage.key}">${stage.title}</option>`).join('')}</select></label></div>` : ''}</article>`;
  };
  const columns = stages;
  list.innerHTML = `<div class="kanban" aria-label="Pedidos por etapa">${columns.map(column => {
    const columnOrders = filtered.filter(order => column.key === orderStatus(order));
    return `<section class="kanban-column kanban-column--${column.key}" data-drop-status="${column.key}" aria-labelledby="kanban-${column.key}"><header><div><h3 id="kanban-${column.key}">${column.title}</h3><p>${column.note}</p></div><strong aria-label="${columnOrders.length} pedidos">${columnOrders.length}</strong></header><div class="kanban-column__cards">${columnOrders.length ? columnOrders.map(card).join('') : `<p class="kanban-empty">${displayOrders.length ? 'Nenhum pedido nesta etapa.' : column.key === 'received' ? 'Os novos pedidos aparecerão aqui.' : 'Nada por aqui ainda.'}</p>`}</div></section>`;
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
  return `<div class="order-detail__actions">${nextStatus[state] ? `<button class="button button--primary" type="button" data-action="toggle" data-id="${escapeHtml(order.id)}">Avançar para ${escapeHtml(statusLabels[nextStatus[state]].toLowerCase())}</button>` : ''}${previousStatus[state] && master ? `<button class="button button--quiet" type="button" data-action="back" data-id="${escapeHtml(order.id)}">Voltar para ${escapeHtml(statusLabels[previousStatus[state]].toLowerCase())}</button>` : ''}${!['delivered', 'cancelled'].includes(state) && canCorrect ? `<button class="button button--quiet" type="button" data-action="edit" data-id="${escapeHtml(order.id)}">Editar pedido</button>` : ''}${live ? `<button class="button button--quiet" type="button" data-action="history" data-id="${escapeHtml(order.id)}">Ver histórico</button>` : ''}${!['delivered', 'cancelled'].includes(state) && canCorrect ? `<button class="order-detail__danger" type="button" data-action="delete" data-id="${escapeHtml(order.id)}">Cancelar pedido</button>` : ''}${live?.role === 'master' ? `<button class="order-detail__danger" type="button" data-action="destroy" data-id="${escapeHtml(order.id)}">Excluir definitivamente</button>` : ''}</div>`;
}

function renderOrderDetail(order) {
  const state = orderStatus(order);
  const itemRows = order.items.map(item => `<li><span><strong>${escapeHtml(itemLabel(item))}</strong><small>${money(item.priceCents)}${item.weightGrams ? '' : ' cada'}</small></span><strong>${money(itemTotal(item))}</strong></li>`).join('');
  detailContent.innerHTML = `<div class="order-detail"><header class="order-detail__header"><div><p class="eyebrow">PEDIDO #${escapeHtml(order.id.slice(0, 8))}</p><h2 id="order-detail-title">${escapeHtml(order.customer)}</h2><span class="status status--${state}">${escapeHtml(statusLabels[state])}</span></div><button class="order-detail__close" type="button" data-action="close-detail" aria-label="Fechar detalhes">×</button></header><div class="order-detail__body"><section class="order-detail__section"><h3>Entrega</h3><p><strong>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong></p><p>${escapeHtml(order.address)}</p>${order.phone ? `<p><a href="tel:${escapeHtml(order.phone)}">${escapeHtml(order.phone)}</a></p>` : '<p class="order-detail__muted">Telefone não informado</p>'}</section><section class="order-detail__section"><div class="order-detail__section-heading"><h3>Itens</h3><span>${order.items.length} ${order.items.length === 1 ? 'linha' : 'linhas'}</span></div><ul class="order-detail__items">${itemRows}</ul><div class="order-detail__totals"><p><span>Produtos</span><strong>${money(orderSubtotal(order))}</strong></p><p><span>Entrega</span><strong>${money(order.feeCents)}</strong></p><p><span>Total</span><strong>${money(orderTotal(order))}</strong></p></div></section><div class="order-detail__grid"><section class="order-detail__section"><h3>Pagamento</h3><p>${escapeHtml(paymentLabels[order.paymentMethod || 'unspecified'] || order.paymentMethod)}</p><small>A forma escolhida não confirma recebimento.</small></section><section class="order-detail__section"><h3>Observação</h3><p>${order.notes ? escapeHtml(order.notes) : '<span class="order-detail__muted">Nenhuma observação.</span>'}</p></section></div></div>${detailActions(order)}</div>`;
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
      orders = orders.map(item => item.id === id ? { ...item, status: target, checked: target !== 'received' } : item);
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
    historyDialog.innerHTML = `<div class="history-dialog__content"><button type="button" class="history-dialog__close" aria-label="Fechar">×</button><h2>Histórico do pedido</h2><p>${escapeHtml(order.customer)} · #${escapeHtml(order.id.slice(0, 8))}</p><ol>${events.map(entry => {
      const before = entry.before_state;
      const after = entry.after_state;
      const change = !before ? 'Pedido criado' : before.status !== after.status ? `Estado: ${statusLabels[before.status] || before.status} → ${statusLabels[after.status] || after.status}` : 'Dados ou valores ajustados';
      return `<li><time>${new Date(entry.happened_at).toLocaleString('pt-BR')}</time><strong>${escapeHtml(change)}</strong><small>Conta: ${escapeHtml(entry.actor_id?.slice(0, 8) || 'sistema')}</small></li>`;
    }).join('')}</ol></div>`;
    historyDialog.querySelector('button').addEventListener('click', () => historyDialog.close());
    historyDialog.showModal();
  } catch (cause) { alert(`Não foi possível carregar o histórico: ${cause.message}`); }
}

async function handleOrderAction(button) {
  if (button.dataset.action === 'new') { openForm(); return; }
  const order = orders.find(item => item.id === button.dataset.id);
  if (!order) return;
  if (movingOrders.has(order.id)) return;
  if (button.dataset.action === 'open') { openOrderDetail(order); return; }
  if (button.dataset.action === 'history') { await openHistory(order); return; }
  if (button.dataset.action === 'edit') { detailDrawer.close(); openForm(order); return; }
  if (button.dataset.action === 'destroy') {
    if (live?.role !== 'master' || !confirm(`Excluir definitivamente o pedido de ${order.customer}? Esta ação não pode ser desfeita.`)) return;
    try { await window.TrameliAccount?.ensureMasterAal2?.(); await live.deleteOrder(order.id); orders = readOrders(); detailDrawer.close(); render(); }
    catch (cause) { alert(`O pedido não foi excluído: ${cause.message}`); }
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

function preparePrint() {
  const dayOrders = selectedOrders();
  if (!dayOrders.length) { alert('Não há pedidos para imprimir na data selecionada.'); return false; }
  const labels = window.TrameliOrderMath.labelsForPrint(dayOrders);
  const slots = 27;
  const printHost = document.getElementById('print-document');
  printHost.style.setProperty('--print-offset-x', `${printSettings.offsetX}mm`);
  printHost.style.setProperty('--print-offset-y', `${printSettings.offsetY}mm`);
  const pages = [];
  for (let index = 0; index < labels.length; index += slots) {
    const pageLabels = labels.slice(index, index + slots);
    pages.push(`<section class="print-page"><div class="print-grid">${pageLabels.map(({ order, items, part, totalParts }, slot) => `<article class="print-label"><div class="print-label__content"><div class="print-label__top"><strong>${escapeHtml(order.customer)}</strong><span>${totalParts > 1 ? `${part}/${totalParts}` : String(index + slot + 1).padStart(2, '0')}</span></div><p>${escapeHtml(order.address)}</p><ul>${items.map(item => `<li>${escapeHtml(itemLabel(item))}</li>`).join('')}</ul>${order.notes && part === totalParts ? `<small>Obs.: ${escapeHtml(order.notes)}</small>` : ''}<footer>Total: ${money(orderTotal(order))}</footer></div></article>`).join('')}</div></section>`);
  }
  printHost.innerHTML = pages.join('');
  return true;
}

document.getElementById('new-order').addEventListener('click', () => openForm());
document.getElementById('add-item').addEventListener('click', () => addItem());
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
document.getElementById('cancel-dialog').addEventListener('click', () => dialog.close());
form.elements.customer.addEventListener('change', event => {
  const client = window.TrameliClients?.findByName(event.target.value);
  if (!client) return;
  form.elements.address.value = client.address;
  form.elements.phone.value = client.phone;
});
form.elements.fee.addEventListener('input', updateFormTotal);
dateInput.addEventListener('change', render);
searchInput.addEventListener('input', render);
supplierCopy.addEventListener('click', async () => {
  const groups = checklistGroups();
  if (!groups.length) return;
  const content = supplierText(groups, dateInput.value);
  try {
    await navigator.clipboard.writeText(content);
    supplierFeedback.textContent = 'Lista copiada. Confira as quantidades antes de enviar.';
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
  [...supplierList.querySelectorAll('input')].find(current => index === undefined
    ? current.dataset.supplierCheckOrder === orderId
    : current.dataset.id === orderId && current.dataset.supplierCheckItem === index)?.focus({ preventScroll: true });
});
supplierPdf?.addEventListener('click', async () => {
  if (supplierPdf.dataset.busy) return;
  const groups = checklistGroups();
  if (!groups.length) return;
  const exportDate = dateInput.value;
  supplierPdf.dataset.busy = 'true'; supplierPdf.disabled = true;
  supplierFeedback.textContent = 'Gerando PDF…';
  try {
    await downloadSupplierPdf(groups, exportDate, live?.settings?.business_name || window.TrameliSettings?.businessName || 'Trameli');
    supplierFeedback.textContent = 'PDF baixado com a lista completa e os pedidos por cliente, sem valores. As marcações no PDF são independentes do site.';
  } catch (error) { supplierFeedback.textContent = `Não foi possível gerar o PDF: ${error.message}`; }
  finally { delete supplierPdf.dataset.busy; renderSupplierList(); }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const items = formItems();
  const feeCents = 200;
  const customer = form.elements.customer.value.trim();
  const address = form.elements.address.value.trim();
  if (!customer || !address || !form.elements.date.value || feeCents === null || !items.length || items.some(item => !item.name || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 || item.priceCents === null || (item.weightGrams !== undefined && (!Number.isInteger(item.weightGrams) || item.weightGrams < 50 || item.weightGrams > 4950 || item.weightGrams % 50 !== 0)))) {
    formError.textContent = 'Confira nome, endereço, data, taxa e os itens com quantidade e preço válidos.';
    formError.hidden = false;
    return;
  }
  const previous = orders.find(order => order.id === editingId);
  const order = {
    id: editingId || (live ? null : (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)),
    version: previous?.version || null,
    createdAt: previous?.createdAt || new Date().toISOString(),
    checked: previous?.checked || false,
    status: previous ? orderStatus(previous) : 'received',
    customer, address, phone: form.elements.phone.value.trim(),
    date: form.elements.date.value, feeCents, items, notes: form.elements.notes.value.trim(),
  };
  if (live) {
    submitting = true;
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      await live.saveOperatorOrder(order, requestId);
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

for (const id of ['print-orders']) {
  document.getElementById(id)?.addEventListener('click', () => { if (preparePrint()) window.print(); });
}
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
window.addEventListener('trameli:orders-changed', () => { orders = readOrders(); render(); });
window.addEventListener('storage', event => {
  if (event.key === storageKey) { orders = readOrders(); render(); }
  if (event.key === checklistKey) {
    try { const saved = JSON.parse(event.newValue || '[]'); supplierChecks = new Set(Array.isArray(saved) ? saved : []); renderSupplierList(); } catch { /* Ignore invalid storage. */ }
  }
});
function openNewOrder(prefill = {}) {
  location.hash = '#operacao';
  setTimeout(() => {
    openForm();
    form.elements.customer.value = prefill.customer || '';
    form.elements.phone.value = prefill.phone || '';
    form.elements.address.value = prefill.address || '';
    form.elements.date.value = prefill.date || dateInput.value;
    form.elements.notes.value = prefill.notes || '';
    if (Array.isArray(prefill.items) && prefill.items.length) {
      itemsHost.replaceChildren();
      prefill.items.forEach(item => addItem(item));
      updateFormTotal();
    }
  }, 260);
}
function openOrderById(id) {
  orders = readOrders();
  const order = orders.find(item => item.id === id);
  if (order) openOrderDetail(order);
}
window.addEventListener('trameli:new-order', event => openNewOrder(event.detail || {}));
window.TrameliOperation = { preparePrint, openOrder: openOrderById, openNew: openNewOrder };
})();
