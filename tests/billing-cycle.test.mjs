import assert from 'node:assert/strict';
import { billingDeadlineForDelivery, daysUntil, billingReminder } from '../src/billing-cycle.js';

assert.equal(billingDeadlineForDelivery('2026-10-01'), '2026-10-15');
assert.equal(billingDeadlineForDelivery('2026-10-15'), '2026-10-15');
assert.equal(billingDeadlineForDelivery('2026-10-16'), '2026-10-31');
assert.equal(billingDeadlineForDelivery('2026-02-28'), '2026-02-28');
assert.equal(billingDeadlineForDelivery('2028-02-16'), '2028-02-29');
assert.equal(daysUntil('2026-10-15', '2026-10-07'), 8);

const rows = [
  { delivery_date: '2026-10-03', due_cents: 1200 },
  { delivery_date: '2026-10-12', due_cents: 800 },
  { delivery_date: '2026-10-20', due_cents: 5000 },
];
assert.deepEqual(billingReminder(rows, '2026-10-07'), {
  state: 'upcoming', days: 8, deadline: '2026-10-15', dueCents: 7000,
  message: 'Faltam 8 dias para o seu pagamento.',
});
assert.equal(billingReminder(rows, '2026-10-15').state, 'today');
assert.equal(billingReminder(rows, '2026-10-16').state, 'overdue');
assert.equal(billingReminder([{ delivery_date: '2026-10-03', due_cents: 0 }], '2026-10-07').state, 'clear');

console.log('billing-cycle tests passed');
