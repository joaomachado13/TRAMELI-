(() => {
  const live = window.TrameliLive;
  const key = 'trameli-clients-v1';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const read = () => {
    if (live) return [];
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item.name === 'string') : [];
    } catch { return []; }
  };
  let clients = read();
  let editingId = null;
  const dialog = document.createElement('dialog');
  dialog.className = 'catalog-dialog';
  dialog.innerHTML = `<form id="client-form" novalidate><div class="catalog-dialog__heading"><div><p class="screen-eyebrow">CLIENTES</p><h2 id="client-dialog-title">Novo cliente</h2></div><button type="button" class="client-close" aria-label="Fechar">×</button></div><p>Rascunho local: não use dados pessoais reais antes da versão segura.</p><label>Nome<input name="name" maxlength="90" autocomplete="name" required></label><label>Telefone <span>(opcional)</span><input name="phone" type="tel" maxlength="25" autocomplete="tel"></label><label>Endereço / referência<input name="address" maxlength="180" autocomplete="street-address" required></label><p class="catalog-error" role="alert" hidden></p><div class="catalog-actions"><button type="button" class="client-cancel">Cancelar</button><button type="submit">Salvar cliente</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('.catalog-error');
  const datalist = document.createElement('datalist');
  datalist.id = 'known-clients';
  document.body.append(datalist);

  function updateDatalist() {
    datalist.innerHTML = clients.map(client => `<option value="${escapeHtml(client.name)}"></option>`).join('');
  }
  updateDatalist();

  function open(id = null) {
    const client = clients.find(item => item.id === id);
    editingId = client?.id || null;
    form.reset();
    error.hidden = true;
    form.elements.name.value = client?.name || '';
    form.elements.phone.value = client?.phone || '';
    form.elements.address.value = client?.address || '';
    dialog.querySelector('#client-dialog-title').textContent = client ? 'Editar cliente' : 'Novo cliente';
    dialog.showModal();
    form.elements.name.focus();
  }

  function save(next) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
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

  function render(orders) {
    const fromOrders = new Map();
    orders.forEach(order => {
      const key = `${order.customer.toLocaleLowerCase('pt-BR')}|${order.address.toLocaleLowerCase('pt-BR')}`;
      const value = fromOrders.get(key) || { name: order.customer, address: order.address, phone: order.phone, count: 0 };
      value.count++;
      fromOrders.set(key, value);
    });
    const cards = clients.map(client => ({ ...client, source: 'Cadastro', count: [...fromOrders.values()].filter(item => item.name.toLocaleLowerCase('pt-BR') === client.name.toLocaleLowerCase('pt-BR')).reduce((sum, item) => sum + item.count, 0) }));
    fromOrders.forEach(client => {
      if (!cards.some(saved => saved.name.toLocaleLowerCase('pt-BR') === client.name.toLocaleLowerCase('pt-BR') && saved.address.toLocaleLowerCase('pt-BR') === client.address.toLocaleLowerCase('pt-BR'))) cards.push({ ...client, source: 'Via pedido' });
    });
    cards.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return `<div class="catalog-toolbar"><p>${cards.length} ${cards.length === 1 ? 'cliente identificado' : 'clientes identificados'}</p>${live ? '' : '<button type="button" data-client-action="new">+ Adicionar cliente</button>'}</div>${cards.length ? `<div class="catalog-grid">${cards.map(client => `<article class="catalog-card"><div><span>${client.source}</span><span>${client.count} ${client.count === 1 ? 'pedido' : 'pedidos'}</span></div><h3>${escapeHtml(client.name)}</h3><p>${escapeHtml(client.address)}</p>${client.phone ? `<p>${escapeHtml(client.phone)}</p>` : ''}${client.id ? `<div class="catalog-card__actions"><button type="button" data-client-action="edit" data-id="${client.id}">Editar</button><button type="button" data-client-action="delete" data-id="${client.id}">Excluir</button></div>` : live ? '' : '<p class="client-card__note">Identificado em pedido. Cadastre para reutilizar os dados.</p>'}</article>`).join('')}</div>` : `<div class="screen-empty"><p>Nenhum cliente ainda. Os clientes aparecerão conforme os pedidos forem registrados.</p>${live ? '' : '<button type="button" data-client-action="new">+ Cadastrar primeiro cliente</button>'}</div>`}`;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-client-action]');
    if (!button) return;
    if (live) return;
    if (button.dataset.clientAction === 'new') open();
    if (button.dataset.clientAction === 'edit') open(button.dataset.id);
    if (button.dataset.clientAction === 'delete') {
      const client = clients.find(item => item.id === button.dataset.id);
      if (client && confirm(`Excluir o cadastro de ${client.name}? Os pedidos já salvos não serão alterados.`)) save(clients.filter(item => item.id !== client.id));
    }
  });
  dialog.querySelector('.client-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.client-cancel').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (live) return;
    const name = form.elements.name.value.trim();
    const address = form.elements.address.value.trim();
    if (!name || !address) { error.textContent = 'Informe nome e endereço.'; error.hidden = false; return; }
    const client = { id: editingId || crypto.randomUUID(), name, address, phone: form.elements.phone.value.trim() };
    const next = editingId ? clients.map(item => item.id === editingId ? client : item) : [...clients, client];
    if (save(next)) dialog.close();
  });
  window.TrameliClients = { render, list: () => clients.slice(), findByName: name => clients.find(item => item.name.toLocaleLowerCase('pt-BR') === name.trim().toLocaleLowerCase('pt-BR')) };
})();
