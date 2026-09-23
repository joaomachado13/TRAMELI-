(() => {
const storageKey = 'trameli-operation-draft-v2';
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
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed) ? parsed.filter(order => order && typeof order.id === 'string' && Array.isArray(order.items)) : [];
  } catch { return []; }
}

let orders = readOrders();
let editingId = null;
const dateInput = document.getElementById('delivery-date');
const searchInput = document.getElementById('order-search');
const list = document.getElementById('orders-list');
const dialog = document.getElementById('operation-dialog');
const form = document.getElementById('order-form');
const itemsHost = document.getElementById('form-items');
const formError = document.getElementById('form-error');

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
const orderSubtotal = order => order.items.reduce((sum, item) => sum + itemTotal(item), 0);
const orderTotal = order => orderSubtotal(order) + order.feeCents;

function addItem(item = {}) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = '<label>Produto <input class="item-name" list="catalog-products" maxlength="90" placeholder="Nome do item" required></label><label>Qtd. <input class="item-quantity" type="number" inputmode="numeric" min="1" max="999" step="1" value="1" required></label><label>Preço unit. (R$) <input class="item-price" inputmode="decimal" placeholder="0,00" required></label><button class="remove-item" type="button" aria-label="Remover item">×</button>';
  row.querySelector('.item-name').value = item.name || '';
  row.querySelector('.item-quantity').value = item.quantity || 1;
  row.querySelector('.item-price').value = item.priceCents == null ? '' : (item.priceCents / 100).toFixed(2).replace('.', ',');
  row.querySelector('.item-name').addEventListener('change', event => {
    const product = window.TrameliCatalog?.findByName(event.target.value);
    if (product) row.querySelector('.item-price').value = (product.priceCents / 100).toFixed(2).replace('.', ',');
    updateFormTotal();
  });
  row.querySelector('.remove-item').addEventListener('click', () => {
    if (itemsHost.children.length === 1) return;
    row.remove();
    updateFormTotal();
  });
  row.addEventListener('input', updateFormTotal);
  itemsHost.append(row);
}

function formItems() {
  return [...itemsHost.children].map(row => ({
    name: row.querySelector('.item-name').value.trim(),
    quantity: Number(row.querySelector('.item-quantity').value),
    priceCents: parseMoney(row.querySelector('.item-price').value),
  }));
}

function updateFormTotal() {
  const fee = parseMoney(form.elements.fee.value);
  const items = formItems();
  const valid = fee !== null && items.every(item => Number.isInteger(item.quantity) && item.quantity > 0 && item.priceCents !== null);
  document.getElementById('form-total').textContent = valid ? money(items.reduce((sum, item) => sum + itemTotal(item), fee)) : '—';
}

