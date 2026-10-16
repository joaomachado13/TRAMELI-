import { statusOf, itemLabel } from './order-math.js';

const normalize = value => String(value || '').trim().toLocaleLowerCase('pt-BR');

export const formatMoney = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// costRows: linhas de trameli_order_costs ({ order_id, line_index, quantity, unit_cost_cents, total_cost_cents, estimated }).
export function costMapFromRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.order_id)) map.set(row.order_id, new Map());
    map.get(row.order_id).set(Number(row.line_index), row);
  }
  return map;
}

// Custo de uma linha do pedido (line_index começa em 1). Custo ausente nunca vira zero.
export function lineCost(costMap, orderId, index) {
  const row = costMap?.get(orderId)?.get(index + 1);
  if (!row) return { known: false, estimated: false, totalCents: null, unitCents: null };
  const known = row.unit_cost_cents != null && row.total_cost_cents != null;
  return {
    known, estimated: Boolean(row.estimated),
    totalCents: known ? Number(row.total_cost_cents) : null,
    unitCents: known ? Number(row.unit_cost_cents) : null,
  };
}

// Consolidado de um período: por produto, por dia e total, só com pedidos não cancelados.
export function supplierPeriodReport(orders, costMap, from, to) {
  const inRange = orders.filter(order => order.date >= from && order.date <= to && statusOf(order) !== 'cancelled');
  const products = new Map();
  const days = new Map();
  let totalCents = 0; let missingLines = 0; let estimatedLines = 0;
  for (const order of inRange) {
    const day = days.get(order.date) || { date: order.date, orders: 0, costCents: 0 };
    day.orders += 1;
    days.set(order.date, day);
    (order.items || []).forEach((item, index) => {
      const cost = lineCost(costMap, order.id, index);
      const weighted = Number(item.weightGrams) > 0;
      const key = JSON.stringify([item.productId || normalize(item.name), weighted]);
      const current = products.get(key) || { name: item.name, weighted, quantity: 0, grams: 0, costCents: 0, missing: 0 };
      current.quantity += Number(item.quantity) || 0;
      current.grams += Number(item.weightGrams) || 0;
      if (cost.known) { current.costCents += cost.totalCents; day.costCents += cost.totalCents; totalCents += cost.totalCents; }
      else { current.missing += 1; missingLines += 1; }
      if (cost.estimated) estimatedLines += 1;
      products.set(key, current);
    });
  }
  const list = [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(product => ({
    ...product, label: `${product.weighted ? `${product.grams} g` : `${product.quantity}×`} ${product.name}`,
    unitCents: !product.weighted && product.quantity && !product.missing ? Math.round(product.costCents / product.quantity) : null,
  }));
  return {
    from, to, orderCount: inRange.length, products: list,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    totalCents, missingLines, estimatedLines,
  };
}

const dateBr = date => date.split('-').reverse().join('/');
export const periodLabel = (from, to) => from === to ? dateBr(from) : `${dateBr(from)} a ${dateBr(to)}`;

export function supplierPeriodText(report, kindLabel, businessName = 'Pão Doce') {
  const lines = [`${businessName} - Repasse da padaria (${kindLabel})`, `Período: ${periodLabel(report.from, report.to)} · ${report.orderCount} pedidos`, '', 'ITENS (preço de custo)'];
  for (const product of report.products) {
    lines.push(`${product.label} — ${product.missing ? 'custo não informado' : formatMoney(product.costCents)}${product.unitCents != null ? ` (${formatMoney(product.unitCents)} un.)` : ''}`);
  }
  lines.push('', 'POR DIA');
  for (const day of report.days) lines.push(`${dateBr(day.date)} · ${day.orders} pedidos · ${formatMoney(day.costCents)}`);
  lines.push('', `TOTAL A PAGAR À PADARIA: ${formatMoney(report.totalCents)}`);
  if (report.missingLines) lines.push(`Atenção: ${report.missingLines} item(ns) sem custo cadastrado; o total está incompleto.`);
  if (report.estimatedLines) lines.push(`Obs.: ${report.estimatedLines} item(ns) com custo estimado, ainda não confirmado.`);
  return lines.join('\n');
}

export { itemLabel };
