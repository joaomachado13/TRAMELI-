import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { formatMoney, periodLabel } from './supplier-costs.js';

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 34;
const BOTTOM = 48;

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
  const rule = rgb(224 / 255, 216 / 255, 209 / 255);
  const label = periodLabel(report.from, report.to);
  pdf.setTitle('Repasse da padaria - ' + kindLabel + ' - ' + label);
  pdf.setAuthor(businessName);
  pdf.setSubject('Itens e custo total do período para a padaria');
  let page;
  let y;

  function newPage() {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
    page.drawText(businessName, { x: MARGIN, y, size: 10, font: strong, color: primary });
    y -= 23;
    page.drawText('Repasse da padaria - ' + kindLabel, { x: MARGIN, y, size: 20, font: strong, color: ink });
    y -= 19;
    page.drawText('Período: ' + label + '   |   ' + report.orderCount + ' ' + (report.orderCount === 1 ? 'pedido' : 'pedidos'),
      { x: MARGIN, y, size: 10, font, color: muted });
    y -= 24;
  }

  function section(title) {
    if (y - 42 < BOTTOM) newPage();
    page.drawRectangle({ x: MARGIN, y: y - 24, width: WIDTH - 2 * MARGIN, height: 24, color: pale });
    page.drawText(title, { x: MARGIN + 10, y: y - 16, size: 11.5, font: strong, color: ink });
    y -= 35;
  }

  function wrapLine(value, selectedFont, size, maxWidth) {
    const words = String(value == null ? '' : value).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return ['—'];
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (selectedFont.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        let part = '';
        for (const character of word) {
          const next = part + character;
          if (selectedFont.widthOfTextAtSize(next, size) > maxWidth && part) {
            lines.push(part);
            part = character;
          } else {
            part = next;
          }
        }
        current = part;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function drawRight(value, baseline, size, selectedFont = font, color = ink) {
    const text = String(value == null ? '' : value);
    page.drawText(text, {
      x: WIDTH - MARGIN - 6 - selectedFont.widthOfTextAtSize(text, size),
      y: baseline, size, font: selectedFont, color,
    });
  }

  function row(left, value, options = {}) {
    const selected = options.bolder ? strong : font;
    const leftX = MARGIN + 6;
    const leftSize = options.leftSize || 9.5;
    const valueSize = options.valueSize || 10;
    const leftWidth = WIDTH - 2 * MARGIN - 150;
    const lines = wrapLine(left, selected, leftSize, leftWidth);
    const rowHeight = Math.max(lines.length * 10, 11) + 3;
    if (y - (rowHeight + 11) < BOTTOM) newPage();

    lines.forEach((line, index) => {
      page.drawText(line, { x: leftX, y: y - index * 10, size: leftSize, font: selected, color: ink });
    });
    drawRight(value, y, valueSize, selected, options.valueColor || ink);
    y -= Math.max(lines.length * 10, 11) + 3;
    page.drawLine({ start: { x: MARGIN, y: y + 3 }, end: { x: WIDTH - MARGIN, y: y + 3 }, thickness: 0.4, color: pale });
    y -= 3;
  }

  function displayProductName(value) {
    const lower = String(value || '').trim().toLocaleLowerCase('pt-BR');
    if (!lower) return 'Produto';
    const capitalized = lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    return capitalized.replace(/\bpratis\b/gi, 'Pratis');
  }

  function productRow(product) {
    const name = displayProductName(product.name);
    const quantity = product.weighted ? String(product.grams) + ' g' : String(product.quantity) + '×';
    const title = quantity + ' ' + name;
    const value = product.missing
      ? 'custo não informado'
      : formatMoney(product.costCents) + (product.estimatedCount > 0 ? '*' : '');
    const note = product.unitCents == null
      ? (product.missing ? 'Preço de custo não informado' : 'Preço de referência não informado')
      : formatMoney(product.unitCents) + (product.weighted ? ' por kg' : ' por unidade');
    const leftX = MARGIN + 6;
    const leftWidth = WIDTH - 2 * MARGIN - 155;
    const titleLines = wrapLine(title, font, 9, leftWidth);
    const noteLines = wrapLine(note, font, 8, WIDTH - 2 * MARGIN - 12);
    const titleHeight = Math.max(titleLines.length * 12, 13);
    const rowHeight = titleHeight + noteLines.length * 9 + 3;

    // Reserve space for the complete item before drawing anything, so its two-line block
    // (including a wrapped product name) can never be split across pages.
    if (y - (rowHeight + 11) < BOTTOM) newPage();

    titleLines.forEach((line, index) => {
      page.drawText(line, { x: leftX, y: y - index * 11, size: 9, font, color: ink });
    });
    drawRight(value, y, 10, font, product.estimatedCount > 0 ? primary : ink);

    let noteY = y - titleHeight + 1;
    for (const line of noteLines) {
      page.drawText(line, { x: leftX, y: noteY, size: 7.8, font, color: muted });
      noteY -= 9;
    }
    y = y - rowHeight - 1;
    page.drawLine({ start: { x: MARGIN, y: y + 3 }, end: { x: WIDTH - MARGIN, y: y + 3 }, thickness: 0.4, color: pale });
    y -= 4;
  }

  newPage();
  section('1. Itens e preço de custo');
  const products = [...report.products].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  for (const product of products) productRow(product);

  y -= 4;

  const notes = [];
  if (report.missingLines) notes.push('Atenção: ' + report.missingLines + ' item(ns) sem custo cadastrado. O total está incompleto.');
  if (report.estimatedLines === 1) notes.push('* Custo estimado, ainda não confirmado (1 item).');
  else if (report.estimatedLines > 1) notes.push('* Custos estimados, ainda não confirmados (' + report.estimatedLines + ' itens).');

  const noteLines = notes.flatMap(note => wrapLine(note, font, 8.8, WIDTH - 2 * MARGIN));
  const dayBlockHeight = 35 + report.days.length * 17 + 8 + 46 + noteLines.length * 11 + 8;
  // Mantém a seção diária, o total e as observações juntos; nunca cria página só para o total.
  if (y - dayBlockHeight < BOTTOM) newPage();
  section('2. Custo por dia');
  for (const day of report.days) {
    const date = day.date.split('-').reverse().join('/');
    row(date + ' · ' + day.orders + ' ' + (day.orders === 1 ? 'pedido' : 'pedidos'), formatMoney(day.costCents), { leftSize: 9, valueSize: 9.5 });
  }

  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 1, color: primary });
  y -= 13;
  page.drawText('TOTAL A PAGAR À PADARIA', { x: MARGIN + 6, y, size: 12.5, font: strong, color: ink });
  drawRight(formatMoney(report.totalCents), y, 13.5, strong, ink);
  y -= 13;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.6, color: rule });
  y -= 12;

  for (const line of noteLines) {
    page.drawText(line, { x: MARGIN + 2, y, size: 8.8, font, color: muted });
    y -= 11;
  }

  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    const footer = (index + 1) + ' / ' + pages.length;
    sheet.drawText(footer, {
      x: (WIDTH - font.widthOfTextAtSize(footer, 8)) / 2,
      y: 31, size: 8, font, color: muted,
    });
  });
  return pdf.save();
}

export async function downloadSupplierPeriodPdf(report, kindLabel, businessName) {
  const [{ default: regularFontUrl }, { default: boldFontUrl }] = await Promise.all([
    import('../assets/manrope-400.ttf?url'),
    import('../assets/manrope-600.ttf?url'),
  ]);
  const load = url => fetch(url).then(response => {
    if (!response.ok) throw new Error('Não foi possível carregar a fonte do PDF.');
    return response.arrayBuffer();
  });
  const [regular, bold] = await Promise.all([load(regularFontUrl), load(boldFontUrl)]);
  const bytes = await createSupplierPeriodPdf(report, kindLabel, { businessName, regular, bold });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'repasse-padaria-' + kindLabel.toLowerCase() + '-' + report.from + '_a_' + report.to + '.pdf';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
