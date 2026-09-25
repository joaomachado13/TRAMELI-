(() => {
const live = window.TrameliLive;
const storageKey = 'trameli-operation-draft-v2';
const printSettingsKey = 'trameli-print-settings-70x33-v1';
try { localStorage.removeItem('trameli-operation-draft-v1'); } catch { /* Storage may be unavailable. */ }
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDate(date);
}

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
let submitting = false;
let requestId = null;
let dayFinanceRequest = 0;
const dateInput = document.getElementById('delivery-date');
const searchInput = document.getElementById('order-search');
const list = document.getElementById('orders-list');
const supplierList = document.getElementById('supplier-list-items');
const supplierCopy = document.getElementById('copy-supplier-list');
const supplierFeedback = document.getElementById('supplier-list-feedback');
const dialog = document.getElementById('operation-dialog');
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

dateInput.value = tomorrow();

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
  document.getElementById('form-total').textContent = valid ? money(items.reduce((sum, item) => sum + itemTotal(item), fee)) : '—';
}

function openForm(order = null) {
  editingId = order?.id || null;
  requestId = order ? null : crypto.randomUUID();
  form.reset();
  formError.hidden = true;
  itemsHost.replaceChildren();
  form.elements.date.value = order?.date || dateInput.value;
  form.elements.fee.value = order ? (order.feeCents / 100).toFixed(2).replace('.', ',') : '2,00';
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

async function renderDailyFinance(dayOrders) {
  const request = ++dayFinanceRequest;
  const initial = window.TrameliFinanceMath.summarizeFinancials(dayOrders, null);
  document.getElementById('day-customer-value').textContent = money(initial.customerCents);
  document.getElementById('day-supplier-value').textContent = '—';
  document.getElementById('day-profit-value').textContent = 'Pendente';
  const note = document.getElementById('day-finance-note');
  if (!live?.operator) {
    note.textContent = 'Custos e lucro exigem a conta da operação conectada. A taxa de entrega fica fora desta conta.';
    return;
  }
  note.textContent = 'Calculando custos da padaria…';
  try {
    const rows = await live.costSummary(dateInput.value, dateInput.value);
    if (request !== dayFinanceRequest) return;
    const result = window.TrameliFinanceMath.summarizeFinancials(dayOrders, rows);
    document.getElementById('day-supplier-value').textContent = money(result.supplierCents);
    document.getElementById('day-profit-value').textContent = result.profitCents === null ? 'Pendente' : `${money(result.profitCents)}${result.estimatedItems ? ' *' : ''}`;
    note.textContent = result.missingItems
      ? `${result.missingItems} ${result.missingItems === 1 ? 'item sem custo' : 'itens sem custo'}${result.estimatedItems ? `; ${result.estimatedItems} com custo estimado` : ''}. O valor da padaria é parcial; não feche o lucro ainda.`
      : result.estimatedItems
        ? `* Lucro provisório: ${result.estimatedItems} ${result.estimatedItems === 1 ? 'item usa custo estimado' : 'itens usam custo estimado'}. Confirme com a padaria. Taxa de entrega fora da conta.`
        : 'Lucro bruto dos produtos; taxa de entrega e outras despesas não entram nesta conta.';
  } catch (cause) {
    if (request === dayFinanceRequest) note.textContent = `Custos indisponíveis: ${cause.message}`;
  }
}

function render() {
  const dayOrders = selectedOrders();
  renderDailyFinance(dayOrders);
  const displayOrders = orders.filter(order => order.date === dateInput.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const filtered = displayOrders.filter(order => {
    const query = searchInput.value.trim().toLocaleLowerCase('pt-BR');
    return !query || [order.customer, order.address, ...order.items.map(item => item.name)].some(value => value.toLocaleLowerCase('pt-BR').includes(query));
  });
  const summary = window.TrameliOrderMath.summarizeDay(orders, dateInput.value);
  document.getElementById('total-orders').textContent = summary.count;
  document.getElementById('pending-orders').textContent = summary.pending;
  document.getElementById('products-total').textContent = money(summary.productsCents);
  document.getElementById('grand-total').textContent = money(summary.totalCents);
  const products = window.TrameliOrderMath.summarizeProducts(orders, dateInput.value);
  supplierList.innerHTML = products.length
    ? `<ul>${products.map(item => `<li><strong>${item.grams ? `${item.grams} g` : `${item.quantity}×`}</strong><span>${escapeHtml(item.name)}</span></li>`).join('')}</ul>`
    : '<p class="supplier-list__empty">Nenhum produto nesta data.</p>';
  supplierCopy.disabled = !products.length;
  supplierFeedback.textContent = '';

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><span aria-hidden="true">✳</span><h3>${displayOrders.length ? 'Nenhum pedido encontrado' : 'O dia ainda está em branco'}</h3><p>${displayOrders.length ? 'Tente outro nome, endereço ou produto.' : 'Quando os pedidos chegarem, lance o primeiro aqui. A soma e as fichas serão preparadas automaticamente.'}</p>${displayOrders.length ? '' : '<button class="button button--primary" type="button" data-action="new">+ Lançar primeiro pedido</button>'}</div>`;
    return;
  }

  list.innerHTML = filtered.map((order, index) => {
    const state = orderStatus(order);
    return `<article class="order-card ${state !== 'received' ? 'order-card--checked' : ''}"><div class="order-card__number">${String(index + 1).padStart(2, '0')}</div><div class="order-card__main"><div class="order-card__title"><div><h3>${escapeHtml(order.customer)}</h3><p>${escapeHtml(order.address)}${order.phone ? ` · ${escapeHtml(order.phone)}` : ''}</p></div><span class="status ${state !== 'received' ? 'status--checked' : ''}">${statusLabels[state] || 'A conferir'}</span></div><ul>${order.items.map(item => `<li><strong>${escapeHtml(itemLabel(item))}</strong><span>${money(itemTotal(item))}</span></li>`).join('')}</ul>${order.notes ? `<p class="order-card__notes">Obs.: ${escapeHtml(order.notes)}</p>` : ''}<div class="order-card__footer"><span>Produtos ${money(orderSubtotal(order))} · Entrega ${money(order.feeCents)}</span><strong>${money(orderTotal(order))}</strong></div><div class="order-card__actions">${nextStatus[state] ? `<button type="button" data-action="toggle" data-id="${order.id}">Avançar para ${statusLabels[nextStatus[state]].toLowerCase()}</button>` : ''}${previousStatus[state] ? `<button type="button" data-action="back" data-id="${order.id}">Voltar para ${statusLabels[previousStatus[state]].toLowerCase()}</button>` : ''}${live ? `<button type="button" data-action="history" data-id="${order.id}">Histórico</button>` : ''}${!['delivered','cancelled'].includes(state) ? `<button type="button" data-action="edit" data-id="${order.id}">Editar</button><button type="button" data-action="delete" data-id="${order.id}">Cancelar</button>` : ''}</div></div></article>`;
  }).join('');
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
  const products = window.TrameliOrderMath.summarizeProducts(orders, dateInput.value);
  if (!products.length) return;
  const content = `Produtos para ${dateInput.value}\n${products.map(item => `${item.grams ? `${item.grams} g` : `${item.quantity}×`} ${item.name}`).join('\n')}`;
  try {
    await navigator.clipboard.writeText(content);
    supplierFeedback.textContent = 'Lista copiada. Confira as quantidades antes de enviar.';
  } catch {
    supplierFeedback.textContent = 'Não foi possível copiar automaticamente neste navegador.';
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const items = formItems();
  const feeCents = parseMoney(form.elements.fee.value);
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

list.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'new') { openForm(); return; }
  const order = orders.find(item => item.id === button.dataset.id);
  if (!order) return;
  if (button.dataset.action === 'history' && live) {
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
    return;
  }
  if (button.dataset.action === 'edit') { openForm(order); return; }
  if (button.dataset.action === 'delete' && !confirm(`Cancelar o pedido de ${order.customer}? O registro ficará no histórico.`)) return;
  const previous = orders;
  const state = button.dataset.action === 'delete' ? 'cancelled' : button.dataset.action === 'back' ? previousStatus[orderStatus(order)] : nextStatus[orderStatus(order)];
  if (!state || ['cancelled', 'delivered'].includes(orderStatus(order))) return;
  if (live) {
    try { await live.setStatus(order, state); orders = readOrders(); render(); }
    catch (cause) { alert(`O pedido não foi alterado: ${cause.message}`); }
    return;
  }
  orders = orders.map(item => item.id === order.id ? { ...item, status: state, checked: state !== 'received' } : item);
  if (!saveOrders()) { orders = previous; return; }
  render();
});

for (const id of ['print-orders', 'print-orders-bottom']) {
  document.getElementById(id).addEventListener('click', () => { if (preparePrint()) window.print(); });
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
});
window.TrameliOperation = { preparePrint };
})();
