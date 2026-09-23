(() => {
  const key = 'trameli-catalog-v1';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  const parseMoney = value => {
    const raw = String(value).trim();
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) return null;
    const [whole, decimals = ''] = raw.replace(',', '.').split('.');
    const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents <= 100000000 ? cents : null;
  };
  const read = () => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item.name === 'string') : [];
    } catch { return []; }
  };
  let products = read();
  let editingId = null;

  const dialog = document.createElement('dialog');
  dialog.className = 'catalog-dialog';
  dialog.innerHTML = `<form id="catalog-form" novalidate><div class="catalog-dialog__heading"><div><p class="screen-eyebrow">CATÁLOGO</p><h2 id="catalog-dialog-title">Novo produto</h2></div><button type="button" class="catalog-close" aria-label="Fechar">×</button></div><p>Cadastre somente os itens e preços confirmados.</p><label>Nome do produto<input name="name" maxlength="90" required></label><div class="catalog-form-grid"><label>Preço unitário (R$)<input name="price" inputmode="decimal" placeholder="0,00" required></label><label>Unidade<input name="unit" maxlength="30" placeholder="unidade, pacote, kg..." required></label></div><label>Categoria <span>(opcional)</span><input name="category" maxlength="50"></label><label class="catalog-check"><input name="active" type="checkbox" checked> Disponível para pedidos</label><p class="catalog-error" role="alert" hidden></p><div class="catalog-actions"><button type="button" class="catalog-cancel">Cancelar</button><button type="submit">Salvar produto</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('.catalog-error');
  const datalist = document.createElement('datalist');
  datalist.id = 'catalog-products';
  document.body.append(datalist);

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
    form.elements.active.checked = product?.active ?? true;
    dialog.querySelector('#catalog-dialog-title').textContent = product ? 'Editar produto' : 'Novo produto';
    dialog.showModal();
    form.elements.name.focus();
  }

  function save(next) {
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
    const sorted = products.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return `<div class="catalog-toolbar"><p>${sorted.length} ${sorted.length === 1 ? 'produto cadastrado' : 'produtos cadastrados'}</p><button type="button" data-catalog-action="new">+ Adicionar produto</button></div>${sorted.length ? `<div class="catalog-grid">${sorted.map(item => `<article class="catalog-card"><div><span>${escapeHtml(item.category || 'Sem categoria')}</span><span class="catalog-card__state ${item.active ? '' : 'catalog-card__state--off'}">${item.active ? 'Disponível' : 'Indisponível'}</span></div><h3>${escapeHtml(item.name)}</h3><p><strong>${money(item.priceCents)}</strong> / ${escapeHtml(item.unit)}</p><div class="catalog-card__actions"><button type="button" data-catalog-action="edit" data-id="${item.id}">Editar</button><button type="button" data-catalog-action="delete" data-id="${item.id}">Excluir</button></div></article>`).join('')}</div>` : `<div class="screen-empty"><p>Nenhum produto cadastrado ainda. Comece pela lista real de produtos e preços.</p><button type="button" data-catalog-action="new">+ Cadastrar primeiro produto</button></div>`}`;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-catalog-action]');
    if (!button) return;
    const action = button.dataset.catalogAction;
    if (action === 'new') open();
    if (action === 'edit') open(button.dataset.id);
    if (action === 'delete') {
      const product = products.find(item => item.id === button.dataset.id);
      if (product && confirm(`Excluir ${product.name} do catálogo? Os pedidos já salvos não serão alterados.`)) save(products.filter(item => item.id !== product.id));
    }
  });
  dialog.querySelector('.catalog-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.catalog-cancel').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    const priceCents = parseMoney(form.elements.price.value);
    const unit = form.elements.unit.value.trim();
    if (!name || !unit || priceCents === null) {
      error.textContent = 'Informe nome, preço válido e unidade.';
      error.hidden = false;
      return;
    }
    if (products.some(item => item.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR') && item.id !== editingId)) {
      error.textContent = 'Já existe um produto com esse nome.';
      error.hidden = false;
      return;
    }
    const product = { id: editingId || crypto.randomUUID(), name, priceCents, unit, category: form.elements.category.value.trim(), active: form.elements.active.checked };
    const next = editingId ? products.map(item => item.id === editingId ? product : item) : [...products, product];
    if (save(next)) dialog.close();
  });

  window.TrameliCatalog = { render, list: () => products.slice(), findByName: name => products.find(item => item.active && item.name.toLocaleLowerCase('pt-BR') === name.trim().toLocaleLowerCase('pt-BR')) };
})();
