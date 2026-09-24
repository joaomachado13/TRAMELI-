export const statusOf = order => order.status || (order.checked ? 'confirmed' : 'received');
export const subtotalCents = order => order.subtotalCents ?? order.items.reduce((sum, item) => sum + item.quantity * item.priceCents, 0);
export const totalCents = order => order.totalCents ?? subtotalCents(order) + order.feeCents;
export function summarizeDay(orders, date) {
  const active = orders.filter(order => order.date === date && statusOf(order) !== 'cancelled');
  return {
    count: active.length,
    pending: active.filter(order => statusOf(order) === 'received').length,
    productsCents: active.reduce((sum, order) => sum + subtotalCents(order), 0),
    feesCents: active.reduce((sum, order) => sum + order.feeCents, 0),
    totalCents: active.reduce((sum, order) => sum + totalCents(order), 0),
  };
}

export function summarizeProducts(orders, date) {
  const grouped = new Map();
  for (const order of orders) {
    if (order.date !== date || statusOf(order) === 'cancelled') continue;
    for (const item of order.items || []) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0 || !item.name?.trim()) continue;
      const name = item.name.trim();
      const key = item.productId || name.toLocaleLowerCase('pt-BR');
      const current = grouped.get(key);
      if (current) current.quantity += item.quantity;
      else grouped.set(key, { name, quantity: item.quantity });
    }
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
