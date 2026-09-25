import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { products } = JSON.parse(await readFile(new URL('../data/client-products.json', import.meta.url), 'utf8'));
assert.equal(products.length, 81);
assert.equal(products.filter(product => product.active).length, 79);
assert.equal(new Set(products.map(product => product.sourceRow)).size, products.length);
assert.equal(new Set(products.map(product => product.id)).size, products.length);
assert(products.every(product => Number.isInteger(product.priceCents) && product.priceCents >= 0));
assert(products.every(product => !('costCents' in product) && !product.image));
assert(!products.some(product => product.name.toLocaleLowerCase('pt-BR') === 'taxa de entrega'));
const activeNames = products.filter(product => product.active).map(product => product.name.toLocaleLowerCase('pt-BR'));
assert.equal(new Set(activeNames).size, activeNames.length);
for (const row of [42, 67]) {
  assert.equal(products.find(product => product.sourceRow === row)?.active, false);
}
for (const [row, price] of [[20, 6999], [21, 4000], [22, 4000], [48, 5999]]) {
  const product = products.find(item => item.sourceRow === row);
  assert.equal(product.priceCents, price);
  assert.equal(product.unit, 'kg');
  assert.equal(product.active, true);
}
for (const [row, price] of [[34, 1949], [36, 1700], [38, 1700], [43, 1200], [74, 70]]) {
  assert.equal(products.find(item => item.sourceRow === row)?.priceCents, price);
}
assert.equal(products.find(item => item.sourceRow === 22)?.name, 'Mortadela defumada');
assert.equal(products.find(item => item.sourceRow === 74)?.name, 'Mini pão francês');
assert.equal(products.find(product => product.name === 'Pão de queijo')?.priceCents, 130);
console.log('Catálogo atualizado: OK');
