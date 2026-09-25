import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run against an isolated, local-mode preview build: TRAMELI_TEST_URL=http://127.0.0.1:4183/ node tests/motion-ui.mjs
const url = process.env.TRAMELI_TEST_URL;
if (!url?.startsWith('http://127.0.0.1:')) throw new Error('Provide a localhost preview URL in TRAMELI_TEST_URL.');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = await mkdtemp(join(tmpdir(), 'trameli-motion-'));
const port = 9367;
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--force-prefers-reduced-motion=no-preference',
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
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 60 && !(await evaluate('!!window.TrameliMotion && !!document.querySelector("#delivery-date").value')); i++) await pause(100);
  assert.equal(await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), false);
  assert.equal(await evaluate('window.TrameliMotion.active()'), true, 'Desktop smooth scroll did not start');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#smooth-wrapper")).position'), 'fixed');
  await evaluate('window.scrollTo(0,600)');
  await pause(750);
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#smooth-content")).transform'), 'none');

  await evaluate('location.hash="#loja"');
  for (let i = 0; i < 40 && !(await evaluate('!!document.querySelector(".portal-hero a")')); i++) await pause(100);
  await evaluate('document.querySelector(".portal-hero a").click()');
  await pause(750);
  assert.equal(await evaluate('location.hash'), '#loja', 'Catalog CTA left the portal');
  assert.ok(await evaluate('scrollY > 200'), 'Catalog CTA did not scroll to products');
  await evaluate('document.querySelector(".portal-product .portal-stepper button:last-child").click()');
  assert.equal(await evaluate('document.querySelector("#portal-cart-count").textContent'), '1');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#portal-floating-host .portal-floating")).position'), 'fixed');
  assert.equal(await evaluate('document.querySelector("#smooth-content").contains(document.querySelector("#portal-floating-host"))'), false);
  await evaluate('document.querySelector("#portal-floating-host button").click()');
  assert.ok(await evaluate('document.querySelector(".portal-cart-line")'), 'Floating cart did not open cart');
  await evaluate('document.querySelector("[data-view=checkout]").click()');
  await evaluate('document.querySelector("#portal-checkout-form [name=customer]").value="Nome em andamento";window.dispatchEvent(new Event("trameli:catalog-changed"))');
  assert.equal(await evaluate('document.querySelector("#portal-checkout-form [name=customer]").value'), 'Nome em andamento');

  await evaluate('location.hash="#configuracoes"');
  await pause(400);
  await evaluate('document.querySelector(".motion-toggle").click()');
  assert.equal(await evaluate('window.TrameliMotion.active()'), false, 'Reduced motion did not stop smoother');
  await evaluate('document.querySelector(".motion-toggle").click()');
  assert.equal(await evaluate('window.TrameliMotion.active()'), true, 'Smoother did not resume');
  await evaluate('window.dispatchEvent(new Event("beforeprint"))');
  assert.equal(await evaluate('window.TrameliMotion.active()'), false, 'Print did not pause smoother');
  await evaluate('window.dispatchEvent(new Event("afterprint"))');
  assert.equal(await evaluate('window.TrameliMotion.active()'), true, 'Scroll did not resume after print');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(400);
  assert.equal(await evaluate('window.TrameliMotion.active()'), false, 'Touch-sized layout should use native scroll');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile horizontal overflow');
  await evaluate('location.hash="#loja"');
  await pause(250);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".portal-bottom-nav")).position'), 'fixed');
  await evaluate('document.querySelector(".portal-menu-button").click()');
  assert.equal(await evaluate('document.body.classList.contains("menu-open")'), true, 'Portal menu did not open');
  assert.equal(await evaluate('document.querySelector("#smooth-content").contains(document.querySelector(".nav"))'), false);
  await evaluate('document.querySelector(".menu-overlay").click()');
  assert.equal(await evaluate('document.body.classList.contains("menu-open")'), false, 'Portal menu did not close');
  console.log('Rolagem, transições, portal, redução de movimento e mobile: OK');
} finally {
  socket?.close();
  browser.kill();
  await pause(200);
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(error => {
    if (error.code !== 'EBUSY') throw error;
  });
}
