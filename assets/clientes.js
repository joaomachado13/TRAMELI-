(() => {
  const live = window.TrameliLive;
  const storageKey = 'trameli-clients-v1';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
  const total = order => window.TrameliOrderMath.totalCents(order);
  const normalize = value => String(value || '').trim().toLocaleLowerCase('pt-BR');
  const dateLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
  const timestamp = value => new Date(value).toLocaleString('pt-BR');
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
  let paymentFilter = 'all';
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
      const normalizedName = normalize(order.customer);
      const saved = clients.find(client => normalize(client.name) === normalizedName);
      const key = order.customerId || saved?.id || `order:${normalizedName}|${normalize(order.address)}`;
      const record = grouped.get(key) || {
        key,
        id: saved?.id || null,
        customerId: order.customerId || null,
        name: saved?.name || order.customer,
        phone: saved?.phone || order.phone || '',
        address: saved?.address || order.address || '',
        orders: [],
      };
      record.orders.push(order);
      if (!record.customerId && order.customerId) record.customerId = order.customerId;
      if (!record.phone && order.phone) record.phone = order.phone;
      if (!record.address && order.address) record.address = order.address;
      grouped.set(key, record);
    });
    clients.forEach(client => {
      if (!grouped.has(client.id)) grouped.set(client.id, { key: client.id, ...client, customerId: null, orders: [] });
    });

    return [...grouped.values()].map(client => {
      const active = client.orders.filter(order => (order.status || (order.checked ? 'confirmed' : 'received')) !== 'cancelled');
      const spent = active.reduce((sum, order) => sum + total(order), 0);
      const recent = active.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
      return { ...client, active, spent, recent, average: active.length ? Math.round(spent / active.length) : 0 };
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  function paymentData(client) {
    const api = window.TrameliPayments?.api;
    const balances = api?.balances || [];
    const ids = new Set([client.customerId, ...client.active.map(order => order.customerId)].filter(Boolean));
    const rows = balances.filter(row => ids.has(row.customer_id) || (!ids.size && normalize(row.customer_name) === normalize(client.name)));
    const customerId = client.customerId || rows.find(row => row.customer_id)?.customer_id || null;
    const totalCents = rows.reduce((sum, row) => sum + Number(row.total_cents || 0), 0);
    const paidCents = rows.reduce((sum, row) => sum + Number(row.paid_cents || 0), 0);
    const dueCents = rows.reduce((sum, row) => sum + Number(row.due_cents || 0), 0);
    const pendingIntents = customerId ? (api?.intents || []).filter(intent => intent.customer_id === customerId && intent.status === 'pending') : [];
    const receiptByIntent = new Map((api?.receipts || []).filter(receipt => !customerId || receipt.customer_id === customerId).map(receipt => [receipt.intent_id, receipt]));
    let status = 'none';
    if (pendingIntents.length) status = 'review';
    else if (dueCents > 0 && paidCents > 0) status = 'partial';
    else if (dueCents > 0) status = 'open';
    else if (totalCents > 0) status = 'paid';
    return { api, rows, customerId, totalCents, paidCents, dueCents, pendingIntents, receiptByIntent, status };
  }

  const statusLabel = status => ({
    review: 'Aguardando conferência',
    partial: 'Pagamento parcial',
    open: 'Em aberto',
    paid: 'Pago',
    none: 'Sem financeiro',
  })[status] || 'Sem financeiro';

  const statusClass = status => ({
    review: 'is-review',
    partial: 'is-partial',
    open: 'is-open',
    paid: 'is-paid',
    none: 'is-neutral',
  })[status] || 'is-neutral';

  function countFilters(cards) {
    const counts = { all: cards.length, review: 0, open: 0, paid: 0 };
    cards.forEach(client => {
      const payment = paymentData(client);
      if (payment.status === 'review') counts.review += 1;
      if (['open', 'partial'].includes(payment.status)) counts.open += 1;
      if (payment.status === 'paid') counts.paid += 1;
    });
    return counts;
  }

  function matchesFilter(client) {
    const status = paymentData(client).status;
    if (paymentFilter === 'review') return status === 'review';
    if (paymentFilter === 'open') return ['open', 'partial'].includes(status);
    if (paymentFilter === 'paid') return status === 'paid';
    return true;
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
    const normalized = normalize(query);
    const visible = lastCards.filter(client => {
      const found = !normalized || [client.name, client.phone, client.address].some(value => normalize(value).includes(normalized));
      return found && matchesFilter(client);
    });
    const counts = countFilters(lastCards);
    const filters = [
      ['all', 'Todos'],
      ['review', 'Aguardando conferência'],
      ['open', 'Em aberto'],
      ['paid', 'Pagos'],
    ];
    return `<div data-client-root>
      <div class="record-toolbar client-toolbar">
        <label class="record-search">Buscar cliente<input id="client-search" type="search" value="${escapeHtml(query)}" placeholder="Nome, telefone ou endereço"></label>
        ${live ? '' : '<button class="screen-primary" type="button" data-client-action="new">+ Novo cliente</button>'}
      </div>
      <div class="client-filters" role="group" aria-label="Filtrar clientes por pagamento">
        ${filters.map(([key, label]) => `<button type="button" data-client-filter="${key}" class="${paymentFilter === key ? 'is-active' : ''}"><span>${label}</span><strong>${counts[key]}</strong></button>`).join('')}
      </div>
      <div class="record-list record-list--clients">
        ${visible.length ? visible.map(client => {
          const payment = paymentData(client);
          return `<button class="record-row client-row client-row--simple" type="button" data-client-action="view" data-key="${escapeHtml(client.key)}">
            <span class="record-avatar" aria-hidden="true">${escapeHtml(client.name.slice(0, 1).toUpperCase())}</span>
            <span class="record-main"><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(formatPhone(client.phone) || 'Telefone não informado')}</small><small class="record-address">${escapeHtml(client.address || 'Endereço não informado')}</small></span>
            <span class="client-payment-badge ${statusClass(payment.status)}">${statusLabel(payment.status)}</span>
            <span class="record-chevron" aria-hidden="true">→</span>
          </button>`;
        }).join('') : '<div class="friendly-empty"><strong>Nenhum cliente encontrado.</strong><span>Ajuste a busca ou os filtros.</span></div>'}
      </div>
    </div>`;
  }

  function paymentBlock(client, payment) {
    if (!live || !payment.api?.ready) {
      return `<section class="entity-block client-finance"><div class="entity-block__heading"><h3>Pagamento</h3></div><p class="entity-muted">Os dados financeiros aparecem aqui quando a conexão de pagamentos estiver disponível.</p></section>`;
    }

    const pending = payment.pendingIntents.map(intent => {
      const receipt = payment.receiptByIntent.get(intent.id);
      return `<article class="client-payment-alert">
        <div class="client-payment-alert__main">
          <span class="client-payment-badge is-review">Aguardando conferência</span>
          <strong>${money(intent.amount_cents)}</strong>
          <small>Cliente informou pagamento em ${escapeHtml(timestamp(intent.created_at))}</small>
          <small>${receipt ? 'Comprovante enviado pelo cliente.' : 'Sem comprovante anexado.'}</small>
        </div>
        <div class="client-payment-alert__actions">
          ${receipt ? `<button type="button" data-client-receipt="${escapeHtml(receipt.id)}">Abrir comprovante</button>` : ''}
          <button class="screen-primary" type="button" data-client-confirm-intent="${escapeHtml(intent.id)}" data-customer-id="${escapeHtml(payment.customerId || '')}" data-customer-name="${escapeHtml(client.name)}">Conferir pagamento</button>
        </div>
      </article>`;
    }).join('');

    let empty;
    if (payment.status === 'paid') empty = '<div class="client-payment-ok"><strong>Conta em dia.</strong><span>Não há saldo pendente para este cliente.</span></div>';
    else if (payment.dueCents > 0) empty = `<div class="client-payment-open"><strong>${money(payment.dueCents)} em aberto</strong><span>O cliente ainda não informou um pagamento para conferência.</span><button type="button" data-client-open-finance data-customer-id="${escapeHtml(payment.customerId || '')}" data-customer-name="${escapeHtml(client.name)}">Registrar pagamento</button></div>`;
    else empty = '<p class="entity-muted">Nenhuma movimentação financeira registrada.</p>';

    return `<section class="entity-block client-finance">
      <div class="entity-block__heading"><div><h3>Pagamento</h3><p>Conferência, comprovante e baixa ficam centralizados neste cliente.</p></div><span>${statusLabel(payment.status)}</span></div>
      ${pending || empty}
    </section>`;
  }

  function orderHistory(client, payment) {
    const balanceByOrder = new Map(payment.rows.map(row => [row.order_id, row]));
    const pendingOrders = new Set(payment.pendingIntents.flatMap(intent => intent.order_ids || []));
    const history = client.active.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!history.length) return '<p class="entity-muted">Nenhum pedido registrado.</p>';
    return `<div class="entity-order-list client-order-list">${history.map(order => {
      const row = balanceByOrder.get(order.id);
      const due = Number(row?.due_cents || 0);
      const paid = Number(row?.paid_cents || 0);
      const financial = pendingOrders.has(order.id) ? 'Aguardando conferência' : row ? (due <= 0 ? 'Pago' : paid > 0 ? 'Parcial' : 'Em aberto') : 'A conferir';
      const cls = pendingOrders.has(order.id) ? 'is-review' : due <= 0 && row ? 'is-paid' : paid > 0 ? 'is-partial' : 'is-open';
      return `<button type="button" data-open-order="${escapeHtml(order.id)}">
        <span><strong>#${escapeHtml(order.id.slice(0, 8))}</strong><small>${dateLabel(order.date)}</small></span>
        <span class="client-order-payment"><span class="client-payment-badge ${cls}">${financial}</span><strong>${money(total(order))}</strong>${row && due > 0 ? `<small>${money(due)} em aberto</small>` : ''}</span>
      </button>`;
    }).join('')}</div>`;
  }

  function openDetail(key) {
    const client = lastCards.find(item => item.key === key);
    if (!client) return;
    const payment = paymentData(client);
    detailDrawer.innerHTML = `<div class="entity-detail client-profile">
      <header class="entity-detail__header client-profile__header">
        <div><p class="screen-eyebrow">CLIENTE</p><h2>${escapeHtml(client.name)}</h2><p>${escapeHtml(formatPhone(client.phone) || 'Telefone não informado')}</p></div>
        <div class="client-profile__header-actions"><span class="client-payment-badge ${statusClass(payment.status)}">${statusLabel(payment.status)}</span><button type="button" data-client-action="close" aria-label="Fechar">×</button></div>
      </header>
      <div class="entity-detail__body">
        <section class="entity-summary client-summary">
          <div><span>Total em pedidos</span><strong>${money(payment.totalCents || client.spent)}</strong></div>
          <div><span>Pago</span><strong>${money(payment.paidCents)}</strong></div>
          <div><span>Em aberto</span><strong>${money(payment.dueCents)}</strong></div>
          <div><span>Pedidos</span><strong>${client.active.length}</strong></div>
        </section>
        ${paymentBlock(client, payment)}
        <section class="entity-block">
          <div class="entity-block__heading"><h3>Pedidos e cobrança</h3><span>${client.active.length}</span></div>
          ${orderHistory(client, payment)}
        </section>
        <section class="entity-block client-contact">
          <h3>Contato e entrega</h3>
          <p>${escapeHtml(client.address || 'Endereço não informado')}</p>
          ${client.phone ? `<div class="client-contact__actions"><a href="tel:${escapeHtml(client.phone)}">${escapeHtml(formatPhone(client.phone))}</a><a href="https://wa.me/55${escapeHtml(String(client.phone).replace(/\D/g, '').replace(/^55/, ''))}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a></div>` : ''}
        </section>
      </div>
      <footer class="entity-detail__actions"><button class="screen-primary" type="button" data-client-action="new-order" data-key="${escapeHtml(client.key)}">+ Novo pedido</button>${client.id && !live ? `<button type="button" data-client-action="edit" data-id="${escapeHtml(client.id)}">Editar dados</button>` : ''}</footer>
    </div>`;
    detailDrawer.showModal();
  }

  document.addEventListener('input', event => {
    if (event.target.id !== 'client-search') return;
    query = event.target.value;
    rerender();
    document.getElementById('client-search')?.focus({ preventScroll: true });
  });

  document.addEventListener('click', async event => {
    const filter = event.target.closest('[data-client-filter]');
    if (filter) { paymentFilter = filter.dataset.clientFilter; rerender(); return; }

    const receipt = event.target.closest('[data-client-receipt]');
    if (receipt) {
      await window.TrameliPayments?.openReceipt?.(receipt.dataset.clientReceipt);
      return;
    }

    const confirmIntent = event.target.closest('[data-client-confirm-intent]');
    if (confirmIntent) {
      await window.TrameliPayments?.openForCustomer?.({
        customerId: confirmIntent.dataset.customerId || null,
        customerName: confirmIntent.dataset.customerName,
        intentId: confirmIntent.dataset.clientConfirmIntent,
      });
      return;
    }

    const openFinance = event.target.closest('[data-client-open-finance]');
    if (openFinance) {
      await window.TrameliPayments?.openForCustomer?.({
        customerId: openFinance.dataset.customerId || null,
        customerName: openFinance.dataset.customerName,
      });
      return;
    }

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

  window.addEventListener('trameli:payments-changed', () => {
    if (document.querySelector('[data-client-root]')) rerender();
    if (detailDrawer.open) {
      const key = detailDrawer.querySelector('[data-client-action="new-order"]')?.dataset.key;
      if (key) openDetail(key);
    }
  });

  window.TrameliClients = {
    render,
    list: () => clients.slice(),
    findByName: name => clients.find(item => normalize(item.name) === normalize(name)),
    open: key => openDetail(key),
  };
})();
