import assert from 'node:assert/strict';
import { selectFeaturedProducts, featuredProductsMarkup } from '../src/featured-products.js';

const bread = { id: 'pao', name: 'Pão francês', unit: 'unidade', priceCents: 140, active: true, featuredPosition: 1 };
const cheeseBread = { id: 'queijo', name: 'Pão de queijo', unit: 'unidade', priceCents: 130, active: true, featuredPosition: 2 };
const catalog = [cheeseBread, { ...bread, id: 'outro-produto', featuredPosition: null }, bread];
assert.deepEqual(selectFeaturedProducts(catalog), [bread, cheeseBread], 'A ordem escolhida pela operação deve prevalecer sobre o catálogo.');
assert.deepEqual(selectFeaturedProducts([{ ...bread, featuredPosition: 3 }, cheeseBread]), [cheeseBread, { ...bread, featuredPosition: 3 }], 'A operação pode colocar outro produto primeiro.');
assert.deepEqual(selectFeaturedProducts([{ ...bread, featuredPosition: null }]), [], 'Sem seleção manual a vitrine fica oculta.');
assert.equal(catalog[0], cheeseBread, 'A vitrine não deve reordenar o catálogo original.');
assert.deepEqual(selectFeaturedProducts([{ ...bread, active: false }, cheeseBread]), [cheeseBread]);
assert.deepEqual(selectFeaturedProducts([{ ...bread, priceCents: null }]), [], 'Preço ausente não deve virar produto grátis.');
assert.equal(featuredProductsMarkup([], {}), '', 'Não renderize vitrine vazia.');
const markup = featuredProductsMarkup([{ ...bread, name: '<Pão>', priceCents: 175 }], {
  headingId: 'teste-destaques', renderPhoto: () => '', renderControls: () => '',
});
assert.match(markup, /1,75/, 'O destaque deve usar o preço atual do catálogo.');
assert.match(markup, /&lt;Pão&gt;/);
assert.doesNotMatch(markup, /<Pão>/);
console.log('Destaques: seleção e ordem manuais, disponibilidade, preço atual e catálogo preservado OK.');
