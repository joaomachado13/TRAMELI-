import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { browserPath, headlessFlags } from './browser-path.mjs';
const origin = process.env.TRAMELI_TEST_URL || 'http://127.0.0.1:4173/';
if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(origin)) throw new Error('Local Vite URL required');
const profile = await mkdtemp(join(tmpdir(), 'trameli-photos-test-'));
const port = 9372;
const browser = spawn(browserPath(), [...headlessFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `${origin}tests/photos-fixture.html`], { windowsHide: true, stdio: 'ignore' });
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
  for (let i = 0; i < 60 && !await evaluate('!!window.photosReady'); i++) await pause(100);
  assert.equal(await evaluate('!!window.photosReady'), true);
  const expectedPhotos = await evaluate('TrameliCatalog.list().filter(product => product.image).length');
  assert.equal(await evaluate('document.querySelectorAll(".portal-product__photo img").length'), expectedPhotos);
  assert.equal(await evaluate('new DOMParser().parseFromString(TrameliCatalog.render(), "text/html").querySelectorAll(".catalog-card__image[src]").length'), expectedPhotos);
  await evaluate('Promise.all([...document.querySelectorAll(".portal-product__photo img")].map(img => { img.loading = "eager"; return img.decode(); }))');
  await mkdir(new URL('../assets/crops/', import.meta.url), { recursive: true });
  for (const width of [1280, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow');
    await evaluate('document.querySelector(".portal-grid").scrollIntoView({ behavior: "instant", block: "start" })');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL(`../assets/crops/photos-${width}.png`, import.meta.url), Buffer.from(shot.data, 'base64'));
  }
  await evaluate(`[...document.querySelectorAll('[data-qty]')].find(button => button.dataset.id === '20260924-0000-4000-8000-000000000002' && button.dataset.qty === '1').click()`);
  for (let i = 0; i < 20 && !await evaluate('!!document.querySelector(".portal-catalog__footer")'); i++) await pause(50);
  assert.match(await evaluate('document.querySelector(".portal-catalog__footer small").textContent'), /1,40/);
  await evaluate('document.getElementById("portal-cart-link").click()');
  assert.equal(await evaluate('document.querySelector(".portal-cart-line__photo img").getAttribute("src")'), 'assets/products/oficiais/pao-frances.jpeg');
  assert.match(await evaluate('document.querySelector(".portal-totals").textContent'), /Subtotal dos produtos.*1,40/);
  assert.doesNotMatch(await evaluate('document.querySelector(".portal-totals").textContent'), /3,40/);
  await evaluate(`document.querySelector('[data-view="checkout"]').click()`);
  const checkout = await evaluate('document.querySelector(".portal-order-summary").textContent');
  assert.match(checkout, /Subtotal dos produtos.*1,40/);
  assert.match(checkout, /Taxa de entrega.*2,00/);
  assert.match(checkout, /Total para.*3,40/);
  // Synthetic personal history: reorder must not submit or rewrite the original.
  await evaluate(`(() => {
    window.confirm=()=>true;
    const bread=TrameliCatalog.list().find(p=>p.id==='20260924-0000-4000-8000-000000000002');
    const cheese=TrameliCatalog.list().find(p=>p.unit==='kg'&&p.active);
    window.testCheeseId=cheese.id;
    const order={id:'shopping-old',customerToken:localStorage.getItem('trameli-portal-token-v1'),createdAt:new Date().toISOString(),date:'2026-01-01',status:'delivered',address:'Teste',feeCents:200,
      items:[{productId:bread.id,name:bread.name,quantity:2,priceCents:100},{productId:cheese.id,name:cheese.name,quantity:1,weightGrams:200,kgPriceCents:1000,priceCents:200},{productId:'gone',name:'Produto removido',quantity:1,priceCents:100}]};
    window.testOldOrders=JSON.stringify([order,{...order,id:'shopping-second'}]);
    localStorage.setItem('trameli-operation-draft-v2',testOldOrders);
    document.getElementById('portal-orders-link').click();
    document.querySelector('[data-reorder="shopping-old"]').click();
  })()`);
  await pause(80);
  assert.equal(await evaluate('document.querySelectorAll(".portal-cart-line").length'),2);
  assert.match(await evaluate('document.querySelector(".portal-review-notice").textContent'),/preços atuais.*preço atualizado.*fora da sacola/);
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("trameli-portal-cart-v1"))[testCheeseId]'),4);
  assert.equal(await evaluate('localStorage.getItem("trameli-operation-draft-v2")===testOldOrders'),true);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await evaluate(`document.querySelector('[data-view="catalog"]').click(); document.querySelector('[data-personal-filter="frequent"]').click()`);
  assert.equal(await evaluate('document.querySelectorAll(".portal-product").length'),2);
  // Exercise asynchronous favorite persistence without any external account.
  await evaluate(`(async()=>{
    const {initShopping}=TrameliTestModules;
    const favorites=new Set(); window.testFavoriteWrites=0;
    const client={
      from(){const query={select(){return query},eq(){return query},order(){return query},range(){return Promise.resolve({data:[...favorites].map(product_id=>({product_id})),error:null})}};return query},
      async rpc(name,args){window.testFavoriteWrites++;if(args.p_favorite)favorites.add(args.p_product_id);else favorites.delete(args.p_product_id);return {error:null}}
    };
    initShopping({client,user:{id:'fixture-user'}});
    await TrameliShopping.refresh();
    document.querySelector('[data-favorite]').click();
  })()`);
  await pause(80);
  assert.equal(await evaluate('testFavoriteWrites'),1);
  await evaluate(`document.querySelector('[data-personal-filter="favorites"]').click()`);
  assert.equal(await evaluate('document.querySelectorAll(".portal-product").length'),1);
  await evaluate('TrameliShopping.refresh()');
  assert.equal(await evaluate('document.querySelectorAll(".portal-product").length'),1);
  await evaluate(`document.querySelector('[data-favorite]').click()`);
  await pause(80);
  assert.equal(await evaluate('document.querySelectorAll(".portal-product").length'),0);
  console.log('Recompra/frequentes/favoritos: fluxo real DOM, novo carrinho, peso 200g e persistência por conta OK.');
  // Operation uses the same real DOM and scripts, with synthetic local data only.
  await evaluate(`(async () => {
    await loadOperationTestModules();
    location.hash = '#operacao';
  })()`);
  await pause(150);
  await evaluate('document.getElementById("new-order").click()');
  assert.match(await evaluate('document.getElementById("form-subtotal").textContent'), /0,00/);
  assert.equal(await evaluate('document.getElementById("form-delivery-summary").hidden'), true);
  await evaluate(`const name = document.querySelector('.item-name'); name.value = 'Pão francês'; name.dispatchEvent(new Event('change', { bubbles:true }));`);
  assert.match(await evaluate('document.getElementById("form-subtotal").textContent'), /1,40/);
  assert.match(await evaluate('document.getElementById("form-total").textContent'), /3,40/);
  assert.equal(await evaluate('document.getElementById("form-delivery-summary").hidden'), false);
  await evaluate(`document.getElementById('close-dialog').click();
    const d = new Date();
    const date = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    localStorage.setItem('trameli-operation-draft-v2', JSON.stringify([{id:'test-order',customer:'Cliente de teste com nome muito extenso para conferir o alinhamento',address:'Teste',date,createdAt:new Date().toISOString(),feeCents:200,status:'received',items:[{name:'Pão francês',quantity:1,priceCents:140}]}]));
    dispatchEvent(new Event('trameli:orders-changed')); location.hash = '#inicio';`);
  await pause(150);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 30 && !(await evaluate('!!document.querySelector("#home-recent-orders td:nth-child(2)")')); i++) await pause(100);
  assert.equal(await evaluate(`(() => { const cell = document.querySelector('#home-recent-orders td:nth-child(2)'); return getComputedStyle(cell).whiteSpace === 'normal' && cell.scrollWidth <= cell.clientWidth; })()`), true);
  await evaluate('location.hash="#clientes"');
  await pause(100);
  assert.match(await evaluate('document.querySelector(".client-row").textContent'), /Cliente de teste com nome muito extenso/);
  await evaluate('location.hash="#inicio"');
  await pause(100);
  assert.match(await evaluate('document.getElementById("home-deliveries").textContent'), /Cliente de teste/);
  assert.doesNotMatch(await evaluate('document.getElementById("home-next-actions").textContent'), /As análises vão aparecer/);
  await evaluate(`window.TrameliPayments={api:{ready:true,error:'',balances:[{due_cents:340}],allocations:[],payments:[]}};dispatchEvent(new Event('trameli:payments-changed'));`);
  assert.match(await evaluate('document.getElementById("home-order-total").textContent'), /3,40/);
  assert.match(await evaluate('document.getElementById("home-next-actions").textContent'), /1 pedido em aberto/);
  assert.match(await evaluate('document.querySelector("#home-order-count").parentElement.textContent'), /1 pedido registrado/);
  assert.match(await evaluate('document.querySelector("#home-recent-orders td:last-child").textContent'), /3,40.*Inclui.*2,00/);
  await evaluate('document.querySelector(".orders-table").scrollIntoView({behavior:"instant",block:"center"})');
  const overviewShot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('../assets/crops/order-fee-overview.png', import.meta.url), Buffer.from(overviewShot.data, 'base64'));
  console.log('Entrega: subtotal na sacola/barra, taxa só no resumo final, pedido manual vazio zerado, nome longo sem sobreposição.');
  console.log('Fotos: catálogo antigo atualizado, 16 imagens carregadas, sacola e layout 390/1280px OK.');
} finally {
  socket?.close(); browser.kill(); await pause(400);
  if (resolve(profile).startsWith(resolve(tmpdir()) + sep) && profile.includes('trameli-photos-test-')) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
