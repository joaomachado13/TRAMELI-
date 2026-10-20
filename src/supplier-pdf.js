import { PDFDocument, PDFName, PDFHexString, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { supplierTotals, supplierDayCost, compareSupplierGroups } from './supplier-checklist.js';
import { formatMoney } from './supplier-costs.js';

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 42;
const BOTTOM = 55;

export async function createSupplierPdf(groups, date, { businessName = 'Pão Doce', regular, bold }) {
  if (!groups.length) throw new Error('Não há pedidos para exportar nesta data.');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const strong = await pdf.embedFont(bold, { subset: true });
  const form = pdf.getForm();
  const ink = rgb(43 / 255, 39 / 255, 36 / 255);
  const muted = rgb(98 / 255, 90 / 255, 85 / 255);
  const pale = rgb(244 / 255, 222 / 255, 213 / 255);
  const primary = rgb(122 / 255, 59 / 255, 40 / 255);
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR');
  pdf.setTitle(`Repasse da padaria - ${dateLabel}`);
  pdf.setAuthor(businessName);
  pdf.setSubject('Lista consolidada por material, com valores de custo quando disponíveis');
  let page;
  let y;
  let fieldIndex = 0;
  const day = supplierDayCost(groups);
  const costed = day.withCosts;
  const drawCost = (text, baseline, size = 10.5, selected = font) => page.drawText(text, { x: WIDTH - MARGIN - 6 - selected.widthOfTextAtSize(text, size), y: baseline, size, font: selected, color: ink });

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
    page.drawText(costed ? 'Consolidado por material. Valores pelo preço de custo.' : 'Consolidado por material. Sem valores.', { x: MARGIN, y, size: 9, font, color: muted });
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
    if (!continued) checkbox(order.checked, MARGIN + 4, y, `Pedido ${order.publicCode || order.id.slice(0, 8)} completo`);
    page.drawText(`Pedido #${order.publicCode || order.id.slice(0, 8)}${continued ? ' - continuação' : ' - pedido completo'}`,
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
    const lines = wrap(product.label, 11, WIDTH - 2 * MARGIN - (costed ? 150 : 32));
    if (y - Math.min(lines.length * 16 + 9, 120) < BOTTOM) { newPage(); totalsHeading(true); }
    checkbox(product.checked, MARGIN + 4, y, `Total: ${product.label}`);
    if (costed) drawCost(product.costMissing ? 'custo não informado' : formatMoney(product.costCents), y, 10.5);
    for (const text of lines) {
      if (y - 16 < BOTTOM) { newPage(); totalsHeading(true); }
      page.drawText(text, { x: MARGIN + 26, y, size: 11, font, color: ink });
      y -= 16;
    }
    y -= 9;
  }
  if (costed) {
    if (y - 50 < BOTTOM) newPage();
    const total = formatMoney(day.totalCents);
    page.drawRectangle({ x: MARGIN, y: y - 30, width: WIDTH - 2 * MARGIN, height: 30, color: primary });
    page.drawText('TOTAL A PAGAR À PADARIA (custo)', { x: MARGIN + 10, y: y - 20, size: 11, font: strong, color: rgb(1, 1, 1) });
    page.drawText(total, { x: WIDTH - MARGIN - 10 - strong.widthOfTextAtSize(total, 13), y: y - 21, size: 13, font: strong, color: rgb(1, 1, 1) });
    y -= 40;
    if (day.missing) { page.drawText(`Atenção: ${day.missing} item(ns) sem custo cadastrado; total incompleto.`, { x: MARGIN, y, size: 9, font, color: muted }); y -= 14; }
  }
  // Repasse financeiro: somente o consolidado por material.
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawText('Conferência da cópia em PDF - alterações não sincronizam com o site.',
      { x: MARGIN, y: 31, size: 8, font, color: muted });
    sheet.drawText(`${index + 1} / ${pages.length}`, { x: WIDTH - MARGIN - 32, y: 31, size: 8, font, color: muted });
  });
  return pdf.save();
}

