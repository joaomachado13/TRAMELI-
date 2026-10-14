import assert from 'node:assert/strict';
import { isDeliveryDate, nextAvailableDeliveryDate, rollingDeliveryWeek } from '../src/delivery-days.js';

assert.equal(isDeliveryDate('2026-10-18'), false, 'Domingo não é um dia de entrega.');
assert.equal(isDeliveryDate('2026-10-17'), true, 'Sábado continua disponível.');
assert.equal(isDeliveryDate('2026-02-30'), false, 'Data de calendário inválida é rejeitada.');
assert.equal(nextAvailableDeliveryDate('2026-10-17', false), '2026-10-19', 'Sábado antes do corte avança para segunda.');
assert.equal(nextAvailableDeliveryDate('2026-10-17', true), '2026-10-19', 'Sábado depois do corte avança para segunda.');
assert.equal(nextAvailableDeliveryDate('2026-10-16', true), '2026-10-19', 'Sexta após o corte pula o domingo.');
assert.equal(nextAvailableDeliveryDate('2026-10-18', false), '2026-10-19', 'No domingo, a próxima entrega é segunda.');
assert.deepEqual(rollingDeliveryWeek('2026-10-16', 7), [
  '2026-10-16', '2026-10-17', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
]);
assert.deepEqual(rollingDeliveryWeek('2026-10-17', 7), [
  '2026-10-17', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24',
]);
assert.deepEqual(rollingDeliveryWeek('2026-10-19', 7), [
  '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-26',
]);
console.log('Calendário de entregas: domingos ocultos e próximo dia válido OK.');
