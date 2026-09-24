import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { products } = JSON.parse(await readFile(new URL('../data/client-products.json', import.meta.url), 'utf8'));
assert.equal(products.length, 81);
assert.equal(products.filter(product => product.active).length, 72);
assert.equal(new Set(products.map(product => product.sourceRow)).size, products.length);
assert.equal(new Set(products.map(product => product.id)).size, products.length);
assert(products.every(product => Number.isInteger(product.priceCents) && product.priceCents >= 0));
assert(products.every(product => !('costCents' in product) && !product.image));
assert(!products.some(product => product.name.toLocaleLowerCase('pt-BR') === 'taxa de entrega'));
const activeNames = products.filter(product => product.active).map(product => product.name.toLocaleLowerCase('pt-BR'));
assert.equal(new Set(activeNames).size, activeNames.length);
for (const row of [20, 21, 22, 36, 42, 43, 48, 67, 74]) {
  assert.equal(products.find(product => product.sourceRow === row)?.active, false);
}
assert.equal(products.find(product => product.name === 'Pão de queijo')?.priceCents, 130);
console.log('Catálogo da planilha: OK');
