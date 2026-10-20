import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
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
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
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
  await evaluate(`document.querySelector('#shirley-featured-products [data-product-step="1"]').click()`);
  assert.match(await evaluate('document.querySelector("#shirley-order-total").textContent'), /3,40/);
  assert.equal(await evaluate('document.querySelector(\'#shirley-products [data-product-id="20260924-0000-4000-8000-000000000002"]\').parentElement.querySelector("span").textContent'), '1');
  await evaluate('document.querySelector(\'#shirley-products [data-product-id="20260924-0000-4000-8000-000000000002"][data-product-step="-1"]\').click()');
  assert.equal(await evaluate('document.querySelector("#shirley-featured-products .shirley-portal__stepper>span").textContent'), '0');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Destaques da Shirley não devem transbordar no celular.');
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

  await evaluate(`document.querySelector('[data-shirley-tab="new"]').click()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const alignment = await evaluate(`(() => {
    const fields=['#shirley-customer-search','#shirley-delivery-date','#shirley-recurrence'].map(selector=>document.querySelector(selector).getBoundingClientRect());
    const buttons=[document.querySelector('#shirley-featured-products [data-product-step="1"]'),document.querySelector('#shirley-products [data-product-step="1"]')].map(button=>{const r=button.getBoundingClientRect(),s=getComputedStyle(button);return {width:r.width,height:r.height,padding:s.padding,radius:s.borderRadius,color:s.backgroundColor};});
    return {tops:fields.map(r=>r.top),heights:fields.map(r=>r.height),buttons};
  })()`);
  assert.ok(Math.max(...alignment.tops)-Math.min(...alignment.tops)<1,'Os três campos precisam começar na mesma linha.');
  assert.ok(Math.max(...alignment.heights)-Math.min(...alignment.heights)<1,'Os campos precisam ter a mesma altura.');
  for(const button of alignment.buttons){assert.equal(button.width,button.height);assert.equal(button.padding,'0px');assert.ok(parseFloat(button.radius)>=button.width/2);}
  assert.equal(alignment.buttons[0].color,alignment.buttons[1].color,'Vitrine e catálogo devem usar o mesmo estilo de botão.');
  await evaluate(`(() => {
    const search=document.querySelector('#shirley-customer-search');search.value='Cliente';search.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-customer-id="cliente-teste"]').click();
    document.querySelector('#shirley-delivery-date').value='2026-10-21';
    const recurrence=document.querySelector('#shirley-recurrence');recurrence.value='monthly';recurrence.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('#shirley-daily-items').click();
    for(let i=0;i<6;i++)document.querySelector('[data-product-id="pao-teste"][data-product-step="1"]').click();
    for(const day of ['3','5'])document.querySelector('#shirley-copy-days input[value="'+day+'"]').checked=true;
    document.querySelector('#shirley-copy-items').click();
    document.querySelector('#shirley-order-form').requestSubmit();
    window.shirleyEmptyDayMessage=document.querySelector('#shirley-order-feedback').textContent;
    document.querySelector('[data-edit-weekday="2"]').click();
    for(let i=0;i<6;i++)document.querySelector('[data-product-id="pao-teste"][data-product-step="1"]').click();
    for(let i=0;i<3;i++)document.querySelector('[data-product-id="queijo-teste"][data-product-step="1"]').click();
    for(const input of document.querySelectorAll('#shirley-copy-days input'))input.checked=['4','6'].includes(input.value);
    document.querySelector('#shirley-copy-items').click();
  })()`);
  assert.match(await evaluate('document.querySelector("#shirley-order-total").textContent'),/9,50/);
  assert.match(await evaluate('window.shirleyEmptyDayMessage'),/produto para terça/,'Salvar deve indicar o dia que ainda está sem produtos.');
  assert.equal(await evaluate('window.shirleyRecurringSaved.length'),0,'Dia vazio não deve criar programação parcial.');
  const dayStyles=await evaluate(`[...document.querySelectorAll('#shirley-day-tabs button')].map(button=>({day:button.dataset.editWeekday,pressed:button.getAttribute('aria-pressed'),background:getComputedStyle(button).backgroundColor}))`);
  assert.notEqual(dayStyles.find(day=>day.pressed==='true')?.background,dayStyles.find(day=>day.pressed==='false')?.background,JSON.stringify(dayStyles));
  await evaluate(`document.querySelector('[data-edit-weekday="1"]').click()`);
  assert.match(await evaluate('document.querySelector("#shirley-order-total").textContent'),/8,00/);
  await evaluate(`document.querySelector('#shirley-order-form').requestSubmit()`);
  await until('window.shirleyRecurringSaved.length===1');
  const savedSchedule=await evaluate('window.shirleyRecurringSaved[0].schedule');
  assert.equal(savedSchedule.recurrence,'monthly');
  for(const day of [1,3,5]){assert.equal(savedSchedule.itemsByWeekday[day].length,1);assert.equal(savedSchedule.itemsByWeekday[day][0].quantity,6);}
  for(const day of [2,4,6]){assert.equal(savedSchedule.itemsByWeekday[day].length,2);assert.equal(savedSchedule.itemsByWeekday[day][1].weightGrams,150);}
  await until('!document.querySelector(\'[data-shirley-panel="orders"]\').hidden');
  await evaluate(`document.querySelector('[data-shirley-tab="recurring"]').click()`);
  await until('!!document.querySelector("[data-edit-schedule]")');
  assert.match(await evaluate('document.querySelector("#shirley-recurring-list").textContent'),/Segunda: 6× Pão de teste/);
  assert.match(await evaluate('document.querySelector("#shirley-recurring-list").textContent'),/Terça:.*150 g/);
  await evaluate('document.querySelector("[data-edit-schedule]").click()');
  assert.equal(await evaluate('document.querySelector("#shirley-delivery-date").value'),'2026-10-21','Editar deve preservar o início da programação.');
  await evaluate(`document.querySelector('[data-edit-weekday="2"]').click()`);
  assert.match(await evaluate('document.querySelector("#shirley-order-total").textContent'),/9,50/);
  await mkdir(new URL('../assets/crops/',import.meta.url),{recursive:true});
  for(const width of [1440,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await pause(300);
    await evaluate(`Promise.all([...document.querySelectorAll('#shirley-featured-products img')].map(image=>image.decode()))`);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'A edição por dia não deve criar rolagem horizontal.');
    await evaluate('document.querySelector("#shirley-recurring-options").scrollIntoView({block:"start"})');
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await writeFile(new URL(`../assets/crops/shirley-daily-${width}.png`,import.meta.url),Buffer.from(shot.data,'base64'));
  }
  await evaluate(`document.querySelector('#shirley-products [data-product-id="queijo-teste"][data-product-step="-1"]').click()`);
  await evaluate('document.querySelector("#shirley-order-form").requestSubmit()');
  await until('window.shirleyRecurringSaved.length===2');
  const edited=await evaluate('window.shirleyRecurringSaved[1]');
  assert.equal(edited.scheduleId,'recorrencia-teste');
  assert.equal(edited.schedule.itemsByWeekday[2][1].weightGrams,100);
  assert.equal(edited.schedule.itemsByWeekday[4][1].weightGrams,150,'Editar terça não deve alterar quinta.');
  console.log('Shirley: campos alinhados, botões circulares, montagem/cópia por dia, pesos, edição independente e layouts desktop/mobile OK.');
} finally {
  socket?.close();
  browser.kill();
  await pause(250);
  const root = resolve(tmpdir()) + sep;
  if (resolve(profile).startsWith(root) && profile.includes('trameli-landing-')) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
