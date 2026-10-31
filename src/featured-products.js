export function selectFeaturedProducts(products) {
  return products.filter(product => product.active && Number.isSafeInteger(product.priceCents) && product.priceCents >= 0
    && Number.isInteger(product.featuredPosition) && product.featuredPosition >= 1 && product.featuredPosition <= 20)
    .sort((a, b) => a.featuredPosition - b.featuredPosition || a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export function featuredProductsMarkup(products, { headingId, renderPhoto, renderControls, hidden = false }) {
  const selected = selectFeaturedProducts(products);
  if (!selected.length) return '';
  return `<section class="featured-products" aria-labelledby="${escapeHtml(headingId)}" ${hidden ? 'hidden' : ''}>
    <header class="featured-products__heading"><div><span>ESCOLHA RÁPIDA</span><h2 id="${escapeHtml(headingId)}">Destaques</h2></div></header>
    <div class="featured-products__rail" role="list" aria-label="Produtos em destaque">
      ${selected.map((product, index) => `<article class="featured-product" role="listitem" data-featured-id="${escapeHtml(product.id)}">
        <div class="featured-product__photo">${renderPhoto(product, index)}<span class="featured-product__badge">Em destaque</span></div>
        <div class="featured-product__body"><p class="featured-product__price">${money(product.priceCents)} <small>/ ${escapeHtml(product.unit)}</small></p><h3>${escapeHtml(product.name)}</h3><div class="featured-product__controls">${renderControls(product)}</div></div>
      </article>`).join('')}
    </div>
  </section>`;
}
