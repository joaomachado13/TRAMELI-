import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserPath, headlessFlags } from './browser-path.mjs';

// Run against an isolated, local-mode preview build: TRAMELI_TEST_URL=http://127.0.0.1:4183/ node tests/motion-ui.mjs
const url = process.env.TRAMELI_TEST_URL;
if (!url?.startsWith('http://127.0.0.1:')) throw new Error('Provide a localhost preview URL in TRAMELI_TEST_URL.');
const profile = await mkdtemp(join(tmpdir(), 'trameli-motion-'));
const port = 9367;
const browser = spawn(browserPath(), [...headlessFlags, '--force-prefers-reduced-motion=no-preference',
  // CI Linux has no physical mouse; make this desktop scenario explicit.
  '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `${url}#operacao`], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(done => setTimeout(done, ms));
let socket;
try {
  let page;
  for (let attempt = 0; attempt < 70; attempt++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(tab => tab.type === 'page' && tab.url.startsWith(url));
      if (page) break;
    } catch { /* Browser still starting. */ }
    await pause(100);
  }
  assert.ok(page, 'Edge did not open the local preview');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = serial++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitTransition = async () => {
    await pause(40);
    for (let i = 0; i < 60 && !(await evaluate('!document.querySelector(".route-transition") || document.querySelector(".route-transition").hidden')); i++) await pause(50);
    assert.ok(await evaluate('!document.querySelector(".route-transition") || document.querySelector(".route-transition").hidden'), 'Transition did not finish');
  };
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('matchMedia("(hover: hover) and (pointer: fine)").matches'), true, 'Desktop mouse emulation is missing');
  for (let i = 0; i < 60 && !(await evaluate('!!window.TrameliMotion && !!document.querySelector("#delivery-date").value')); i++) await pause(100);
  for (let i = 0; i < 60 && !(await evaluate('window.TrameliMotion.active()')); i++) await pause(100);
  assert.equal(await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), false);
  assert.equal(await evaluate('window.TrameliMotion.active()'), true, 'Desktop smoothing did not start');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#smooth-wrapper")).position'), 'fixed');
  await pause(700);
  await send('Input.dispatchMouseEvent', { type:'mouseWheel', x:900, y:700, deltaX:0, deltaY:600 });
  await pause(120);
  const midScroll = await evaluate('({native:scrollY,visual:window.TrameliMotion.scrollTop()})');
  assert.ok(midScroll.visual > 0 && midScroll.visual < midScroll.native - 1, `Scroll did not interpolate between positions: ${JSON.stringify(midScroll)}`);
  await pause(650);
  assert.ok(await evaluate('Math.abs(window.TrameliMotion.scrollTop() - scrollY) < 2'), 'Scroll did not settle');
  assert.ok(await evaluate('document.querySelector(".nav2").getBoundingClientRect().bottom < 0'), 'Header remained fixed during scrolling');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav2")).position'), 'relative');
  assert.equal(await evaluate('document.querySelectorAll(".pin-spacer").length'), 0, 'Header kept a pin spacer');
  await evaluate('document.querySelector("#new-order").click()');
  await pause(150);
  const modalPosition = await evaluate('scrollY');
  await send('Input.dispatchMouseEvent', { type:'mouseWheel', x:20, y:800, deltaX:0, deltaY:300 });
  await pause(120);
  assert.equal(await evaluate('scrollY'), modalPosition, 'Background scrolled behind a modal');
  await evaluate('document.querySelector("#close-dialog").click()');

  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector("#main-navigation-panel").click()');
  await evaluate('document.querySelector(".nav__close").click()');
  assert.ok(await evaluate('document.body.classList.contains("sidebar-collapsed")'), 'Collapse button reopened the sidebar');
  await mkdir(new URL('../assets/crops/', import.meta.url), { recursive: true });
  for (const [route, style] of [['inicio','curve'],['clientes','swipe'],['relatorios','diagonal'],['agenda','wave']]) {
    await evaluate(`document.querySelector('.nav__item[href="#${route}"] .ico').click()`);
    await pause(160);
    assert.ok(await evaluate('document.body.classList.contains("sidebar-collapsed")'), 'Navigation icon expanded the sidebar during the transition');
    assert.equal(await evaluate('document.querySelector(".route-transition").hidden'), false, 'Swipe did not appear');
    assert.equal(await evaluate('document.querySelector(".route-transition").dataset.style'), style);
    const firstShape = await evaluate('document.querySelector(".route-transition__front").getAttribute("d")');
    await pause(100);
    assert.notEqual(await evaluate('document.querySelector(".route-transition__front").getAttribute("d")'), firstShape, 'MorphSVG did not animate the path');
    const image = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
    await writeFile(new URL(`../assets/crops/transition-${style}.png`, import.meta.url), Buffer.from(image.data,'base64'));
    await waitTransition();
    assert.equal(await evaluate('document.querySelector(".route-transition").hidden'), true, 'Swipe remained over the content');
    assert.ok(await evaluate('document.body.classList.contains("sidebar-collapsed")'), 'Navigation changed the collapsed sidebar preference');
  }
  await evaluate('document.querySelector("#main-navigation-panel").click()');
  assert.ok(await evaluate('!document.body.classList.contains("sidebar-collapsed")'), 'Empty sidebar area did not expand the menu');
  await evaluate('location.hash="#clientes"'); await pause(50);
  await evaluate('location.hash="#produtos"'); await pause(30);
  await evaluate('location.hash="#agenda"'); await waitTransition();
  assert.equal(await evaluate('document.querySelector("#screen-view h1").textContent'), 'Agenda', 'Rapid navigation rendered an older route');
  assert.equal(await evaluate('document.querySelector(".route-transition").hidden'), true, 'Rapid navigation left a swipe visible');
  await evaluate('location.hash="#clientes"'); await pause(40);
  await evaluate('location.hash="#agenda"'); await waitTransition();
  assert.equal(await evaluate('document.querySelector("#screen-view h1").textContent'), 'Agenda', 'Returning to the current route did not cancel navigation');
  await evaluate('location.hash="#inicio"');
  await waitTransition();
  assert.equal(await evaluate('document.querySelector("#home-view").hidden'), false);
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#home-view")).transform'), 'none');
  assert.ok(await evaluate('document.querySelector(".orders-panel").getBoundingClientRect().width >= 650'), 'Orders panel is too narrow for its table');
  await evaluate(`document.querySelector('#home-recent-orders').innerHTML='<tr><td>—</td><td>Rosilena Benedita Alves Machado</td><td>01/10/2026</td><td>A conferir</td><td>R$ 69,48</td></tr>'`);
  assert.ok(await evaluate(`(() => { const cell = document.querySelector('#home-recent-orders td:nth-child(2)'); const range = document.createRange(); range.selectNodeContents(cell); return [...range.getClientRects()].every(rect => rect.right <= cell.getBoundingClientRect().right + 1); })()`), 'Customer name overlaps the delivery column');

  await evaluate('location.hash="#financeiro"');
  await waitTransition();
  assert.equal(await evaluate('document.querySelectorAll("[data-finance-days]").length'), 3);
  await evaluate(`document.querySelector('[data-finance-days="7"]').click()`);
  assert.equal(await evaluate('(Date.parse(document.querySelector("#finance-to").value)-Date.parse(document.querySelector("#finance-from").value))/86400000'), 6);
  await evaluate(`document.querySelector('[data-finance-days="15"]').click()`);
  assert.equal(await evaluate('(Date.parse(document.querySelector("#finance-to").value)-Date.parse(document.querySelector("#finance-from").value))/86400000'), 14);

  await evaluate('location.hash="#loja"');
  for (let i = 0; i < 40 && !(await evaluate('!!document.querySelector(".portal-welcome a")')); i++) await pause(100);
  await evaluate('document.querySelector(".portal-welcome a").click()');
  await pause(750);
  assert.equal(await evaluate('location.hash'), '#loja', 'Catalog CTA left the portal');
  assert.ok(await evaluate('scrollY > 200'), 'Catalog CTA did not scroll to products');
  await evaluate('document.querySelector(".portal-product .portal-stepper button:last-child").click()');
  assert.equal(await evaluate('document.querySelector("#portal-cart-count").textContent'), '1');
  for (let i = 0; i < 20 && !await evaluate('!!document.querySelector("#portal-floating-host .portal-catalog__footer")'); i++) await pause(50);
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#portal-floating-host .portal-catalog__footer")).position'), 'fixed');
  assert.equal(await evaluate('document.querySelector("#smooth-content").contains(document.querySelector("#portal-floating-host"))'), false);
  await evaluate('document.querySelector("#portal-floating-host button").click()');
  assert.ok(await evaluate('document.querySelector(".portal-cart-line")'), 'Floating cart did not open cart');
  await evaluate('document.querySelector("[data-view=checkout]").click()');
  await evaluate('document.querySelector("#portal-checkout-form [name=customer]").value="Nome em andamento";window.dispatchEvent(new Event("trameli:catalog-changed"))');
  assert.equal(await evaluate('document.querySelector("#portal-checkout-form [name=customer]").value'), 'Nome em andamento');

  await evaluate('location.hash="#configuracoes"');
  await waitTransition();
  await evaluate('document.querySelector(".motion-toggle").click()');
  assert.equal(await evaluate('document.body.classList.contains("motion-off")'), true, 'Reduced motion was not enabled');
  assert.equal(await evaluate('window.TrameliMotion.active()'), false, 'Reduced motion did not stop smoothing');
  await evaluate('location.hash="#clientes"'); await pause(60);
  assert.ok(await evaluate('!!document.querySelector(".record-list--clients")'), 'Reduced motion delayed navigation');
  assert.equal(await evaluate('document.querySelector(".route-transition").hidden'), true, 'Reduced motion retained a swipe');
  await evaluate('location.hash="#configuracoes"'); await pause(80);
  await evaluate('document.querySelector(".motion-toggle").click()');
  assert.equal(await evaluate('document.body.classList.contains("motion-off")'), false, 'Motion did not resume');
  assert.equal(await evaluate('window.TrameliMotion.active()'), true, 'Smoothing did not resume');
  await evaluate('window.dispatchEvent(new Event("beforeprint"))');
  assert.equal(await evaluate('window.TrameliMotion.active()'), false, 'Print should retain native scroll');
  await evaluate('window.dispatchEvent(new Event("afterprint"))');
  await pause(150);
  assert.equal(await evaluate('window.TrameliMotion.active()'), true, 'Smoothing did not resume after printing');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await pause(400);
  assert.equal(await evaluate('window.TrameliMotion.active()'), false, 'Touch-sized layout should use native scroll');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile horizontal overflow');
  await evaluate('location.hash="#loja"');
  await pause(250);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".portal-bottom-nav")).position'), 'fixed');
  assert.equal(await evaluate('document.querySelector(".portal-menu-button")'), null, 'Portal do cliente ainda exibiu o botão da sidebar administrativa.');
  assert.equal(await evaluate('document.body.classList.contains("menu-open")'), false, 'Portal abriu sidebar administrativa sem solicitação.');
  assert.equal(await evaluate('document.querySelector("#smooth-content").contains(document.querySelector(".nav"))'), false);
  console.log('ScrollSmoother, cabeçalho no fluxo da página, MorphSVG suave, modais, impressão, redução de movimento e toque nativo: OK');
} finally {
  socket?.close();
  browser.kill();
  await pause(200);
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(error => {
    if (error.code !== 'EBUSY') throw error;
  });
}
