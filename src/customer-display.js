// Presentation only: never use this formatted label as a customer identifier.
const lowercaseWords = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);

export function formatCustomerName(value) {
  return String(value ?? '').normalize('NFC').trim().split(/\s+/).map(word => {
    const lower = word.toLocaleLowerCase('pt-BR');
    return lowercaseWords.has(lower) ? lower : lower.replace(/\p{L}/u, letter => letter.toLocaleUpperCase('pt-BR'));
  }).join(' ');
}

// Search normalization is separate from identity matching and saved values.
export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim();
}
