(() => {
  const live = window.TrameliLive;
  const host = document.getElementById('portal-content');
  const orderKey = 'trameli-operation-draft-v2';
  const profileKey = 'trameli-portal-profile-v1';
  const tokenKey = 'trameli-portal-token-v1';
  const cartKey = 'trameli-portal-cart-v1';
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const tomorrow = () => { const date = new Date(); date.setDate(date.getDate() + 1); return dateKey(date); };
  const formatDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const products = () => window.TrameliCatalog?.list().filter(item => item.active && Number.isSafeInteger(item.priceCents) && item.priceCents >= 0) || [];
  const readOrders = () => { const value = live ? live.orders : readJson(orderKey, []); return Array.isArray(value) ? value : []; };
  const profile = live ? { name: live.profile?.name || '', phone: live.profile?.phone || '', address: live.profile?.address || '' } : readJson(profileKey, {});
  let token = live ? null : localStorage.getItem(tokenKey);
  if (!live && !token) { token = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; try { localStorage.setItem(tokenKey, token); } catch { /* Demo continues without persistence. */ } }
  const owns = order => live ? order.customerId === live.user.id : order.customerToken === token;
  const editable = order => (order.status || (order.checked ? 'confirmed' : 'received')) === 'received';
  let cart = readJson(cartKey, {});
  if (!cart || typeof cart !== 'object' || Array.isArray(cart)) cart = {};
  let view = 'catalog';
  let category = 'Todos';
  let query = '';
  let editingOrderId = null;
  let lastOrder = null;
  let error = '';
  let submitting = false;
  const requestKey = 'trameli-checkout-request-v1';
  let checkoutRequestId = null;
  if (live) {
    try { checkoutRequestId = sessionStorage.getItem(requestKey) || crypto.randomUUID(); sessionStorage.setItem(requestKey, checkoutRequestId); }
    catch { checkoutRequestId = crypto.randomUUID(); }
  }

  function cartLines() {
    return products().filter(product => Number.isInteger(cart[product.id]) && cart[product.id] > 0).map(product => ({ product, quantity: Math.min(99, cart[product.id]) }));
  }
  const subtotal = () => cartLines().reduce((sum, line) => sum + line.quantity * line.product.priceCents, 0);
  const count = () => cartLines().reduce((sum, line) => sum + line.quantity, 0);
  function persistCart() { try { localStorage.setItem(cartKey, JSON.stringify(cart)); } catch { /* Still usable this session. */ } }
  function updateCounters() {
    document.getElementById('portal-cart-count').textContent = count();
    document.getElementById('portal-bottom-count').textContent = count();
  }
  const photo = product => product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">` : '<span class="portal-photo-empty" aria-label="Foto em breve">Foto em breve</span>';
  function stepper(product) {
    const quantity = cart[product.id] || 0;
    return `<div class="portal-stepper" aria-label="Quantidade de ${escapeHtml(product.name)}"><button type="button" data-qty="-1" data-id="${escapeHtml(product.id)}" aria-label="Diminuir ${escapeHtml(product.name)}" ${quantity ? '' : 'disabled'}>−</button><span>${quantity}</span><button type="button" data-qty="1" data-id="${escapeHtml(product.id)}" aria-label="Adicionar ${escapeHtml(product.name)}" ${quantity >= 99 ? 'disabled' : ''}>+</button></div>`;
  }
  function card(product) {
    return `<article class="portal-product"><div class="portal-product__photo">${photo(product)}</div><div class="portal-product__body"><span class="portal-product__category">${escapeHtml(product.category || 'Padaria')}</span><h3>${escapeHtml(product.name)}</h3><p>${money(product.priceCents)} <small>/ ${escapeHtml(product.unit)}</small></p>${stepper(product)}</div></article>`;
  }
  function catalog() {
    const all = products();
    const categories = ['Todos', ...new Set(all.map(product => product.category || 'Outros'))];
    const visible = all.filter(product => (category === 'Todos' || (product.category || 'Outros') === category) && (!query || product.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))));
    return `<section class="portal-hero"><div><span class="portal-eyebrow">SEU CAFÉ DA MANHÃ, SEM COMPLICAÇÃO</span><h1>O que vai para a sua mesa <em>amanhã?</em></h1><p>Escolha seus favoritos em poucos toques. Entrega de amanhã: ${formatDate(tomorrow())}.</p><a href="#portal-products">Escolher produtos ↓</a></div><div class="portal-hero__accent" aria-hidden="true"><span>☀</span><strong>Bom dia<br>começa aqui.</strong></div></section><section id="portal-products" class="portal-section"><div class="portal-section__head"><div><span class="portal-eyebrow">FEITO PARA O SEU DIA</span><h2>Produtos da padaria</h2></div><span>${all.length} opções</span></div><label class="portal-search">Buscar produto<input id="portal-search" type="search" value="${escapeHtml(query)}" placeholder="Pão, bolo, suco..."></label><div class="portal-categories" aria-label="Categorias">${categories.map(item => `<button type="button" data-category="${escapeHtml(item)}" aria-pressed="${String(item === category)}">${escapeHtml(item)}</button>`).join('')}</div><div class="portal-grid" id="portal-grid">${visible.length ? visible.map(card).join('') : '<p class="portal-empty">Não encontramos produtos nessa busca.</p>'}</div></section>${count() ? `<div class="portal-floating"><div><small>${count()} ${count() === 1 ? 'item' : 'itens'} na sacola</small><strong>${money(subtotal() + 200)}</strong></div><button type="button" data-view="cart">Ver sacola →</button></div>` : ''}`;
  }
  function cartView() {
    const lines = cartLines();
    return `<section class="portal-page"><button class="portal-back" type="button" data-view="catalog">← Continuar escolhendo</button><span class="portal-eyebrow">QUASE LÁ</span><h1>Sua sacola</h1><p>Confira quantidades e valores antes de seguir.</p>${lines.length ? `<div class="portal-cart-lines">${lines.map(({ product, quantity }) => `<article class="portal-cart-line"><div class="portal-cart-line__photo">${photo(product)}</div><div><h2>${escapeHtml(product.name)}</h2><p>${money(product.priceCents)} / ${escapeHtml(product.unit)}</p>${stepper(product)}</div><strong>${money(product.priceCents * quantity)}</strong></article>`).join('')}</div><div class="portal-totals"><div><span>Produtos</span><strong>${money(subtotal())}</strong></div><div><span>Taxa de entrega</span><strong>${money(200)}</strong></div><div class="portal-totals__final"><span>Total</span><strong>${money(subtotal() + 200)}</strong></div></div><button class="portal-primary" type="button" data-view="checkout">Continuar para entrega →</button>` : `<div class="portal-empty"><h2>Sua sacola está vazia</h2><p>Escolha algo gostoso para amanhã.</p><button type="button" data-view="catalog">Ver produtos</button></div>`}</section>`;
  }
  function checkout() {
    if (!count()) { view = 'cart'; return cartView(); }
    const previous = readOrders().find(order => order.id === editingOrderId && owns(order) && editable(order));
    const deliveryDate = previous?.date || tomorrow();
    return `<section class="portal-page"><button class="portal-back" type="button" data-view="cart">← Voltar à sacola</button><span class="portal-eyebrow">ENTREGA EM ${escapeHtml(formatDate(deliveryDate).toLocaleUpperCase('pt-BR'))}</span><h1>Onde entregamos?</h1><p>${live ? 'Seus dados ficam vinculados à sua conta para o próximo pedido.' : 'Se você já pediu neste navegador, seus dados aparecem preenchidos para poupar tempo.'}</p><form id="portal-checkout-form"><label>Seu nome<input name="customer" autocomplete="name" maxlength="90" value="${escapeHtml(previous?.customer || profile.name || '')}" required></label><label>Telefone <span>(opcional)</span><input name="phone" type="tel" autocomplete="tel" maxlength="25" value="${escapeHtml(previous?.phone || profile.phone || '')}"></label><label>Endereço e referência<input name="address" autocomplete="street-address" maxlength="180" value="${escapeHtml(previous?.address || profile.address || '')}" placeholder="Bloco, apartamento ou ponto de encontro" required></label><label>Observação <span>(opcional)</span><textarea name="notes" maxlength="280" rows="3" placeholder="Ex.: deixar na portaria">${escapeHtml(previous?.notes || '')}</textarea></label><div class="portal-order-summary"><h2>Resumo do pedido</h2>${cartLines().map(({ product, quantity }) => `<div><span>${quantity}× ${escapeHtml(product.name)}</span><strong>${money(quantity * product.priceCents)}</strong></div>`).join('')}<div><span>Entrega</span><strong>${money(200)}</strong></div><div class="portal-order-summary__total"><span>Total para ${formatDate(deliveryDate)}</span><strong>${money(subtotal() + 200)}</strong></div></div><p class="portal-payment-note">Pagamento Pix ainda não está integrado. O pedido não representa pagamento confirmado.</p>${error ? `<p class="portal-error" role="alert">${escapeHtml(error)}</p>` : ''}<button class="portal-primary" type="submit">${previous ? 'Salvar alterações' : 'Confirmar pedido'} · ${money(subtotal() + 200)}</button></form></section>`;
  }
  function success() {
    return `<section class="portal-page portal-success"><span class="portal-success__icon" aria-hidden="true">✓</span><span class="portal-eyebrow">PEDIDO REGISTRADO</span><h1>Até amanhã!</h1><p>Seu pedido entrou na fila de conferência para ${lastOrder ? formatDate(lastOrder.date) : 'amanhã'}. Ele aparece em “Meus pedidos” ${live ? 'na sua conta' : 'neste navegador'}.</p><div class="portal-success__receipt"><span>Pedido</span><strong>#${escapeHtml(lastOrder?.id.slice(0, 8) || '—')}</strong><span>Total</span><strong>${lastOrder ? money(lastOrder.items.reduce((sum, item) => sum + item.quantity * item.priceCents, lastOrder.feeCents)) : '—'}</strong></div><p class="portal-payment-note">O pedido ainda não representa pagamento confirmado.</p><button class="portal-primary" type="button" data-view="orders">Ver meus pedidos</button><button class="portal-link" type="button" data-view="catalog">Voltar aos produtos</button></section>`;
  }
  function ordersView() {
    const orders = readOrders().filter(owns).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const labels = { received: 'A conferir', confirmed: 'Conferido', packing: 'Em separação', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' };
    return `<section class="portal-page"><button class="portal-back" type="button" data-view="catalog">← Voltar aos produtos</button><span class="portal-eyebrow">NO SEU RITMO</span><h1>Meus pedidos</h1><p>${live ? 'Pedidos vinculados à sua conta.' : 'Pedidos feitos neste navegador.'} Você pode ajustar ou cancelar enquanto não forem conferidos.</p>${orders.length ? `<div class="portal-history">${orders.map(order => { const state = order.status || (order.checked ? 'confirmed' : 'received'); return `<article><div><span>${formatDate(order.date)}</span><strong>${labels[state] || 'A conferir'}</strong></div><h2>${order.items.map(item => `${item.quantity}× ${escapeHtml(item.name)}`).join(' · ')}</h2><p>${escapeHtml(order.address)}</p><footer><strong>${money(order.items.reduce((sum, item) => sum + item.quantity * item.priceCents, order.feeCents))}</strong>${state === 'received' && order.date >= dateKey(new Date()) ? `<span><button type="button" data-edit-order="${escapeHtml(order.id)}">Alterar</button><button type="button" data-cancel-order="${escapeHtml(order.id)}">Cancelar</button></span>` : ''}</footer></article>`; }).join('')}</div>` : `<div class="portal-empty"><h2>Nenhum pedido por aqui</h2><p>Quando você confirmar um pedido, ele aparecerá nesta lista.</p><button type="button" data-view="catalog">Escolher produtos</button></div>`}</section>`;
  }
  function render(preserveScroll = false) {
    if (location.hash !== '#loja') return;
    const scroll = scrollY;
    host.innerHTML = ({ catalog, cart: cartView, checkout, success, orders: ordersView })[view]();
    updateCounters();
    document.querySelectorAll('[data-portal-nav]').forEach(button => button.setAttribute('aria-current', String(button.dataset.portalNav === view)));
    if (preserveScroll) scrollTo(0, scroll); else scrollTo(0, 0);
  }
  function changeQuantity(id, delta) {
    if (!products().some(product => product.id === id)) return;
    const next = Math.max(0, Math.min(99, (cart[id] || 0) + delta));
    if (next) cart[id] = next; else delete cart[id];
    persistCart();
    render(true);
  }
  async function placeOrder(form) {
    if (submitting) return;
    const lines = cartLines();
    const customer = form.elements.customer.value.trim();
    const address = form.elements.address.value.trim();
    if (!lines.length || !customer || !address) { error = 'Informe seu nome, endereço e ao menos um produto.'; render(true); return; }
    const oldOrders = readOrders();
    const previous = oldOrders.find(order => order.id === editingOrderId && owns(order) && editable(order));
    if (editingOrderId && !previous) { error = 'Este pedido não pode mais ser alterado. Confira em Meus pedidos.'; render(true); return; }
    const nextOrder = {
      id: previous?.id || (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      createdAt: previous?.createdAt || new Date().toISOString(),
      checked: false, customer, address, phone: form.elements.phone.value.trim(),
      date: previous?.date || tomorrow(), feeCents: 200,
      items: lines.map(({ product, quantity }) => ({ name: product.name, quantity, priceCents: product.priceCents })),
      notes: form.elements.notes.value.trim(), source: 'portal', customerToken: token,
    };
    if (live) {
      submitting = true;
      form.querySelector('[type="submit"]').disabled = true;
      try {
        const saved = await live.saveCustomerOrder({ ...nextOrder, id: previous?.id || null, version: previous?.version || null }, lines.map(({ product, quantity }) => ({ product_id: product.id, quantity })), checkoutRequestId);
        Object.assign(profile, { name: customer, phone: nextOrder.phone, address });
        lastOrder = saved;
        checkoutRequestId = crypto.randomUUID();
        try { sessionStorage.setItem(requestKey, checkoutRequestId); } catch { /* A new request still works in this tab. */ }
        cart = {};
        editingOrderId = null;
        persistCart();
        error = '';
        view = 'success';
        render();
      } catch (cause) { error = `Não foi possível registrar: ${cause.message}`; render(true); }
      finally { submitting = false; }
      return;
    }
    const nextOrders = previous ? oldOrders.map(order => order.id === previous.id ? nextOrder : order) : [...oldOrders, nextOrder];
    try {
      localStorage.setItem(orderKey, JSON.stringify(nextOrders));
      localStorage.setItem(profileKey, JSON.stringify({ name: customer, phone: nextOrder.phone, address }));
    } catch { error = 'Não foi possível salvar o pedido neste navegador. Tente novamente.'; render(true); return; }
    Object.assign(profile, { name: customer, phone: nextOrder.phone, address });
    lastOrder = nextOrder;
    cart = {};
    editingOrderId = null;
    persistCart();
    error = '';
    view = 'success';
    window.dispatchEvent(new Event('trameli:orders-changed'));
    render();
  }

  host.addEventListener('click', event => {
    const quantity = event.target.closest('[data-qty]');
    if (quantity) { changeQuantity(quantity.dataset.id, Number(quantity.dataset.qty)); return; }
    const categoryButton = event.target.closest('[data-category]');
    if (categoryButton) { category = categoryButton.dataset.category; render(true); return; }
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) { view = viewButton.dataset.view; error = ''; render(); return; }
    const editButton = event.target.closest('[data-edit-order]');
    if (editButton) {
      const order = readOrders().find(item => item.id === editButton.dataset.editOrder && owns(item) && editable(item));
      if (!order) { render(); return; }
      cart = {};
      order.items.forEach(item => { const product = products().find(entry => entry.id === item.productId) || products().find(entry => entry.name === item.name); if (product) cart[product.id] = item.quantity; });
      editingOrderId = order.id;
      persistCart();
      view = 'cart';
      render();
      return;
    }
    const cancelButton = event.target.closest('[data-cancel-order]');
    if (cancelButton) {
      const oldOrders = readOrders();
      const order = oldOrders.find(item => item.id === cancelButton.dataset.cancelOrder && owns(item) && editable(item) && item.date >= dateKey(new Date()));
      if (!order || !confirm('Cancelar este pedido?')) return;
      if (live) {
        live.cancelCustomerOrder(order).then(() => render(true)).catch(cause => alert(`Não foi possível cancelar: ${cause.message}`));
        return;
      }
      try { localStorage.setItem(orderKey, JSON.stringify(oldOrders.map(item => item.id === order.id ? { ...item, status: 'cancelled', checked: true } : item))); }
      catch { alert('Não foi possível cancelar o pedido.'); return; }
      window.dispatchEvent(new Event('trameli:orders-changed'));
      render(true);
    }
  });
  host.addEventListener('input', event => {
    if (event.target.id !== 'portal-search') return;
    query = event.target.value;
    const visible = products().filter(product => (category === 'Todos' || (product.category || 'Outros') === category) && product.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
    document.getElementById('portal-grid').innerHTML = visible.length ? visible.map(card).join('') : '<p class="portal-empty">Não encontramos produtos nessa busca.</p>';
  });
  host.addEventListener('submit', event => { if (event.target.id === 'portal-checkout-form') { event.preventDefault(); placeOrder(event.target); } });
  document.getElementById('portal-orders-link').addEventListener('click', () => { view = 'orders'; render(); });
  document.getElementById('portal-cart-link').addEventListener('click', () => { view = 'cart'; render(); });
  document.querySelectorAll('[data-portal-nav]').forEach(button => button.addEventListener('click', () => { view = button.dataset.portalNav; render(); }));
  function syncPortalFrame() {
    const isPortal = location.hash === '#loja';
    document.body.classList.toggle('portal-mode', isPortal);
    document.querySelector('.app-shell').hidden = isPortal;
    document.getElementById('portal-view').hidden = !isPortal;
    if (isPortal) {
      window.TrameliMenu?.close();
      render();
    }
  }
  window.addEventListener('trameli:portal-open', syncPortalFrame);
  window.addEventListener('trameli:catalog-changed', () => render(true));
  if (live) window.addEventListener('trameli:orders-changed', () => render(true));
  window.addEventListener('storage', event => { if ([orderKey, cartKey].includes(event.key)) { if (event.key === cartKey) cart = readJson(cartKey, {}); render(true); } });
  window.addEventListener('hashchange', syncPortalFrame);
  syncPortalFrame();
})();
