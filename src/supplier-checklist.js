import { statusOf, itemLabel } from './order-math.js';
import { lineCost, formatMoney } from './supplier-costs.js';
import { parseStreetAddress } from './address-sort.js';
import { supplierProductIdentity } from './supplier-product-identity.js';

const normalize = value => String(value || '').trim().toLocaleLowerCase('pt-BR');

export const SANDRA_ITEMS = Object.freeze(['broa', 'biscoito provolone', 'bolacha de nata', 'biscoito de nata', 'biscoito de queijo', 'biscoito da vovó']);
export const isSandraSupplierItem = name => SANDRA_ITEMS.includes(normalize(name));
export function filterSupplierGroups(groups, supplier = 'divano') {
  return groups.map(group => ({
    ...group,
    orders: group.orders.map(order => ({
      ...order,
      lines: order.lines.filter(line => supplier === 'sandra' ? isSandraSupplierItem(line.name) : !isSandraSupplierItem(line.name)),
    })).filter(order => order.lines.length),
  })).filter(group => group.orders.length);
}
const signature = order => encodeURIComponent(JSON.stringify(order.items.map(item =>
  [item.productId || '', item.name, item.quantity, item.weightGrams || 0])));

export function itemCheckKey(order, index) {
  return `${order.date}:${order.id}:${signature(order)}:${index}`;
}

// Ordena pela rua e, dentro dela, pelo número da casa. Nome só desempata endereços iguais.
export function compareSupplierGroups(a, b) {
  const addressA = parseStreetAddress(a.address);
  const addressB = parseStreetAddress(b.address);
  const streetA = addressA.streetNumber;
  const streetB = addressB.streetNumber;
  if (streetA != null && streetB != null && streetA !== streetB) return streetA - streetB;
  if (streetA != null && streetB == null) return -1;
  if (streetA == null && streetB != null) return 1;
  if (streetA == null && streetB == null) {
    const addressOrder = String(a.address || '').localeCompare(String(b.address || ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
    if (addressOrder) return addressOrder;
  }
  const houseA = addressA.houseNumber;
  const houseB = addressB.houseNumber;
  if (houseA != null && houseB != null && houseA !== houseB) return houseA - houseB;
  if (houseA != null && houseB == null) return -1;
  if (houseA == null && houseB != null) return 1;
  return String(a.customer || '').localeCompare(String(b.customer || ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

// Explicit projection: financial and contact fields never enter the supplier document.
export function supplierGroups(orders, date, checked = new Set(), costMap = null) {
  const groups = new Map();
  for (const order of orders.filter(order => order.date === date && statusOf(order) !== 'cancelled')) {
    const key = JSON.stringify([order.customerId || normalize(order.customer), normalize(order.address)]);
    if (!groups.has(key)) groups.set(key, { customer: order.customer, address: order.address || '', orders: [] });
    const lines = order.items.map((item, index) => ({
      key: itemCheckKey(order, index), label: itemLabel(item), checked: checked.has(itemCheckKey(order, index)),
      productId: item.productId || '', name: item.name, quantity: item.quantity, weightGrams: item.weightGrams || 0,
      ...(costMap ? (() => { const cost = lineCost(costMap, order.id, index);
        return { costKnown: cost.known, costEstimated: cost.estimated, costCents: cost.totalCents }; })() : {}),
    }));
    groups.get(key).orders.push({ id: order.id, publicCode: order.publicCode || '', notes: order.notes || '', lines,
      checked: lines.length > 0 && lines.every(line => line.checked),
      ...(costMap ? { costCents: lines.reduce((sum, line) => sum + (line.costCents || 0), 0), costMissing: lines.filter(line => !line.costKnown).length } : {}) });
  }
  return [...groups.values()].sort(compareSupplierGroups);
}

export function supplierTotals(groups) {
  const products = new Map();
  const identify = supplierProductIdentity(groups.flatMap(group => group.orders.flatMap(order => order.lines)));
  for (const group of groups) for (const order of group.orders) for (const line of order.lines) {
    const { key } = identify(line);
    const current = products.get(key) || { name: line.name, quantity: 0, grams: 0, checked: true, costCents: 0, costMissing: 0 };
    if ('costKnown' in line) { if (line.costKnown) current.costCents += line.costCents; else current.costMissing += 1; current.hasCost = true; }
    current.quantity += line.quantity;
    current.grams += line.weightGrams;
    current.checked = current.checked && line.checked;
    products.set(key, current);
  }
  return [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(product => ({
    ...product, label: `${product.grams ? `${product.grams} g` : `${product.quantity}×`} ${product.name}`,
  }));
}

const costTail = (known, cents) => known ? ` — ${formatMoney(cents)}` : ' — custo não informado';
export function supplierDayCost(groups) {
  const lines = groups.flatMap(group => group.orders.flatMap(order => order.lines));
  return { totalCents: lines.reduce((sum, line) => sum + (line.costCents || 0), 0), missing: lines.filter(line => 'costKnown' in line && !line.costKnown).length,
    withCosts: lines.some(line => 'costKnown' in line) };
}

export function supplierText(groups, date) {
  const totals = supplierTotals(groups);
  const day = supplierDayCost(groups);
  const totalLine = product => product.hasCost ? `${product.label}${costTail(!product.costMissing, product.costCents)}` : product.label;
  return `Repasse da padaria - ${date}\n\nLISTA CONSOLIDADA POR MATERIAL\n${totals.map(totalLine).join('\n')}${day.withCosts ? `\n\nTOTAL (preço de custo): ${formatMoney(day.totalCents)}${day.missing ? ` — ${day.missing} item(ns) sem custo, total incompleto` : ''}` : ''}`;
}

export async function downloadSeparationPdf(groups, date, businessName, supplierName) {
  const { createSeparationPdf } = await import('./supplier-pdf.js');
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
  const bytes = await createSeparationPdf(groups, date, { businessName, supplierName, regular, bold });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `separacao-${String(supplierName).toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-')}-${date}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function downloadSupplierPdf(groups, date, businessName) {
  const { createSupplierPdf } = await import('./supplier-pdf.js');
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
  const bytes = await createSupplierPdf(groups, date, { businessName, regular, bold });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `repasse-padaria-${date}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
