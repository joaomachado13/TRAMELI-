import assert from 'node:assert/strict';
import { itemLabel, labelsForPrint, summarizeDay, summarizeProducts, totalCents, weightPriceCents } from '../src/order-math.js';

const date = '2026-09-25';
const orders = Array.from({ length: 60 }, (_, index) => ({
  date,
  status: index < 5 ? 'cancelled' : index < 20 ? 'confirmed' : 'received',
  items: [{ name: 'Pão francês', quantity: 5, priceCents: 120 }, { name: 'Suco', quantity: 1, priceCents: 890 }],
  feeCents: 200,
}));
orders.push({ date: '2026-09-26', status: 'received', items: [{ name: 'Bolo', quantity: 1, priceCents: 900 }], feeCents: 200 });

const result = summarizeDay(orders, date);
assert.equal(result.count, 55);
assert.equal(result.pending, 40);
assert.equal(result.productsCents, 55 * 1490);
assert.equal(result.feesCents, 55 * 200);
assert.equal(result.totalCents, 55 * 1690);
assert.equal(totalCents({ items: [], subtotalCents: 1234, feeCents: 200, totalCents: 1434 }), 1434);
assert.deepEqual(summarizeProducts(orders, date), [
  { name: 'Pão francês', quantity: 275, grams: 0 },
  { name: 'Suco', quantity: 55, grams: 0 },
]);
assert.deepEqual(summarizeProducts([
  { date, status: 'received', items: [{ name: 'Pão de queijo', quantity: 2 }] },
  { date, status: 'confirmed', items: [{ name: 'pão de queijo', quantity: 3 }] },
  { date, status: 'cancelled', items: [{ name: 'Pão de queijo', quantity: 9 }] },
], date), [{ name: 'Pão de queijo', quantity: 5, grams: 0 }]);
assert.equal(weightPriceCents(6999, 50), 350);
assert.equal(weightPriceCents(6999, 150), 1050);
assert.equal(weightPriceCents(6999, 1000), 6999);
assert.equal(weightPriceCents(5999, 50), 300);
assert.equal(itemLabel({ name: 'Mussarela', quantity: 1, weightGrams: 150 }), '150 g de Mussarela');
assert.deepEqual(summarizeProducts([
  { date, status: 'received', items: [{ productId: 'm', name: 'Mussarela', quantity: 1, weightGrams: 150, priceCents: 1050 }] },
  { date, status: 'confirmed', items: [{ productId: 'm', name: 'Mussarela', quantity: 1, weightGrams: 350, priceCents: 2450 }] },
], date), [{ name: 'Mussarela', quantity: 2, grams: 500 }]);
assert.equal(labelsForPrint(orders.slice(0, 60)).length, 60);
const manyItems = { items: Array.from({ length: 7 }, (_, index) => ({ name: `Item ${index}` })) };
assert.deepEqual(labelsForPrint([manyItems]).map(label => [label.items.length, label.part, label.totalParts]),
  [[3, 1, 3], [3, 2, 3], [1, 3, 3]]);
console.log('Cálculos de 60 pedidos: OK');
