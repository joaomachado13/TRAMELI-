const shiftDateKey = (value, days) => {
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const calendarDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
};

export const isDeliveryDate = value => {
  const date = calendarDate(value);
  return Boolean(date && date.getUTCDay() !== 0);
};

export const nextAvailableDeliveryDate = (today, cutoffPassed = false) => {
  if (!calendarDate(today)) throw new TypeError('A data atual deve estar no formato YYYY-MM-DD.');
  let candidate = shiftDateKey(today, cutoffPassed ? 2 : 1);
  while (!isDeliveryDate(candidate)) candidate = shiftDateKey(candidate, 1);
  return candidate;
};

export const rollingDeliveryWeek = (startDate, count = 7) => {
  if (!calendarDate(startDate)) throw new TypeError('A data inicial deve estar no formato YYYY-MM-DD.');
  if (!Number.isInteger(count) || count < 1 || count > 31) throw new RangeError('A quantidade de dias deve estar entre 1 e 31.');
  const days = [];
  let offset = 0;
  while (days.length < count) {
    const date = shiftDateKey(startDate, offset++);
    if (!isDeliveryDate(date)) continue;
    days.push(date);
  }
  return days;
};
