export const normalizeCatalogSearch = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export function productMatchesCatalogSearch(product, value) {
  const search = normalizeCatalogSearch(value);
  if (!search) return true;
  const haystack = normalizeCatalogSearch([
    product?.name,
    product?.category,
    product?.unit,
  ].filter(Boolean).join(' '));
  return search.split(' ').every(term => haystack.includes(term));
}
