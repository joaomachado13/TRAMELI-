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
  assert.equal(await evaluate('document.querySelector(".featured-product").dataset.featuredId'), '20260924-0000-4000-8000-000000000002');
  assert.ok(await evaluate('!!(document.querySelector(".featured-products").compareDocumentPosition(document.querySelector(".portal-quick-actions")) & Node.DOCUMENT_POSITION_FOLLOWING)'), 'Destaques devem aparecer antes das ações secundárias e do catálogo completo.');
  await evaluate(`(() => {
    const button = document.querySelector('.featured-product [data-qty="1"]'); button.focus(); button.click();
  })()`);
  assert.equal(await evaluate('document.querySelector(\'#portal-grid [data-id="20260924-0000-4000-8000-000000000002"]\').parentElement.querySelector("span").textContent'), '1');
  assert.ok(await evaluate('!!document.activeElement.closest(".featured-products")'), 'Adicionar deve preservar o foco na vitrine.');
  await evaluate('document.querySelector(\'#portal-grid [data-id="20260924-0000-4000-8000-000000000002"][data-qty="1"]\').click()');
  assert.equal(await evaluate('document.querySelector(".featured-product .portal-stepper>span").textContent'), '2');
  await evaluate(`document.querySelector('.featured-product [data-qty="-1"]').click(); document.querySelector('.featured-product [data-qty="-1"]').click()`);
  await evaluate('const input = document.querySelector("#portal-search"); input.value="queijo"; input.dispatchEvent(new Event("input",{bubbles:true}))');
  assert.equal(await evaluate('document.querySelector(".featured-products").hidden'), true);
  await evaluate('document.querySelector("#portal-search").value=""; document.querySelector("#portal-search").dispatchEvent(new Event("input",{bubbles:true}))');
  assert.equal(await evaluate('document.querySelector(".featured-products").hidden'), false);
  await evaluate(`(async () => {
    const product = TrameliCatalog.list().find(p => p.active && p.featuredPosition == null && p.image);
    window.featuredManagementProduct = product.id;
    TrameliCatalog.open(product.id);
    const form = document.querySelector('[data-featured-form]');
    form.elements.featured.checked = true; form.elements.featured.dispatchEvent(new Event('change',{bubbles:true}));
    form.elements.position.value = '5'; form.requestSubmit();
  })()`);
  for (let i = 0; i < 40 && !await evaluate('document.querySelector("[data-featured-feedback]").textContent.includes("atualizada")'); i++) await pause(50);
  assert.equal(await evaluate('TrameliCatalog.list().find(p=>p.id===window.featuredManagementProduct).featuredPosition'), 5);
  assert.ok(await evaluate('!!document.querySelector(`[data-featured-id="${window.featuredManagementProduct}"]`)'), 'A seleção da operação deve aparecer na vitrine.');
  await evaluate('const form = document.querySelector("[data-featured-form]"); form.elements.featured.checked=false; form.requestSubmit()');
  for (let i = 0; i < 40 && !await evaluate('TrameliCatalog.list().find(p=>p.id===window.featuredManagementProduct).featuredPosition === null'); i++) await pause(50);
  assert.equal(await evaluate('!!document.querySelector(`[data-featured-id="${window.featuredManagementProduct}"]`)'), false);
  await evaluate('document.querySelector("[data-product-close]").click()');
  console.log('Vitrine: seleção e remoção em Produtos, ordem manual e quantidade sincronizada com o catálogo OK.');
  const expectedPhotos = await evaluate('TrameliCatalog.list().filter(product => product.image).length');
  assert.equal(await evaluate('document.querySelectorAll(".portal-product__photo img").length'), expectedPhotos);
  assert.equal(await evaluate('new DOMParser().parseFromString(TrameliCatalog.render(), "text/html").querySelectorAll(".catalog-card__image[src]").length'), expectedPhotos);
  await evaluate('Promise.all([...document.querySelectorAll(".portal-product__photo img")].map(img => { img.loading = "eager"; return img.decode(); }))');
  await mkdir(new URL('../assets/crops/', import.meta.url), { recursive: true });
  for (const width of [1280, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow');
    await evaluate('document.querySelector(".featured-products").scrollIntoView({ behavior: "instant", block: "start" })');
    const highlightsShot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL(`../assets/crops/highlights-${width}.png`, import.meta.url), Buffer.from(highlightsShot.data, 'base64'));
    await evaluate('document.querySelector("#portal-grid").scrollIntoView({ behavior: "instant", block: "start" })');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL(`../assets/crops/photos-${width}.png`, import.meta.url), Buffer.from(shot.data, 'base64'));
  }
  const editorProductId = await evaluate(`(() => {
    const product = TrameliCatalog.list().find(item => item.image);
    window.testPhotoEditorId = product.id;
    TrameliCatalog.open(product.id);
    document.querySelector('.product-drawer [data-catalog-action="edit"]').click();
    return product.id;
  })()`);
  assert.equal(await evaluate('!document.querySelector("[data-photo-editor]").hidden'), true, 'Editor de foto não abriu para um produto com imagem.');
  const dragResult = await evaluate(`(() => {
    const zoom = document.querySelector('[name="imageZoom"]');
    zoom.value = '150'; zoom.dispatchEvent(new Event('input', { bubbles: true }));
    const stage = document.querySelector('[data-photo-stage]');
    const rect = stage.getBoundingClientRect();
    const start = { x: rect.left + rect.width * .5, y: rect.top + rect.height * .5 };
    const end = { x: rect.left + rect.width * .65, y: rect.top + rect.height * .6 };
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, clientX: start.x, clientY: start.y }));
    stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 11, clientX: end.x, clientY: end.y }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11, clientX: end.x, clientY: end.y }));
    return { position: stage.querySelector('img').style.objectPosition, zoom: zoom.value };
  })()`);
  assert.notEqual(dragResult.position, '50% 50%', 'Arrastar a foto não alterou o enquadramento.');
  assert.equal(dragResult.zoom, '150', 'Controle de zoom não atualizou a prévia.');
  await evaluate('document.querySelector("#catalog-form").requestSubmit()');
  for (let i = 0; i < 30 && await evaluate('document.querySelector("#catalog-form").closest("dialog").open'); i++) await pause(50);
  const savedFrame = await evaluate(`TrameliCatalog.list().find(item => item.id === window.testPhotoEditorId).image`);
  assert.match(savedFrame, /#trameli-frame=\d{1,3},\d{1,3},150$/, 'Enquadramento e zoom não foram salvos no produto.');
  const adminImageStyle = await evaluate(`(() => {
    const root = new DOMParser().parseFromString(TrameliCatalog.render(), 'text/html');
    return root.querySelector('.catalog-card[data-id="' + window.testPhotoEditorId + '"] .catalog-card__image')?.getAttribute('style') || '';
  })()`);
  assert.match(adminImageStyle, /object-position:/);
  assert.match(adminImageStyle, /width:150%/, 'Zoom salvo não foi aplicado no cartão do catálogo.');
  console.log('Editor de fotos: arraste, zoom, salvamento do enquadramento e prévia do catálogo OK.');
  await evaluate(`[...document.querySelectorAll('[data-qty]')].find(button => button.dataset.id === '20260924-0000-4000-8000-000000000002' && button.dataset.qty === '1').click()`);
  for (let i = 0; i < 20 && !await evaluate('!!document.querySelector(".portal-catalog__footer")'); i++) await pause(50);
  assert.match(await evaluate('document.querySelector(".portal-catalog__footer small").textContent'), /1,40/);
  await evaluate('document.getElementById("portal-cart-link").click()');
  assert.equal(await evaluate('document.querySelector(".portal-cart-line__photo img").getAttribute("src").split("#")[0]'), 'assets/products/oficiais/pao-frances.jpeg');
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
  await pause(520);
  assert.equal(await evaluate('document.querySelectorAll(".portal-product").length'),2);
  await evaluate(`document.querySelector('[data-personal-filter="all"]').click()`);
  await pause(520);
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
  })()`);
  await pause(520);
  await evaluate(`document.querySelector('[data-favorite]').click()`);
  await pause(80);
  assert.equal(await evaluate('testFavoriteWrites'),1);
  await evaluate(`document.querySelector('[data-personal-filter="favorites"]').click()`);
  await pause(520);
  assert.equal(await evaluate('document.querySelectorAll(".portal-product").length'),1);
  await evaluate('TrameliShopping.refresh()');
  await pause(520);
  assert.equal(await evaluate('document.querySelectorAll(".portal-product").length'),1);
  await evaluate(`document.querySelector('[data-favorite]').click()`);
  await pause(520);
  assert.equal(await evaluate('document.querySelectorAll(".portal-product").length'),0);
  console.log('Recompra/frequentes/favoritos: fluxo real DOM, novo carrinho, peso 200g e persistência por conta OK.');
  // Operation uses the same real DOM and scripts, with synthetic local data only.
  await evaluate(`(async () => {
    await loadOperationTestModules();
    location.hash = '#operacao';
  })()`);
  await pause(150);
  await evaluate('window.TrameliOperation.openNew()');
  for (let i = 0; i < 60 && !(await evaluate('document.getElementById("operation-dialog").open')); i++) await pause(100);
  assert.equal(await evaluate('document.getElementById("operation-dialog").open'), true);
  assert.match(await evaluate('document.getElementById("form-subtotal").textContent'), /0,00/);
  assert.equal(await evaluate('document.getElementById("form-delivery-summary").hidden'), true);
  await evaluate(`(() => { const card = [...document.querySelectorAll('#form-catalog .admin-product-card')].find(item => item.querySelector('.admin-product-card__body > strong')?.textContent.trim() === 'Pão francês'); if (!card) throw new Error('Card de Pão francês não encontrado.'); card.querySelector('[data-product-step="1"]').click(); })()`);
  assert.match(await evaluate('document.getElementById("form-subtotal").textContent'), /1,40/);
  assert.match(await evaluate('document.getElementById("form-total").textContent'), /3,40/);
  assert.equal(await evaluate('document.getElementById("form-delivery-summary").hidden'), false);
  await evaluate(`document.getElementById('close-dialog').click();
    // A visão geral usa o ciclo operacional, que vira às 13:30 em São Paulo.
    const date = document.querySelector('#delivery-date').value;
    localStorage.setItem('trameli-operation-draft-v2', JSON.stringify([{id:'test-order',customer:'Cliente de teste com nome muito extenso para conferir o alinhamento',address:'Teste',date,createdAt:new Date().toISOString(),feeCents:200,status:'received',items:[{name:'Pão francês',quantity:1,priceCents:140}]}]));
    dispatchEvent(new Event('trameli:orders-changed')); location.hash = '#inicio';`);
  await pause(150);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 30 && !(await evaluate('!!document.querySelector("#home-recent-orders td:nth-child(2)")')); i++) await pause(100);
  assert.equal(await evaluate(`(() => { const cell = document.querySelector('#home-recent-orders td:nth-child(2)'); return getComputedStyle(cell).whiteSpace === 'normal' && cell.scrollWidth <= cell.clientWidth; })()`), true);
  await evaluate('location.hash="#clientes"');
  await pause(100);
  assert.match(await evaluate('document.querySelector(".client-row").textContent'), /Cliente de Teste Com Nome Muito Extenso/);
  await evaluate('location.hash="#inicio"');
  await pause(100);
  assert.match(await evaluate('document.getElementById("home-deliveries").textContent'), /Cliente de Teste/);
  assert.doesNotMatch(await evaluate('document.getElementById("home-next-actions").textContent'), /As análises vão aparecer/);
  await evaluate(`window.TrameliPayments={api:{ready:true,error:'',balances:[{due_cents:340}],allocations:[],payments:[]}};dispatchEvent(new Event('trameli:payments-changed'));`);
  assert.match(await evaluate('document.getElementById("home-order-total").textContent'), /3,40/);
  assert.match(await evaluate('document.getElementById("home-next-actions").textContent'), /Pedidos em aberto/);
  assert.equal(await evaluate('document.querySelector("#home-next-actions a[href$=financeiro] .staff-badge").textContent'), '1');
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
