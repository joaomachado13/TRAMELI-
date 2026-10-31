import assert from 'node:assert/strict';
import { createMobileDiagnostics, installMobileDiagnostics } from '../src/mobile-diagnostics.js';

function fakeWindow(search = '') {
  const listeners = new Map();
  const win = {
    location: { search },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    fire(name, payload = {}) { listeners.get(name)?.(payload); },
    listeners,
  };
  return win;
}

const win = fakeWindow('?mobile-diagnostics=1');
const inactive = fakeWindow();
assert.equal(installMobileDiagnostics({ win: inactive }), null);
assert.equal(inactive.TrameliMobileDiagnostics, undefined);
assert.equal(inactive.listeners.size, 0, 'Sem opt-in nao instala listeners.');

const diagnostic = installMobileDiagnostics({ win, perf: { now: () => 350.25 } });
assert.ok(diagnostic);
win.fire('error', { message: 'segredo', filename: '/cliente/123', error: { stack: 'private' } });
win.fire('unhandledrejection', { reason: { token: 'private' } });
win.fire('offline');
win.fire('online');
diagnostic.bootReady();
let result = win.TrameliMobileDiagnostics.snapshot();
assert.deepEqual(result.events.map(item => item.type),
  ['script-error', 'promise-rejection', 'offline', 'online', 'boot-ready']);
assert.equal(result.events.at(-1).durationMs, 350);
assert.ok(!JSON.stringify(result).includes('segredo'));
assert.ok(!JSON.stringify(result).includes('private'));
assert.ok(!JSON.stringify(result).includes('cliente'));
result.events[0].type = 'tampered';
assert.equal(diagnostic.snapshot().events[0].type, 'script-error', 'Snapshot nao altera memoria interna.');
diagnostic.stop();
win.fire('error');
assert.equal(diagnostic.snapshot().counters['script-error'], 1);
assert.equal(win.listeners.size, 0);

const bounded = createMobileDiagnostics({ win: fakeWindow(), perf: { now: () => 90000 } });
bounded.start();
for (let i = 0; i < 45; i++) bounded.bootReady();
result = bounded.snapshot();
assert.equal(result.events.length, 30, 'Limite de eventos em memoria.');
assert.equal(result.counters['boot-ready'], 45);
assert.equal(result.events[0].durationMs, 60000);
bounded.stop();
console.log('Diagnostico mobile: opt-in, memoria limitada, sem dados sensiveis, parada e tempos OK.');
