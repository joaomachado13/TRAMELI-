(() => {
  const live = window.TrameliLive;
  const storageKey = 'trameli-clients-v1';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
  const total = order => window.TrameliOrderMath.totalCents(order);
  const formatPhone = value => {
    const digits = String(value || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return String(value || '').trim();
  };
  const read = () => {
    if (live) return [];
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item.name === 'string') : [];
    } catch { return []; }
  };
  let clients = read();
  let editingId = null;
  let query = '';
  let lastOrders = [];
  let lastCards = [];

  const formDialog = document.createElement('dialog');
  formDialog.className = 'catalog-dialog';
  formDialog.innerHTML = `<form id="client-form" novalidate><div class="catalog-dialog__heading"><div><p class="screen-eyebrow">CLIENTES</p><h2 id="client-dialog-title">Novo cliente</h2></div><button type="button" class="client-close" aria-label="Fechar">×</button></div><label>Nome<input name="name" maxlength="90" autocomplete="name" required></label><label>Telefone<input name="phone" type="tel" maxlength="25" autocomplete="tel" placeholder="(34) 99999-9999"></label><label>Endereço e referência<input name="address" maxlength="180" autocomplete="street-address" required></label><p class="catalog-error" role="alert" hidden></p><div class="catalog-actions"><button type="button" class="client-cancel">Cancelar</button><button type="submit">Salvar cliente</button></div></form>`;
  document.body.append(formDialog);
  const detailDrawer = document.createElement('dialog');
  detailDrawer.className = 'entity-drawer client-drawer';
  detailDrawer.setAttribute('aria-label', 'Perfil do cliente');
  document.body.append(detailDrawer);
  const form = formDialog.querySelector('form');
  const error = formDialog.querySelector('.catalog-error');
  const datalist = document.createElement('datalist');
  datalist.id = 'known-clients';
  document.body.append(datalist);

  function updateDatalist() {
    const names = new Set([...clients.map(client => client.name), ...lastOrders.map(order => order.customer)]);
    datalist.innerHTML = [...names].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
  }

  function buildCards(orders) {
    const grouped = new Map();
    orders.forEach(order => {
      const normalizedName = order.customer.trim().toLocaleLowerCase('pt-BR');
      const saved = clients.find(client => client.name.trim().toLocaleLowerCase('pt-BR') === normalizedName);
      const key = saved?.id || `order:${normalizedName}|${String(order.address || '').trim().toLocaleLowerCase('pt-BR')}`;
      const record = grouped.get(key) || { key, id: saved?.id || null, name: saved?.name || order.customer, phone: saved?.phone || order.phone || '', address: saved?.address || order.address || '', orders: [] };
      record.orders.push(order);
      if (!record.phone && order.phone) record.phone = order.phone;
      grouped.set(key, record);
    });
    clients.forEach(client => {
      if (!grouped.has(client.id)) grouped.set(client.id, { key: client.id, ...client, orders: [] });
    });
    return [...grouped.values()].map(client => {
      const active = client.orders.filter(order => (order.status || (order.checked ? 'confirmed' : 'received')) !== 'cancelled');
      const spent = active.reduce((sum, order) => sum + total(order), 0);
      const recent = active.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
      return { ...client, active, spent, recent, average: active.length ? Math.round(spent / active.length) : 0 };
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  function openForm(id = null) {
    const client = clients.find(item => item.id === id);
    editingId = client?.id || null;
    form.reset();
    error.hidden = true;
    form.elements.name.value = client?.name || '';
    form.elements.phone.value = formatPhone(client?.phone || '');
    form.elements.address.value = client?.address || '';
    formDialog.querySelector('#client-dialog-title').textContent = client ? 'Editar cliente' : 'Novo cliente';
    formDialog.showModal();
    form.elements.name.focus();
  }

  function save(next) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      clients = next;
      updateDatalist();
      dispatchEvent(new Event('trameli:clients-changed'));
      return true;
    } catch {
      error.textContent = 'Não foi possível salvar no navegador.';
      error.hidden = false;
      return false;
    }
  }

  function rerender() {
    const root = document.querySelector('[data-client-root]');
    if (root) root.outerHTML = render(lastOrders);
  }

  function render(orders) {
    lastOrders = orders.slice();
    updateDatalist();
    lastCards = buildCards(lastOrders);
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    const visible = lastCards.filter(client => !normalized || [client.name, client.phone, client.address].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(normalized)));
    return `<div data-client-root><div class="record-toolbar"><label class="record-search">Buscar cliente<input id="client-search" type="search" value="${escapeHtml(query)}" placeholder="Nome, telefone ou endereço"></label>${live ? '' : '<button class="screen-primary" type="button" data-client-action="new">+ Novo cliente</button>'}</div><div class="record-list record-list--clients">${visible.length ? visible.map(client => `<button class="record-row client-row" type="button" data-client-action="view" data-key="${escapeHtml(client.key)}"><span class="record-avatar" aria-hidden="true">${escapeHtml(client.name.slice(0, 1).toUpperCase())}</span><span class="record-main"><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(formatPhone(client.phone) || 'Telefone não informado')}</small><small class="record-address">${escapeHtml(client.address || 'Endereço não informado')}</small></span><span class="record-meta"><strong>${client.active.length}</strong><small>${client.active.length === 1 ? 'pedido' : 'pedidos'}</small></span><span class="record-meta record-meta--money"><strong>${money(client.spent)}</strong><small>total comprado</small></span><span class="record-chevron" aria-hidden="true">→</span></button>`).join('') : '<div class="friendly-empty"><strong>Nenhum cliente encontrado.</strong><span>Ajuste a busca ou cadastre um novo cliente.</span></div>'}</div></div>`;
  }

  function openDetail(key) {
    const client = lastCards.find(item => item.key === key);
    if (!client) return;
    const balanceRows = (window.TrameliPayments?.api?.balances || []).filter(row => String(row.customer_name || '').toLocaleLowerCase('pt-BR') === client.name.toLocaleLowerCase('pt-BR'));
    const due = balanceRows.reduce((sum, row) => sum + Number(row.due_cents || 0), 0);
    const history = client.active.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    detailDrawer.innerHTML = `<div class="entity-detail"><header class="entity-detail__header"><div><p class="screen-eyebrow">PERFIL DO CLIENTE</p><h2>${escapeHtml(client.name)}</h2><p>${escapeHtml(formatPhone(client.phone) || 'Telefone não informado')}</p></div><button type="button" data-client-action="close" aria-label="Fechar">×</button></header><div class="entity-detail__body"><section class="entity-summary"><div><span>Pedidos</span><strong>${client.active.length}</strong></div><div><span>Total comprado</span><strong>${money(client.spent)}</strong></div><div><span>Ticket médio</span><strong>${money(client.average)}</strong></div><div><span>Em aberto</span><strong>${money(due)}</strong></div></section><section class="entity-block"><h3>Contato e entrega</h3><p>${escapeHtml(client.address || 'Endereço não informado')}</p>${client.phone ? `<a href="tel:${escapeHtml(client.phone)}">${escapeHtml(formatPhone(client.phone))}</a>` : ''}</section><section class="entity-block"><div class="entity-block__heading"><h3>Histórico de pedidos</h3><span>${history.length}</span></div>${history.length ? `<div class="entity-order-list">${history.slice(0, 8).map(order => `<button type="button" data-open-order="${escapeHtml(order.id)}"><span><strong>#${escapeHtml(order.id.slice(0, 8))}</strong><small>${new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR')}</small></span><strong>${money(total(order))}</strong></button>`).join('')}</div>` : '<p class="entity-muted">Nenhum pedido registrado.</p>'}</section></div><footer class="entity-detail__actions"><button class="screen-primary" type="button" data-client-action="new-order" data-key="${escapeHtml(client.key)}">+ Novo pedido</button>${client.id && !live ? `<button type="button" data-client-action="edit" data-id="${escapeHtml(client.id)}">Editar dados</button>` : ''}</footer></div>`;
    detailDrawer.showModal();
  }

  document.addEventListener('input', event => {
    if (event.target.id !== 'client-search') return;
    query = event.target.value;
    rerender();
    document.getElementById('client-search')?.focus({ preventScroll: true });
  });
  document.addEventListener('click', event => {
    const orderButton = event.target.closest('[data-open-order]');
    if (orderButton) { detailDrawer.close(); window.TrameliOperation?.openOrder(orderButton.dataset.openOrder); return; }
    const button = event.target.closest('[data-client-action]');
    if (!button) return;
    const action = button.dataset.clientAction;
    if (action === 'close') { detailDrawer.close(); return; }
    if (action === 'view') { openDetail(button.dataset.key); return; }
    if (action === 'new' && !live) { openForm(); return; }
    if (action === 'edit' && !live) { detailDrawer.close(); openForm(button.dataset.id); return; }
    if (action === 'new-order') {
      const client = lastCards.find(item => item.key === button.dataset.key);
      if (client) { detailDrawer.close(); window.TrameliOperation?.openNew({ customer: client.name, phone: client.phone, address: client.address }); }
      return;
    }
  });
  formDialog.querySelector('.client-close').addEventListener('click', () => formDialog.close());
  formDialog.querySelector('.client-cancel').addEventListener('click', () => formDialog.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (live) return;
    const name = form.elements.name.value.trim();
    const address = form.elements.address.value.trim();
    if (!name || !address) { error.textContent = 'Informe nome e endereço.'; error.hidden = false; return; }
    const client = { id: editingId || crypto.randomUUID(), name, address, phone: formatPhone(form.elements.phone.value) };
    const next = editingId ? clients.map(item => item.id === editingId ? client : item) : [...clients, client];
    if (save(next)) formDialog.close();
  });

  window.TrameliClients = {
    render,
    list: () => clients.slice(),
    findByName: name => clients.find(item => item.name.toLocaleLowerCase('pt-BR') === name.trim().toLocaleLowerCase('pt-BR')),
    open: key => openDetail(key),
  };
})();
