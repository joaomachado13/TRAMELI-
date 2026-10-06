import { PDFDocument, PDFName, PDFHexString, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { supplierTotals } from './supplier-checklist.js';

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 42;
const BOTTOM = 55;

export async function createSupplierPdf(groups, date, { businessName = 'Trameli', regular, bold }) {
  if (!groups.length) throw new Error('Não há pedidos para exportar nesta data.');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const strong = await pdf.embedFont(bold, { subset: true });
  const form = pdf.getForm();
  const ink = rgb(43 / 255, 39 / 255, 36 / 255);
  const muted = rgb(98 / 255, 90 / 255, 85 / 255);
  const pale = rgb(244 / 255, 222 / 255, 213 / 255);
  const primary = rgb(158 / 255, 67 / 255, 44 / 255);
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR');
  pdf.setTitle(`Repasse da padaria - ${dateLabel}`);
  pdf.setAuthor(businessName);
  pdf.setSubject('Lista completa de itens e pedidos por cliente, sem valores, com caixas de conferência');
  let page;
  let y;
  let fieldIndex = 0;

  function wrap(value, size = 10, width = WIDTH - 2 * MARGIN, selectedFont = font) {
    const result = [];
    for (const paragraph of String(value || '').split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (selectedFont.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
        if (line) result.push(line);
        line = '';
        for (const character of word) {
          if (line && selectedFont.widthOfTextAtSize(line + character, size) > width) {
            result.push(line); line = '';
          }
          line += character;
        }
      }
      result.push(line);
    }
    return result;
  }

  function newPage() {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
    for (const line of wrap(businessName, 10, WIDTH - 2 * MARGIN, strong)) {
      page.drawText(line, { x: MARGIN, y, size: 10, font: strong, color: primary }); y -= 14;
    }
    page.drawText('Repasse da padaria', { x: MARGIN, y: y - 10, size: 21, font: strong, color: ink });
    y -= 34;
    page.drawText(`Entrega: ${dateLabel}   |   ${groups.length} clientes`, { x: MARGIN, y, size: 10, font, color: muted });
    y -= 20;
    page.drawText('Marque os itens separados e o pedido completo. Sem valores.', { x: MARGIN, y, size: 9, font, color: muted });
    y -= 25;
  }

  function clientHeader(group, continued = false) {
    const names = wrap(`${group.customer}${continued ? ' (continuação)' : ''}`, 13, WIDTH - 2 * MARGIN - 20, strong);
    const addresses = wrap(group.address, 9, WIDTH - 2 * MARGIN - 20);
    const height = names.length * 17 + addresses.length * 13 + 22;
    if (y - height - 58 < BOTTOM) newPage();
    page.drawRectangle({ x: MARGIN, y: y - height, width: WIDTH - 2 * MARGIN, height, color: pale });
    y -= 19;
    for (const line of names) {
      page.drawText(line, { x: MARGIN + 10, y, size: 13, font: strong, color: ink }); y -= 17;
    }
    for (const line of addresses) {
      page.drawText(line, { x: MARGIN + 10, y, size: 9, font, color: muted }); y -= 13;
    }
    y -= 16;
  }

  function checkbox(checked, x, baseline, title) {
    const field = form.createCheckBox(`conferencia_${fieldIndex++}`);
    field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(title));
    field.addToPage(page, { x, y: baseline - 2, width: 12, height: 12,
      borderWidth: 0.8, borderColor: muted, backgroundColor: rgb(1, 1, 1), textColor: ink });
    if (checked) field.check(); else field.uncheck();
  }

  function orderHeader(order, continued = false) {
    if (!continued) checkbox(order.checked, MARGIN + 4, y, `Pedido ${order.id.slice(0, 8)} completo`);
    page.drawText(`Pedido #${order.id.slice(0, 8)}${continued ? ' - continuação' : ' - pedido completo'}`,
      { x: MARGIN + 26, y, size: 10, font: strong, color: ink });
    y -= 24;
  }

  newPage();
  function totalsHeading(continued = false) {
    page.drawRectangle({ x: MARGIN, y: y - 32, width: WIDTH - 2 * MARGIN, height: 32, color: pale });
    page.drawText(`1. Lista completa de itens${continued ? ' - continuação' : ''}`,
      { x: MARGIN + 10, y: y - 21, size: 13, font: strong, color: ink });
    y -= 53;
  }
  totalsHeading();
  for (const product of supplierTotals(groups)) {
    const lines = wrap(product.label, 11, WIDTH - 2 * MARGIN - 32);
    if (y - Math.min(lines.length * 16 + 9, 120) < BOTTOM) { newPage(); totalsHeading(true); }
    checkbox(product.checked, MARGIN + 4, y, `Total: ${product.label}`);
    for (const text of lines) {
      if (y - 16 < BOTTOM) { newPage(); totalsHeading(true); }
      page.drawText(text, { x: MARGIN + 26, y, size: 11, font, color: ink });
      y -= 16;
    }
    y -= 9;
  }
  newPage();
  page.drawText('2. Pedidos por cliente', { x: MARGIN, y, size: 13, font: strong, color: ink });
  y -= 26;
  for (const group of groups) {
    clientHeader(group);
    for (const order of group.orders) {
      if (y - 50 < BOTTOM) { newPage(); clientHeader(group, true); }
      orderHeader(order);
      const continueOrder = () => { newPage(); clientHeader(group, true); orderHeader(order, true); };
      for (const line of order.lines) {
        const lines = wrap(line.label, 11, WIDTH - 2 * MARGIN - 32);
        if (y - Math.min(lines.length * 16 + 10, 120) < BOTTOM) continueOrder();
        checkbox(line.checked, MARGIN + 4, y, line.label);
        for (const text of lines) {
          if (y - 16 < BOTTOM) continueOrder();
          page.drawText(text, { x: MARGIN + 26, y, size: 11, font, color: ink });
          y -= 16;
        }
        y -= 10;
      }
      if (order.notes) {
        for (const text of wrap(`Observação: ${order.notes}`, 9, WIDTH - 2 * MARGIN - 26)) {
          if (y - 14 < BOTTOM) continueOrder();
          page.drawText(text, { x: MARGIN + 26, y, size: 9, font, color: muted }); y -= 14;
        }
      }
      y -= 12;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: pale });
      y -= 20;
    }
    y -= 4;
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawText('Conferência da cópia em PDF - alterações não sincronizam com o site.',
      { x: MARGIN, y: 31, size: 8, font, color: muted });
    sheet.drawText(`${index + 1} / ${pages.length}`, { x: WIDTH - MARGIN - 32, y: 31, size: 8, font, color: muted });
  });
  return pdf.save();
}
