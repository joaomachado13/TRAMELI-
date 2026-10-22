import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { supplierGroups, supplierTotals, supplierText, supplierCustomerText } from '../src/supplier-checklist.js';
import { costMapFromRows, supplierPeriodReport, supplierPeriodText, supplierPeriodCustomerText } from '../src/supplier-costs.js';
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
const customerText = supplierCustomerText(groups, '2026-10-15', 'Pão Doce');
assert(customerText.includes('ITENS POR CLIENTE (preço de custo)'));
assert(customerText.includes('Ana'));
assert(customerText.includes('Pão francês') && customerText.includes('Mussarela'));
assert(/TOTAL A PAGAR À PADARIA: R\$\s*26,10/.test(customerText));
assert(!/123456|234567/.test(customerText), 'A cópia por cliente usa custo, nunca preço de venda.');


// Same product with/without its ID must consolidate; preserve all historical costs.
const splitOrders = [
  mk('id-order', '2026-10-20', [{ productId: 'bread', name: 'Pão francês', quantity: 124, priceCents: 140 }]),
  mk('legacy-order', '2026-10-20', [{ name: 'Pão francês', quantity: 117, priceCents: 140 }]),
];
const splitCosts = costMapFromRows([
  { order_id: 'id-order', line_index: 1, quantity: 124, unit_cost_cents: 90, total_cost_cents: 11160 },
  { order_id: 'legacy-order', line_index: 1, quantity: 117, unit_cost_cents: 90, total_cost_cents: 10530 },
]);
const combined = supplierTotals(supplierGroups(splitOrders, '2026-10-20', new Set(), splitCosts));
assert.equal(combined.length, 1);
assert.equal(combined[0].quantity, 241);
assert.equal(combined[0].costCents, 21690);
for (const [from, to] of [['2026-10-20','2026-10-20'],['2026-10-16','2026-10-31'],['2026-10-01','2026-10-31']]) {
  const consolidated = supplierPeriodReport(splitOrders, splitCosts, from, to);
  assert.equal(consolidated.products.length, 1);
  assert.equal(consolidated.products[0].quantity, 241);
  assert.equal(consolidated.totalCents, 21690);
  assert.equal(consolidated.orderCount, 2, 'Consolidar materiais não elimina pedidos.');
}
const distinct = [
  mk('a','2026-10-20',[{productId:'a',name:'Cookies',quantity:2,priceCents:200}]),
  mk('b','2026-10-20',[{productId:'b',name:'Cookies',quantity:3,priceCents:200}]),
];
assert.equal(supplierPeriodReport(distinct,new Map(),'2026-10-20','2026-10-20').products.length,2,'IDs diferentes não podem ser fundidos só pelo nome.');
const weighted = [
  mk('w1','2026-10-20',[{productId:'cheese',name:'Mussarela',quantity:1,weightGrams:200,priceCents:1400}]),
  mk('w2','2026-10-20',[{name:' Mussarela ',quantity:1,weightGrams:300,priceCents:2100}]),
];
const weightTotals=supplierTotals(supplierGroups(weighted,'2026-10-20'));
assert.equal(weightTotals.length,1);assert.equal(weightTotals[0].grams,500);
const unitAndWeight=[...weighted,mk('unit','2026-10-20',[{name:'Mussarela',quantity:1,priceCents:100}])];
assert.equal(supplierTotals(supplierGroups(unitAndWeight,'2026-10-20')).length,2,'Peso e unidades continuam separados.');

// Período quinzenal alinhado ao fechamento (1–15 e 16–31).
const first = closingPeriod('2026-10-15', 'quinzenal');
const report = supplierPeriodReport(orders, costMap, first.from, first.to);
assert.equal(report.orderCount, 3);
assert.equal(report.totalCents, 900 + 1260 + 450);
assert.equal(report.missingLines, 1, 'Custo ausente nunca vira zero.');
assert.equal(report.estimatedLines, 1);
assert.equal(report.customerOrders.length, 3, 'O período deve preservar os pedidos para detalhamento por cliente.');
assert(report.customerOrders.every(order => order.lines.length >= 1));
assert.deepEqual(report.days.map(day => day.date), ['2026-10-14', '2026-10-15']);
const second = supplierPeriodReport(orders, costMap, ...Object.values(closingPeriod('2026-10-20', 'quinzenal')).slice(1));
assert.equal(second.totalCents, 360);
const month = supplierPeriodReport(orders, costMap, ...Object.values(closingPeriod('2026-10-20', 'mensal')).slice(1));
assert.equal(month.totalCents, 900 + 1260 + 450 + 360);
assert(supplierPeriodText(report, 'Quinzenal').includes('sem custo'));
const periodCustomerText = supplierPeriodCustomerText(report, 'Quinzenal');
assert(periodCustomerText.includes('ITENS POR CLIENTE (preço de custo)'));
assert(periodCustomerText.includes('Ana') && periodCustomerText.includes('15/10/2026 · 10× Pão francês'));
assert(periodCustomerText.includes('TOTAL A PAGAR À PADARIA'));


const regular = await readFile(new URL('../assets/manrope-400.ttf', import.meta.url));
const bold = await readFile(new URL('../assets/manrope-600.ttf', import.meta.url));
const daily = await PDFDocument.load(await createSupplierPdf(groups, '2026-10-15', { regular, bold }));
assert(daily.getPageCount() >= 1, 'O consolidado diário deve caber em uma página quando houver poucos materiais.');
const periodPdf = await PDFDocument.load(await createSupplierPeriodPdf(month, 'Mensal', { regular, bold }));
assert(periodPdf.getPageCount() >= 1);
await assert.rejects(createSupplierPeriodPdf(supplierPeriodReport(orders, costMap, '2027-01-01', '2027-01-31'), 'Mensal', { regular, bold }), /Não há pedidos/);
console.log('Repasse com preço de custo (diário, quinzenal, mensal): OK.');
