const normalize = name => String(name || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
const nameKey = (name, weighted) => JSON.stringify([normalize(name), weighted]);

// Older recurring lines may have only a name. Resolve it only when the product is unambiguous.
export function supplierProductIdentity(items, catalog = []) {
  const idsByName = new Map();
  const remember = (name, weighted, id) => {
    if (!id || !normalize(name)) return;
    const key = nameKey(name, weighted);
    if (!idsByName.has(key)) idsByName.set(key, new Set());
    idsByName.get(key).add(id);
  };
  for (const item of items) remember(item.name, Number(item.weightGrams) > 0, item.productId);
  for (const product of catalog) remember(product.name, product.unit === 'kg', product.id);
  return item => {
    const weighted = Number(item.weightGrams) > 0;
    const candidates = idsByName.get(nameKey(item.name, weighted));
    const productId = item.productId || (candidates?.size === 1 ? candidates.values().next().value : null);
    return { productId, weighted, key: JSON.stringify([productId ? 'product' : 'name', productId || normalize(item.name), weighted]) };
  };
}
