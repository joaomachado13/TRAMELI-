import assert from 'node:assert/strict';
import { PaymentsApi } from '../src/payments-api.js';

const customerQueries = [
  'trameli_payment_balances',
  'trameli_upcoming_recurring_orders',
  'trameli_payment_statement',
  'trameli_payment_intents',
];
const operatorQueries = [
  ...customerQueries,
  'trameli_payments',
  'trameli_payment_allocations',
  'trameli_profiles',
  'trameli_payment_receipts',
];

function mockLive(operator, requests, gate) {
  const request = name => {
    requests.push(name);
    return gate.then(() => ({ data: [], error: null }));
  };
  const query = name => ({
    select() { return this; },
    order() { return this; },
    limit() { return this; },
    range() { return request(name); },
    then(resolve, reject) { return request(name).then(resolve, reject); },
  });
  return {
    operator,
    client: {
      rpc(name) { return request(name); },
      from(name) { return query(name); },
    },
  };
}

const originalWindow = globalThis.window;
const events = [];
globalThis.window = { dispatchEvent(event) { events.push(event.type); } };

try {
  for (const operator of [false, true]) {
    const requests = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const api = new PaymentsApi(mockLive(operator, requests, gate));
    const first = api.load();
    // Promise.all registra os builders thenable do Supabase em uma microtask.
    await new Promise(resolve => setImmediate(resolve));
    const expected = operator ? operatorQueries : customerQueries;
    assert.deepEqual([...requests].sort(), [...expected].sort(),
      'Todas as consultas independentes precisam iniciar antes de a primeira terminar.');
    const second = api.load();
    assert.equal(requests.length, expected.length,
      'Chamadas concorrentes nao devem repetir as consultas em andamento.');
    release();
    await Promise.all([first, second]);
    assert.equal(api.ready, true);
    assert.equal(api.error, '');
    assert.equal(api.balances.length, 0);
    assert.equal(api.intents.length, 0);

    const count = requests.length;
    await api.load(true);
    assert.equal(requests.length, count + expected.length,
      'Atualizacao forcada depois de pagamento deve buscar dados novos.');
  }
  assert.deepEqual(events, ['trameli:payments-changed', 'trameli:payments-changed'],
    'Snapshots iguais nao devem provocar redraws redundantes.');
  console.log('Pagamentos: consultas paralelas, modo cliente/operacao, single-flight, force e snapshot OK.');
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
