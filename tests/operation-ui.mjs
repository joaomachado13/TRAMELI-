import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { browserPath, headlessFlags } from './browser-path.mjs';

const url = process.env.TRAMELI_TEST_URL;
if (!url?.startsWith('http://127.0.0.1:')) throw new Error('Provide a local Vite server in TRAMELI_TEST_URL.');
const profile = await mkdtemp(join(tmpdir(), 'trameli-operation-'));
const pageUrl = new URL('#operacao', url).href;
const shot = new URL('../assets/crops/operation-first-slice-390x844.png', import.meta.url);
const desktopShot = new URL('../assets/crops/operation-first-slice-1350x900.png', import.meta.url);
const catalogShot = new URL('../assets/crops/catalog-first-item-390x844.png', import.meta.url);
const port = 9341;
const browser = spawn(browserPath(), [...headlessFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, pageUrl], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(done => setTimeout(done, ms));
let socket;

try {
  let page;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = tabs.find(tab => tab.type === 'page' && tab.url.startsWith(url));
      if (page) break;
    } catch { /* Starting. */ }
    await pause(100);
  }
  if (!page) throw new Error('Navegador de teste não abriu a operação.');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
  let id = 1;
  const tasks = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !tasks.has(message.id)) return;
    const task = tasks.get(message.id);
    tasks.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((done, fail) => { const current = id++; tasks.set(current, { resolve: done, reject: fail }); socket.send(JSON.stringify({ id: current, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (let attempt = 0; attempt < 60 && !(await evaluate('!!window.TrameliMenu && !!window.TrameliOperation')); attempt++) await pause(100);
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Rolagem horizontal no celular.');
  assert(await evaluate('document.querySelector("#main-navigation-panel").inert'), 'Menu móvel começou interativo enquanto fechado.');
  await evaluate('document.querySelector(".mobile-menu-button").click()');
  await pause(50);
  const mobileMenuState = await evaluate('({open:document.body.classList.contains("menu-open"),inert:document.querySelector("#main-navigation-panel").inert,expanded:document.querySelector(".mobile-menu-button").getAttribute("aria-expanded"),portal:document.body.classList.contains("portal-mode"),wide:matchMedia("(min-width: 1100px)").matches})');
  assert(mobileMenuState.open && !mobileMenuState.inert, `Menu móvel não abriu corretamente: ${JSON.stringify(mobileMenuState)}`);
  await evaluate('document.querySelector(".menu-overlay").click()');
  assert(await evaluate('document.querySelector("#total-orders").textContent === "0"'), 'O dia não começou vazio.');
  await evaluate('location.hash = "#produtos"');
  for (let attempt = 0; attempt < 40 && !(await evaluate('!!document.querySelector("[data-catalog-action=new]")')); attempt++) await pause(100);
  assert(await evaluate('!!document.querySelector("[data-catalog-action=new]")'), 'Catálogo não ficou disponível após abrir Produtos.');
  const initialProductCount = await evaluate('document.querySelectorAll(".catalog-card").length');
  await evaluate('document.querySelector("[data-catalog-action=new]").click()');
  assert(await evaluate('document.querySelector(".catalog-dialog").open'), 'Cadastro de produto não abriu.');
  await evaluate(`(() => { const f = document.querySelector('#catalog-form'); f.elements.name.value='Pão'; f.elements.price.value='4,50'; f.elements.unit.value='unidade'; f.requestSubmit(); })()`);
  assert(await evaluate(`document.querySelectorAll(".catalog-card").length === ${initialProductCount + 1}`), 'Produto não apareceu no catálogo.');
  await mkdir(new URL('../assets/crops/', import.meta.url), { recursive: true });
  const catalogImage = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(catalogShot, Buffer.from(catalogImage.data, 'base64'));
  await evaluate('location.hash = "#clientes"');
  await pause(350);
  await evaluate('document.querySelector("[data-client-action=new]").click()');
  assert(await evaluate('document.querySelector("#client-form").closest("dialog").open'), 'Cadastro de cliente não abriu.');
  await evaluate(`(() => { const f = document.querySelector('#client-form'); f.elements.name.value='Cliente Teste'; f.elements.address.value='Bloco A, ap. 10'; f.requestSubmit(); })()`);
  assert(await evaluate('document.querySelector(".client-row").textContent.includes("Cliente Teste")'), 'Cliente não apareceu no cadastro.');
  await evaluate('location.hash = "#operacao"');
  await pause(350);
  await evaluate('document.querySelector("#new-order").click()');
  assert(await evaluate('document.querySelector("#operation-dialog").open'), 'Formulário não abriu.');
  assert(await evaluate('!!document.querySelector("#catalog-products option[value=Pão]")'), 'Produto não ficou disponível no pedido.');
  await evaluate(`(() => { const f = document.querySelector('#order-form'); const d = new Date(); d.setDate(d.getDate() + 1); f.elements.date.value = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); f.elements.customer.value='Cliente Teste'; f.elements.customer.dispatchEvent(new Event('change', { bubbles: true })); const name = document.querySelector('.item-name'); name.value='Pão'; name.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('.item-quantity').value='3'; f.requestSubmit(); })()`);
  const createdOrderDate = await evaluate('document.querySelector("#delivery-date").value');
  assert(await evaluate('document.querySelectorAll(".kanban-column").length === 3'), 'Kanban não mostrou as três etapas operacionais.');
  await evaluate('document.querySelector(".order-card").click()');
  assert(await evaluate('document.querySelector("#order-detail-drawer").open && document.querySelector("#order-detail-content").textContent.includes("Bloco A, ap. 10")'), 'Detalhe lateral não mostrou o endereço reaproveitado.');
  assert(await evaluate('document.querySelector("#total-orders").textContent === "1"'), 'Pedido não foi salvo.');
  assert(await evaluate('document.querySelector("#grand-total").textContent.includes("15,50")'), 'Soma com taxa incorreta.');
  assert(await evaluate('document.querySelector("#pending-orders").textContent === "1"'), 'Conferência inicial incorreta.');
  await evaluate('document.querySelector("#order-detail-drawer [data-action=toggle]").click()');
  assert(await evaluate('document.querySelector("#pending-orders").textContent === "0"'), 'Conferência não atualizou.');
  await evaluate('document.querySelector("#order-detail-drawer [data-action=edit]").click()');
  await evaluate(`(() => { document.querySelector('.item-quantity').value='4'; document.querySelector('#order-form').requestSubmit(); })()`);
  assert(await evaluate('document.querySelector("#grand-total").textContent.includes("20,00")'), 'Edição não recalculou.');
  assert(await evaluate('window.TrameliOperation.preparePrint() && document.querySelectorAll(".print-label").length === 1'), 'Ficha de impressão não foi criada.');
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  assert(await evaluate('getComputedStyle(document.querySelector(".nav")).display === "none" && getComputedStyle(document.querySelector("#print-document")).display === "block"'), 'Layout de impressão integrado não isolou as fichas.');
  await send('Emulation.setEmulatedMedia', { media: 'screen' });
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(shot, Buffer.from(image.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 1350, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(180);
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Rolagem horizontal no desktop.');
  assert(await evaluate('!document.querySelector("#main-navigation-panel").inert && getComputedStyle(document.querySelector(".mobile-menu-button")).display === "none"'), 'Sidebar desktop não permaneceu acessível e visível.');
  const desktopImage = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(desktopShot, Buffer.from(desktopImage.data, 'base64'));
  await send('Page.reload');
  for (let attempt = 0; attempt < 60 && !(await evaluate('document.readyState === "complete" && !!window.TrameliOperation')); attempt++) await pause(100);
  await evaluate(`(() => { const input = document.querySelector('#delivery-date'); input.value = '${createdOrderDate}'; input.dispatchEvent(new Event('change')); })()`);
  assert(await evaluate('document.querySelector("#total-orders").textContent === "1"'), 'Pedido não persistiu após recarga.');
  await evaluate('localStorage.setItem("trameli-operation-draft-v1", "dados-antigos")');
  await send('Page.reload');
  for (let attempt = 0; attempt < 60 && !(await evaluate('document.readyState === "complete" && !!window.TrameliOperation')); attempt++) await pause(100);
  assert(await evaluate('localStorage.getItem("trameli-operation-draft-v1") === null'), 'Dados antigos não foram apagados.');
  process.stdout.write('Operação diária: Kanban, detalhe lateral, conferência, edição, impressão, persistência e layouts 390/1350px OK.\n');
} finally {
  socket?.close();
  browser.kill();
  await new Promise(resolveExit => {
    if (browser.exitCode !== null) return resolveExit();
    browser.once('exit', resolveExit);
    setTimeout(resolveExit, 1200);
  });
  const root = resolve(tmpdir()) + sep;
  if (resolve(profile).startsWith(root)) await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }).catch(() => {});
}
