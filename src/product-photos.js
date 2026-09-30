// Official photos supplied by the owner. Null rows are archived, not offered for sale.
// A photo never creates a product, changes availability, or supplies a price.
export const officialPhotos = [
  ['florinda-com-goiabada', 'FLORINDA COM GOIABADA.jpeg', null],
  ['bolo-fuba', 'BOLO FUBÁ.jpeg', null],
  ['rosca-hungara', 'ROSCA HUNGARA.jpeg', null],
  ['broas', 'BROAS.jpeg', 13],
  ['biscoito-de-queijo', 'BISCOITO DE QUEIJO.jpeg', 49],
  ['mini-salgadinhos', 'MINI SALGADINHOS.jpeg', 30],
  ['biscoitao', 'BISCOITÃO.jpeg', 51],
  ['donuts', 'DONUTS.jpeg', 10],
  ['sonho', 'SONHO.jpeg', 26],
  ['pao-de-queijo', 'PAO DE QUEIJO.jpeg', 4],
  ['pao-frances', 'PÃO FRANCES.jpeg', 2],
  ['rosca-creme', 'ROSCA CREME.jpeg', null],
  ['rosca-rondant', 'ROSCA RONDANT.jpeg', null],
  ['biscoito-frito', 'BISCOITO FRITO.jpeg', 12],
  ['pedaco-de-cenoura', 'PEDAÇO DE CENOURA.jpeg', 63],
  ['bolo-mesclado', 'BOLO MESCLADO.jpeg', null],
  ['bolo-de-churros', 'BOLO DE CHURROS.jpeg', null],
  ['bolo-de-laranja', 'BOLO DE LARANJA.jpeg', null],
  ['bolo-de-queijo', 'BOLO DE QUEIJO QUEIJO.jpeg', null],
  ['rosca-de-creme-com-coco', 'ROSCA DE CREME COM CÔCO.jpeg', null],
  ['rosquinha-de-queijo', 'ROSQUINHA DE QUEIJO.jpeg', 24],
  ['bolo-de-chocolate', 'BOLO DE CHOCOLATE.jpeg', null],
  ['pamonha-assada', 'PAMONHA ASSADA.jpeg', null],
  ['bolo-de-cenoura-com-chocolate', 'BOLO DE CENOURA COM CHOCOLATE.jpeg', null],
  ['pao-de-batata', 'PAO DE BATATA.jpeg', 3],
  ['biscoito-da-vovo', 'BISCOITO DA VOVO.jpeg', 15],
  ['biscoito-de-nata', 'BISCOITO DE NATA.jpeg', 65],
  ['cookies', 'COOKIES.jpeg', 23],
  ['mini-donuts', 'MINI DONUTS.jpeg', 9],
  ['rosca-frita', 'ROSCA FRITA.jpeg', null],
].map(([slug, originalFile, sourceRow]) => ({
  slug, originalFile, sourceRow,
  productId: sourceRow === null ? null : `20260924-0000-4000-8000-${sourceRow.toString(16).padStart(12, '0')}`,
  image: `assets/products/oficiais/${slug}.jpeg`,
}));

const byId = new Map(officialPhotos.filter(photo => photo.productId).map(photo => [photo.productId, photo.image]));

export function resolveProductPhoto(id, existingImage) {
  // Keep operator-managed photos authoritative. Match IDs, never fuzzy names.
  return existingImage || byId.get(id) || null;
}

export function withOfficialProductPhoto(product) {
  return { ...product, image: resolveProductPhoto(product.id, product.image) };
}
