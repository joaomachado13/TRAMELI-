import assert from 'node:assert/strict';
import { stages, statusPath, progressOrder } from '../src/operation-flow.js';

assert.equal(stages.length, 5);
assert.deepEqual(statusPath('received', 'ready', false), ['confirmed', 'packing', 'ready']);
assert.deepEqual(statusPath('ready', 'received', true), ['packing', 'confirmed', 'received']);
assert.deepEqual(statusPath('ready', 'packing', false), []);
assert.deepEqual(statusPath('delivered', 'received', true), []);
assert.deepEqual(statusPath('cancelled', 'packing', true), []);
assert.deepEqual(statusPath('confirmed', 'confirmed', true), []);

let current = { id: 'a', status: 'received', version: 7 };
const requests = [];
await progressOrder(current, 'delivered', {
  master: false,
  setStatus: async (order, status) => {
    requests.push([order.version, status]);
    current = { ...order, status, version: order.version + 1 };
  },
  getOrder: () => current,
});
assert.deepEqual(requests, [[7, 'confirmed'], [8, 'packing'], [9, 'ready'], [10, 'delivered']]);

current = { id: 'b', status: 'received', version: 1 };
const partial = [];
await assert.rejects(progressOrder(current, 'ready', {
  master: false,
  setStatus: async (order, status) => {
    partial.push(status);
    if (status === 'packing') throw new Error('connection lost');
    current = { ...order, status, version: order.version + 1 };
  },
  getOrder: () => current,
}), /connection lost/);
assert.equal(current.status, 'confirmed');
assert.deepEqual(partial, ['confirmed', 'packing']);

current = { id: 'c', status: 'received', version: 1 };
await assert.rejects(progressOrder(current, 'ready', {
  master: false,
  setStatus: async (order, status) => { current = { ...order, status, version: order.version + 2 }; },
  getOrder: () => current,
}), /atualizado durante/);
console.log('Movimentação: etapas, permissões, versões e falha parcial OK.');
