import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createReportPdf } from '../src/report-pdf.js';

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
console.log('Relatórios: PDF real, metadados e paginação OK.');