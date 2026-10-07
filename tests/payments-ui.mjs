import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { auditIdentity } from './identity-audit.mjs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { browserPath, headlessFlags } from './browser-path.mjs';
const origin = process.env.TRAMELI_TEST_URL || 'http://127.0.0.1:4173/';
if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(origin)) throw new Error('Local Vite URL required');
const profile = await mkdtemp(join(tmpdir(), 'trameli-payments-test-'));
const port = 9373;
const browser = spawn(browserPath(), [...headlessFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `${origin}tests/payments-fixture.html`], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let page;
  for (let i = 0; i < 80; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && p.url.startsWith(origin)); } catch {}
    if (page) break;
    await pause(100);
  }
  assert.ok(page, 'Browser did not start');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let seq = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data), task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };

  for(let i=0;i<80 && !await evaluate('!!window.paymentFixtureReady');i++)await pause(100);
  assert.equal(await evaluate('!!window.paymentFixtureReady'),true);
  assert.match(await evaluate('document.body.textContent'),/Em aberto/);
  await evaluate(`window.TrameliPayments.openForCustomer({ customerId: paymentFixture.state.balances[0].customer_id, customerName: paymentFixture.state.balances[0].customer_name })`);
  for(let i=0;i<40&&!await evaluate('document.querySelector(".payment-dialog").open');i++)await pause(100);
  assert.match(await evaluate('document.querySelector(".payment-dialog").textContent'),/Em aberto/);
  assert.deepEqual(await evaluate(`(${auditIdentity.toString()})()`), [], 'Modal pagamento: fonte e contraste');
  await evaluate(`const f=document.querySelector('[data-payment-form]');f.querySelector('[data-allocation]').checked=true;f.querySelector('input[type=checkbox][required]').checked=true;f.requestSubmit();f.requestSubmit();`);
  for(let i=0;i<40&&await evaluate('document.querySelector(".payment-dialog").open');i++)await pause(100);
  assert.equal(await evaluate('paymentFixture.state.calls.filter(c=>c.name==="trameli_record_payment").length'),1);
  assert.equal(await evaluate('paymentFixture.state.calls.find(c=>c.name==="trameli_record_payment").args.p_amount_cents'),1200);
  assert.match(await evaluate('document.querySelector("[data-payment-content]").textContent'),/Pago/);
  await evaluate('document.querySelector("[data-pay-unknown]").click()');
  await evaluate(`{const form=document.querySelector('[data-payment-form]');form.elements.amount.value='3,00';form.querySelector('[type=checkbox]').checked=true;form.requestSubmit();}`);
  for(let i=0;i<40&&await evaluate('document.querySelector(".payment-dialog").open');i++)await pause(100);
  assert.match(await evaluate('document.querySelector("[data-payment-content]").textContent'),/Sem cliente vinculado/);
  assert.match(await evaluate('document.querySelector("[data-payment-content]").textContent'),/1/);
  await evaluate('window.confirm=()=>true;document.querySelector("[data-day-close]").click()');
  for(let i=0;i<40&&!await evaluate('paymentFixture.state.closings.length');i++)await pause(100);
  await pause(100);
  assert.match(await evaluate('document.querySelector("[data-day-history]").textContent'),/Revisão 1/);
  await mkdir(new URL('../assets/crops/',import.meta.url),{recursive:true});
  for(const width of [1280,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Financeiro sem overflow');
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await writeFile(new URL(`../assets/crops/payments-${width}.png`,import.meta.url),Buffer.from(shot.data,'base64'));
  }
  await evaluate('paymentFixture.state.balances[0].paid_cents=400;paymentFixture.state.balances[0].due_cents=800;paymentFixture.state.balances[0].payment_status="partial";paymentFixture.render(true)');
  assert.match(await evaluate('document.body.textContent'),/Meus pagamentos/);
  assert.match(await evaluate('document.body.textContent'),/Saldo em aberto/);
  assert.match(await evaluate('document.body.textContent'),/Parcialmente pago/);
  assert.equal(await evaluate('!!document.querySelector("[data-pay-refund]")'),false);
  const beforePix=await evaluate('paymentFixture.state.calls.length');
  await evaluate('(async()=>{paymentFixture.state.balances.push({...paymentFixture.state.balances[0],order_id:"other-order",due_cents:5000,paid_cents:0,payment_status:"open"});await paymentFixture.render(true);const selected=document.querySelector(`[data-pix-select="${paymentFixture.order}"]`);selected.checked=true;selected.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector(`[data-pix-order="selected"]`).click()})()');
  for(let i=0;i<40&&!await evaluate('!!document.querySelector(".pix-qr")');i++)await pause(100);
  assert.match(await evaluate('document.querySelector(".pix-amount").textContent'),/8,00/);
  assert.equal(await evaluate('document.querySelector(".pix-qr").complete'),true);
  assert.equal(await evaluate('document.querySelector("[data-pix-payload]").value.includes("54048.00")'),true);
  assert.equal(await evaluate('paymentFixture.state.calls.length'),beforePix,'QR cannot post a payment');
  assert.match(await evaluate('document.querySelector(".pix-dialog").textContent'),/não pague de novo/);
  assert.ok(await evaluate('document.querySelector(".pix-dialog").scrollWidth<=document.querySelector(".pix-dialog").clientWidth'),'QR dialog fits mobile');
  const pixShot=await send('Page.captureScreenshot',{format:'png'});
  assert.deepEqual(await evaluate(`(${auditIdentity.toString()})()`), [], 'Modal Pix: fonte e contraste');
  await writeFile(new URL('../assets/crops/pix-390.png',import.meta.url),Buffer.from(pixShot.data,'base64'));
  await evaluate('document.querySelector("[data-pix-close]").click();paymentFixture.state.balances[0].due_cents=0;document.querySelector(`[data-pix-order="${paymentFixture.order}"]`).click()');
  await pause(150);
  assert.equal(await evaluate('!!document.querySelector(".pix-qr")'),false);
  assert.match(await evaluate('document.querySelector(".pix-dialog").textContent'),/Não há saldo/);
  await evaluate('document.querySelector("[data-pix-close]").click();paymentFixture.state.balances[0].due_cents=800;paymentFixture.state.pix.enabled=false;document.querySelector(`[data-pix-order="${paymentFixture.order}"]`).click()');
  await pause(150);
  assert.match(await evaluate('document.querySelector(".pix-dialog").textContent'),/não foi habilitado/);
  await evaluate('document.querySelector("[data-pix-close]").click();paymentFixture.render()');
  await evaluate('document.querySelector("[data-pix-config]").click()');
  await pause(150);
  await evaluate(`const pf=document.querySelector('[data-pix-form]');pf.elements.enabled.checked=true;pf.requestSubmit();`);
  assert.match(await evaluate('document.querySelector("[data-pix-error]").textContent'),/conferência/);
  await evaluate(`document.querySelector('[data-pix-form]').elements.verified.checked=true;document.querySelector('[data-pix-form]').requestSubmit()`);
  await pause(150);
  assert.match(await evaluate('document.querySelector(".pix-dialog").textContent'),/Configuração salva/);
  assert.equal(await evaluate('paymentFixture.state.calls.filter(c=>c.name==="trameli_record_payment").length'),2);
  await evaluate('document.querySelector("[data-pix-close]").click();paymentFixture.state.missing=true;paymentFixture.render()');
  assert.match(await evaluate('document.body.textContent'),/migração 007/);
  assert.equal(await evaluate('document.querySelector("[data-day-close]").disabled'),true);
  await evaluate('paymentFixture.state.missing=false;paymentFixture.state.fail=true;paymentFixture.render()');
  assert.equal(await evaluate('!!document.querySelector("[data-pay-account]")'),false);
  console.log('UI pagamentos: fluxo por cliente, quitação integral, envio duplo bloqueado, exceção sem cliente, fechamento, extrato, falha de conexão e mobile OK.');
  console.log('UI Pix: seleção de pedidos, saldo atualizado, QR local, sem baixa automática, bloqueio de saldo zero, desativação, conferência obrigatória e layout mobile OK.');
} finally {
  socket?.close();browser.kill();await pause(400);
  if(resolve(profile).startsWith(resolve(tmpdir())+sep)&&profile.includes('trameli-payments-test-'))await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
}
