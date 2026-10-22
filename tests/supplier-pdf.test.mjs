import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { supplierGroups, supplierTotals, supplierText, itemCheckKey, filterSupplierGroups, compareSupplierGroups, bakeryLabelOrders, SANDRA_ITEMS } from '../src/supplier-checklist.js';
import { createSupplierPdf, createSeparationPdf } from '../src/supplier-pdf.js';

const date = '2026-10-07';
const first = { id: 'pedido-a', customerId: 'client-a', customer: 'Ana Gonçalves', address: 'Rua A, 101', date,
  notes: 'Separar a mussarela do pão. Não colocar açúcar.', status: 'received', feeCents: 200,
  phone: 'telefone privado', paymentMethod: 'cash',
  items: [{ name: 'Pão francês', quantity: 5, priceCents: 123456 }, { name: 'Mussarela', quantity: 1, weightGrams: 350, priceCents: 234567 }] };
const orders = [first, { ...first, id: 'pedido-b', address: 'Rua A, 101' }, { ...first, id: 'cancelado', status: 'cancelled' },
  { ...first, id: 'outro-dia', date: '2026-10-08' }, { ...first, id: 'homonimo', customerId: 'client-b', address: 'Rua B, 202' }];
const checks = new Set(first.items.map((_, index) => itemCheckKey(first, index)));
const groups = supplierGroups(orders, date, checks);
assert.equal(groups.length, 2);
assert.equal(groups[0].orders.length, 2);
const streetOrder = [
  { customer: 'Zuleica', address: 'Rua 2, casa 1' },
  { customer: 'Ana', address: 'Rua 2, casa 20' },
  { customer: 'Bruno', address: 'Rua 10, casa 3' },
].sort(compareSupplierGroups);
assert.deepEqual(streetOrder.map(group => group.customer), ['Zuleica', 'Ana', 'Bruno'],
  'A lista deve ordenar primeiro a rua e depois o número da casa.');
assert(groups[0].orders[0].checked);
assert(!groups[0].orders[1].checked);
assert(groups[0].orders[0].lines[1].label.includes('350 g'));
assert(groups[0].address.localeCompare(groups[1].address, 'pt-BR') < 0, 'Clientes devem ser ordenados pelo endereço/rua.');

