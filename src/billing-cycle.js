const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value) {
  if (!DATE_RE.test(String(value || ''))) throw new Error('Data inválida.');
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Data inválida.');
  }
  return date;
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function billingDeadlineForDelivery(deliveryDate) {
  const date = parseDate(deliveryDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (date.getUTCDate() <= 15) return `${year}-${String(month + 1).padStart(2, '0')}-15`;
  return formatDate(new Date(Date.UTC(year, month + 1, 0)));
}

export function daysUntil(date, today) {
  return Math.round((parseDate(date).getTime() - parseDate(today).getTime()) / 86400000);
}

export function billingReminder(rows, today) {
  const open = (rows || []).filter(row => Number(row.due_cents || 0) > 0 && row.delivery_date);
  if (!open.length) return { state: 'clear', days: null, deadline: null, dueCents: 0, message: 'Nenhum pagamento pendente.' };

  const deadlines = open.map(row => billingDeadlineForDelivery(row.delivery_date)).sort();
  const deadline = deadlines[0];
  const days = daysUntil(deadline, today);
  const dueCents = open.reduce((sum, row) => sum + Number(row.due_cents || 0), 0);

  if (days < 0) return { state: 'overdue', days, deadline, dueCents, message: 'Seu pagamento está em atraso.' };
  if (days === 0) return { state: 'today', days, deadline, dueCents, message: 'Hoje é o dia do seu pagamento.' };
  if (days === 1) return { state: 'upcoming', days, deadline, dueCents, message: 'Falta 1 dia para o seu pagamento.' };
  return { state: 'upcoming', days, deadline, dueCents, message: `Faltam ${days} dias para o seu pagamento.` };
}
