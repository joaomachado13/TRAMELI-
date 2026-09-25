// A diferença dos produtos é bruta: entrega e outras despesas não entram.
export function summarizeFinancials(orders, costRows) {
  const active = orders.filter(order => (order.status || (order.checked ? 'confirmed' : 'received')) !== 'cancelled');
  const customerCents = active.reduce((sum, order) => sum + order.items.reduce(
    (lineSum, item) => lineSum + item.quantity * item.priceCents, 0), 0);
  const deliveryCents = active.reduce((sum, order) => sum + order.feeCents, 0);
  if (!costRows) return { customerCents, deliveryCents, supplierCents: null, missingItems: null, estimatedItems: null, profitCents: null };
  const byOrder = new Map(costRows.map(row => [row.order_id, row]));
  const supplierCents = active.reduce((sum, order) => sum + Number(byOrder.get(order.id)?.supplier_total_cents || 0), 0);
  const missingItems = active.reduce((sum, order) => sum + (byOrder.has(order.id)
    ? Number(byOrder.get(order.id).missing_count || 0) : order.items.length), 0);
  const estimatedItems = active.reduce((sum, order) => sum + Number(byOrder.get(order.id)?.estimated_count || 0), 0);
  return { customerCents, deliveryCents, supplierCents, missingItems, estimatedItems,
    profitCents: missingItems === 0 ? customerCents - supplierCents : null };
}
