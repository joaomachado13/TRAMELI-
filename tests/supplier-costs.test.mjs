import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { supplierGroups, supplierTotals, supplierText } from '../src/supplier-checklist.js';
import { costMapFromRows, supplierPeriodReport, supplierPeriodText } from '../src/supplier-costs.js';
import { createSupplierPdf } from '../src/supplier-pdf.js';
import { createSupplierPeriodPdf } from '../src/supplier-period-pdf.js';
import { closingPeriod } from '../src/billing-cycle.js';

const mk = (id, date, items, extra = {}) => ({ id, customerId: 'c1', customer: 'Ana', address: 'Rua 1, casa 2', date, status: 'received', feeCents: 200, items, ...extra });
const orders = [
  mk('o1', '2026-10-15', [{ name: 'Pão francês', quantity: 10, priceCents: 140 }, { name: 'Mussarela', quantity: 1, weightGrams: 300, priceCents: 2100 }]),
  mk('o2', '2026-10-15', [{ name: 'Pão francês', quantity: 5, priceCents: 140 }]),
  mk('o3', '2026-10-16', [{ name: 'Pão francês', quantity: 4, priceCents: 140 }]),
  mk('o4', '2026-10-14', [{ name: 'Bolo', quantity: 1, priceCents: 1500 }]),
  mk('canc', '2026-10-15', [{ name: 'Pão francês', quantity: 99, priceCents: 140 }], { status: 'cancelled' }),
];
const costMap = costMapFromRows([
  { order_id: 'o1', line_index: 1, quantity: 10, unit_cost_cents: 90, total_cost_cents: 900, estimated: false },
  { order_id: 'o1', line_index: 2, quantity: 1, unit_cost_cents: 1260, total_cost_cents: 1260, estimated: true },
  { order_id: 'o2', line_index: 1, quantity: 5, unit_cost_cents: 90, total_cost_cents: 450, estimated: false },
  { order_id: 'o3', line_index: 1, quantity: 4, unit_cost_cents: 90, total_cost_cents: 360, estimated: false },
  { order_id: 'o4', line_index: 1, quantity: 1, unit_cost_cents: null, total_cost_cents: null, estimated: false },
]);

// Diário: custo por linha, por pedido e total.
const groups = supplierGroups(orders, '2026-10-15', new Set(), costMap);
const totals = supplierTotals(groups);
assert.equal(totals.find(item => item.name === 'Pão francês').costCents, 1350);
assert.equal(totals.find(item => item.name === 'Mussarela').costCents, 1260);
const text = supplierText(groups, '2026-10-15');
assert(text.includes('TOTAL (preço de custo): R$ 26,10'.replace(/ /g, ' ')) || /TOTAL \(preço de custo\): R\$\s26,10/.test(text));
assert(!/140|2100/.test(text.replace(/\d{4}-\d{2}-\d{2}/, '')), 'Preço de venda nunca entra no repasse.');

// Período quinzenal alinhado ao fechamento (1–15 e 16–31).
const first = closingPeriod('2026-10-15', 'quinzenal');
const report = supplierPeriodReport(orders, costMap, first.from, first.to);
assert.equal(report.orderCount, 3);
assert.equal(report.totalCents, 900 + 1260 + 450);
assert.equal(report.missingLines, 1, 'Custo ausente nunca vira zero.');
assert.equal(report.estimatedLines, 1);
assert.deepEqual(report.days.map(day => day.date), ['2026-10-14', '2026-10-15']);
const second = supplierPeriodReport(orders, costMap, ...Object.values(closingPeriod('2026-10-20', 'quinzenal')).slice(1));
assert.equal(second.totalCents, 360);
const month = supplierPeriodReport(orders, costMap, ...Object.values(closingPeriod('2026-10-20', 'mensal')).slice(1));
assert.equal(month.totalCents, 900 + 1260 + 450 + 360);
assert(supplierPeriodText(report, 'Quinzenal').includes('sem custo'));

const regular = await readFile(new URL('../assets/manrope-400.ttf', import.meta.url));
const bold = await readFile(new URL('../assets/manrope-600.ttf', import.meta.url));
const daily = await PDFDocument.load(await createSupplierPdf(groups, '2026-10-15', { regular, bold }));
assert(daily.getPageCount() >= 2);
const periodPdf = await PDFDocument.load(await createSupplierPeriodPdf(month, 'Mensal', { regular, bold }));
assert(periodPdf.getPageCount() >= 1);
await assert.rejects(createSupplierPeriodPdf(supplierPeriodReport(orders, costMap, '2027-01-01', '2027-01-31'), 'Mensal', { regular, bold }), /Não há pedidos/);
console.log('Repasse com preço de custo (diário, quinzenal, mensal): OK.');
