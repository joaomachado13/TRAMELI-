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

export async function downloadReportPdf({ title, period, text, businessName = 'Trameli', filename = 'relatorio' }) {
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
  const bytes = await createReportPdf({ title, period, text, businessName, regular, bold });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}