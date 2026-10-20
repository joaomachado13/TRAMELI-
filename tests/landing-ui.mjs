import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { browserPath, headlessFlags } from './browser-path.mjs';

const baseUrl = process.env.TRAMELI_TEST_URL;
if (!baseUrl?.startsWith('http://127.0.0.1:')) throw new Error('Provide a local preview URL in TRAMELI_TEST_URL.');
const profile = await mkdtemp(join(tmpdir(), 'trameli-landing-'));
const port = 9392;
const browser = spawn(browserPath(), [...headlessFlags, `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, baseUrl], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(done => setTimeout(done, ms));
let socket;

try {
  let page;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(tab => tab.type === 'page'); } catch { /* Starting. */ }
    if (page) break;
    await pause(100);
  }
  assert.ok(page, 'Browser did not start');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  let sequence = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
    const id = sequence++;
    pending.set(id, { resolve: resolveSend, reject: rejectSend });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    assert.fail(`Condition not reached: ${expression}`);
  };

  const htmlResponse = await fetch(baseUrl);
  assert.ok(htmlResponse.ok, 'A página raiz não respondeu.');
  const initialHtml = await htmlResponse.text();
  assert.match(initialHtml, /<body class="app-booting">/, 'O HTML não começa em estado protegido.');
  assert.match(initialHtml, /<div class="app-shell" hidden>/, 'O painel interno não começa oculto.');
  const initialCss = await readFile(new URL('../assets/identity.css', import.meta.url), 'utf8');
  assert.match(initialCss, /body\.app-booting::before/, 'A tela neutra de inicialização não está definida.');
  assert.match(initialCss, /body\.app-booting #smooth-wrapper/, 'A operação não está protegida contra flash.');

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await until('location.hash === "#loja" && !document.querySelector("#portal-view").hidden && !!document.querySelector(".portal-welcome") && !document.body.classList.contains("app-booting")');
  assert.equal(await evaluate('document.body.classList.contains("app-booting")'), false, 'A tela de carregamento não foi removida.');
  assert.equal(await evaluate('document.body.classList.contains("portal-mode")'), true, 'A rota raiz não ativou o portal.');
  assert.equal(await evaluate('document.querySelector(".app-shell").hidden'), true, 'A operação ficou visível na entrada.');
  assert.ok(await evaluate('document.querySelector(".nav").getBoundingClientRect().right <= 0'), 'A sidebar ficou visível no portal do cliente.');
  assert.ok((await evaluate('document.title')).startsWith('Peça para amanhã'), 'O título inicial não corresponde ao portal.');
  
  await evaluate('location.hash = "#operacao"');
  await until('location.hash === "#operacao" && !document.querySelector(".app-shell").hidden && !document.querySelector("#operation-view").hidden');
  assert.equal(await evaluate('document.body.classList.contains("portal-mode")'), false, 'A rota da operação deixou o modo portal ativo.');

  await evaluate('window.scrollTo(0, 600); document.querySelector(\'.nav__item[href="#portal-shirley"]\').click()');
  await until('!document.querySelector("#shirley-portal-view").hidden && (!document.querySelector(".route-transition") || document.querySelector(".route-transition").hidden)');
  assert.equal(await evaluate('document.body.classList.contains("portal-mode")'), false, 'Shirley deve abrir como página interna.');
  assert.equal(await evaluate('document.querySelector(".app-shell").hidden'), false);
  assert.equal(await evaluate('!!document.querySelector("#shirley-portal-view").closest(".app-shell")'), true);
  assert.equal(await evaluate('document.querySelector("#main-navigation-panel").inert'), false);
  assert.equal(await evaluate('document.querySelector(\'.nav__item[href="#portal-shirley"]\').getAttribute("aria-current")'), 'page');
  assert.ok(await evaluate('document.querySelector(".nav").getBoundingClientRect().right > 0'), 'Sidebar deve continuar visível.');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Portal da Shirley não deve criar rolagem horizontal.');
  await evaluate('document.querySelector(\'.nav__item[href="#clientes"]\').click()');
  await until('!document.querySelector("#screen-view").hidden && document.querySelector("#shirley-portal-view").hidden');
  await evaluate('document.querySelector(\'.nav__item[href="#portal-shirley"]\').click()');
  await until('!document.querySelector("#shirley-portal-view").hidden && (!document.querySelector(".route-transition") || document.querySelector(".route-transition").hidden)');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Portal da Shirley não deve transbordar no celular.');
  await evaluate('document.querySelector(".mobile-menu-button").click()');
  await until('document.body.classList.contains("menu-open") && !document.querySelector("#main-navigation-panel").inert');
  await evaluate('document.querySelector(\'.nav__item[href="#operacao"]\').click()');
  await until('!document.querySelector("#operation-view").hidden && !document.body.classList.contains("menu-open")');
  
  await evaluate('location.hash = "#loja"');
  await until('!document.querySelector("#portal-view").hidden && !!document.querySelector(".portal-welcome")');
  assert.equal(await evaluate('document.querySelector(".app-shell").hidden'), true);
  console.log('Navegação: entrada pública, Portal da Shirley dentro do painel, sidebar desktop e menu mobile OK.');

  await send('Page.navigate', { url: new URL('tests/shirley-fixture.html', baseUrl).href });
  await until('window.shirleyReady === true');
  assert.match(await evaluate('document.querySelector("#shirley-order-total").textContent'), /0,00/);
  await evaluate(`(() => {
    const search = document.querySelector('#shirley-customer-search');
    search.value = 'Cliente'; search.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-customer-id="cliente-teste"]').click();
    document.querySelector('#shirley-delivery-date').value = '2026-10-21';
    for (let i = 0; i < 3; i++) document.querySelector('[data-product-id="pao-teste"][data-product-step="1"]').click();
  })()`);
  assert.match(await evaluate('document.querySelector("#shirley-order-total").textContent'), /5,00/, 'Três unidades de R$ 1,00 mais taxa devem totalizar R$ 5,00.');
  await evaluate(`(() => {
    for (let i = 0; i < 3; i++) document.querySelector('[data-product-id="queijo-teste"][data-product-step="1"]').click();
  })()`);
  assert.match(await evaluate('document.querySelector("#shirley-order-total").textContent'), /6,50/, '150 g a R$ 10/kg somam R$ 1,50 à compra.');
  await evaluate('document.querySelector("#shirley-order-form").requestSubmit()');
  await until('window.shirleySaved.length === 1 && !document.querySelector(\'[data-shirley-panel="orders"]\').hidden');
  assert.equal(await evaluate('TrameliOrderMath.totalCents(shirleySaved[0].order)'), 650);
  assert.equal(await evaluate('shirleySaved[0].customerId'), 'cliente-teste');
  assert.equal(await evaluate('shirleySaved[0].order.items[0].quantity'), 3);
  assert.equal(await evaluate('shirleySaved[0].order.items[1].weightGrams'), 150);
  assert.match(await evaluate('document.querySelector("#shirley-orders-list").textContent'), /6,50/);
  console.log('Portal da Shirley: quantidades, peso, taxa, seleção de cliente e lançamento com resumo consistente OK.');
} finally {
  socket?.close();
  browser.kill();
  await pause(250);
  const root = resolve(tmpdir()) + sep;
  if (resolve(profile).startsWith(root) && profile.includes('trameli-landing-')) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
