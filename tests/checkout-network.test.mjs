import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkoutIsOffline, checkoutConnectionMessage } from '../src/checkout-network.js';

assert.equal(checkoutIsOffline({ onLine: false }), true);
assert.equal(checkoutIsOffline({ onLine: true }), false);
assert.equal(checkoutIsOffline({}), false);
assert.match(checkoutConnectionMessage(null, { offline: true }), /Sem conexão/);
assert.match(checkoutConnectionMessage(new TypeError('Failed to fetch')), /pode ter sido registrado/);
assert.match(checkoutConnectionMessage({ code: 'ETIMEDOUT' }, { weekly: true }), /Alguns dias podem ter sido registrados/);
assert.match(checkoutConnectionMessage({ message: 'Load failed' }), /Confira Meus pedidos/);
assert.match(checkoutConnectionMessage({ message: 'Você já tem um pedido para essa data' }), /Você já tem um pedido/);
const portal = await readFile(new URL('../assets/portal.js', import.meta.url), 'utf8');
assert.match(portal, /checkoutIsOffline\(navigator\)/);
assert.equal((portal.match(/checkoutConnectionMessage\(cause/g) || []).length, 2);
assert.match(portal, /sessionStorage\.getItem\(requestKey\)/);
assert.match(portal, /weeklyRequestIds\[day\.date\] \|\|= crypto\.randomUUID\(\)/);
assert.match(portal, /checkoutRequestId = crypto\.randomUUID\(\);[\s\S]*?view = 'success'/);
console.log('Checkout mobile: offline, falha ambigua, regras de negocio e chaves idempotentes preservadas OK.');
