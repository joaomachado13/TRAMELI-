import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { formatMoney, periodLabel } from './supplier-costs.js';

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 42;
const BOTTOM = 55;

export async function createSupplierPeriodPdf(report, kindLabel, { businessName = 'Pão Doce', regular, bold }) {
  if (!report.orderCount) throw new Error('Não há pedidos neste período.');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const strong = await pdf.embedFont(bold, { subset: true });
  const ink = rgb(43 / 255, 39 / 255, 36 / 255);
  const muted = rgb(98 / 255, 90 / 255, 85 / 255);
  const pale = rgb(244 / 255, 222 / 255, 213 / 255);
  const primary = rgb(122 / 255, 59 / 255, 40 / 255);
  const label = periodLabel(report.from, report.to);
  pdf.setTitle(`Repasse da padaria - ${kindLabel} - ${label}`);
  pdf.setAuthor(businessName);
  pdf.setSubject('Itens e custo total do período para a padaria');
  let page; let y;

  function newPage() {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
    page.drawText(businessName, { x: MARGIN, y, size: 10, font: strong, color: primary }); y -= 26;
    page.drawText(`Repasse da padaria - ${kindLabel}`, { x: MARGIN, y, size: 20, font: strong, color: ink }); y -= 20;
    page.drawText(`Período: ${label}   |   ${report.orderCount} pedidos`, { x: MARGIN, y, size: 10, font, color: muted }); y -= 28;
  }
  function section(title) {
    if (y - 60 < BOTTOM) newPage();
    page.drawRectangle({ x: MARGIN, y: y - 26, width: WIDTH - 2 * MARGIN, height: 26, color: pale });
    page.drawText(title, { x: MARGIN + 10, y: y - 18, size: 12, font: strong, color: ink });
    y -= 42;
  }
  function row(left, value, { bolder = false, note = '' } = {}) {
    if (y - 20 < BOTTOM) newPage();
    const selected = bolder ? strong : font;
    page.drawText(left, { x: MARGIN + 6, y, size: 10.5, font: selected, color: ink });
    const width = selected.widthOfTextAtSize(value, 10.5);
    page.drawText(value, { x: WIDTH - MARGIN - 6 - width, y, size: 10.5, font: selected, color: note ? primary : ink });
    y -= 17;
    if (note) { page.drawText(note, { x: MARGIN + 6, y: y + 2, size: 8, font, color: muted }); y -= 8; }
    page.drawLine({ start: { x: MARGIN, y: y + 9 }, end: { x: WIDTH - MARGIN, y: y + 9 }, thickness: 0.4, color: pale });
  }

  newPage();
  section('1. Itens e preço de custo');
  for (const product of report.products) {
    const value = product.missing ? 'custo não informado' : formatMoney(product.costCents);
    const note = product.unitCents != null ? `${formatMoney(product.unitCents)} por unidade` : '';
    row(product.label, value, { note: product.missing ? '' : note });
  }
  y -= 10;
  section('2. Custo por dia');
  for (const day of report.days) row(`${day.date.split('-').reverse().join('/')} - ${day.orders} pedidos`, formatMoney(day.costCents));
  y -= 14;
  if (y - 70 < BOTTOM) newPage();
  page.drawRectangle({ x: MARGIN, y: y - 34, width: WIDTH - 2 * MARGIN, height: 34, color: primary });
  const total = formatMoney(report.totalCents);
  page.drawText('TOTAL A PAGAR À PADARIA', { x: MARGIN + 12, y: y - 22, size: 12, font: strong, color: rgb(1, 1, 1) });
  page.drawText(total, { x: WIDTH - MARGIN - 12 - strong.widthOfTextAtSize(total, 14), y: y - 23, size: 14, font: strong, color: rgb(1, 1, 1) });
  y -= 52;
  const notes = [];
  if (report.missingLines) notes.push(`Atenção: ${report.missingLines} item(ns) sem custo cadastrado. O total está incompleto.`);
  if (report.estimatedLines) notes.push(`${report.estimatedLines} item(ns) com custo estimado, ainda não confirmado.`);
  for (const text of notes) { page.drawText(text, { x: MARGIN, y, size: 9, font, color: muted }); y -= 14; }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => sheet.drawText(`${index + 1} / ${pages.length}`, { x: WIDTH - MARGIN - 32, y: 31, size: 8, font, color: muted }));
  return pdf.save();
}

export async function downloadSupplierPeriodPdf(report, kindLabel, businessName) {
  const load = name => fetch(new URL(`../assets/${name}`, import.meta.url)).then(response => {
    if (!response.ok) throw new Error('Não foi possível carregar a fonte do PDF.');
    return response.arrayBuffer();
  });
  const [regular, bold] = await Promise.all([load('manrope-400.ttf'), load('manrope-600.ttf')]);
  const bytes = await createSupplierPeriodPdf(report, kindLabel, { businessName, regular, bold });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `repasse-padaria-${kindLabel.toLowerCase()}-${report.from}_a_${report.to}.pdf`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
