export const weekdayNames = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function recurringItemsText(items = []) {
  return items.map(item => `${item.weightGrams ? `${item.weightGrams} g de ` : `${item.quantity}× `}${item.name}`).join(' · ');
}

export function recurringScheduleText(schedule) {
  return schedule.items_by_weekday
    ? (schedule.weekdays || []).map(day => `${weekdayNames[day]}: ${recurringItemsText(schedule.items_by_weekday[String(day)] || [])}`)
    : [recurringItemsText(schedule.items || [])];
}
