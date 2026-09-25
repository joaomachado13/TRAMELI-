import assert from 'node:assert/strict';
import { summarizeFinancials } from '../src/finance-math.js';

const orders = [
  { id: 'a', status: 'received', feeCents: 200, items: [{ quantity: 2, priceCents: 140 }] },
  { id: 'b', status: 'confirmed', feeCents: 200, items: [{ quantity: 1, priceCents: 350, weightGrams: 50 }] },
  { id: 'c', status: 'cancelled', feeCents: 200, items: [{ quantity: 1, priceCents: 9999 }] },
];
const complete = summarizeFinancials(orders, [
  { order_id: 'a', supplier_total_cents: 200, missing_count: 0 },
  { order_id: 'b', supplier_total_cents: 250, missing_count: 0 },
]);
assert.deepEqual(complete, { customerCents: 630, deliveryCents: 400, supplierCents: 450,
  missingItems: 0, estimatedItems: 0, profitCents: 180 });
const incomplete = summarizeFinancials(orders, [{ order_id: 'a', supplier_total_cents: 200, missing_count: 1 }]);
assert.equal(incomplete.profitCents, null);
assert.equal(incomplete.missingItems, 2);
const provisional = summarizeFinancials(orders, [
  { order_id: 'a', supplier_total_cents: 200, missing_count: 0, estimated_count: 1 },
  { order_id: 'b', supplier_total_cents: 250, missing_count: 0, estimated_count: 0 },
]);
assert.equal(provisional.estimatedItems, 1);
assert.equal(provisional.profitCents, 180);
assert.equal(summarizeFinancials(orders, null).supplierCents, null);
console.log('Venda, custo e lucro bruto: OK');
