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
  function wrapLine(value, selectedFont, size, maxWidth) {
    const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return ['—'];
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (selectedFont.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        // Keep even unusually long product names inside the page width.
        let part = '';
        for (const character of word) {
          const next = part + character;
          if (selectedFont.widthOfTextAtSize(next, size) > maxWidth && part) {
            lines.push(part);
            part = character;
          } else part = next;
        }
        current = part;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function row(left, value, { bolder = false, note = '' } = {}) {
    const selected = bolder ? strong : font;
    const leftX = MARGIN + 6;
    const valueRight = WIDTH - MARGIN - 6;
    const valueSize = 10;
    const leftSize = 9.5;
    const leftWidth = 320;
    const valueWidth = selected.widthOfTextAtSize(String(value ?? ''), valueSize);
    const lines = wrapLine(left, selected, leftSize, leftWidth);
    const noteLines = note ? wrapLine(note, font, 8, WIDTH - 2 * MARGIN - 12) : [];
    // Calculate each baseline and divider from the last product line so the
    // divider can never cross the product or unit-cost text.
    const productLastLineOffset = (lines.length - 1) * 12;
    const noteStartOffset = productLastLineOffset + 13;
    const dividerOffset = noteLines.length
      ? noteStartOffset + (noteLines.length - 1) * 10 + 8
      : productLastLineOffset + 8;
    const nextRowOffset = dividerOffset + 14;
    if (y - nextRowOffset < BOTTOM) newPage();

    const productLastY = y - productLastLineOffset;
    const noteStartY = y - noteStartOffset;
    const dividerY = y - dividerOffset;
    const nextRowY = y - nextRowOffset;

    lines.forEach((line, index) => {
      page.drawText(line, { x: leftX, y: y - index * 12, size: leftSize, font: selected, color: ink });
    });
    const shownValue = String(value ?? '');
    const safeValue = shownValue;
    const safeValueSize = valueWidth > 150 ? 8.5 : valueSize;
    // Monetary values remain right-aligned and never collide with a long product name.
    page.drawText(safeValue, {
      x: valueRight - selected.widthOfTextAtSize(safeValue, safeValueSize),
      y,
      size: safeValueSize,
      font: selected,
      color: note ? primary : ink,
    });
    noteLines.forEach((line, index) => {
      page.drawText(line, { x: leftX, y: noteStartY - index * 10, size: 8, font, color: muted });
    });
    // Use a single divider position and a consistent 14 pt gap before the next row.
    page.drawLine({ start: { x: MARGIN, y: dividerY }, end: { x: WIDTH - MARGIN, y: dividerY }, thickness: 0.4, color: pale });
    y = nextRowY;
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
