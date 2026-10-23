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

function normalizedFrequency(value) {
  return value === 'mensal' ? 'mensal' : 'quinzenal';
}

export function shiftBillingDate(value, days) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return formatDate(date);
}

export function billingDeadlineForDelivery(deliveryDate, frequency = 'quinzenal') {
  const date = parseDate(deliveryDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (normalizedFrequency(frequency) === 'mensal') {
    return formatDate(new Date(Date.UTC(year, month + 1, 0)));
  }
  if (date.getUTCDate() <= 15) return `${year}-${String(month + 1).padStart(2, '0')}-15`;
  return formatDate(new Date(Date.UTC(year, month + 1, 0)));
}

export function paymentDueDateForDelivery(deliveryDate, frequency = 'quinzenal', graceDays = 3) {
  return shiftBillingDate(billingDeadlineForDelivery(deliveryDate, frequency), graceDays);
}

export function daysUntil(date, today) {
  return Math.round((parseDate(date).getTime() - parseDate(today).getTime()) / 86400000);
}

export function nextBillingDeadline(today, frequency = 'quinzenal') {
  const date = parseDate(today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  if (normalizedFrequency(frequency) === 'mensal') {
    if (day < lastDay) return formatDate(new Date(Date.UTC(year, month + 1, 0)));
    return formatDate(new Date(Date.UTC(year, month + 2, 0)));
  }

  if (day < 15) return `${year}-${String(month + 1).padStart(2, '0')}-15`;
  if (day < lastDay) return formatDate(new Date(Date.UTC(year, month + 1, 0)));
  return `${month === 11 ? year + 1 : year}-${String(month === 11 ? 1 : month + 2).padStart(2, '0')}-15`;
}

export function billingReminder(rows, today, frequency = 'quinzenal', graceDays = 3) {
  const open = (rows || []).filter(row => Number(row.due_cents || 0) > 0 && row.delivery_date);
  if (!open.length) {
    return { state: 'clear', days: null, deadline: null, closingDate: null, dueCents: 0, message: 'Nenhum pagamento pendente.' };
  }

  const scheduled = open.map(row => {
    const closingDate = billingDeadlineForDelivery(row.delivery_date, frequency);
    return { row, closingDate, deadline: shiftBillingDate(closingDate, graceDays) };
  });
  const deadline = scheduled.map(item => item.deadline).sort()[0];
  const target = scheduled.filter(item => item.deadline === deadline);
  const closingDate = target.map(item => item.closingDate).sort()[0];
  const days = daysUntil(deadline, today);
  const dueCents = target.reduce((sum, item) => sum + Number(item.row.due_cents || 0), 0);

  if (days < 0) return { state: 'overdue', days, deadline, closingDate, dueCents, message: 'Seu pagamento está em atraso.' };
  if (days === 0) return { state: 'today', days, deadline, closingDate, dueCents, message: 'Hoje é o último dia para pagar este fechamento.' };
  if (days === 1) return { state: 'upcoming', days, deadline, closingDate, dueCents, message: 'Falta 1 dia para pagar este fechamento.' };
  return { state: 'upcoming', days, deadline, closingDate, dueCents, message: `Faltam ${days} dias para pagar este fechamento.` };
}

const pad = value => String(value).padStart(2, '0');

// Períodos alinhados aos fechamentos: quinzena 1 (dia 1 ao 15), quinzena 2 (16 ao último dia) e mês inteiro.
export function closingPeriod(date, kind = 'quinzenal') {
  const parsed = parseDate(date);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const prefix = `${year}-${pad(month + 1)}`;
  if (kind === 'mensal') return { kind, from: `${prefix}-01`, to: `${prefix}-${pad(lastDay)}` };
  if (kind === 'quinzenal') {
    return parsed.getUTCDate() <= 15
      ? { kind, from: `${prefix}-01`, to: `${prefix}-15` }
      : { kind, from: `${prefix}-16`, to: `${prefix}-${pad(lastDay)}` };
  }
  return { kind: 'diario', from: String(date), to: String(date) };
}
