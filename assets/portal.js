(() => {
  const live = window.TrameliLive;
  const host = document.getElementById('portal-content');
  const floatingHost = document.getElementById('portal-floating-host');
  const motion = () => window.TrameliMotion;
  const orderKey = 'trameli-operation-draft-v2';
  const profileKey = 'trameli-portal-profile-v1';
  const tokenKey = 'trameli-portal-token-v1';
  const cartKey = 'trameli-portal-cart-v1';
  const favoriteOrdersKey = `trameli-favorite-orders-v1:${live?.user?.id || 'local'}`;
  const weeklyPlanKey = `trameli-weekly-plan-v1:${live?.user?.id || 'local'}`;
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  const paymentLabels = { pix_manual: 'Pix', cash: 'Dinheiro', other: 'Combinar com a loja', unspecified: 'Não informado' };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const tomorrow = () => { const date = new Date(); date.setDate(date.getDate() + 1); return dateKey(date); };
  const formatDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const allProducts = () => window.TrameliCatalog?.list().filter(item => item.active && Number.isSafeInteger(item.priceCents) && item.priceCents >= 0) || [];
  const unavailableFor = (item, date = tomorrow()) => Boolean(item.unavailableFrom && item.unavailableUntil && date >= item.unavailableFrom && date <= item.unavailableUntil);
  const products = () => allProducts().filter(item => !unavailableFor(item));
  const weighted = product => product.unit === 'kg';
  const linePrice = (product, quantity) => weighted(product)
    ? window.TrameliOrderMath.weightPriceCents(product.priceCents, quantity * 50)
    : product.priceCents * quantity;
  const lineLabel = (product, quantity) => weighted(product)
    ? `${quantity * 50} g de ${product.name}` : `${quantity}× ${product.name}`;
  const orderItem = ({ product, quantity }) => weighted(product)
    ? { productId: product.id, name: product.name, quantity: 1, weightGrams: quantity * 50,
        kgPriceCents: product.priceCents, priceCents: linePrice(product, quantity) }
    : { productId: product.id, name: product.name, quantity, priceCents: product.priceCents };
  const readOrders = () => { const value = live ? live.orders : readJson(orderKey, []); return Array.isArray(value) ? value : []; };
  const profile = live ? { name: live.profile?.name || live.user.user_metadata?.full_name || live.user.user_metadata?.name || '', phone: live.profile?.phone || live.user.phone || '', address: live.profile?.address || '' } : readJson(profileKey, {});
  let token = live ? null : localStorage.getItem(tokenKey);
  if (!live && !token) { token = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; try { localStorage.setItem(tokenKey, token); } catch { /* Demo continues without persistence. */ } }
  const owns = order => live ? order.customerId === live.user.id : order.customerToken === token;
  const saoPauloClock = (value = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const beforeCustomerCutoff = deliveryDate => {
    const [year, month, day] = String(deliveryDate).split('-').map(Number);
    if (!year || !month || !day) return false;
    const clock = saoPauloClock();
    const currentDay = Date.UTC(clock.year, clock.month - 1, clock.day);
    const cutoffDay = Date.UTC(year, month - 1, day) - 86400000;
    return currentDay < cutoffDay || (currentDay === cutoffDay && clock.hour * 60 + clock.minute <= 22 * 60 + 30);
  };
  const editable = order => (order.status || (order.checked ? 'confirmed' : 'received')) === 'received' && beforeCustomerCutoff(order.date);
  let cart = readJson(cartKey, {});
  if (!cart || typeof cart !== 'object' || Array.isArray(cart)) cart = {};
  let favoriteOrders = new Set(readJson(favoriteOrdersKey, []));
  let weeklyPlan = readJson(weeklyPlanKey, {});
  let weeklyDay = 'monday';
  let view = 'catalog';
  let renderedView = null;
  let portalVisible = false;
  let category = 'Todos';
  let query = '';
  let personalFilter = 'all';
  let reorderNotices = [];
  let reordering = false;
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
  const subtotal = () => cartLines().reduce((sum, line) => sum + linePrice(line.product, line.quantity), 0);
  const count = () => cartLines().reduce((sum, line) => sum + (weighted(line.product) ? 1 : line.quantity), 0);
  function persistCart() { try { localStorage.setItem(cartKey, JSON.stringify(cart)); } catch { /* Still usable this session. */ } }
  function updateCounters() {
    document.getElementById('portal-cart-count').textContent = count();
    document.getElementById('portal-bottom-count').textContent = count();
  }
  function renderFloating() {
    if (!floatingHost) return;
    const visible = location.hash === '#loja' && view === 'catalog' && count() > 0;
    floatingHost.hidden = !visible;
    floatingHost.innerHTML = visible ? `<div class="portal-floating"><div><small>${count()} ${count() === 1 ? 'item' : 'itens'} · só produtos</small><strong>${money(subtotal())}</strong></div><button type="button" data-view="cart">Ver sacola →</button></div>` : '';
  }
  function rememberFocus() {
    const element = document.activeElement;
    if (!host.contains(element)) return null;
    let selector = element.id ? `#${CSS.escape(element.id)}` : null;
    if (!selector && element.name) selector = `[name="${CSS.escape(element.name)}"]`;
    if (!selector && element.dataset.id && element.dataset.qty) selector = `[data-id="${CSS.escape(element.dataset.id)}"][data-qty="${element.dataset.qty}"]`;
    if (!selector && element.dataset.category) selector = `[data-category="${CSS.escape(element.dataset.category)}"]`;
    return selector ? { selector, start: element.selectionStart, end: element.selectionEnd } : null;
  }
  function restoreFocus(saved) {
    const element = saved && host.querySelector(saved.selector);
    if (!element || element.disabled) return;
    element.focus({ preventScroll: true });
    if (typeof saved.start === 'number' && element.setSelectionRange) element.setSelectionRange(saved.start, saved.end);
  }
  const photo = product => product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">` : '<span class="portal-photo-empty" aria-label="Foto em breve">Foto em breve</span>';
  function stepper(product) {
    const quantity = cart[product.id] || 0;
    return `<div class="portal-stepper" aria-label="${weighted(product) ? 'Peso' : 'Quantidade'} de ${escapeHtml(product.name)}"><button type="button" data-qty="-1" data-id="${escapeHtml(product.id)}" aria-label="Diminuir ${escapeHtml(product.name)} em ${weighted(product) ? '50 gramas' : 'uma unidade'}" ${quantity ? '' : 'disabled'}>−</button><span>${weighted(product) ? `${quantity * 50} g` : quantity}</span><button type="button" data-qty="1" data-id="${escapeHtml(product.id)}" aria-label="Adicionar ${escapeHtml(product.name)} em ${weighted(product) ? '50 gramas' : 'uma unidade'}" ${quantity >= 99 ? 'disabled' : ''}>+</button></div>`;
  }
  const shopping = () => window.TrameliShopping;
  const reviewNotice = () => reorderNotices.length ? `<aside class="portal-review-notice" role="status"><strong>Confira sua nova sacola</strong><ul>${reorderNotices.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul></aside>` : '';
  function favoriteButton(product) {
    if (!shopping()?.ready) return '';
    const selected = shopping().favorites.has(product.id);
    return `<button class="portal-favorite" type="button" data-favorite="${escapeHtml(product.id)}" aria-pressed="${selected}" aria-label="${selected ? 'Remover dos' : 'Adicionar aos'} favoritos: ${escapeHtml(product.name)}" ${shopping().pending.has(product.id) ? 'disabled' : ''}>${selected ? '♥ Favorito' : '♡ Favoritar'}</button>`;
  }
  function filteredProducts() {
    const frequent = new Set(shopping()?.frequentProductIds(readOrders().filter(owns), products()) || []);
    return products().filter(product => (personalFilter === 'all' || (personalFilter === 'favorites' ? shopping()?.favorites.has(product.id) : frequent.has(product.id)))
      && (category === 'Todos' || (product.category || 'Outros') === category)
      && (!query || product.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))));
  }
  function personalFilters() {
    if (!shopping()) return '';
    return `<div class="portal-personal-filters" aria-label="Seleção pessoal">${[['all','Todos os produtos'],['favorites','Meus favoritos'],['frequent','Comprados com frequência']].map(([id,label]) => `<button type="button" data-personal-filter="${id}" aria-pressed="${personalFilter === id}" ${id === 'favorites' && !shopping().ready ? 'disabled' : ''}>${label}</button>`).join('')}</div><p class="portal-filter-note">${escapeHtml(shopping().message || (personalFilter === 'frequent' ? 'Produtos presentes em pelo menos dois dos seus pedidos não cancelados.' : personalFilter === 'favorites' ? 'Seus favoritos disponíveis no catálogo atual.' : ''))}</p>`;
  }
  function card(product) {
    return `<article class="portal-product"><div class="portal-product__photo">${photo(product)}</div><div class="portal-product__body"><span class="portal-product__category">${escapeHtml(product.category || 'Padaria')}</span>${favoriteButton(product)}<h3>${escapeHtml(product.name)}</h3><p>${money(product.priceCents)} <small>/ ${escapeHtml(product.unit)}</small>${weighted(product) ? `<small class="portal-weight-hint">50 g = ${money(linePrice(product, 1))}</small>` : ''}</p>${stepper(product)}</div></article>`;
  }
  const greeting = () => {
    const hour = saoPauloClock().hour;
    return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  };
  const firstName = () => String(profile.name || '').trim().split(/\s+/)[0] || '';
  const orderValue = order => order.items.reduce((sum, item) => sum + item.quantity * item.priceCents, order.feeCents || 0);
  function lastOrderCard() {
    const order = readOrders().filter(owns).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!order) return `<article class="portal-first-order"><span>SEU PRIMEIRO PEDIDO</span><strong>Escolha seus produtos</strong><p>Sua sacola fica disponível enquanto você navega.</p><a href="#portal-products">Começar agora ↓</a></article>`;
    return `<article class="portal-last-order"><div><span>SEU ÚLTIMO PEDIDO</span><h2>${order.items.slice(0, 3).map(item => escapeHtml(item.name)).join(' · ')}${order.items.length > 3 ? ` +${order.items.length - 3}` : ''}</h2><p>${formatDate(order.date)} · ${money(orderValue(order))}</p></div><button type="button" data-reorder="${escapeHtml(order.id)}">Pedir novamente</button></article>`;
  }
  function catalog() {
    const all = products();
    const unavailable = allProducts().filter(item => unavailableFor(item));
    const categories = ['Todos', ...new Set(all.map(product => product.category || 'Outros'))];
    const visible = filteredProducts();
    const notice=unavailable.length?`<aside class="portal-review-notice" role="status"><strong>Indisponíveis para amanhã</strong><ul>${unavailable.map(item=>{const substitute=allProducts().find(candidate=>candidate.id===item.substituteProductId&&!unavailableFor(candidate));return `<li>${escapeHtml(item.name)}${substitute?` — sugestão: ${escapeHtml(substitute.name)}`:''}</li>`;}).join('')}</ul><p>A troca não é automática; escolha a sugestão no catálogo se desejar.</p></aside>`:'';
    return `<section class="portal-welcome"><span class="portal-eyebrow">${greeting().toLocaleUpperCase('pt-BR')}${firstName() ? `, ${escapeHtml(firstName()).toLocaleUpperCase('pt-BR')}` : ''}</span><h1>${greeting()}${firstName() ? `, ${escapeHtml(firstName())}` : ''}.</h1><p>Seu pedido em três passos simples.</p><ol><li><strong>1</strong> Escolha os produtos</li><li><strong>2</strong> Revise a sacola</li><li><strong>3</strong> Confirme entrega e pagamento</li></ol><a class="portal-welcome__action" href="#portal-products">Escolher produtos ↓</a></section><section class="portal-quick-actions">${lastOrderCard()}<article><span>PLANEJE COM CALMA</span><strong>Pedidos da semana</strong><p>Organize cada dia sem confirmar nada automaticamente.</p><button type="button" data-view="week">Montar minha semana</button></article></section><section id="portal-products" class="portal-section">${notice}<div class="portal-section__head"><div><span class="portal-eyebrow">FEITO PARA O SEU DIA</span><h2>Produtos da padaria</h2></div><span>${all.length} opções</span></div><label class="portal-search">Buscar produto<input id="portal-search" type="search" value="${escapeHtml(query)}" placeholder="Pão, bolo, suco..."></label><div class="portal-categories" aria-label="Categorias">${categories.map(item => `<button type="button" data-category="${escapeHtml(item)}" aria-pressed="${String(item === category)}">${escapeHtml(item)}</button>`).join('')}</div>${personalFilters()}<div class="portal-grid" id="portal-grid">${visible.length ? visible.map(card).join('') : '<p class="portal-empty">Não encontramos produtos nessa busca.</p>'}</div></section>`;
  }
  function cartView() {
    const lines = cartLines();
    return `<section class="portal-page"><button class="portal-back" type="button" data-view="catalog">← Continuar escolhendo</button><span class="portal-eyebrow">QUASE LÁ</span><h1>Sua sacola</h1>${reviewNotice()}<p>Confira quantidades e valores antes de seguir.</p>${lines.length ? `<div class="portal-cart-lines">${lines.map(({ product, quantity }) => `<article class="portal-cart-line"><div class="portal-cart-line__photo">${photo(product)}</div><div><h2>${escapeHtml(product.name)}</h2><p>${money(product.priceCents)} / ${escapeHtml(product.unit)}</p>${stepper(product)}</div><strong>${money(linePrice(product, quantity))}</strong></article>`).join('')}</div><div class="portal-totals"><div class="portal-totals__final"><span>Subtotal dos produtos</span><strong>${money(subtotal())}</strong></div></div><p class="portal-payment-note">A entrega de ${money(200)} será somada na próxima etapa, antes de confirmar.</p><button class="portal-primary" type="button" data-view="checkout">Continuar para entrega →</button>` : `<div class="portal-empty"><h2>Sua sacola está vazia</h2><p>Escolha algo gostoso para amanhã.</p><button type="button" data-view="catalog">Ver produtos</button></div>`}</section>`;
  }
  function checkout() {
    if (!count()) { view = 'cart'; return cartView(); }
    const previous = readOrders().find(order => order.id === editingOrderId && owns(order) && editable(order));
    const deliveryDate = previous?.date || tomorrow();
    const selectedPayment = paymentLabels[previous?.paymentMethod] ? previous.paymentMethod : 'pix_manual';
    return `<section class="portal-page"><button class="portal-back" type="button" data-view="cart">← Voltar à sacola</button><span class="portal-eyebrow">ENTREGA EM ${escapeHtml(formatDate(deliveryDate).toLocaleUpperCase('pt-BR'))}</span><h1>Entrega e pagamento</h1>${reviewNotice()}<p>Seus dados ficam salvos para os próximos pedidos.</p><form id="portal-checkout-form"><label>Seu nome<input name="customer" autocomplete="name" maxlength="90" value="${escapeHtml(previous?.customer || profile.name || '')}" required></label><label>Telefone<input name="phone" type="tel" autocomplete="tel" maxlength="25" value="${escapeHtml(previous?.phone || profile.phone || '')}" required></label><label>Endereço e referência<input name="address" autocomplete="street-address" maxlength="180" value="${escapeHtml(previous?.address || profile.address || '')}" placeholder="Bloco, apartamento ou ponto de encontro" required></label><fieldset class="portal-payment-options"><legend>Como pretende pagar?</legend>${Object.entries(paymentLabels).filter(([key]) => key !== 'unspecified').map(([key, label]) => `<label><input type="radio" name="paymentMethod" value="${key}" ${key === selectedPayment ? 'checked' : ''} required><span>${key === 'pix_manual' ? '◇' : key === 'cash' ? 'R$' : '•••'}</span><strong>${label}</strong></label>`).join('')}</fieldset><label>Observação <span>(opcional)</span><textarea name="notes" maxlength="280" rows="3" placeholder="Ex.: deixar na portaria">${escapeHtml(previous?.notes || '')}</textarea></label><div class="portal-order-summary"><h2>Resumo do pedido</h2>${cartLines().map(({ product, quantity }) => `<div><span>${escapeHtml(lineLabel(product, quantity))}</span><strong>${money(linePrice(product, quantity))}</strong></div>`).join('')}<div><span>Subtotal dos produtos</span><strong>${money(subtotal())}</strong></div><div><span>Taxa de entrega</span><strong>${money(200)}</strong></div><div class="portal-order-summary__total"><span>Total para ${formatDate(deliveryDate)}</span><strong>${money(subtotal() + 200)}</strong></div></div><p class="portal-payment-note">A forma escolhida ainda não confirma o recebimento. Alterações são permitidas até 22h30 do dia anterior.</p>${!beforeCustomerCutoff(deliveryDate) ? '<p class="portal-error" role="alert">O prazo das 22h30 para esta entrega já terminou.</p>' : ''}${error ? `<p class="portal-error" role="alert">${escapeHtml(error)}</p>` : ''}<button class="portal-primary" type="submit" ${beforeCustomerCutoff(deliveryDate) ? '' : 'disabled'}>${previous ? 'Salvar alterações' : 'Confirmar pedido'} · ${money(subtotal() + 200)}</button></form></section>`;
  }
  function success() {
    return `<section class="portal-page portal-success"><span class="portal-success__icon" aria-hidden="true">✓</span><span class="portal-eyebrow">PEDIDO RECEBIDO</span><h1>Pedido registrado com sucesso.</h1><p>Agora ele segue para a conferência da operação.</p><div class="portal-success__receipt"><span>Pedido</span><strong>#${escapeHtml(lastOrder?.id.slice(0, 8) || '—')}</strong><span>Entrega</span><strong>${lastOrder ? formatDate(lastOrder.date) : '—'}</strong><span>Endereço</span><strong>${escapeHtml(lastOrder?.address || '—')}</strong><span>Pagamento</span><strong>${escapeHtml(paymentLabels[lastOrder?.paymentMethod] || paymentLabels.unspecified)}</strong><span>Total</span><strong>${lastOrder ? money(orderValue(lastOrder)) : '—'}</strong></div><p class="portal-payment-note">O pedido ainda não representa pagamento confirmado.</p><button class="portal-primary" type="button" data-view="orders">Ver meu pedido</button><button class="portal-link" type="button" data-view="catalog">Voltar aos produtos</button></section>`;
  }
  function ordersView() {
    const orders = readOrders().filter(owns).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const labels = { received: 'A conferir', confirmed: 'Conferido', packing: 'Em separação', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelado' };
    return `<section class="portal-page portal-orders-page"><button class="portal-back" type="button" data-view="catalog">← Voltar aos produtos</button><span class="portal-eyebrow">SEUS PEDIDOS</span><h1>Meus pedidos</h1>${error ? `<p class="portal-error" role="alert">${escapeHtml(error)}</p>` : ''}${reviewNotice()}${orders.length ? `<div class="portal-history portal-history--clean">${orders.map(order => { const state = order.status || (order.checked ? 'confirmed' : 'received'); const favorite = favoriteOrders.has(order.id); return `<article><div><span>${formatDate(order.date)}</span><strong>${labels[state] || 'A conferir'}</strong></div><h2>${order.items.slice(0, 3).map(item => escapeHtml(window.TrameliOrderMath.itemLabel(item))).join(' · ')}${order.items.length > 3 ? ` +${order.items.length - 3}` : ''}</h2><p>#${escapeHtml(order.id.slice(0, 8))} · ${escapeHtml(paymentLabels[order.paymentMethod] || paymentLabels.unspecified)}</p><footer><strong>${money(orderValue(order))}</strong><button type="button" data-favorite-order="${escapeHtml(order.id)}" aria-pressed="${favorite}">${favorite ? '♥ Favorito' : '♡ Favoritar'}</button>${shopping() ? `<button type="button" data-reorder="${escapeHtml(order.id)}">Pedir novamente</button>` : ''}${editable(order) ? `<span><button type="button" data-edit-order="${escapeHtml(order.id)}">Alterar</button><button type="button" data-cancel-order="${escapeHtml(order.id)}">Cancelar</button></span>` : ''}</footer></article>`; }).join('')}</div>` : `<div class="portal-empty"><h2>Nenhum pedido por aqui</h2><p>Quando você confirmar um pedido, ele aparecerá nesta lista.</p><button type="button" data-view="catalog">Escolher produtos</button></div>`}</section>`;
  }
  function weekView() {
    const days = [['monday','Segunda'],['tuesday','Terça'],['wednesday','Quarta'],['thursday','Quinta'],['friday','Sexta'],['saturday','Sábado'],['sunday','Domingo']];
    const plan = weeklyPlan[weeklyDay] || {};
    const selectedCount = Object.values(plan).reduce((sum, value) => sum + Number(value || 0), 0);
    return `<section class="portal-page portal-week"><button class="portal-back" type="button" data-view="catalog">← Voltar aos produtos</button><span class="portal-eyebrow">PLANEJAMENTO, NÃO CONFIRMAÇÃO</span><h1>Minha semana</h1><p>Organize o que pretende pedir em cada dia. Nada será enviado automaticamente.</p><div class="portal-week__days">${days.map(([value, label]) => `<button type="button" data-week-day="${value}" aria-pressed="${weeklyDay === value}">${label}<small>${Object.values(weeklyPlan[value] || {}).reduce((sum, quantity) => sum + Number(quantity || 0), 0)} itens</small></button>`).join('')}</div><div class="portal-week__products">${products().map(product => { const quantity = Number(plan[product.id] || 0); return `<article><div class="portal-week__photo">${photo(product)}</div><span><strong>${escapeHtml(product.name)}</strong><small>${money(product.priceCents)} / ${escapeHtml(product.unit)}</small></span><div class="portal-stepper"><button type="button" data-week-qty="-1" data-id="${escapeHtml(product.id)}" ${quantity ? '' : 'disabled'}>−</button><span>${weighted(product) ? `${quantity * 50} g` : quantity}</span><button type="button" data-week-qty="1" data-id="${escapeHtml(product.id)}">+</button></div></article>`; }).join('')}</div><div class="portal-week__footer"><span>${selectedCount} ${selectedCount === 1 ? 'item planejado' : 'itens planejados'} para ${days.find(([value]) => value === weeklyDay)[1]}</span><button class="portal-primary" type="button" data-week-to-cart ${selectedCount ? '' : 'disabled'}>Revisar este dia na sacola</button></div></section>`;
  }
  function render(preserveScroll = false) {
    if (location.hash !== '#loja') return;
    const scroll = motion()?.scrollTop() ?? scrollY;
    const changedView = view !== renderedView || !portalVisible;
    const focus = preserveScroll ? rememberFocus() : null;
    const draft = preserveScroll && view === 'checkout' && host.querySelector('#portal-checkout-form')
      ? Object.fromEntries(new FormData(host.querySelector('#portal-checkout-form'))) : null;
    motion()?.reset(host);
    host.innerHTML = ({ catalog, cart: cartView, checkout, success, orders: ordersView, week: weekView })[view]();
    if (view === 'orders' && window.TrameliPayments) {
      host.querySelector('.portal-page').insertAdjacentHTML('beforeend', window.TrameliPayments.customerRender());
      window.TrameliPayments.refresh();
    }
    if (draft && view === 'checkout') for (const [name, value] of Object.entries(draft)) {
      if (host.querySelector('#portal-checkout-form')?.elements[name]) host.querySelector('#portal-checkout-form').elements[name].value = value;
    }
    renderedView = view;
    portalVisible = true;
    updateCounters();
    renderFloating();
    document.querySelectorAll('[data-portal-nav]').forEach(button => button.setAttribute('aria-current', String(button.dataset.portalNav === view)));
    if (preserveScroll) { motion()?.scrollTo(scroll, false); restoreFocus(focus); }
    else motion()?.scrollTo(0, false);
    if (changedView && !preserveScroll) motion()?.enter(host); else motion()?.refresh();
  }
  function changeQuantity(id, delta) {
    const product = products().find(item => item.id === id);
    if (!product) return;
    const next = Math.max(0, Math.min(99, (cart[id] || 0) + delta));
    if (next) cart[id] = next; else delete cart[id];
    persistCart();
    if (view === 'catalog') {
      const current = [...host.querySelectorAll('.portal-stepper')].find(element => element.querySelector('[data-id]')?.dataset.id === id);
      if (current) {
        current.outerHTML = stepper(product);
        const updated = [...host.querySelectorAll('.portal-stepper')].find(element => element.querySelector('[data-id]')?.dataset.id === id);
        updated?.querySelector(`[data-qty="${delta}"]`)?.focus({ preventScroll: true });
        updateCounters();
        renderFloating();
        motion()?.pulse(updated);
        return;
      }
    }
    render(true);
  }
  async function placeOrder(form) {
    if (submitting) return;
    const lines = cartLines();
    const customer = form.elements.customer.value.trim();
    const address = form.elements.address.value.trim();
    const phone = form.elements.phone.value.trim();
    if (!lines.length || !customer || !phone || !address) { error = 'Informe seu nome, telefone, endereço e ao menos um produto.'; render(true); return; }
    const oldOrders = readOrders();
    const previous = oldOrders.find(order => order.id === editingOrderId && owns(order) && editable(order));
    if (editingOrderId && !previous) { error = 'Este pedido não pode mais ser alterado. Confira em Meus pedidos.'; render(true); return; }
    const deliveryDate = previous?.date || tomorrow();
    if (!beforeCustomerCutoff(deliveryDate)) { error = 'O prazo das 22h30 para esta entrega já terminou.'; render(true); return; }
    const nextOrder = {
      id: previous?.id || (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      createdAt: previous?.createdAt || new Date().toISOString(),
      checked: false, customer, address, phone,
      date: deliveryDate, feeCents: 200,
      items: lines.map(orderItem),
      notes: form.elements.notes.value.trim(), paymentMethod: form.elements.paymentMethod.value,
      source: 'portal', customerToken: token,
    };
    if (live) {
      submitting = true;
      form.querySelector('[type="submit"]').disabled = true;
      try {
        const saved = await live.saveCustomerOrder({ ...nextOrder, id: previous?.id || null, version: previous?.version || null }, lines.map(({ product, quantity }) => weighted(product) ? { product_id: product.id, grams: quantity * 50 } : { product_id: product.id, quantity }), checkoutRequestId);
        Object.assign(profile, { name: customer, phone: nextOrder.phone, address });
        lastOrder = saved;
        reorderNotices = [];
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
    reorderNotices = [];
    cart = {};
    editingOrderId = null;
    persistCart();
    error = '';
    view = 'success';
    window.dispatchEvent(new Event('trameli:orders-changed'));
    render();
  }

  host.addEventListener('click', async event => {
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) { await shopping()?.toggle(favorite.dataset.favorite); return; }
    const favoriteOrder = event.target.closest('[data-favorite-order]');
    if (favoriteOrder) {
      const id = favoriteOrder.dataset.favoriteOrder;
      if (favoriteOrders.has(id)) favoriteOrders.delete(id); else favoriteOrders.add(id);
      try { localStorage.setItem(favoriteOrdersKey, JSON.stringify([...favoriteOrders])); } catch { /* Favorite remains for this session. */ }
      render(true);
      return;
    }
    const weekDayButton = event.target.closest('[data-week-day]');
    if (weekDayButton) { weeklyDay = weekDayButton.dataset.weekDay; render(true); return; }
    const weekQuantity = event.target.closest('[data-week-qty]');
    if (weekQuantity) {
      const product = products().find(item => item.id === weekQuantity.dataset.id);
      if (!product) return;
      const plan = { ...(weeklyPlan[weeklyDay] || {}) };
      const next = Math.max(0, Math.min(99, Number(plan[product.id] || 0) + Number(weekQuantity.dataset.weekQty)));
      if (next) plan[product.id] = next; else delete plan[product.id];
      weeklyPlan = { ...weeklyPlan, [weeklyDay]: plan };
      try { localStorage.setItem(weeklyPlanKey, JSON.stringify(weeklyPlan)); } catch { /* Plan remains for this session. */ }
      render(true);
      return;
    }
    if (event.target.closest('[data-week-to-cart]')) {
      const plan = weeklyPlan[weeklyDay] || {};
      if ((cartLines().length || editingOrderId) && !confirm('Substituir a sacola atual pelo planejamento deste dia?')) return;
      cart = { ...plan }; editingOrderId = null; reorderNotices = ['Planejamento carregado. Revise a sacola antes de confirmar o pedido.'];
      persistCart(); view = 'cart'; render(); return;
    }
    const filter = event.target.closest('[data-personal-filter]');
    if (filter) { personalFilter = filter.dataset.personalFilter; render(true); return; }
    const reorder = event.target.closest('[data-reorder]');
    if (reorder) {
      if (reordering || submitting) return;
      const id = reorder.dataset.reorder;
      reordering = true;
      try {
        if (live) await live.load(true);
        const order = readOrders().find(item => item.id === id && owns(item));
        if (!order) throw new Error('O pedido não está mais disponível.');
        const result = shopping().rebuildCart(order, products());
        if (!Object.keys(result.cart).length) {
          reorderNotices = result.notices; error = 'Nenhum item deste pedido está disponível para recompra.';
          view = 'orders'; render(); return;
        }
        if ((cartLines().length || editingOrderId) && !confirm('Substituir a sacola atual por uma nova cópia deste pedido?')) return;
        cart = result.cart; editingOrderId = null; error = '';
        reorderNotices = ['Nova compra com os preços atuais e entrega para amanhã. O pedido anterior não foi alterado.', ...result.notices];
        if (live) {
          checkoutRequestId = crypto.randomUUID();
          try { sessionStorage.setItem(requestKey, checkoutRequestId); } catch { /* Current tab keeps the new request ID. */ }
        }
        persistCart(); view = 'cart'; render();
      } catch (cause) { error = `Não foi possível preparar a recompra: ${cause.message}`; view = 'orders'; render(true); }
      finally { reordering = false; }
      return;
    }
    const catalogJump = event.target.closest('a[href="#portal-products"]');
    if (catalogJump) { event.preventDefault(); motion()?.scrollTo('#portal-products', true, 16); return; }
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
      order.items.forEach(item => { const product = products().find(entry => entry.id === item.productId) || products().find(entry => entry.name === item.name); if (product) cart[product.id] = item.weightGrams ? item.weightGrams / 50 : item.quantity; });
      editingOrderId = order.id;
      reorderNotices = [];
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
    const visible = filteredProducts();
    motion()?.reset(host);
    document.getElementById('portal-grid').innerHTML = visible.length ? visible.map(card).join('') : '<p class="portal-empty">Não encontramos produtos nessa busca.</p>';
    motion()?.refresh();
  });
  floatingHost?.addEventListener('click', event => {
    if (!event.target.closest('[data-view="cart"]')) return;
    view = 'cart'; error = ''; render();
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
    if (isPortal && !portalVisible) {
      window.TrameliMenu?.close();
      render();
    } else if (!isPortal) { portalVisible = false; renderFloating(); }
  }
  window.addEventListener('trameli:portal-open', syncPortalFrame);
  window.addEventListener('trameli:shopping-changed', () => { if (view === 'catalog') render(true); });
  window.addEventListener('trameli:catalog-changed', () => render(true));
  if (live) window.addEventListener('trameli:orders-changed', () => { if (view === 'orders' || (view === 'catalog' && personalFilter === 'frequent')) render(true); });
  window.addEventListener('storage', event => { if ([orderKey, cartKey].includes(event.key)) { if (event.key === cartKey) cart = readJson(cartKey, {}); render(true); } });
  window.addEventListener('hashchange', syncPortalFrame);
  syncPortalFrame();
})();
