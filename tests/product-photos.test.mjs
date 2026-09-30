import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { officialPhotos, resolveProductPhoto, withOfficialProductPhoto } from '../src/product-photos.js';

const { products } = JSON.parse(await readFile(new URL('../data/client-products.json', import.meta.url), 'utf8'));
assert.equal(officialPhotos.length, 30);
assert.equal(new Set(officialPhotos.map(photo => photo.image)).size, 30);
assert.equal(officialPhotos.filter(photo => photo.productId).length, 16);
for (const photo of officialPhotos) {
  const image = await readFile(new URL(`../${photo.image}`, import.meta.url));
  assert.equal(image.subarray(0, 2).toString('hex'), 'ffd8', photo.originalFile);
  if (!photo.productId) continue;
  const product = products.find(item => item.id === photo.productId);
  assert.ok(product, photo.originalFile);
  assert.equal(product.sourceRow, photo.sourceRow);
  assert.deepEqual(withOfficialProductPhoto(product), { ...product, image: photo.image });
  assert.equal(resolveProductPhoto(product.id, '/custom-photo.jpeg'), '/custom-photo.jpeg');
}
assert.equal(resolveProductPhoto('unknown-id', null), null);
assert.equal(withOfficialProductPhoto({ id: 'unknown-id', name: 'Pão francês' }).image, null);
const original = products[0];
withOfficialProductPhoto(original);
assert.equal(original.image, null, 'Photo enrichment must not mutate source data');
console.log('Fotos oficiais: 30 arquivos, 16 associações exatas, preços e fotos personalizadas preservados.');
