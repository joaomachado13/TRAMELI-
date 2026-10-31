import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/pwa.js', import.meta.url), 'utf8');
const original = {
  window: globalThis.window,
  document: globalThis.document,
  navigator: globalThis.navigator,
};
const nodes = [];
let attempts = 0;
const registration = { scope: '/' };
const serviceWorker = {
  register: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Falha temporaria do navegador');
    return registration;
  },
  ready: Promise.resolve(registration),
};
try {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serviceWorker },
  });
  globalThis.window = {
    location: { search: '' },
    isSecureContext: true,
  };
  globalThis.document = {
    head: { append(node) { nodes.push(node); } },
    querySelector(selector) {
      return nodes.find(node => selector.includes(node.rel || '__none__') && node.rel === 'manifest') || null;
    },
    createElement(tag) { return { tagName: tag }; },
  };
  const module = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));
  await assert.rejects(module.getPwaRegistration(), /Falha temporaria/);
  const recovered = await module.getPwaRegistration();
  assert.equal(recovered, registration);
  assert.equal(attempts, 2, 'O navegador deve poder repetir registro apos falha.');
  await module.getPwaRegistration();
  assert.equal(attempts, 2, 'Registro bem sucedido deve ser reutilizado.');
  assert.match(source, /isIOS\(\) && !standalone/, 'No iPhone nao solicitar push antes de abrir o PWA instalado.');
  assert.match(source, /Abra pelo ícone para liberar as notificações/);
  console.log('PWA Android/iOS: registro recuperavel e orientacao de push iOS OK.');
} finally {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[name];
    else Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
}
