import { statusOf, itemLabel } from './order-math.js';
import { lineCost, formatMoney } from './supplier-costs.js';

const normalize = value => String(value || '').trim().toLocaleLowerCase('pt-BR');
const signature = order => encodeURIComponent(JSON.stringify(order.items.map(item =>
  [item.productId || '', item.name, item.quantity, item.weightGrams || 0])));

export function itemCheckKey(order, index) {
  return `${order.date}:${order.id}:${signature(order)}:${index}`;
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
  return [...groups.values()].sort((a, b) => a.customer.localeCompare(b.customer, 'pt-BR'));
}

export function supplierTotals(groups) {
  const products = new Map();
  for (const group of groups) for (const order of group.orders) for (const line of order.lines) {
    const weighted = line.weightGrams > 0;
    const key = JSON.stringify([line.productId || normalize(line.name), weighted]);
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
  const lineText = line => 'costKnown' in line ? `${line.label}${costTail(line.costKnown, line.costCents)}` : line.label;
  return `Repasse da padaria - ${date}\n\n1. LISTA COMPLETA DE ITENS\n${totals.map(totalLine).join('\n')}${day.withCosts ? `\n\nTOTAL (preço de custo): ${formatMoney(day.totalCents)}${day.missing ? ` — ${day.missing} item(ns) sem custo, total incompleto` : ''}` : ''}\n\n2. PEDIDOS POR CLIENTE\n\n${groups.map(group =>
    `${group.customer}\n${group.address}\n${group.orders.map(order =>
      `Pedido #${order.publicCode || order.id.slice(0, 8)}\n${order.lines.map(line => `[${line.checked ? 'x' : ' '}] ${lineText(line)}`).join('\n')}${order.costCents != null ? `\nSubtotal de custo: ${formatMoney(order.costCents)}` : ''}${order.notes ? `\nObservação: ${order.notes}` : ''}`
    ).join('\n\n')}`).join('\n\n')}`;
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
