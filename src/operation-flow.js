export const stages = [
  { key: 'received', title: 'A conferir', note: 'Pedidos recebidos' },
  { key: 'confirmed', title: 'Conferido', note: 'Conferência concluída' },
  { key: 'packing', title: 'Em separação', note: 'Montando os pedidos' },
  { key: 'ready', title: 'Pronto', note: 'Aguardando entrega' },
  { key: 'delivered', title: 'Entregue', note: 'Entrega concluída' },
];

// Use the existing versioned status API, including its audit trail and permissions.
export function statusPath(from, to, master = false) {
  const start = stages.findIndex(stage => stage.key === from);
  const end = stages.findIndex(stage => stage.key === to);
  if (start < 0 || end < 0 || start === end || from === 'delivered') return [];
  if (end < start && !master) return [];
  const step = end > start ? 1 : -1;
  const path = [];
  for (let index = start + step; index !== end + step; index += step) path.push(stages[index].key);
  return path;
}

export async function progressOrder(order, target, { master, setStatus, getOrder }) {
  const path = statusPath(order.status || (order.checked ? 'confirmed' : 'received'), target, master);
  if (!path.length) throw new Error('Esta mudança de etapa não está disponível para este pedido.');
  let current = order;
  for (const state of path) {
    await setStatus(current, state);
    const updated = getOrder(order.id);
    if (!updated || updated.status !== state || (current.version != null && updated.version !== current.version + 1)) {
      throw new Error('O pedido foi atualizado durante a movimentação. Confira a etapa atual antes de tentar novamente.');
    }
    current = updated;
  }
  return current;
}
