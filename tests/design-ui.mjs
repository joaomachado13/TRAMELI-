import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { browserPath, headlessFlags } from './browser-path.mjs';

const url = process.env.TRAMELI_TEST_URL;
if (!url?.startsWith('http://127.0.0.1:')) throw new Error('Provide a local Vite server in TRAMELI_TEST_URL.');
const profile = await mkdtemp(join(tmpdir(), 'trameli-design-'));
const port = 9381;
const browser = spawn(browserPath(), [...headlessFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, new URL('#inicio', url).href], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(done => setTimeout(done, ms));
let socket;

try {
  let page;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(tab => tab.type === 'page' && tab.url.startsWith(url)); } catch { /* Starting. */ }
    if (page) break;
    await pause(100);
  }
  if (!page) throw new Error('Navegador de revisão visual não abriu.');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
  let id = 1;
  const tasks = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), task = tasks.get(message.id);
    if (!task) return;
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
  const waitFor = async selector => {
    for (let attempt = 0; attempt < 50 && !(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)); attempt++) await pause(100);
    assert(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `Tela não renderizou ${selector}.`);
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await waitFor('#home-view:not([hidden])');
  await evaluate(`(() => {
    const today = new Date();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const key = value => [value.getFullYear(), String(value.getMonth()+1).padStart(2,'0'), String(value.getDate()).padStart(2,'0')].join('-');
    const base = { createdAt:new Date().toISOString(), feeCents:200, paymentMethod:'pix_manual', address:'Rua das Flores, 120', phone:'34999999999' };
    localStorage.setItem('trameli-operation-draft-v2', JSON.stringify([
      {...base,id:'design-1',customer:'Ana Ferreira',date:key(today),status:'received',items:[{name:'Pão francês',quantity:5,priceCents:140}]},
      {...base,id:'design-2',customer:'João Lima',date:key(tomorrow),status:'confirmed',items:[{name:'Pão de queijo',quantity:3,priceCents:130}]},
      {...base,id:'design-3',customer:'Marina Costa',date:key(tomorrow),status:'delivered',items:[{name:'Rosca caseira',quantity:1,priceCents:1000}]}
    ]));
    dispatchEvent(new Event('trameli:orders-changed'));
  })()`);
  await pause(180);
  assert(await evaluate('getComputedStyle(document.body).backgroundColor === "rgb(244, 240, 231)"'), 'Canvas Master não usa o creme do design system.');
  assert(await evaluate('!document.querySelector("#main-navigation-panel").inert'), 'Sidebar desktop não está acessível.');
  assert(await evaluate('document.querySelector(".app-shell").getBoundingClientRect().left >= 250'), 'Conteúdo não respeita a sidebar desktop.');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Visão Geral criou rolagem horizontal.');
  assert(await evaluate('getComputedStyle(document.querySelector(".attention-strip__heading h2")).color !== "rgb(238, 232, 215)"'), 'Aviso principal permaneceu com baixo contraste.');

  const routes = [
    ['pedidos', '.orders-browser'],
    ['clientes', '.record-list--clients'],
    ['produtos', '.catalog-grid--compact'],
    ['agenda', '.agenda-calendar'],
    ['financeiro', '.finance-headline'],
    ['relatorios', '.report-generator'],
    ['configuracoes', '.settings-shell'],
    ['loja', '.portal-welcome'],
  ];
  await mkdir(new URL('../assets/crops/', import.meta.url), { recursive: true });
  for (const [route, selector] of routes) {
    await evaluate(`location.hash=${JSON.stringify(`#${route}`)}`);
    await waitFor(selector);
    await pause(80);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `${route} criou rolagem horizontal no desktop.`);
    if (['produtos', 'financeiro', 'loja'].includes(route)) {
      const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(new URL(`../assets/crops/design-${route}-1440.png`, import.meta.url), Buffer.from(image.data, 'base64'));
    }
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('location.hash="#produtos"');
  await waitFor('.product-insights');
  await pause(100);
  assert(await evaluate('getComputedStyle(document.querySelector(".product-insights")).gridTemplateColumns.split(" ").length === 2'), 'Indicadores de produto não mantiveram grade 2×2 no celular.');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Produtos criou rolagem horizontal no celular.');
  process.stdout.write('Design system: canvas, sidebar, contraste, oito rotas Master/Portal e responsividade 390/1440px OK.\n');
} finally {
  socket?.close();
  browser.kill();
  await pause(400);
  if (resolve(profile).startsWith(resolve(tmpdir()) + sep)) await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
