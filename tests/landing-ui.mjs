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
  await until('location.hash === "#loja" && !document.querySelector("#portal-view").hidden && !!document.querySelector(".portal-welcome")');
  assert.equal(await evaluate('document.body.classList.contains("app-booting")'), false, 'A tela de carregamento não foi removida.');
  assert.equal(await evaluate('document.body.classList.contains("portal-mode")'), true, 'A rota raiz não ativou o portal.');
  assert.equal(await evaluate('document.querySelector(".app-shell").hidden'), true, 'A operação ficou visível na entrada.');
  assert.ok(await evaluate('document.querySelector(".nav").getBoundingClientRect().right <= 0'), 'A sidebar ficou visível no portal do cliente.');
  assert.ok((await evaluate('document.title')).startsWith('Peça para amanhã'), 'O título inicial não corresponde ao portal.');
  
  await evaluate('location.hash = "#operacao"');
  await until('location.hash === "#operacao" && !document.querySelector(".app-shell").hidden && !document.querySelector("#operation-view").hidden');
  assert.equal(await evaluate('document.body.classList.contains("portal-mode")'), false, 'A rota da operação deixou o modo portal ativo.');
  
  await evaluate('location.hash = "#loja"');
  await until('!document.querySelector("#portal-view").hidden && !!document.querySelector(".portal-welcome")');
  assert.equal(await evaluate('document.querySelector(".app-shell").hidden'), true);
  console.log('Entrada pública: splash sem flash, portal do cliente por padrão e operação acessível por rota explícita OK.');
} finally {
  socket?.close();
  browser.kill();
  await pause(250);
  const root = resolve(tmpdir()) + sep;
  if (resolve(profile).startsWith(root) && profile.includes('trameli-landing-')) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
