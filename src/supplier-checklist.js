import { statusOf, itemLabel } from './order-math.js';

const normalize = value => String(value || '').trim().toLocaleLowerCase('pt-BR');
const signature = order => encodeURIComponent(JSON.stringify(order.items.map(item =>
  [item.productId || '', item.name, item.quantity, item.weightGrams || 0])));

export function itemCheckKey(order, index) {
  return `${order.date}:${order.id}:${signature(order)}:${index}`;
}

// Explicit projection: financial and contact fields never enter the supplier document.
export function supplierGroups(orders, date, checked = new Set()) {
  const groups = new Map();
  for (const order of orders.filter(order => order.date === date && statusOf(order) !== 'cancelled')) {
    const key = JSON.stringify([order.customerId || normalize(order.customer), normalize(order.address)]);
    if (!groups.has(key)) groups.set(key, { customer: order.customer, address: order.address || '', orders: [] });
    const lines = order.items.map((item, index) => ({
      key: itemCheckKey(order, index), label: itemLabel(item), checked: checked.has(itemCheckKey(order, index)),
      productId: item.productId || '', name: item.name, quantity: item.quantity, weightGrams: item.weightGrams || 0,
    }));
    groups.get(key).orders.push({ id: order.id, notes: order.notes || '', lines,
      checked: lines.length > 0 && lines.every(line => line.checked) });
  }
  return [...groups.values()].sort((a, b) => a.customer.localeCompare(b.customer, 'pt-BR'));
}

export function supplierTotals(groups) {
  const products = new Map();
  for (const group of groups) for (const order of group.orders) for (const line of order.lines) {
    const weighted = line.weightGrams > 0;
    const key = JSON.stringify([line.productId || normalize(line.name), weighted]);
    const current = products.get(key) || { name: line.name, quantity: 0, grams: 0, checked: true };
    current.quantity += line.quantity;
    current.grams += line.weightGrams;
    current.checked = current.checked && line.checked;
    products.set(key, current);
  }
  return [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(product => ({
    ...product, label: `${product.grams ? `${product.grams} g` : `${product.quantity}×`} ${product.name}`,
  }));
}

export function supplierText(groups, date) {
  const totals = supplierTotals(groups);
  return `Repasse da padaria - ${date}\n\n1. LISTA COMPLETA DE ITENS\n${totals.map(product => product.label).join('\n')}\n\n2. PEDIDOS POR CLIENTE\n\n${groups.map(group =>
    `${group.customer}\n${group.address}\n${group.orders.map(order =>
      `Pedido #${order.id.slice(0, 8)}\n${order.lines.map(line => `[${line.checked ? 'x' : ' '}] ${line.label}`).join('\n')}${order.notes ? `\nObservação: ${order.notes}` : ''}`
    ).join('\n\n')}`).join('\n\n')}`;
}

export async function downloadSupplierPdf(groups, date, businessName) {
  const { createSupplierPdf } = await import('./supplier-pdf.js');
  const [regular, bold] = await Promise.all([
    fetch(new URL('../assets/dm-sans-400.ttf', import.meta.url)).then(response => {
      if (!response.ok) throw new Error('Não foi possível carregar a fonte do PDF.');
      return response.arrayBuffer();
    }),
    fetch(new URL('../assets/dm-sans-600.ttf', import.meta.url)).then(response => {
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
