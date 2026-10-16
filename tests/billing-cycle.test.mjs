import assert from 'node:assert/strict';
import { billingDeadlineForDelivery, daysUntil, billingReminder, nextBillingDeadline, closingPeriod } from '../src/billing-cycle.js';

assert.equal(billingDeadlineForDelivery('2026-10-01'), '2026-10-15');
assert.equal(billingDeadlineForDelivery('2026-10-15'), '2026-10-15');
assert.equal(billingDeadlineForDelivery('2026-10-16'), '2026-10-31');
assert.equal(billingDeadlineForDelivery('2026-02-28'), '2026-02-28');
assert.equal(billingDeadlineForDelivery('2028-02-16'), '2028-02-29');
assert.equal(daysUntil('2026-10-15', '2026-10-07'), 8);
assert.equal(nextBillingDeadline('2026-10-07'), '2026-10-15');
assert.equal(nextBillingDeadline('2026-10-15'), '2026-10-31');
assert.equal(nextBillingDeadline('2026-10-20'), '2026-10-31');
assert.equal(nextBillingDeadline('2026-10-31'), '2026-11-15');
assert.equal(nextBillingDeadline('2026-02-28'), '2026-03-15');

const rows = [
  { delivery_date: '2026-10-03', due_cents: 1200 },
  { delivery_date: '2026-10-12', due_cents: 800 },
  { delivery_date: '2026-10-20', due_cents: 5000 },
];
assert.deepEqual(billingReminder(rows, '2026-10-07'), {
  state: 'upcoming', days: 8, deadline: '2026-10-15', dueCents: 2000,
  message: 'Faltam 8 dias para o seu pagamento.',
});
assert.equal(billingReminder(rows, '2026-10-15').state, 'today');
assert.equal(billingReminder(rows, '2026-10-16').state, 'overdue');
assert.equal(billingReminder([{ delivery_date: '2026-10-03', due_cents: 0 }], '2026-10-07').state, 'clear');

console.log('billing-cycle tests passed');

assert.deepEqual(closingPeriod('2026-10-07', 'quinzenal'), { kind: 'quinzenal', from: '2026-10-01', to: '2026-10-15' });
assert.deepEqual(closingPeriod('2026-10-16', 'quinzenal'), { kind: 'quinzenal', from: '2026-10-16', to: '2026-10-31' });
assert.deepEqual(closingPeriod('2028-02-20', 'quinzenal'), { kind: 'quinzenal', from: '2028-02-16', to: '2028-02-29' });
assert.deepEqual(closingPeriod('2026-11-10', 'mensal'), { kind: 'mensal', from: '2026-11-01', to: '2026-11-30' });
assert.deepEqual(closingPeriod('2026-10-16', 'diario'), { kind: 'diario', from: '2026-10-16', to: '2026-10-16' });
// O fim de cada quinzena coincide com o vencimento do fechamento.
assert.equal(closingPeriod('2026-10-09').to, billingDeadlineForDelivery('2026-10-09'));
assert.equal(closingPeriod('2026-10-27').to, billingDeadlineForDelivery('2026-10-27'));
