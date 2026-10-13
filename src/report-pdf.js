import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 42;
const BOTTOM = 48;

function wrap(font, value, size, width) {
  const lines = [];
  for (const paragraph of String(value || '').split(/\r?\n/)) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      line = word;
    }
    lines.push(line);
  }
  return lines;
}

export async function createReportPdf({ title, period, text, businessName = 'Trameli', regular, bold }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const strong = await pdf.embedFont(bold, { subset: true });
  const ink = rgb(43 / 255, 39 / 255, 36 / 255);
  const muted = rgb(98 / 255, 90 / 255, 85 / 255);
  const primary = rgb(158 / 255, 67 / 255, 44 / 255);
  let page;
  let y;

  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
    page.drawText(businessName, { x: MARGIN, y, size: 10, font: strong, color: primary });
    y -= 26;
    page.drawText(title, { x: MARGIN, y, size: 20, font: strong, color: ink });
    y -= 20;
    page.drawText(period, { x: MARGIN, y, size: 9, font, color: muted });
    y -= 26;
  };

  newPage();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const isHeading = /^(TRAMELI|RESUMO|CLIENTE|PEDIDOS?|VALOR TOTAL|COMPRAS|PAGO|EM ABERTO)/i.test(rawLine.trim());
    const selectedFont = isHeading ? strong : font;
    const size = isHeading ? 10 : 9;
    const lines = wrap(selectedFont, rawLine, size, WIDTH - 2 * MARGIN);
    if (!rawLine.trim()) { y -= 8; continue; }
    for (const line of lines) {
      if (y < BOTTOM) newPage();
      page.drawText(line || ' ', { x: MARGIN, y, size, font: selectedFont, color: isHeading ? ink : muted });
      y -= isHeading ? 15 : 13;
    }
  }
  pdf.setTitle(`${businessName} - ${title}`);
  pdf.setAuthor(businessName);
  return pdf.save();
}

function billingMoney(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
}

function billingDate(value) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
}

export async function createBillingReportPdf({ title = 'Cobrança detalhada', period, customers = [], businessName = 'Trameli', regular, bold }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const strong = await pdf.embedFont(bold, { subset: true });
  const ink = rgb(43 / 255, 39 / 255, 36 / 255);
  const muted = rgb(98 / 255, 90 / 255, 85 / 255);
  const primary = rgb(158 / 255, 67 / 255, 44 / 255);
  const pale = rgb(247 / 255, 242 / 255, 234 / 255);
  const rule = rgb(224 / 255, 216 / 255, 209 / 255);
  const pages = [];
  let page;
  let y;
  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    pages.push(page);
    y = HEIGHT - MARGIN;
    page.drawText(businessName, { x: MARGIN, y, size: 10, font: strong, color: primary });
    y -= 23;
    page.drawText(title, { x: MARGIN, y, size: 18, font: strong, color: ink });
    y -= 18;
    for (const line of wrap(font, period || '', 9, WIDTH - 2 * MARGIN)) {
      page.drawText(line, { x: MARGIN, y, size: 9, font, color: muted });
      y -= 12;
    }
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.7, color: rule });
    y -= 18;
  };
  const ensureSpace = height => { if (y - height < BOTTOM) newPage(); };
  const drawRight = (value, right, baseline, size, selectedFont = font, color = muted) => {
    const text = String(value ?? '');
    page.drawText(text, { x: right - selectedFont.widthOfTextAtSize(text, size), y: baseline, size, font: selectedFont, color });
  };
  newPage();
  for (const customer of customers) {
    ensureSpace(82);
    page.drawRectangle({ x: MARGIN, y: y - 34, width: WIDTH - 2 * MARGIN, height: 38, color: pale });
    const customerNameLines = wrap(strong, customer.name || 'Cliente', 10, WIDTH - 2 * MARGIN - 110).slice(0, 2);
    customerNameLines.forEach((line, index) => page.drawText(line, { x: MARGIN + 10, y: y - 14 - index * 12, size: 10, font: strong, color: ink }));
    page.drawText(`${(customer.orders || []).length} ${(customer.orders || []).length === 1 ? 'pedido' : 'pedidos'}`, { x: WIDTH - MARGIN - 84, y: y - 14, size: 8, font, color: muted });
    y -= 45;
    const colWidth = (WIDTH - 2 * MARGIN) / 3;
    const summary = [
      ['Compras', customer.totalCents],
      ['Pago', customer.paidCents],
      ['Em aberto', customer.dueCents],
    ];
    summary.forEach(([label, amount], index) => {
      const x = MARGIN + index * colWidth;
      page.drawText(label, { x, y, size: 8, font, color: muted });
      page.drawText(billingMoney(amount), { x, y: y - 12, size: 9, font: strong, color: ink });
    });
    y -= 31;
    for (const order of customer.orders || []) {
      ensureSpace(38);
      page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.55, color: rule });
      y -= 14;
      const heading = `${billingDate(order.date)} · ${order.code || 'Pedido'} · vence ${billingDate(order.dueDate)}`;
      const headingLines = wrap(strong, heading, 8.5, WIDTH - 2 * MARGIN - 92);
      page.drawText(headingLines[0] || 'Pedido', { x: MARGIN, y, size: 8.5, font: strong, color: ink });
      drawRight(order.status || '', WIDTH - MARGIN, y, 8, strong, order.status === 'Pago' ? primary : muted);
      y -= 14;
      for (const item of order.items || []) {
        const itemLines = wrap(font, item.label || 'Item', 8, WIDTH - 2 * MARGIN - 95);
        for (let index = 0; index < itemLines.length; index += 1) {
          ensureSpace(13);
          page.drawText(itemLines[index], { x: MARGIN + 8, y, size: 8, font, color: muted });
          if (index === 0) drawRight(billingMoney(item.amountCents), WIDTH - MARGIN, y, 8, font, ink);
          y -= 11;
        }
      }
      ensureSpace(25);
      page.drawLine({ start: { x: MARGIN + 8, y: y + 4 }, end: { x: WIDTH - MARGIN, y: y + 4 }, thickness: 0.35, color: rule });
      const totals = `Total ${billingMoney(order.totalCents)}   Pago ${billingMoney(order.paidCents)}   Em aberto ${billingMoney(order.dueCents)}`;
      page.drawText(totals, { x: MARGIN + 8, y: y - 8, size: 8, font: strong, color: ink });
      y -= 24;
    }
    y -= 8;
  }
  pages.forEach((current, index) => {
    current.drawText(`Página ${index + 1} de ${pages.length}`, { x: WIDTH - MARGIN - 74, y: 24, size: 7, font, color: muted });
  });
  pdf.setTitle(`${businessName} - ${title}`);
  pdf.setAuthor(businessName);
  return pdf.save();
}

export async function downloadReportPdf({ title, period, text, billingCustomers = null, businessName = 'Trameli', filename = 'relatorio' }) {
  const [regular, bold] = await Promise.all([
    fetch(new URL('../assets/manrope-400.ttf', import.meta.url)).then(response => {
      if (!response.ok) throw new Error('Não foi possível carregar a fonte do PDF.');
      return response.arrayBuffer();
    }),
    fetch(new URL('../assets/manrope-600.ttf', import.meta.url)).then(response => {
      if (!response.ok) throw new Error('Não foi possível carregar a fonte do PDF.');
      return response.arrayBuffer();
    }),
  ]);
  const bytes = Array.isArray(billingCustomers) && billingCustomers.length
    ? await createBillingReportPdf({ title, period, customers: billingCustomers, businessName, regular, bold })
    : await createReportPdf({ title, period, text, businessName, regular, bold });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}