export async function createSeparationPdf(groups, date, { businessName = 'Pão Doce', supplierName = 'Padaria do Divano', regular, bold }) {
  if (!groups.length) throw new Error('Não há pedidos para separar nesta data.');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const strong = await pdf.embedFont(bold, { subset: true });
  const WIDTH = 595.28, HEIGHT = 841.89, MARGIN = 30, BOTTOM = 38;
  const ink = rgb(43 / 255, 39 / 255, 36 / 255);
  const muted = rgb(98 / 255, 90 / 255, 85 / 255);
  const pale = rgb(244 / 255, 222 / 255, 213 / 255);
  const primary = rgb(122 / 255, 59 / 255, 40 / 255);
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR');
  pdf.setTitle(`Lista de separação - ${supplierName} - ${dateLabel}`);
  pdf.setAuthor(businessName);
  pdf.setSubject('Lista operacional por rua e cliente, sem valores');
  let page, y;
  function newPage() {
    page = pdf.addPage([WIDTH, HEIGHT]); y = HEIGHT - MARGIN;
    page.drawText(businessName, { x: MARGIN, y, size: 8, font: strong, color: primary }); y -= 17;
    page.drawText('Lista de separação', { x: MARGIN, y, size: 18, font: strong, color: ink }); y -= 21;
    page.drawText(`${supplierName}  •  Entrega: ${dateLabel}`, { x: MARGIN, y, size: 9, font: strong, color: muted }); y -= 13;
    page.drawText('Confira produtos e quantidades. Sem preços.', { x: MARGIN, y, size: 8, font, color: muted }); y -= 18;
  }
  function wrap(value, size, width, selected = font) {
    const out = []; let line = '';
    for (const word of String(value || '').split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (selected.widthOfTextAtSize(next, size) <= width) line = next;
      else { if (line) out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  }
  const sorted = [...groups].sort(compareSupplierGroups);
  newPage();
  for (const group of sorted) {
    const heading = wrap(group.customer, 11, WIDTH - 2*MARGIN - 20, strong);
    const address = wrap(group.address || 'Endereço não informado', 9, WIDTH - 2*MARGIN - 20);
    const needed = 12 + heading.length*13 + address.length*10 + group.orders.reduce((n,o)=>n+o.lines.reduce((m,l)=>m+Math.max(1,wrap(l.label,9.5,WIDTH-2*MARGIN-36).length)*12+2,0)+7,0);
    if (y - Math.min(needed, HEIGHT) < BOTTOM) newPage();
    const boxHeight = heading.length*13 + address.length*10 + 8;
    page.drawRectangle({x:MARGIN,y:y-boxHeight,width:WIDTH-2*MARGIN,height:boxHeight,color:pale});
    y -= 17;
    for (const line of heading) { page.drawText(line,{x:MARGIN+8,y,size:11,font:strong,color:ink}); y-=13; }
    for (const line of address) { page.drawText(line,{x:MARGIN+8,y,size:8,font,color:muted}); y-=10; }
    y -= 4;
    for (const order of group.orders) {
      if (y-18 < BOTTOM) newPage();
      page.drawText(`#${order.publicCode || order.id.slice(0,8)}`,{x:MARGIN+8,y,size:8.5,font:strong,color:ink}); y-=13;
      for (const line of order.lines) {
        const lines = wrap(`[ ] ${line.label}`,9.5,WIDTH-2*MARGIN-30);
        if (y-lines.length*12 < BOTTOM) newPage();
        for (const text of lines) { page.drawText(text,{x:MARGIN+14,y,size:9.5,font,color:ink}); y-=12; }
        y -= 1;
      }
      if (order.notes) {
        for (const text of wrap(`Obs.: ${order.notes}`,8,WIDTH-2*MARGIN-32)) {
          if (y-10 < BOTTOM) newPage();
          page.drawText(text,{x:MARGIN+14,y,size:8,font,color:muted}); y-=10;
        }
      }
      y -= 7;
    }
    y -= 5;
  }
  const pages = pdf.getPages();
  pages.forEach((sheet,index) => {
    sheet.drawText('Lista de separação • sem valores financeiros', {x:MARGIN,y:22,size:7,font,color:muted});
    sheet.drawText(`${index+1} / ${pages.length}`, {x:WIDTH-MARGIN-32,y:22,size:7,font,color:muted});
  });
  return pdf.save();
}
