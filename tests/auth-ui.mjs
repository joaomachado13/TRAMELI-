// Isolated application tests; never connects to Supabase or uses a personal browser profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { browserPath, headlessFlags } from './browser-path.mjs';

const url = process.env.TRAMELI_TEST_URL;
if (!url?.startsWith('http://127.0.0.1:')) throw new Error('Provide a local Vite server in TRAMELI_TEST_URL.');
const profile = await mkdtemp(join(tmpdir(), 'trameli-auth-test-'));
const port = 9371;
const browser = spawn(browserPath(),
  [...headlessFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `${url}tests/auth-fixture.html`],
  { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let page;
  for (let i = 0; i < 80; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(tab => tab.type === 'page' && tab.url.startsWith(url)); } catch { /* Starting. */ }
    if (page) break;
    await pause(100);
  }
  assert.ok(page, 'Browser did not start');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await pause(100); }
    assert.fail(`Condition not reached: ${expression}`);
  };
  const start = async options => {
    await evaluate(`fixture(${JSON.stringify(options)})`);
    if (!options.session || options.recovery) await until('!!document.querySelector(".live-gate form") && document.querySelector(".live-gate").getAttribute("aria-busy") !== "true"');
  };
  const submit = async (values = {}) => {
    await evaluate(`(() => { const f = document.querySelector('.live-gate form'); for (const [name,value] of Object.entries(${JSON.stringify(values)})) f.elements[name].value=value; f.requestSubmit(); })()`);
  };
  await until('typeof fixture === "function"');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await start({ deferred: true });
  await evaluate(`document.querySelector('[name=identity]').value='test@example.test'; document.querySelector('[name=password]').value='typed-password'; authFixture.resolveProviders({external:{google:true,phone:true}});`);
  await until('!!document.querySelector("[data-method=phone]")');
  assert.equal(await evaluate('document.querySelector("[name=password]").value'), 'typed-password', 'Provider lookup must preserve typed passwords');
  await submit({ identity: 'test@example.test', password: 'wrong' });
  await until('document.querySelector(".live-gate__message").textContent.includes("não conferem")');
  assert.equal(await evaluate('authResult'), 'pending');
  await submit({ identity: 'test@example.test', password: 'correct-password' });
  await until('authResult === "entered"');
  assert.equal(await evaluate('!!document.querySelector(".live-gate")'), false);
  await start({ session: true });
  await until('authResult === "entered"');
  assert.deepEqual(await evaluate('authFixture.log'), ['loaded'], 'Saved sessions must skip credentials');
  await start({ session: true, recovery: true });
  await until('document.querySelector("h1").textContent.includes("Escolha sua senha")');
  await submit({ password: 'correct-password', confirmation: 'correct-password' });
  await until('authResult === "entered"');
  assert.deepEqual(await evaluate('authFixture.log'), ['password-updated', 'loaded']);
  await start({ google: false });
  await until('document.querySelector(".auth-provider-note").textContent.includes("ainda não")');
  assert.equal(await evaluate('document.querySelector(".auth-google").disabled'), true);
  await start({ google: true, phone: true });
  await until('document.querySelector(".auth-google").disabled === false');
  await evaluate('document.querySelector(".auth-google").click()');
  await until('authFixture.log.includes("google")');
  await evaluate('document.querySelector("[data-method=phone]").click(); document.querySelector("[data-mode=signup]").click()');
  await submit({ identity: '(34) 99999-9999', password: 'correct-password', confirmation: 'correct-password' });
  await until('!!document.querySelector("[name=code]")');
  await submit({ code: '123456' });
  await until('authResult === "entered"');
  assert.ok((await evaluate('authFixture.log')).includes('phone-verified'));
  await start({ session: true, loadError: true });
  await until('!!document.querySelector("[data-action=logout]") && document.querySelector(".live-gate").getAttribute("aria-busy") !== "true"');
  await evaluate('authFixture.options.loadError=false');
  await submit();
  await until('authResult === "entered"');
  await start({ google: false });
  await until('document.querySelector(".auth-provider-note").textContent.includes("ainda não")');
  await mkdir(new URL('../assets/crops/', import.meta.url), { recursive: true });
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await until(`innerWidth === ${width}`);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Login must not overflow horizontally');
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(new URL(`../assets/crops/login-${width}.png`, import.meta.url), Buffer.from(shot.data, 'base64'));
  }
  console.log('Interface de acesso: senha, sessão, recuperação, Google, telefone, conexão e 390/1280px OK');
  if (process.env.TRAMELI_CHECK_REAL_LOGIN === '1') {
    await send('Page.navigate', { url });
    await until('!!document.querySelector(".live-gate [name=password]")');
    await until('!document.querySelector(".auth-provider-note").textContent.includes("Verificando")');
    assert.equal(await evaluate('!!document.querySelector(".live-gate [name=identity]")'), true);
    console.log('Página real carregou e-mail/senha e verificou provedores (nenhuma conta acessada).');
  }
} finally {
  socket?.close(); browser.kill();
  await pause(400);
  const root = resolve(tmpdir());
  if (resolve(profile).startsWith(root + sep) && profile.includes('trameli-auth-test-')) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
