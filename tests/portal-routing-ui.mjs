import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserPath, headlessFlags } from './browser-path.mjs';
const baseUrl = process.env.TRAMELI_TEST_URL;
if (!baseUrl?.startsWith('http://127.0.0.1:')) throw new Error('Local preview URL required');
const profile = await mkdtemp(join(tmpdir(), 'trameli-portal-routing-'));
const port = 9393;
const browser = spawn(browserPath(), [...headlessFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, baseUrl], { stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
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

  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const safeFrame = async context => {
    assert.deepEqual(await evaluate('portalFixture.frameLeaks'), [], `${context}: exposed the operational shell`);
    assert.equal(await evaluate('location.hash'), '#loja', `${context}: checkout changed route`);
    assert.equal(await evaluate('document.querySelector(".app-shell").hidden'), true, context);
  };
  const checkout = async () => {
    await click('#portal-cart-link');
    await until('!!document.querySelector("[data-view=checkout]")');
    await click('[data-view=checkout]');
    await until('!!document.querySelector("#portal-checkout-form")');
  };
  for (const role of ['customer', 'operator', 'master']) {
    for (const width of [1366, 390]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await send('Page.navigate', { url: `${baseUrl}tests/portal-routing-fixture.html?role=${role}` });
      await until('!!window.portalFixture?.ready');
      const context = `${role}/${width}px`;
      await click('[data-qty="1"]');
      await checkout();
      // Use a real click: dispatching submit alone misses the document click collision.
      await click('#portal-checkout-form [type=submit]');
      await until('portalFixture.calls === 1');
      await safeFrame(`${context} pending first order`);
      await until('!!document.querySelector("#portal-success-screen")');
      await safeFrame(`${context} successful order`);
      assert.equal(await evaluate('portalFixture.records.length'), 1);
      await click('[data-success-action=catalog]');
      await click('[data-qty="1"]');
      await checkout();
      await click('#portal-checkout-form [type=submit]');
      await until('!!document.querySelector(".portal-orders-page .portal-error")');
      assert.match(await evaluate('document.querySelector(".portal-error").textContent'), /já tem um pedido/);
      assert.equal(await evaluate('portalFixture.calls'), 1, 'Known duplicate should not call RPC');
      await safeFrame(`${context} locally blocked duplicate`);
      // Existing order remains editable and follows the same customer checkout.
      await click('[data-edit-order]');
      await click('[data-view=checkout]');
      await click('#portal-checkout-form [type=submit]');
      await until('!!document.querySelector("#portal-success-screen")');
      assert.equal(await evaluate('portalFixture.records.length'), 1, 'Editing must preserve a single order');
      await safeFrame(`${context} editing existing order`);
      await click('[data-success-action=catalog]');
      await click('[data-qty="1"]');
      // Simulate another tab/device placing an order after this client's cache.
      await evaluate('TrameliLive.orders=[]; portalFixture.mode="server-duplicate"');
      await checkout();
      await click('#portal-checkout-form [type=submit]');
      await until('!!document.querySelector("#portal-checkout-form .portal-error:not([hidden])")');
      assert.match(await evaluate('document.querySelector("#portal-checkout-form .portal-error:not([hidden])").textContent'), /já tem um pedido/);
      assert.equal(await evaluate('document.querySelector("#portal-checkout-form [type=submit]").disabled'), false);
      await safeFrame(`${context} server rejected duplicate`);
      await evaluate('portalFixture.mode="network-error"');
      await click('#portal-checkout-form [type=submit]');
      await until('!!document.querySelector("#portal-checkout-form .portal-error:not([hidden])")?.textContent.includes("Falha de conexão")');
      await safeFrame(`${context} network failure`);
      await click('#portal-cart-link');
      await until('!!document.querySelector(".portal-cart-line")');
      assert.match(await evaluate('document.querySelector(".portal-cart-line").textContent'), /Pão de teste/);
      await click('[data-view=catalog]');
      await until('!!document.querySelector(".portal-welcome")');
      await evaluate('dispatchEvent(new Event("trameli:catalog-changed")); dispatchEvent(new Event("trameli:orders-changed")); dispatchEvent(new Event("trameli:profile-changed"))');
      await safeFrame(`${context} refresh events`);
      if (role === 'customer') {
        for (const hash of ['#portal-shirley', '#operacao', '#financeiro']) {
          await evaluate(`location.hash=${JSON.stringify(hash)}`);
          await until('location.hash === "#loja"');
          await safeFrame(`${context} blocked internal navigation`);
        }
      } else {
        // Operator shortcut remains available in the internal shell.
        await evaluate('location.hash="#pedidos"');
        await until('!!document.querySelector("#screen-view [data-new-order]")');
        await click('#screen-view [data-new-order]');
        await until('location.hash === "#portal-shirley" && !document.querySelector(".app-shell").hidden');
      }
      console.log(`Portal routing: ${context} success, duplicate, edit, server error and retry OK`);
    }
  }
} finally {
  socket?.close(); browser.kill();
  await pause(250);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
