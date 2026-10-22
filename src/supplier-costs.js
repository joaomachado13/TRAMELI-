import { statusOf, itemLabel } from './order-math.js';
import { supplierProductIdentity } from './supplier-product-identity.js';

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
// O preço por kg é metadado de exibição; não altera custos por linha nem totais.
export function supplierPeriodReport(orders, costMap, from, to, catalogProducts = [], itemFilter = null) {
  const catalogCostById = new Map((catalogProducts || []).map(product => [product.id, product.costCents]));
  const inRange = orders.filter(order => order.date >= from && order.date <= to && statusOf(order) !== 'cancelled');
  const identify = supplierProductIdentity(inRange.flatMap(order => order.items || []), catalogProducts);
  const products = new Map();
  const days = new Map();
  const customerOrders = [];
  let totalCents = 0; let missingLines = 0; let estimatedLines = 0; let matchedOrderCount = 0;
  for (const order of inRange) {
    const matchingItems = (order.items || []).map((item, index) => ({ item, index })).filter(({ item }) => !itemFilter || itemFilter(item));
    if (!matchingItems.length) continue;
    matchedOrderCount += 1;
    const day = days.get(order.date) || { date: order.date, orders: 0, costCents: 0 };
    day.orders += 1;
    days.set(order.date, day);
    const detail = {
      id: order.id,
      publicCode: order.publicCode || '',
      customer: order.customer || 'Cliente sem nome',
      address: order.address || '',
      date: order.date,
      lines: [],
      costCents: 0,
      missing: 0,
      estimatedCount: 0,
    };
    matchingItems.forEach(({ item, index }) => {
      const cost = lineCost(costMap, order.id, index);
      const { weighted, key, productId } = identify(item);
      const current = products.get(key) || {
        productId, name: item.name, weighted, quantity: 0, grams: 0, costCents: 0,
        missing: 0, estimatedCount: 0, referenceUnitCents: null,
      };
      current.quantity += Number(item.quantity) || 0;
      current.grams += Number(item.weightGrams) || 0;
      detail.lines.push({
        label: itemLabel(item),
        name: item.name,
        quantity: Number(item.quantity) || 0,
        weightGrams: Number(item.weightGrams) || 0,
        costKnown: cost.known,
        costCents: cost.totalCents,
        unitCents: cost.unitCents,
        estimated: cost.estimated,
      });
      if (cost.known) {
        detail.costCents += cost.totalCents;
        current.costCents += cost.totalCents;
        day.costCents += cost.totalCents;
        totalCents += cost.totalCents;
        if (current.referenceUnitCents == null && cost.totalCents != null) {
          // O snapshot guarda o custo da porção vendida; converte para kg só para exibição.
          current.referenceUnitCents = weighted && Number(item.weightGrams) > 0
            ? Math.round(cost.totalCents * 1000 / Number(item.weightGrams))
            : cost.unitCents;
        }
      } else {
        detail.missing += 1;
        current.missing += 1;
        missingLines += 1;
      }
      if (cost.estimated) {
        detail.estimatedCount += 1;
        estimatedLines += 1;
        current.estimatedCount += 1;
      }
      products.set(key, current);
    });
    customerOrders.push(detail);
  }
  const list = [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(product => ({
    ...product,
    label: (product.weighted ? String(product.grams) + ' g' : String(product.quantity) + '×') + ' ' + product.name,
    unitCents: product.missing ? null : product.weighted
      ? (catalogCostById.get(product.productId) ?? product.referenceUnitCents)
      : product.quantity ? Math.round(product.costCents / product.quantity) : null,
  }));
  return {
    from, to, orderCount: matchedOrderCount, products: list,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    customerOrders: customerOrders.sort((a, b) => {
      const byCustomer = String(a.customer).localeCompare(String(b.customer), 'pt-BR', { sensitivity: 'base' });
      return byCustomer || a.date.localeCompare(b.date) || String(a.publicCode).localeCompare(String(b.publicCode), 'pt-BR', { numeric: true });
    }),
    totalCents, missingLines, estimatedLines,
  };
}

const dateBr = date => date.split('-').reverse().join('/');
export const periodLabel = (from, to) => from === to ? dateBr(from) : dateBr(from) + ' a ' + dateBr(to);

export function supplierPeriodCustomerText(report, kindLabel, businessName = 'Pão Doce') {
  const lines = [businessName + ' - Repasse da padaria (' + kindLabel + ')', 'Período: ' + periodLabel(report.from, report.to) + ' · ' + report.orderCount + ' pedidos', '', 'ITENS POR CLIENTE (preço de custo)'];
  const customers = new Map();
  for (const order of report.customerOrders || []) {
    const key = JSON.stringify([order.customer || '', order.address || '']);
    if (!customers.has(key)) customers.set(key, { customer: order.customer || 'Cliente sem nome', address: order.address || '', orders: [], costCents: 0, missing: 0 });
    const current = customers.get(key);
    current.orders.push(order);
    current.costCents += Number(order.costCents || 0);
    current.missing += Number(order.missing || 0);
  }
  for (const customer of [...customers.values()].sort((a, b) => a.customer.localeCompare(b.customer, 'pt-BR', { sensitivity: 'base' }))) {
    lines.push('', customer.customer);
    for (const order of customer.orders) {
      for (const line of order.lines) {
        const value = line.costKnown ? formatMoney(line.costCents) + (line.estimated ? '*' : '') : 'custo não informado';
        lines.push(dateBr(order.date) + ' · ' + line.label + ' — ' + value);
      }
    }
    lines.push('Subtotal: ' + formatMoney(customer.costCents) + (customer.missing ? ' — ' + customer.missing + ' item(ns) sem custo' : ''));
  }
  lines.push('', 'TOTAL A PAGAR À PADARIA: ' + formatMoney(report.totalCents));
  if (report.missingLines) lines.push('Atenção: ' + report.missingLines + ' item(ns) sem custo cadastrado; o total está incompleto.');
  if (report.estimatedLines) lines.push('* ' + report.estimatedLines + ' item(ns) com custo estimado, ainda não confirmado.');
  return lines.join('\n');
}

export function supplierPeriodText(report, kindLabel, businessName = 'Pão Doce') {
  const lines = [businessName + ' - Repasse da padaria (' + kindLabel + ')', 'Período: ' + periodLabel(report.from, report.to) + ' · ' + report.orderCount + ' pedidos', '', 'ITENS (preço de custo)'];
  for (const product of report.products) {
    lines.push(product.label + ' — ' + (product.missing ? 'custo não informado' : formatMoney(product.costCents)) + (product.unitCents != null && !product.weighted ? ' (' + formatMoney(product.unitCents) + ' un.)' : ''));
  }
  lines.push('', 'POR DIA');
  for (const day of report.days) lines.push(dateBr(day.date) + ' · ' + day.orders + ' pedidos · ' + formatMoney(day.costCents));
  lines.push('', 'TOTAL A PAGAR À PADARIA: ' + formatMoney(report.totalCents));
  if (report.missingLines) lines.push('Atenção: ' + report.missingLines + ' item(ns) sem custo cadastrado; o total está incompleto.');
  if (report.estimatedLines) lines.push('Obs.: ' + report.estimatedLines + ' item(ns) com custo estimado, ainda não confirmado.');
  return lines.join('\n');
}

export { itemLabel };
