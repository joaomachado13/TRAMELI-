import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = await mkdtemp(join(tmpdir(), 'trameli-smoke-'));
const pageUrl = new URL('../index.html#inicio', import.meta.url).href;
const screenshotPath = new URL('../assets/crops/refined-home-390x844.png', import.meta.url);
const ordersScreenshotPath = new URL('../assets/crops/orders-empty-390x844.png', import.meta.url);
const port = 9338;
const browser = spawn(edgePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, pageUrl,
], { windowsHide: true, stdio: 'ignore' });

const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
let socket;

try {
  let page;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const tabs = await response.json();
      page = tabs.find(tab => tab.type === 'page' && tab.url.startsWith('file:///'));
      if (page) break;
    } catch { /* Browser is starting. */ }
    await pause(100);
  }
  if (!page) throw new Error('O navegador de teste não abriu a página.');

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });

  const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
    const id = nextId++;
    pending.set(id, { resolve: resolveSend, reject: rejectSend });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (let attempt = 0; attempt < 40 && !(await evaluate('document.readyState === "complete" && innerWidth === 390')); attempt++) await pause(100);
  const dimensions = await evaluate('({ viewport: innerWidth, document: document.documentElement.scrollWidth })');
  assert(dimensions.viewport === 390, `Viewport inesperado: ${dimensions.viewport}`);
  assert(dimensions.document <= 390, `Rolagem horizontal indesejada: ${dimensions.document}`);
  assert(await evaluate('typeof window.gsap === "object"'), 'GSAP local não carregou.');

  await evaluate('document.querySelector(".mobile-menu-button").click()');
  assert(await evaluate('document.body.classList.contains("menu-open")'), 'Menu móvel não abriu.');
  await evaluate(`document.querySelector('.nav__item[href="#pedidos"]').click()`);
  await pause(350);
  assert(await evaluate('location.hash === "#pedidos" && !document.body.classList.contains("menu-open")'), 'Navegação móvel não abriu Pedidos ou não fechou o menu.');
  assert(await evaluate('!document.querySelector("#screen-view").hidden'), 'Tela de pedidos não apareceu.');
  assert(await evaluate('document.querySelector(".screen-empty").textContent.includes("Nenhum pedido")'), 'Pedidos não começou vazio.');
  await mkdir(new URL('../assets/crops/', import.meta.url), { recursive: true });
  const ordersImage = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(ordersScreenshotPath, Buffer.from(ordersImage.data, 'base64'));

  await evaluate('document.querySelector(\'.nav__item[href="#configuracoes"]\').click()');
  await pause(350);
  assert(await evaluate('!!document.querySelector(".motion-toggle")'), 'Controle de movimento não apareceu.');
  await evaluate('document.querySelector(".motion-toggle").click()');
  assert(await evaluate('document.body.classList.contains("motion-off")'), 'Movimento não foi desativado.');
  assert(await evaluate('document.querySelector(".motion-toggle").getAttribute("aria-pressed") === "false"'), 'Estado do controle de movimento incorreto.');

  await evaluate(`document.querySelector('.nav__item[href="#inicio"]').click()`);
  await pause(350);
  assert(await evaluate('document.querySelector("#home-order-count").textContent === "0"'), 'Visão geral não começou zerada.');
  assert(await evaluate('!document.querySelector("#home-orders-empty").hidden'), 'Estado vazio da visão geral não apareceu.');

  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'));
  process.stdout.write('OK: 390px sem corte horizontal; GSAP, menu, rotas, movimento e telas vazias funcionam.\n');
} finally {
  socket?.close();
  browser.kill();
  await pause(200);
  const root = resolve(tmpdir()) + sep;
  if (resolve(profile).startsWith(root)) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
