import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { formatMoney, periodLabel } from './supplier-costs.js';

const WIDTH = 595.28;
const HEIGHT = 841.89;
// Espaçamento de referência: 12 px convertidos para pontos do PDF (9 pt).
// Os demais espaçamentos são proporções desta única variável.
const PDF_GAP = 9;
const PDF_HALF_GAP = PDF_GAP / 2;
const PDF_NOTE_GAP = PDF_GAP / 6;
const PDF_SECTION_TOP = PDF_GAP * 5 / 3;
const PDF_SECTION_BOTTOM = PDF_GAP * 5 / 6;
const PDF_TOTAL_MARGIN = PDF_GAP * 4 / 3;
const PDF_TOTAL_PADDING = PDF_GAP * 7 / 6;
const PDF_FOOTNOTE_MARGIN = PDF_GAP * 7 / 6;
const MARGIN = 28;
const BOTTOM = 48;

export async function createSupplierPeriodPdf(report, kindLabel, { businessName = 'Pão Doce', regular, bold, includeCustomers = false, supplierName = 'Padaria' }) {
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
  const isOutsidePurchase = supplierName.startsWith('Outros');
  pdf.setTitle((isOutsidePurchase ? 'Compras à parte - ' : 'Repasse da padaria - ') + supplierName + ' - ' + kindLabel + ' - ' + label);
  pdf.setAuthor(businessName);
  pdf.setSubject(isOutsidePurchase ? 'Itens e custos comprados à parte' : 'Itens e custo total do período para a padaria');
  let page;
  let y;

  function newPage() {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
    page.drawText(businessName, { x: MARGIN, y, size: 10, font: strong, color: primary });
    y -= 26;
    page.drawText((isOutsidePurchase ? 'Compras à parte - ' : 'Repasse da padaria - ') + kindLabel, { x: MARGIN, y, size: 20, font: strong, color: ink });
    y -= 22;
    page.drawText('Período: ' + label + '   |   ' + report.orderCount + ' ' + (report.orderCount === 1 ? 'pedido' : 'pedidos'),
      { x: MARGIN, y, size: 10, font, color: muted });
    y -= 24;
  }

  function section(title) {
    y -= PDF_SECTION_TOP;
    const height = 18;
    page.drawRectangle({ x: MARGIN, y: y - height, width: WIDTH - 2 * MARGIN, height, color: pale });
    page.drawText(title, { x: MARGIN + 10, y: y - 12, size: 11, font: strong, color: ink });
    y -= height + PDF_SECTION_BOTTOM;
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
    const lineHeight = Math.max(lines.length * 10, 11);
    y -= PDF_HALF_GAP;
    const baseline = y - 8;
    lines.forEach((line, index) => {
      page.drawText(line, { x: leftX, y: baseline - index * 10, size: leftSize, font: selected, color: ink });
    });
    drawRight(value, baseline, valueSize, selected, options.valueColor || ink);
    const separatorY = baseline - lineHeight - PDF_HALF_GAP;
    page.drawLine({ start: { x: MARGIN, y: separatorY }, end: { x: WIDTH - MARGIN, y: separatorY }, thickness: 0.4, color: pale });
    y = separatorY - PDF_HALF_GAP;
  }

  function displayProductName(value) {
    const lower = String(value || '').trim().toLocaleLowerCase('pt-BR');
    if (!lower) return 'Produto';
    const capitalized = lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    return capitalized.replace(/\bpratis\b/gi, 'Pratis');
  }

  let finalBlockHeight = 0;

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
    const noteLines = wrapLine(note, font, 7.8, WIDTH - 2 * MARGIN - 12);
    const titleHeight = Math.max(titleLines.length * 11, 11);
    const noteHeight = noteLines.length * 9;
    const contentHeight = titleHeight + PDF_NOTE_GAP + noteHeight;
    const rowHeight = PDF_HALF_GAP + 8 + contentHeight + PDF_NOTE_GAP + PDF_HALF_GAP;

    // Mantém o item inteiro e reserva espaço para a seção diária + total + nota.
    if (y - rowHeight - finalBlockHeight < BOTTOM) newPage();

    const titleBaseline = y - PDF_HALF_GAP - 8;
    titleLines.forEach((line, index) => {
      page.drawText(line, { x: leftX, y: titleBaseline - index * 11, size: 9, font, color: ink });
    });
    drawRight(value, titleBaseline, 10, font, product.estimatedCount > 0 ? primary : ink);

    let noteY = titleBaseline - titleHeight - PDF_NOTE_GAP;
    for (const line of noteLines) {
      page.drawText(line, { x: leftX, y: noteY, size: 7.8, font, color: muted });
      noteY -= 9;
    }
    const separatorY = noteY + 9 - PDF_GAP - PDF_NOTE_GAP;
    page.drawLine({ start: { x: MARGIN, y: separatorY }, end: { x: WIDTH - MARGIN, y: separatorY }, thickness: 0.4, color: pale });
    y = separatorY - PDF_HALF_GAP;
  }

  const notes = [];
  if (report.missingLines) notes.push('Atenção: ' + report.missingLines + ' item(ns) sem custo cadastrado. O total está incompleto.');
  if (report.estimatedLines === 1) notes.push('* Custo estimado, ainda não confirmado (1 item).');
  else if (report.estimatedLines > 1) notes.push('* Custos estimados, ainda não confirmados (' + report.estimatedLines + ' itens).');
  const noteLines = notes.flatMap(note => wrapLine(note, font, 8.8, WIDTH - 2 * MARGIN));

  const sectionHeight = PDF_SECTION_TOP + 18 + PDF_SECTION_BOTTOM;
  const dayRowHeight = PDF_HALF_GAP + 8 + 11 + PDF_HALF_GAP * 2;
  const totalHeight = PDF_TOTAL_MARGIN + PDF_TOTAL_PADDING + 8 + PDF_TOTAL_PADDING + 3;
  const footnoteHeight = PDF_FOOTNOTE_MARGIN + (noteLines.length ? 8 + noteLines.length * 9 + PDF_HALF_GAP : 0);
  finalBlockHeight = sectionHeight + report.days.length * dayRowHeight + totalHeight + footnoteHeight + PDF_GAP;

  newPage();
  section('1. Itens e preço de custo');
  const products = [...report.products].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  for (const product of products) productRow(product);

  if (includeCustomers && report.customerOrders?.length) {
    newPage();
    section('2. Itens por cliente');
    const customers = new Map();
    for (const order of report.customerOrders) {
      const key = JSON.stringify([order.customer || '', order.address || '']);
      if (!customers.has(key)) customers.set(key, { customer: order.customer || 'Cliente sem nome', address: order.address || '', orders: [], costCents: 0, missing: 0 });
      const current = customers.get(key);
      current.orders.push(order);
      current.costCents += Number(order.costCents || 0);
      current.missing += Number(order.missing || 0);
    }
    const orderedCustomers = [...customers.values()].sort((a, b) =>
      a.customer.localeCompare(b.customer, 'pt-BR', { sensitivity: 'base' })
    );
    for (const customer of orderedCustomers) {
      if (y < 115) {
        newPage();
        section('2. Itens por cliente · continuação');
      }
      const customerNameLines = wrapLine(customer.customer, strong, 11, WIDTH - 2 * MARGIN - 12);
      for (const line of customerNameLines) {
        page.drawText(line, { x: MARGIN + 6, y: y - 8, size: 11, font: strong, color: ink });
        y -= 13;
      }
      if (customer.address) {
        const addressLines = wrapLine(customer.address, font, 8, WIDTH - 2 * MARGIN - 12);
        for (const line of addressLines) {
          page.drawText(line, { x: MARGIN + 6, y: y - 5, size: 8, font, color: muted });
          y -= 10;
        }
      }
      y -= PDF_HALF_GAP;
      for (const order of customer.orders) {
        const date = order.date.split('-').reverse().join('/');
        for (const detail of order.lines) {
          if (y < 82) {
            newPage();
            section('2. Itens por cliente · continuação');
            page.drawText(customer.customer + ' (continuação)', { x: MARGIN + 6, y: y - 8, size: 10.5, font: strong, color: ink });
            y -= 22;
          }
          const value = detail.costKnown
            ? formatMoney(detail.costCents) + (detail.estimated ? '*' : '')
            : 'custo não informado';
          row(date + ' · ' + detail.label, value, { leftSize: 8.8, valueSize: 9.3 });
        }
      }
      if (y < 72) {
        newPage();
        section('2. Itens por cliente · continuação');
      }
      row('Subtotal de ' + customer.customer,
        formatMoney(customer.costCents) + (customer.missing ? ' *' : ''),
        { leftSize: 9.2, valueSize: 10, bolder: true });
      if (customer.missing) {
        const warning = customer.missing + ' item(ns) sem custo cadastrado; subtotal incompleto.';
        for (const line of wrapLine(warning, font, 7.8, WIDTH - 2 * MARGIN - 12)) {
          page.drawText(line, { x: MARGIN + 6, y, size: 7.8, font, color: muted });
          y -= 9;
        }
      }
      y -= PDF_GAP;
    }
  }

  // O custo por dia e o total ficam em um bloco próprio após o detalhamento por cliente.
  if (includeCustomers) newPage();
  section(includeCustomers ? '3. Custo por dia' : '2. Custo por dia');
  for (const day of report.days) {
    const date = day.date.split('-').reverse().join('/');
    row(date + ' · ' + day.orders + ' ' + (day.orders === 1 ? 'pedido' : 'pedidos'), formatMoney(day.costCents), { leftSize: 9, valueSize: 9.5 });
  }

  y -= PDF_TOTAL_MARGIN;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 1, color: primary });
  y -= PDF_TOTAL_PADDING + 8;
  page.drawText(isOutsidePurchase ? 'TOTAL DE COMPRAS À PARTE' : 'TOTAL A PAGAR À PADARIA', { x: MARGIN + 6, y, size: 12.5, font: strong, color: ink });
  drawRight(formatMoney(report.totalCents), y, 13.5, strong, ink);
  y -= PDF_TOTAL_PADDING + 3;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.6, color: rule });
  y -= PDF_FOOTNOTE_MARGIN + 8;

  for (const line of noteLines) {
    page.drawText(line, { x: MARGIN + 2, y, size: 8.8, font, color: muted });
    y -= 9;
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

export async function downloadSupplierPeriodPdf(report, kindLabel, businessName, options = {}) {
  const [{ default: regularFontUrl }, { default: boldFontUrl }] = await Promise.all([
    import('../assets/manrope-400.ttf?url'),
    import('../assets/manrope-600.ttf?url'),
  ]);
  const load = url => fetch(url).then(response => {
    if (!response.ok) throw new Error('Não foi possível carregar a fonte do PDF.');
    return response.arrayBuffer();
  });
  const [regular, bold] = await Promise.all([load(regularFontUrl), load(boldFontUrl)]);
  const bytes = await createSupplierPeriodPdf(report, kindLabel, { businessName, regular, bold, ...options });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'repasse-padaria-' + kindLabel.toLowerCase() + '-' + report.from + '_a_' + report.to + '.pdf';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
