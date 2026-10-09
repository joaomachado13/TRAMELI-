(() => {
  const live = window.TrameliLive;
  const key = 'trameli-catalog-v1';
  const seedKey = 'trameli-catalog-client-sheet-seeded-v2';
  const sourceProducts = (window.TrameliSourceCatalog || []).map(item => ({ ...item, demo: true }));
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  const parseMoney = value => {
    const raw = String(value).trim();
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) return null;
    const [whole, decimals = ''] = raw.replace(',', '.').split('.');
    const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents <= 100000000 ? cents : null;
  };
  const clampPhotoFrame = (x = 50, y = 50, zoom = 100) => ({
    x: Math.round(Math.max(0, Math.min(100, Number(x) || 0))),
    y: Math.round(Math.max(0, Math.min(100, Number(y) || 0))),
    zoom: Math.round(Math.max(100, Math.min(220, Number(zoom) || 100)) / 5) * 5,
  });
  const photoFrameFromUrl = value => {
    const match = String(value || '').match(/#trameli-frame=(\d{1,3}),(\d{1,3}),(\d{3})$/);
    return match ? clampPhotoFrame(match[1], match[2], match[3]) : clampPhotoFrame();
  };
  const photoUrl = value => String(value || '').replace(/#trameli-frame=\d{1,3},\d{1,3},\d{3}$/, '');
  const photoUrlWithFrame = (value, frame) => {
    const base = photoUrl(value);
    if (!base || (frame.x === 50 && frame.y === 50 && frame.zoom === 100)) return base;
    return `${base}#trameli-frame=${frame.x},${frame.y},${frame.zoom}`;
  };
  const photoStyle = value => {
    const frame = photoFrameFromUrl(value);
    return `object-position:${frame.x}% ${frame.y}%;transform:${frame.zoom === 100 ? 'none' : `scale(${frame.zoom / 100})`};transform-origin:center center;`;
  };
  const read = () => {
    if (live) return live.products.slice();
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item.name === 'string').map(item => window.TrameliProductPhoto ? window.TrameliProductPhoto(item) : item) : [];
    } catch { return []; }
  };
  let products = read();
  if (!live) {
    try {
      if (!localStorage.getItem(seedKey)) {
        const retained = products.filter(item => !item.demo);
        const existingNames = new Set(retained.map(item => item.name.toLocaleLowerCase('pt-BR')));
        products = [...retained, ...sourceProducts.filter(item => !existingNames.has(item.name.toLocaleLowerCase('pt-BR')))];
        localStorage.setItem(key, JSON.stringify(products));
        localStorage.setItem(seedKey, 'true');
      }
    } catch { /* The catalog can still be viewed without persistent storage. */ }
  }
  let editingId = null;
  const filters = { query: '', category: 'all', availability: 'all', photo: 'all', cost: 'all', sort: 'name' };

  const dialog = document.createElement('dialog');
  dialog.className = 'catalog-dialog';
  dialog.innerHTML = `<form id="catalog-form" novalidate><div class="catalog-dialog__heading"><div><p class="screen-eyebrow">CATÁLOGO</p><h2 id="catalog-dialog-title">Novo produto</h2></div><button type="button" class="catalog-close" aria-label="Fechar">×</button></div><label>Nome do produto<input name="name" maxlength="90" required></label><div class="catalog-form-grid"><label>Preço ao cliente (R$)<input name="price" inputmode="decimal" placeholder="0,00" required></label><label>Custo da padaria (R$) <span>(opcional)</span><input name="cost" inputmode="decimal" placeholder="A confirmar"></label></div><div class="catalog-form-grid"><label>Unidade<input name="unit" maxlength="30" placeholder="unidade, pacote, kg..." required></label><label>Categoria <span>(opcional)</span><input name="category" maxlength="50"></label></div><label>Foto do produto${live?.role === 'master' ? '<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp"><span>PNG, JPEG ou WebP de até 2 MB.</span>' : live ? '<input name="imageUrl" type="url" placeholder="https://..."><span>Use uma URL pública da imagem.</span>' : '<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp"><span>PNG, JPEG ou WebP de até 1,5 MB.</span>'}</label><section class="catalog-photo-editor" data-photo-editor hidden><div class="catalog-photo-editor__heading"><div><strong>Enquadrar foto</strong><span>Arraste a imagem para mostrar a parte certa.</span></div><button type="button" data-photo-reset>Centralizar</button></div><div class="catalog-photo-editor__stage" data-photo-stage tabindex="0" role="img" aria-label="Prévia da foto. Arraste para reposicionar."><img data-photo-preview alt=""><span data-photo-placeholder>Escolha uma foto para começar.</span><span class="catalog-photo-editor__hint">Arraste para posicionar</span></div><label class="catalog-photo-editor__zoom">Zoom <output data-photo-zoom>100%</output><input name="imageZoom" type="range" min="100" max="220" step="5" value="100"></label><p>O arquivo original é preservado; este ajuste muda apenas o enquadramento no catálogo.</p></section>${live?.operator ? '<label>Nome no fornecedor <span>(opcional)</span><input name="supplierName" maxlength="90"></label><div class="catalog-form-grid"><label>Indisponível de <span>(opcional)</span><input name="unavailableFrom" type="date"></label><label>Até <span>(inclusive)</span><input name="unavailableUntil" type="date"></label></div><label>Substituto sugerido <span>(opcional)</span><select name="substituteProductId"><option value="">Nenhum</option></select></label>' : ''}<label class="catalog-check"><input name="active" type="checkbox" checked> Disponível para pedidos</label><p class="catalog-error" role="alert" hidden></p><div class="catalog-actions"><button type="button" class="catalog-cancel">Cancelar</button><button type="submit">Salvar produto</button></div></form>`;
  document.body.append(dialog);
  const detailDialog = document.createElement('dialog');
  detailDialog.className = 'entity-drawer product-drawer';
  detailDialog.setAttribute('aria-label', 'Detalhes do produto');
  document.body.append(detailDialog);
  const historyDialog = document.createElement('dialog');
  historyDialog.className = 'catalog-dialog';
  document.body.append(historyDialog);
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('.catalog-error');
  const photoEditor = form.querySelector('[data-photo-editor]');
  const photoStage = form.querySelector('[data-photo-stage]');
  const photoPreview = form.querySelector('[data-photo-preview]');
  const photoPlaceholder = form.querySelector('[data-photo-placeholder]');
  const photoZoom = form.querySelector('[name="imageZoom"]');
  const photoZoomOutput = form.querySelector('[data-photo-zoom]');
  let photoFrame = clampPhotoFrame();
  let photoPreviewObjectUrl = null;
  let photoDrag = null;
  const datalist = document.createElement('datalist');
  datalist.id = 'catalog-products';
  document.body.append(datalist);

  function releasePhotoPreviewUrl() {
    if (photoPreviewObjectUrl) URL.revokeObjectURL(photoPreviewObjectUrl);
    photoPreviewObjectUrl = null;
  }
  function applyPhotoFrame() {
    photoPreview.style.objectPosition = `${photoFrame.x}% ${photoFrame.y}%`;
    photoPreview.style.transform = photoFrame.zoom === 100 ? 'none' : `scale(${photoFrame.zoom / 100})`;
    photoPreview.style.transformOrigin = 'center center';
    photoZoom.value = String(photoFrame.zoom);
    photoZoomOutput.value = `${photoFrame.zoom}%`;
    photoZoomOutput.textContent = `${photoFrame.zoom}%`;
  }
  function setPhotoPreview(source) {
    const url = photoUrl(source);
    photoEditor.hidden = !url;
    if (!url) {
      photoPreview.removeAttribute('src');
      photoPlaceholder.hidden = false;
      return;
    }
    if (photoPreview.getAttribute('src') !== url) photoPreview.setAttribute('src', url);
    photoPlaceholder.hidden = true;
    applyPhotoFrame();
  }
  function resetPhotoFrame() {
    photoFrame = clampPhotoFrame();
    applyPhotoFrame();
  }
  photoStage.addEventListener('pointerdown', event => {
    if (photoEditor.hidden || !photoPreview.getAttribute('src')) return;
    const rect = photoStage.getBoundingClientRect();
    photoDrag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      x: photoFrame.x, y: photoFrame.y, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    photoStage.classList.add('is-dragging');
    try { photoStage.setPointerCapture(event.pointerId); } catch { /* Synthetic and older pointers may not support capture. */ }
    event.preventDefault();
  });
  photoStage.addEventListener('pointermove', event => {
    if (!photoDrag || event.pointerId !== photoDrag.pointerId) return;
    photoFrame = clampPhotoFrame(
      photoDrag.x - ((event.clientX - photoDrag.clientX) / photoDrag.width) * 100,
      photoDrag.y - ((event.clientY - photoDrag.clientY) / photoDrag.height) * 100,
      photoFrame.zoom,
    );
    applyPhotoFrame();
  });
  const stopPhotoDrag = event => {
    if (!photoDrag || (event && event.pointerId !== photoDrag.pointerId)) return;
    photoDrag = null;
    photoStage.classList.remove('is-dragging');
  };
  photoStage.addEventListener('pointerup', stopPhotoDrag);
  photoStage.addEventListener('pointercancel', stopPhotoDrag);
  photoStage.addEventListener('keydown', event => {
    const step = event.shiftKey ? 10 : 3;
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    photoFrame = clampPhotoFrame(
      photoFrame.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      photoFrame.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
      photoFrame.zoom,
    );
    applyPhotoFrame();
    event.preventDefault();
  });
  photoZoom.addEventListener('input', () => {
    photoFrame = clampPhotoFrame(photoFrame.x, photoFrame.y, photoZoom.value);
    applyPhotoFrame();
  });
  form.elements.imageFile?.addEventListener('change', () => {
    const file = form.elements.imageFile.files?.[0];
    if (!file) {
      releasePhotoPreviewUrl();
      const existing = products.find(item => item.id === editingId);
      photoFrame = photoFrameFromUrl(existing?.image || '');
      setPhotoPreview(existing?.image || '');
      return;
    }
    releasePhotoPreviewUrl();
    photoPreviewObjectUrl = URL.createObjectURL(file);
    photoFrame = clampPhotoFrame();
    setPhotoPreview(photoPreviewObjectUrl);
  });
  form.elements.imageUrl?.addEventListener('change', () => {
    releasePhotoPreviewUrl();
    photoFrame = clampPhotoFrame();
    setPhotoPreview(form.elements.imageUrl.value.trim());
  });
  photoEditor.querySelector('[data-photo-reset]').addEventListener('click', resetPhotoFrame);
  dialog.addEventListener('close', releasePhotoPreviewUrl);

  function updateDatalist() {
    datalist.innerHTML = products.filter(item => item.active).map(item => `<option value="${escapeHtml(item.name)}"></option>`).join('');
  }
  updateDatalist();

  function open(id = null) {
    const product = products.find(item => item.id === id);
    editingId = product?.id || null;
    form.reset();
    error.hidden = true;
    form.elements.name.value = product?.name || '';
    form.elements.price.value = product ? (product.priceCents / 100).toFixed(2).replace('.', ',') : '';
    form.elements.unit.value = product?.unit || '';
    form.elements.category.value = product?.category || '';
    if (form.elements.imageUrl) form.elements.imageUrl.value = photoUrl(product?.image || '');
    if (form.elements.cost) form.elements.cost.value = product?.costCents == null ? '' : (product.costCents / 100).toFixed(2).replace('.', ',');
    if (form.elements.supplierName) form.elements.supplierName.value = product?.supplierName || '';
    if (form.elements.unavailableFrom) form.elements.unavailableFrom.value = product?.unavailableFrom || '';
    if (form.elements.unavailableUntil) form.elements.unavailableUntil.value = product?.unavailableUntil || '';
    if (form.elements.substituteProductId) {
      form.elements.substituteProductId.innerHTML = `<option value="">Nenhum</option>${products.filter(item => item.active && item.id !== product?.id).map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;
      form.elements.substituteProductId.value = product?.substituteProductId || '';
    }
    form.elements.active.checked = product?.active ?? true;
    photoFrame = photoFrameFromUrl(product?.image || '');
    setPhotoPreview(product?.image || '');
    dialog.querySelector('#catalog-dialog-title').textContent = product ? 'Editar produto' : 'Novo produto';
    dialog.showModal();
    form.elements.name.focus();
  }

  async function save(next) {
    if (live) {
      const changed = next.find(item => !products.some(old => old.id === item.id && JSON.stringify(old) === JSON.stringify(item)));
      if (!changed) return false;
      try { await live.saveProduct(changed); return true; }
      catch (cause) { error.textContent = `Não foi possível salvar: ${cause.message}`; error.hidden = false; return false; }
    }
    try {
      localStorage.setItem(key, JSON.stringify(next));
      products = next;
      updateDatalist();
      dispatchEvent(new Event('trameli:catalog-changed'));
      return true;
    } catch {
      error.textContent = 'Não foi possível salvar no navegador. Os dados não foram alterados.';
      error.hidden = false;
      return false;
    }
  }

  function render() {
    const categories = [...new Set(products.map(item => item.category || 'Sem categoria'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const normalized = filters.query.trim().toLocaleLowerCase('pt-BR');
    const sorted = products.filter(item => (!normalized || item.name.toLocaleLowerCase('pt-BR').includes(normalized))
      && (filters.category === 'all' || (item.category || 'Sem categoria') === filters.category)
      && (filters.availability === 'all' || (filters.availability === 'active') === Boolean(item.active))
      && (filters.photo === 'all' || (filters.photo === 'with') === Boolean(item.image))
      && (filters.cost === 'all' || (filters.cost === 'known') === (item.costCents != null)))
      .sort((a, b) => filters.sort === 'price-desc' ? b.priceCents - a.priceCents : filters.sort === 'price-asc' ? a.priceCents - b.priceCents : a.name.localeCompare(b.name, 'pt-BR'));
    const missingCosts = products.filter(item => item.active && item.costCents == null).length;
    return `<div data-catalog-root><div class="catalog-toolbar"><div><p>${sorted.length} de ${products.length} produtos</p>${missingCosts ? `<button class="catalog-alert" type="button" data-catalog-missing>${missingCosts} sem custo</button>` : '<small>Custos ativos preenchidos.</small>'}</div><div class="catalog-toolbar__actions"><a href="#loja">Ver portal ↗</a><button type="button" data-catalog-action="new">+ Produto</button></div></div><div class="catalog-filters"><label>Buscar<input id="catalog-search" type="search" value="${escapeHtml(filters.query)}" placeholder="Nome do produto"></label><label>Categoria<select data-catalog-filter="category"><option value="all">Todas</option>${categories.map(value => `<option value="${escapeHtml(value)}" ${filters.category === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label><label>Disponibilidade<select data-catalog-filter="availability"><option value="all">Todas</option><option value="active" ${filters.availability === 'active' ? 'selected' : ''}>Disponíveis</option><option value="inactive" ${filters.availability === 'inactive' ? 'selected' : ''}>Indisponíveis</option></select></label><label>Foto<select data-catalog-filter="photo"><option value="all">Todas</option><option value="with" ${filters.photo === 'with' ? 'selected' : ''}>Com foto</option><option value="without" ${filters.photo === 'without' ? 'selected' : ''}>Sem foto</option></select></label>${live?.operator ? `<label>Custo<select data-catalog-filter="cost"><option value="all">Todos</option><option value="known" ${filters.cost === 'known' ? 'selected' : ''}>Preenchido</option><option value="missing" ${filters.cost === 'missing' ? 'selected' : ''}>Pendente</option></select></label>` : ''}<label>Ordenar<select data-catalog-filter="sort"><option value="name">Nome</option><option value="price-desc" ${filters.sort === 'price-desc' ? 'selected' : ''}>Maior preço</option><option value="price-asc" ${filters.sort === 'price-asc' ? 'selected' : ''}>Menor preço</option></select></label></div>${sorted.length ? `<div class="catalog-grid catalog-grid--compact">${sorted.map(item => `<button type="button" class="catalog-card catalog-card--compact" data-catalog-action="view" data-id="${escapeHtml(item.id)}">${item.image ? `<img class="catalog-card__image" src="${escapeHtml(item.image)}" style="${photoStyle(item.image)}" alt="" loading="lazy">` : '<div class="catalog-card__image catalog-card__image--pending" aria-hidden="true">Foto pendente</div>'}<span class="catalog-card__body"><span><small>${escapeHtml(item.category || 'Sem categoria')}</small><small class="catalog-card__state ${item.active ? '' : 'catalog-card__state--off'}">${item.active ? 'Disponível' : 'Indisponível'}</small></span><strong>${escapeHtml(item.name)}</strong><span>${money(item.priceCents)} / ${escapeHtml(item.unit)}</span>${live?.operator ? `<small class="catalog-cost-state ${item.costCents == null ? 'is-missing' : ''}">${item.costCents == null ? 'Custo pendente' : `Custo ${money(item.costCents)}`}</small>` : ''}</span></button>`).join('')}</div>` : '<div class="friendly-empty"><strong>Nenhum produto encontrado.</strong><span>Ajuste os filtros para visualizar outros itens.</span></div>'}</div>`;
  }

  function rerender() {
    const root = document.querySelector('[data-catalog-root]');
    if (root) root.outerHTML = render();
  }

  function openDetail(id) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    const margin = product.costCents == null || !product.priceCents ? null : Math.round(((product.priceCents - product.costCents) / product.priceCents) * 100);
    detailDialog.innerHTML = `<div class="entity-detail"><header class="entity-detail__header"><div><p class="screen-eyebrow">PRODUTO</p><h2>${escapeHtml(product.name)}</h2><p>${escapeHtml(product.category || 'Sem categoria')} · ${product.active ? 'Disponível' : 'Indisponível'}</p></div><button type="button" data-product-close aria-label="Fechar">×</button></header><div class="entity-detail__body">${product.image ? `<div class="product-detail-photo-frame"><img class="product-detail-photo" src="${escapeHtml(product.image)}" style="${photoStyle(product.image)}" alt="${escapeHtml(product.name)}"></div>` : '<div class="product-detail-photo product-detail-photo--empty">Foto pendente</div>'}<section class="entity-summary"><div><span>Preço</span><strong>${money(product.priceCents)}</strong></div><div><span>Custo</span><strong>${product.costCents == null ? 'Pendente' : money(product.costCents)}</strong></div><div><span>Margem</span><strong>${margin == null ? '—' : `${margin}%`}</strong></div></section><section class="entity-block"><h3>Cadastro</h3><p>Unidade: ${escapeHtml(product.unit)}</p>${product.supplierName ? `<p>Fornecedor: ${escapeHtml(product.supplierName)}</p>` : ''}${product.unavailableFrom ? `<p>Indisponível de ${escapeHtml(product.unavailableFrom)} até ${escapeHtml(product.unavailableUntil)}</p>` : ''}</section></div><footer class="entity-detail__actions"><button class="screen-primary" type="button" data-catalog-action="edit" data-id="${escapeHtml(product.id)}">Editar produto</button>${live?.operator ? `<button type="button" data-catalog-action="history" data-id="${escapeHtml(product.id)}">Histórico</button>` : ''}<button type="button" class="entity-danger" data-catalog-action="delete" data-id="${escapeHtml(product.id)}">${live?.role === 'master' ? 'Excluir definitivamente' : live ? 'Desativar' : 'Excluir'}</button></footer></div>`;
    detailDialog.showModal();
  }

  document.addEventListener('click', async event => {
    if (event.target.closest('[data-product-close]')) { detailDialog.close(); return; }
    if (event.target.closest('[data-catalog-missing]')) { filters.cost = 'missing'; rerender(); return; }
    const button = event.target.closest('[data-catalog-action]');
    if (!button) return;
    const action = button.dataset.catalogAction;
    if (action === 'new') open();
    if (action === 'view') openDetail(button.dataset.id);
    if (action === 'edit') { detailDialog.close(); open(button.dataset.id); }
    if (action === 'history' && live?.operator) {
      detailDialog.close();
      const product=products.find(item=>item.id===button.dataset.id);
      historyDialog.innerHTML='<p>Carregando histórico…</p>';historyDialog.showModal();
      try { const events=await live.productEvents(button.dataset.id);historyDialog.innerHTML=`<div class="catalog-dialog__heading"><h2>Histórico · ${escapeHtml(product?.name||'produto')}</h2><button type="button" data-history-close class="catalog-close" aria-label="Fechar">×</button></div>${events.length?`<ul>${events.map(item=>`<li><strong>${item.event_kind==='cost'?'Custo':'Catálogo'}</strong> · ${new Date(item.happened_at).toLocaleString('pt-BR')}</li>`).join('')}</ul>`:'<p>Nenhuma alteração registrada desde a ativação do histórico.</p>'}`; }
      catch (cause) { historyDialog.innerHTML=`<p role="alert">Não foi possível carregar: ${escapeHtml(cause.message)}</p><button type="button" data-history-close>Fechar</button>`; }
    }
    if (action === 'confirm-cost') {
      const product = products.find(item => item.id === button.dataset.id);
      if (product?.costEstimated && confirm(`Você conferiu com a padaria que o custo de ${product.name} é ${money(product.costCents)} por ${product.unit}?`)) {
        live.confirmProductCost(product.id).catch(cause => alert(`Não foi possível confirmar o custo: ${cause.message}`));
      }
    }
    if (action === 'delete') {
      const product = products.find(item => item.id === button.dataset.id);
      const permanent = live?.role === 'master';
      if (product && confirm(`${permanent ? 'Excluir definitivamente' : live ? 'Desativar' : 'Excluir'} ${product.name} do catálogo? Os pedidos já salvos não serão alterados.`)) {
        if (permanent) { try { await window.TrameliAccount?.ensureMasterAal2?.(); await live.deleteProduct(product.id); detailDialog.close(); } catch (cause) { alert(`Não foi possível excluir: ${cause.message}`); } }
        else if (live) live.saveProduct({ ...product, active: false }).catch(cause => alert(`Não foi possível desativar: ${cause.message}`));
        else save(products.filter(item => item.id !== product.id));
      }
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id !== 'catalog-search') return;
    filters.query = event.target.value;
    rerender();
    const input = document.getElementById('catalog-search');
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(filters.query.length, filters.query.length);
  });
  document.addEventListener('change', event => {
    const select = event.target.closest('[data-catalog-filter]');
    if (!select) return;
    filters[select.dataset.catalogFilter] = select.value;
    rerender();
  });
  historyDialog.addEventListener('click',event=>{if(event.target.closest('[data-history-close]'))historyDialog.close();});
  dialog.querySelector('.catalog-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.catalog-cancel').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    const priceCents = parseMoney(form.elements.price.value);
    const costCents = form.elements.cost?.value.trim() ? parseMoney(form.elements.cost.value) : null;
    const unit = form.elements.unit.value.trim();
    const unavailableFrom=form.elements.unavailableFrom?.value||null;
    const unavailableUntil=form.elements.unavailableUntil?.value||null;
    const substituteProductId=form.elements.substituteProductId?.value||null;
    if (!name || !unit || priceCents === null || (form.elements.cost?.value.trim() && costCents === null)) {
      error.textContent = 'Informe nome, unidade e valores válidos em reais.';
      error.hidden = false;
      return;
    }
    if ((unavailableFrom && !unavailableUntil) || (!unavailableFrom && unavailableUntil) || (unavailableFrom && unavailableFrom > unavailableUntil)) {
      error.textContent = 'Informe o início e o fim válidos da indisponibilidade.';
      error.hidden = false;
      return;
    }
    if (form.elements.active.checked && products.some(item => item.active && item.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR') && item.id !== editingId)) {
      error.textContent = 'Já existe um produto disponível com esse nome.';
      error.hidden = false;
      return;
    }
    const previous = products.find(item => item.id === editingId);
    const productId = editingId || crypto.randomUUID();
    let image = photoUrl(form.elements.imageUrl?.value.trim() || previous?.image || '');
    const file = form.elements.imageFile?.files?.[0];
    if (file) {
      if (live) {
        try { image = await live.uploadProductImage(productId, file); }
        catch (cause) { error.textContent = `Não foi possível enviar a foto: ${cause.message}`; error.hidden = false; return; }
      } else image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }).catch(() => null);
      if (!image) { error.textContent = 'Não foi possível ler a foto selecionada.'; error.hidden = false; return; }
    }
    image = photoUrlWithFrame(image, photoFrame);
    const product = { ...previous, id: productId, name, image, priceCents, unit, category: form.elements.category.value.trim(), active: form.elements.active.checked, costCents, supplierName: form.elements.supplierName?.value.trim() || '', unavailableFrom, unavailableUntil, substituteProductId, ...(previous?.demo ? { demo: true } : {}) };
    if (product.active) product.reviewReason = null;
    const next = editingId ? products.map(item => item.id === editingId ? product : item) : [...products, product];
    if (await save(next)) { products = read(); updateDatalist(); rerender(); dialog.close(); }
  });

  if (live) window.addEventListener('trameli:catalog-changed', () => { products = read(); updateDatalist(); });

  window.TrameliCatalog = { render, list: () => products.slice(), findByName: name => products.find(item => item.active && item.name.toLocaleLowerCase('pt-BR') === name.trim().toLocaleLowerCase('pt-BR')), open: openDetail };
})();
