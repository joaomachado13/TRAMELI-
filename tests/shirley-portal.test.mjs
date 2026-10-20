import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [html, routes, operation, portal] = await Promise.all([
  read('../index.html'),
  read('../assets/screens.js'),
  read('../assets/operacao.js'),
  read('../assets/shirley-portal.js'),
]);

assert.match(html, /href="#portal-shirley"/, 'sidebar must link to the Shirley portal');
assert.match(html, /id="shirley-portal-view"/, 'the Shirley portal page must exist');
assert.match(html, /assets\/shirley-portal\.css/, 'the Shirley portal styles must be loaded');
assert.match(html, /id="shirley-customer-search"/, 'the portal must provide customer search');
assert.match(html, /id="shirley-product-search"/, 'the portal must provide product search');
assert.match(routes, /'portal-shirley'/, 'the route must be registered');
assert.match(operation, /location\.hash = '#portal-shirley'/, 'New order must open the full-page portal');
assert.match(portal, /saveOperatorOrder/, 'one-off orders must use the existing operator API');
assert.match(portal, /saveRecurringOrder/, 'recurrences must use the existing recurring-order API');
assert.match(portal, /materializeRecurringOrders/, 'recurring orders must use existing materialization rules');
assert.match(portal, /data-edit-order/, 'the order search must offer editing an existing order');

console.log('Portal da Shirley: estrutura, navegação e integrações principais verificadas.');
