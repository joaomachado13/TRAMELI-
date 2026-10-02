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

const catalogPhotos = new Map([
  ['20260924-0000-4000-8000-000000000014', 'assets/products/mussarela.webp'],
  ['20260924-0000-4000-8000-000000000015', 'assets/products/presunto.webp'],
  ['20260924-0000-4000-8000-000000000016', 'assets/products/catalogo/mortadela-defumada.png'],
  ['20260924-0000-4000-8000-000000000021', 'assets/products/catalogo/manteiga-taquari-200g.png'],
  ['20260924-0000-4000-8000-000000000022', 'assets/products/catalogo/manteiga-calu-200g.jpg'],
  ['20260924-0000-4000-8000-000000000023', 'assets/products/catalogo/manteiga-aralat.png'],
  ['20260924-0000-4000-8000-000000000024', 'assets/products/catalogo/manteiga-italac-200g.jpg'],
  ['20260924-0000-4000-8000-000000000025', 'assets/products/catalogo/manteiga-tourinho-200g.jpg'],
  ['20260924-0000-4000-8000-000000000026', 'assets/products/catalogo/manteiga-canto-de-minas-200g.jpg'],
  ['20260924-0000-4000-8000-000000000029', 'assets/products/catalogo/suco-kapo-200ml.jpg'],
  ['20260924-0000-4000-8000-00000000002e', 'assets/products/catalogo/suco-prats-900ml.jpg'],
  ['20260924-0000-4000-8000-000000000030', 'assets/products/catalogo/peito-de-peru.png'],
  ['20260924-0000-4000-8000-000000000039', 'assets/products/catalogo/cafe-cajuba-500g.jpg'],
  ['20260924-0000-4000-8000-00000000003b', 'assets/products/catalogo/ovos.png'],
  ['20260924-0000-4000-8000-00000000003c', 'assets/products/catalogo/ovos.png'],
  ['20260924-0000-4000-8000-00000000003d', 'assets/products/catalogo/cafe-cajuba-250g.jpg'],
  ['20260924-0000-4000-8000-000000000042', 'assets/products/catalogo/coca-cola-2l.jpg'],
  ['20260924-0000-4000-8000-000000000044', 'assets/products/catalogo/manteiga-taquari-500g.webp'],
  ['20260924-0000-4000-8000-000000000045', 'assets/products/catalogo/del-valle-1l.png'],
  ['20260924-0000-4000-8000-000000000046', 'assets/products/catalogo/manteiga-calu-500g.jpg'],
  ['20260924-0000-4000-8000-000000000049', 'assets/products/catalogo/toddy.jpeg'],
  ['20260924-0000-4000-8000-00000000004b', 'assets/products/catalogo/nescau.jpg'],
  ['20260924-0000-4000-8000-00000000004c', 'assets/products/catalogo/margarina-qualy-500g.png'],
  ['20260924-0000-4000-8000-00000000004d', 'assets/products/catalogo/margarina-qualy-250g.png'],
]);

export function resolveProductPhoto(id, existingImage) {
  // Keep operator-managed photos authoritative. Match IDs, never fuzzy names.
  return existingImage || byId.get(id) || catalogPhotos.get(id) || null;
}

export function withOfficialProductPhoto(product) {
  return { ...product, image: resolveProductPhoto(product.id, product.image) };
}
