import assert from 'node:assert/strict';
import { normalizeCatalogSearch, productMatchesCatalogSearch } from '../src/catalog-search.js';

const pao = { name: 'Pão francês', category: 'Pães', unit: 'unidade' };
assert.equal(normalizeCatalogSearch('Pão francês'), 'pao frances');
assert(productMatchesCatalogSearch(pao, 'pao frances'));
assert(productMatchesCatalogSearch(pao, 'PAO FRANCES'));
assert(productMatchesCatalogSearch(pao, 'frances pao'));
assert(productMatchesCatalogSearch(pao, 'pao fran'));
assert(productMatchesCatalogSearch(pao, 'francês'));
assert(!productMatchesCatalogSearch(pao, 'mussarela'));

const broa = { name: 'Broa Doce', category: 'Broas', unit: 'unidade' };
assert(productMatchesCatalogSearch(broa, 'broa doce'));
assert(productMatchesCatalogSearch(broa, 'doce broa'));

console.log('Busca tolerante do catálogo: OK');
