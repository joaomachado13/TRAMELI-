import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const operation = await readFile(new URL('../assets/operacao.js', import.meta.url), 'utf8');
const pix = await readFile(new URL('../src/manual-pix.js', import.meta.url), 'utf8');
const period = await readFile(new URL('../src/supplier-period-pdf.js', import.meta.url), 'utf8');
const supplier = await readFile(new URL('../src/supplier-checklist.js', import.meta.url), 'utf8');

assert.doesNotMatch(operation, /^import\s+.*from\s+['"]\.\.\/src\/supplier-period-pdf\.js['"]/m,
  'PDF mensal/quinzenal nao deve ser dependencia estatica da inicializacao.');
assert.match(operation, /const \{ downloadSupplierPeriodPdf \} = await import\(['"]\.\.\/src\/supplier-period-pdf\.js['"]\);\s*await downloadSupplierPeriodPdf\(/,
  'PDF deve carregar no proprio fluxo de exportacao, antes de executar a geracao.');
assert.match(period, /export async function downloadSupplierPeriodPdf\(/,
  'A exportacao do PDF permanece disponivel.');
assert.doesNotMatch(pix, /^import\s+QRCode\s+from\s+['"]qrcode['"]/m,
  'Biblioteca QR nao deve carregar junto com a abertura do portal.');
assert.equal((pix.match(/await import\(['"]qrcode['"]\)/g) || []).length, 2,
  'Os dois fluxos de Pix (pedido e historico) precisam carregar QR sob demanda.');
assert.equal((pix.match(/await QRCode\.toDataURL\(/g) || []).length, 2,
  'A geracao dos dois QR Codes deve permanecer funcional.');
assert.match(supplier, /await import\(['"]\.\/supplier-pdf\.js['"]\)/,
  'PDF de separacao e repasse diario permanece sob demanda.');
console.log('Inicializacao sob demanda: PDF periodo e QR Pix nao sao imports estaticos; fluxos preservados.');