function openForm(order = null) {
  editingId = order?.id || null;
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
  return orders.filter(order => order.date === dateInput.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function render() {
  const dayOrders = selectedOrders();
  const filtered = dayOrders.filter(order => {
    const query = searchInput.value.trim().toLocaleLowerCase('pt-BR');
    return !query || [order.customer, order.address, ...order.items.map(item => item.name)].some(value => value.toLocaleLowerCase('pt-BR').includes(query));
  });
  document.getElementById('total-orders').textContent = dayOrders.length;
  document.getElementById('pending-orders').textContent = dayOrders.filter(order => !order.checked).length;
  document.getElementById('products-total').textContent = money(dayOrders.reduce((sum, order) => sum + orderSubtotal(order), 0));
  document.getElementById('grand-total').textContent = money(dayOrders.reduce((sum, order) => sum + orderTotal(order), 0));

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><span aria-hidden="true">✳</span><h3>${dayOrders.length ? 'Nenhum pedido encontrado' : 'O dia ainda está em branco'}</h3><p>${dayOrders.length ? 'Tente outro nome, endereço ou produto.' : 'Quando os pedidos chegarem, lance o primeiro aqui. A soma e as fichas serão preparadas automaticamente.'}</p>${dayOrders.length ? '' : '<button class="button button--primary" type="button" data-action="new">+ Lançar primeiro pedido</button>'}</div>`;
    return;
  }

  list.innerHTML = filtered.map((order, index) => `<article class="order-card ${order.checked ? 'order-card--checked' : ''}"><div class="order-card__number">${String(index + 1).padStart(2, '0')}</div><div class="order-card__main"><div class="order-card__title"><div><h3>${escapeHtml(order.customer)}</h3><p>${escapeHtml(order.address)}${order.phone ? ` · ${escapeHtml(order.phone)}` : ''}</p></div><span class="status ${order.checked ? 'status--checked' : ''}">${order.checked ? 'Conferido' : 'A conferir'}</span></div><ul>${order.items.map(item => `<li><strong>${item.quantity}× ${escapeHtml(item.name)}</strong><span>${money(itemTotal(item))}</span></li>`).join('')}</ul>${order.notes ? `<p class="order-card__notes">Obs.: ${escapeHtml(order.notes)}</p>` : ''}<div class="order-card__footer"><span>Produtos ${money(orderSubtotal(order))} · Entrega ${money(order.feeCents)}</span><strong>${money(orderTotal(order))}</strong></div><div class="order-card__actions"><button type="button" data-action="toggle" data-id="${order.id}">${order.checked ? 'Voltar a conferir' : 'Marcar conferido'}</button><button type="button" data-action="edit" data-id="${order.id}">Editar</button><button type="button" data-action="delete" data-id="${order.id}">Excluir</button></div></div></article>`).join('');
}

function preparePrint() {
  const dayOrders = selectedOrders();
  if (!dayOrders.length) { alert('Não há pedidos para imprimir na data selecionada.'); return false; }
  const printHost = document.getElementById('print-document');
  const pages = [];
  for (let index = 0; index < dayOrders.length; index += 8) {
    const pageOrders = dayOrders.slice(index, index + 8);
    pages.push(`<section class="print-page"><header><strong>Trameli · fichas de separação</strong><span>Entrega: ${new Date(`${dateInput.value}T12:00:00`).toLocaleDateString('pt-BR')} · Página ${pages.length + 1}</span></header><div class="print-grid">${pageOrders.map((order, slot) => `<article class="print-label"><div class="print-label__top"><strong>${escapeHtml(order.customer)}</strong><span>${String(index + slot + 1).padStart(2, '0')}</span></div><p>${escapeHtml(order.address)}</p><ul>${order.items.map(item => `<li>${item.quantity}× ${escapeHtml(item.name)}</li>`).join('')}</ul>${order.notes ? `<small>Obs.: ${escapeHtml(order.notes)}</small>` : ''}<footer>Total: ${money(orderTotal(order))}</footer></article>`).join('')}</div></section>`);
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

form.addEventListener('submit', event => {
  event.preventDefault();
  const items = formItems();
  const feeCents = parseMoney(form.elements.fee.value);
  const customer = form.elements.customer.value.trim();
  const address = form.elements.address.value.trim();
  if (!customer || !address || !form.elements.date.value || feeCents === null || !items.length || items.some(item => !item.name || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 || item.priceCents === null)) {
    formError.textContent = 'Confira nome, endereço, data, taxa e os itens com quantidade e preço válidos.';
    formError.hidden = false;
    return;
  }
  const previous = orders.find(order => order.id === editingId);
  const order = {
    id: editingId || (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    createdAt: previous?.createdAt || new Date().toISOString(),
    checked: previous?.checked || false,
    customer, address, phone: form.elements.phone.value.trim(),
    date: form.elements.date.value, feeCents, items, notes: form.elements.notes.value.trim(),
  };
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
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'new') { openForm(); return; }
  const order = orders.find(item => item.id === button.dataset.id);
  if (!order) return;
  if (button.dataset.action === 'edit') { openForm(order); return; }
  if (button.dataset.action === 'delete' && !confirm(`Excluir o pedido de ${order.customer}?`)) return;
  const previous = orders;
  orders = button.dataset.action === 'delete'
    ? orders.filter(item => item.id !== order.id)
    : orders.map(item => item.id === order.id ? { ...item, checked: !item.checked } : item);
  if (!saveOrders()) { orders = previous; return; }
  render();
});

for (const id of ['print-orders', 'print-orders-bottom']) {
  document.getElementById(id).addEventListener('click', () => { if (preparePrint()) window.print(); });
}

render();
window.TrameliOperation = { preparePrint };
})();
