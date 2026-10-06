import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import { supplierGroups, supplierTotals, supplierText, itemCheckKey } from '../src/supplier-checklist.js';
import { createSupplierPdf } from '../src/supplier-pdf.js';

const date = '2026-10-07';
const first = { id: 'pedido-a', customerId: 'client-a', customer: 'Ana Gonçalves', address: 'Bloco A, apartamento 101', date,
  notes: 'Separar a mussarela do pão. Não colocar açúcar.', status: 'received', feeCents: 200,
  phone: 'telefone privado', paymentMethod: 'cash',
  items: [{ name: 'Pão francês', quantity: 5, priceCents: 123456 }, { name: 'Mussarela', quantity: 1, weightGrams: 350, priceCents: 234567 }] };
const orders = [first, { ...first, id: 'pedido-b' }, { ...first, id: 'cancelado', status: 'cancelled' },
  { ...first, id: 'outro-dia', date: '2026-10-08' }, { ...first, id: 'homonimo', customerId: 'client-b', address: 'Bloco B' }];
const checks = new Set(first.items.map((_, index) => itemCheckKey(first, index)));
const groups = supplierGroups(orders, date, checks);
assert.equal(groups.length, 2);
assert.equal(groups[0].orders.length, 2);
assert(groups[0].orders[0].checked);
assert(!groups[0].orders[1].checked);
assert(groups[0].orders[0].lines[1].label.includes('350 g'));
const text = supplierText(groups, date);
const totals = supplierTotals(groups);
assert.deepEqual(totals.map(product => product.label), ['1050 g Mussarela', '15× Pão francês']);
assert(totals.every(product => !product.checked), 'Totais só ficam marcados quando todos os pedidos foram conferidos.');
assert(text.indexOf('1. LISTA COMPLETA DE ITENS') < text.indexOf('2. PEDIDOS POR CLIENTE'));
assert(text.includes('1050 g Mussarela') && text.includes('15× Pão francês'));
assert(!/123456|234567|telefone privado|R\$|cancelado|outro-dia/.test(JSON.stringify(groups) + text));
assert(text.includes('[x] 5× Pão francês'));
const changed = { ...first, items: [{ ...first.items[0], quantity: 6 }, first.items[1]] };
assert(!supplierGroups([changed], date, checks)[0].orders[0].checked, 'Mudanças nos itens devem invalidar a conferência anterior.');
assert.equal(itemCheckKey(first, 0), itemCheckKey({ ...first, items: first.items.map(item => ({ ...item, priceCents: 999 })) }, 0));

const regular = await readFile(new URL('../assets/manrope-400.ttf', import.meta.url));
const bold = await readFile(new URL('../assets/manrope-600.ttf', import.meta.url));
const bytes = await createSupplierPdf(groups, date, { regular, bold, businessName: 'Trameli' });
const loaded = await PDFDocument.load(bytes);
const fields = loaded.getForm().getFields();
assert.equal(fields.length, 11, 'Cada produto consolidado, pedido e linha deve ter uma caixa interativa.');
assert.equal(fields.filter(field => field.isChecked()).length, 3);
for (const field of fields) {
  assert(field.acroField.dict.has(PDFName.of('V')), 'Cada campo deve registrar explicitamente seu valor marcado ou desmarcado.');
  for (const widget of field.acroField.getWidgets()) {
    assert(widget.dict.has(PDFName.of('AP')), 'Widget precisa de aparência renderizável.');
    assert(widget.dict.has(PDFName.of('Parent')), 'Widget precisa apontar para o campo canônico.');
    assert.equal(widget.dict.get(PDFName.of('AS')).toString(), field.acroField.getValue().toString());
  }
}
await assert.rejects(createSupplierPdf([], date, { regular, bold }), /Não há pedidos/);

const longOrder = { ...first, id: 'pedido-longo', customer: 'Cliente com pedido longo para conferir a continuação',
  notes: 'Separar os pães.\n' + 'Observação extensa com instrução de montagem. '.repeat(20),
  items: Array.from({ length: 75 }, (_, index) => ({ name: `${index + 1} - Produto com nome extenso ${'X'.repeat(110)}`, quantity: index + 1, priceCents: 777777 })) };
const many = Array.from({ length: 60 }, (_, index) => ({ ...first, id: `pedido-${index}`, customerId: `cliente-${index}`, customer: `Cliente ${String(index + 1).padStart(2, '0')}` }));
const longBytes = await createSupplierPdf(supplierGroups([longOrder, ...many], date), date, { regular, bold });
const longPdf = await PDFDocument.load(longBytes);
assert(longPdf.getPageCount() > 10);
assert.equal(longPdf.getForm().getFields().length, 76 + 60 * 3 + 77);
assert.equal(new Set(longPdf.getForm().getFields().map(field => field.getName())).size, 333);
await mkdir(new URL('../tmp/pdfs/', import.meta.url), { recursive: true });
await writeFile(new URL('../tmp/pdfs/repasse-exemplo.pdf', import.meta.url), bytes);
await writeFile(new URL('../tmp/pdfs/repasse-longo.pdf', import.meta.url), longBytes);
console.log('Repasse: clientes, pesos, ausência de preços, caixas interativas e paginação extensa OK.');