const text = supplierText(groups, date);
const totals = supplierTotals(groups);
assert.deepEqual(totals.map(product => product.label), ['1050 g Mussarela', '15× Pão francês']);
assert(totals.every(product => !product.checked), 'Totais só ficam marcados quando todos os pedidos foram conferidos.');
assert(text.includes('LISTA CONSOLIDADA POR MATERIAL'));
assert(text.includes('1050 g Mussarela') && text.includes('15× Pão francês'));
assert(!text.includes('PEDIDOS POR CLIENTE'));
assert(!/123456|234567|telefone privado|R\$|cancelado|outro-dia/.test(JSON.stringify(groups) + text));
assert(!text.includes('Ana Gonçalves'), 'O texto de repasse não deve incluir nomes de clientes.');
const supplierFixture = [{ customer: 'Cliente', address: 'Rua A', orders: [{ id: 'supplier-test', lines: [
  { name: 'Broa', label: '1× Broa' }, { name: 'Pão francês', label: '2× Pão francês' },
  { name: 'Biscoito de nata', label: '3× Biscoito de nata' },
] }] }];
assert.deepEqual(filterSupplierGroups(supplierFixture, 'sandra').flatMap(g => g.orders.flatMap(o => o.lines.map(l => l.name))), ['Broa', 'Biscoito de nata']);
assert.deepEqual(filterSupplierGroups(supplierFixture, 'divano').flatMap(g => g.orders.flatMap(o => o.lines.map(l => l.name))), ['Pão francês']);
// The bakery paperwork is a projection; customer orders and financial repasses remain complete.
const mixedOrder = { ...first, id: 'mixed', items: [
  { name: 'Pão francês', quantity: 4, priceCents: 140 },
  ...SANDRA_ITEMS.map(name => ({ name, quantity: 2, priceCents: 400 })),
] };
const sandraOnly = { ...first, id: 'sandra-only', customerId: 'sandra-only-client', items: [{ name: 'BISCOITO DE NATA', quantity: 1, priceCents: 400 }] };
const paperworkOrders = [mixedOrder, sandraOnly];
const originalOrders = JSON.stringify(paperworkOrders);
const labelOrders = bakeryLabelOrders(paperworkOrders);
assert.equal(labelOrders.length, 1, 'Pedidos só da Sandra não devem gerar etiquetas vazias.');
assert.deepEqual(labelOrders[0].items.map(item => item.name), ['Pão francês']);
const fullGroups = supplierGroups(paperworkOrders, date);
const divanoGroups = filterSupplierGroups(fullGroups, 'divano');
assert.deepEqual(divanoGroups.flatMap(g => g.orders.flatMap(o => o.lines.map(l => l.name))), ['Pão francês']);
assert.equal(filterSupplierGroups(fullGroups, 'sandra').flatMap(g => g.orders.flatMap(o => o.lines)).length, SANDRA_ITEMS.length + 1, 'O repasse financeiro da Sandra deve continuar completo.');
assert.equal(JSON.stringify(paperworkOrders), originalOrders, 'Filtrar as impressões não pode modificar os pedidos originais.');
assert.equal(filterSupplierGroups(supplierGroups([sandraOnly], date), 'divano').length, 0);
const changed = { ...first, items: [{ ...first.items[0], quantity: 6 }, first.items[1]] };
assert(!supplierGroups([changed], date, checks)[0].orders[0].checked, 'Mudanças nos itens devem invalidar a conferência anterior.');
assert.equal(itemCheckKey(first, 0), itemCheckKey({ ...first, items: first.items.map(item => ({ ...item, priceCents: 999 })) }, 0));

const regular = await readFile(new URL('../assets/manrope-400.ttf', import.meta.url));
const bold = await readFile(new URL('../assets/manrope-600.ttf', import.meta.url));
const bytes = await createSupplierPdf(groups, date, { regular, bold, businessName: 'Pão Doce' });
const loaded = await PDFDocument.load(bytes);
assert.equal(loaded.getForm().getFields().length, 2, 'Repasse contém somente caixas para os materiais consolidados.');
assert(loaded.getPageCount() >= 1);
await assert.rejects(createSupplierPdf([], date, { regular, bold }), /Não há pedidos/);

const separationBytes = await createSeparationPdf(divanoGroups, date, { regular, bold, businessName: 'Pão Doce', supplierName: 'Padaria do Divano' });
const separationPdf = await PDFDocument.load(separationBytes);
assert(separationPdf.getPageCount() >= 1);
assert.equal(separationPdf.getForm().getFields().length, 0, 'Lista operacional não deve conter campos financeiros/interativos.');
await assert.rejects(createSeparationPdf([], date, { regular, bold }), /Não há pedidos/);

const longOrder = { ...first, id: 'pedido-longo', customer: 'Cliente com pedido longo para conferir a continuação',
  notes: 'Separar os pães. Observação extensa com instrução de montagem. '.repeat(20),
  items: Array.from({ length: 75 }, (_, index) => ({ name: `${index + 1} - Produto com nome extenso ${'X'.repeat(110)}`, quantity: index + 1, priceCents: 777777 })) };
const longBytes = await createSupplierPdf(supplierGroups([longOrder], date), date, { regular, bold });
const longPdf = await PDFDocument.load(longBytes);
assert(longPdf.getPageCount() > 1, 'Lista de materiais longa deve continuar em páginas seguintes.');
await mkdir(new URL('../tmp/pdfs/', import.meta.url), { recursive: true });
await writeFile(new URL('../tmp/pdfs/repasse-exemplo.pdf', import.meta.url), bytes);
await writeFile(new URL('../tmp/pdfs/separacao-exemplo.pdf', import.meta.url), separationBytes);
console.log('Repasse por material e PDF de separação independente validados estruturalmente.');
