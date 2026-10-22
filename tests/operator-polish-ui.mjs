import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserPath, headlessFlags } from './browser-path.mjs';

// Run against an isolated, local-mode preview build: TRAMELI_TEST_URL=http://127.0.0.1:4183/ node tests/motion-ui.mjs
const url = process.env.TRAMELI_TEST_URL;
if (!url?.startsWith('http://127.0.0.1:')) throw new Error('Provide a localhost preview URL in TRAMELI_TEST_URL.');
const profile = await mkdtemp(join(tmpdir(), 'trameli-polish-'));
const port = 9392;
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

  const rawOrders = await evaluate(`(() => {
    const date=document.querySelector('#delivery-date').value;
    const base={createdAt:new Date().toISOString(),date,feeCents:200,address:'Rua teste 1',items:[{name:'Pão francês',quantity:6,priceCents:140}]};
    const orders=[{...base,id:'polish-a',customer:'CLIENTE ALFA',status:'received'},{...base,id:'polish-b',customer:'ÉRICA CLIENTE DE TESTE E DEMONSTRAÇÃO',status:'confirmed'},{...base,id:'polish-c',customer:'CLIENTE DOS TESTES E DAS FLORES',status:'delivered'}];
    const raw=JSON.stringify(orders);localStorage.setItem('trameli-operation-draft-v2',raw);dispatchEvent(new Event('trameli:orders-changed'));return raw;
  })()`);
  await pause(350);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.order-card__customer')].map(e=>e.textContent).sort()`),['Cliente Alfa','Cliente dos Testes e das Flores','Érica Cliente de Teste e Demonstração'].sort());
  const alignment=await evaluate(`(()=>[...document.querySelectorAll('.kanban-card')].map(card=>{
    const name=card.querySelector('.order-card__customer').getBoundingClientRect();
    const button=card.querySelector('.order-card'),box=button.getBoundingClientRect();
    const select=card.querySelector('[data-move-id]')?.getBoundingClientRect();
    return select?{left:Math.abs(select.left-name.left),right:Math.abs(select.right-(box.right-parseFloat(getComputedStyle(button).paddingRight)))}:null;
  }).filter(Boolean))()`);
  assert.equal(alignment.length,3,'All three statuses should retain their move control');
  assert.ok(alignment.every(row=>row.left<1 && row.right<1),`Move selectors are not aligned: ${JSON.stringify(alignment)}`);
  const cardImage=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('/tmp/trameli-polish-operation-desktop.png',Buffer.from(cardImage.data,'base64'));
  const scrollbar=await evaluate(`(()=>{
    const elements=[document.documentElement,document.querySelector('.nav'),document.querySelector('.kanban-column__cards')];
    return elements.map(e=>({width:getComputedStyle(e,'::-webkit-scrollbar').width,thumb:getComputedStyle(e,'::-webkit-scrollbar-thumb').backgroundColor,track:getComputedStyle(e,'::-webkit-scrollbar-track').backgroundColor}));
  })()`);
  assert.ok(scrollbar.every(s=>s.width==='8px' && s.thumb==='rgb(221, 208, 197)' && s.track==='rgba(0, 0, 0, 0)'),`Global scrollbars are inconsistent: ${JSON.stringify(scrollbar)}`);
  assert.ok(await evaluate(`(()=>{const icons=[...document.querySelectorAll('.nav__item .ico')].map(e=>getComputedStyle(e).getPropertyValue('--tm-icon-image'));return icons.length===new Set(icons).size && document.querySelector('.nav__item[href="#pedidos"] .ico--orders') && document.querySelector('.nav__item[href="#operacao"] .ico--daily');})()`),'Sidebar icons must be distinct');
  await evaluate(`{const e=document.querySelector('#order-search');e.value='ERICA';e.dispatchEvent(new Event('input',{bubbles:true}));}`);
  assert.equal(await evaluate('document.querySelectorAll(".kanban-card").length'),1,'Order search must ignore case and accents');
  await evaluate(`{const e=document.querySelector('#order-search');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await evaluate('window.TrameliOperation.preparePrint()');
  assert.ok(await evaluate(`[...document.querySelectorAll('.print-label__top strong')].some(e=>e.textContent==='Érica Cliente de Teste e Demonstração')`),'Print labels must format customer names');
  await evaluate(`{const e=document.querySelector('#global-search-input');e.value='erica';e.dispatchEvent(new Event('input',{bubbles:true}));}`);
  assert.ok(await evaluate(`document.querySelector('#global-search-results').textContent.includes('Érica Cliente de Teste e Demonstração')`),'Global search must find and format accented names');
  await evaluate(`{const e=document.querySelector('#global-search-input');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await evaluate(`{const e=document.createElement('button');e.className='live-logout';e.textContent='Sair';document.querySelector('.account-actions').append(e);}`);
  for(const width of [1920,1366,1024,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await pause(250);
    for(const route of ['inicio','pedidos','clientes','produtos','portal-shirley']){
      await evaluate(`location.hash='#${route}'`);await waitTransition();await pause(150);
      const boxes=await evaluate(`(()=>{
        const root=document.querySelector('${route==='inicio'?'#home-view':route==='portal-shirley'?'#shirley-portal-view':'#screen-view'}');
        const header=document.querySelector('.nav2'),h=header.getBoundingClientRect(),r=root.getBoundingClientRect(),style=getComputedStyle(header),actions=document.querySelector('.account-actions').getBoundingClientRect();
        const date=document.querySelector('#today-date').getBoundingClientRect();
        return {left:Math.abs(r.left-(h.left+parseFloat(style.paddingLeft))),right:Math.abs(r.right-(h.right-parseFloat(style.paddingRight))),action:Math.abs(r.right-actions.right),width:r.width,dateRight:date.right,contentRight:r.right,overflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      assert.ok(boxes.left<1 && boxes.right<1 && boxes.width<=1361 && !boxes.overflow,`Container mismatch ${route}/${width}: ${JSON.stringify(boxes)}`);
      if(width>=1024)assert.ok(boxes.action<1,`Content did not align with logout ${route}/${width}: ${JSON.stringify(boxes)}`);
      if(route==='inicio' && width>=1024)assert.ok(Math.abs(boxes.dateRight-boxes.contentRight)<1,'Overview date exceeded the shared content edge');
      if((route==='inicio' && width===1920)||(route==='clientes' && width===390)){
        const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        await writeFile(`/tmp/trameli-polish-${route}-${width}.png`,Buffer.from(shot.data,'base64'));
      }
      if(route==='clientes' && width===1366){
        await evaluate(`{const e=document.querySelector('#client-search');e.value='ERICA';e.dispatchEvent(new Event('input',{bubbles:true}));}`);
        assert.equal(await evaluate('document.querySelectorAll(".client-row").length'),1,'Client search must ignore accents');
        assert.equal(await evaluate('document.querySelector(".client-row .record-main strong").textContent'),'Érica Cliente de Teste e Demonstração');
        await evaluate(`{const e=document.querySelector('#client-search');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));}`);
      }
    }
  }
  assert.equal(await evaluate('localStorage.getItem("trameli-operation-draft-v2")'),rawOrders,'Display formatting must not rewrite saved orders');
  console.log('Acabamento: seletores alinhados, scroll global, containers 390–1920px, nomes/busca/etiquetas e ícones únicos; dados originais preservados: OK');
} finally {
  socket?.close();
  browser.kill();
  await pause(200);
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(error => {
    if (error.code !== 'EBUSY') throw error;
  });
}
