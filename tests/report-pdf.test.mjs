import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createReportPdf, createBillingReportPdf } from '../src/report-pdf.js';

const regular = await readFile(new URL('../assets/manrope-400.ttf', import.meta.url));
const bold = await readFile(new URL('../assets/manrope-600.ttf', import.meta.url));
const text = [
  'TRAMELI · RELATÓRIO',
  'Resumo financeiro',
  '08/10/2026 — 15/10/2026',
  '',
  'Pedidos 4',
  'Valor total R$ 128,50',
  'Cliente Ana Ferreira',
  'Pedido #abc12345',
  'Pago R$ 50,00',
  'Em aberto R$ 78,50',
].join('\n');
const bytes = await createReportPdf({
  title: 'Resumo financeiro',
  period: '08/10/2026 — 15/10/2026',
  text,
  businessName: 'Trameli',
  regular,
  bold,
});
assert(bytes.byteLength > 1000);
const pdf = await PDFDocument.load(bytes);
assert(pdf.getPageCount() >= 1);
assert.equal(pdf.getTitle(), 'Trameli - Resumo financeiro');

const longBytes = await createReportPdf({
  title: 'Pedidos',
  period: 'Outubro de 2026',
  text: Array.from({ length: 350 }, (_, index) => `Pedido ${index + 1} · Cliente de teste · R$ 12,00`).join('\n'),
  businessName: 'Trameli',
  regular,
  bold,
});
const longPdf = await PDFDocument.load(longBytes);
assert(longPdf.getPageCount() > 1);
const billingBytes = await createBillingReportPdf({
  title: 'Cobrança detalhada',
  period: '01/10/2026 — 13/10/2026 · Cliente de teste',
  customers: [{
    name: 'Cliente de teste', totalCents: 250000, paidCents: 125000, dueCents: 125000,
    orders: Array.from({ length: 24 }, (_, index) => ({
      date: '2026-10-13', code: `TR-131026-${String(index + 1).padStart(3, '0')}`, dueDate: '2026-10-15',
      status: index % 2 ? 'Pago' : 'Em aberto', totalCents: 10000, paidCents: 5000, dueCents: 5000,
      items: Array.from({ length: 8 }, (_, item) => ({ label: `Produto ${item + 1} de um pedido grande`, amountCents: 1250 })),
    })),
  }],
  businessName: 'Trameli', regular, bold,
});
const billingPdf = await PDFDocument.load(billingBytes);
assert(billingPdf.getPageCount() > 1, 'Cobrança detalhada deve paginar sem cortar pedidos longos.');
assert.equal(billingPdf.getTitle(), 'Trameli - Cobrança detalhada');

console.log('Relatórios: PDF real, metadados e paginação OK.');