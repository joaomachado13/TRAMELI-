import { featuredProductsMarkup } from '../src/featured-products.js';
import '../src/featured-products.css';
import { weekdayNames, recurringItemsText, recurringScheduleText } from '../src/recurring-days.js';

(() => {
  const root = document.getElementById('shirley-portal-view');
  if (!root) return;
  const live = window.TrameliLive;
  const $ = selector => root.querySelector(selector);
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const today = () => { const p = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); const v=Object.fromEntries(p.map(x=>[x.type,x.value])); return v.year+'-'+v.month+'-'+v.day; };
  const shiftDate = value => { const d = new Date(value+'T12:00:00'); if (d.getDay()===0) d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); };
  let selectedQuantities = new Map();
  let retainedLines = [];
  const dayDrafts = new Map();
  let editingDay = null;
  let editingDailySchedule = false;
  let selectedCustomerId = '';
  let editingScheduleId = null;
  let profiles = [];
  let products = [];
  let schedules = [];
  let activeTab = 'new';
  const customerSearch = $('#shirley-customer-search');
  const customerId = $('#shirley-customer-id');
  const customerResults = $('#shirley-customer-results');
  const productSearch = $('#shirley-product-search');
  const productsHost = $('#shirley-products');
  const highlightsHost = $('#shirley-featured-products');
  const form = $('#shirley-order-form');
  const feedback = $('#shirley-order-feedback');
  const dateInput = $('#shirley-delivery-date');
  const ordersDate = $('#shirley-orders-date');
  const ordersSearch = $('#shirley-orders-search');
  const weekdayHost = $('#shirley-weekdays');
  const recurrenceInput = $('#shirley-recurrence');
  const dailyInput = $('#shirley-daily-items');
  const recurringOptions = $('#shirley-recurring-options');
  const dayEditor = $('#shirley-day-editor');
  const selectedDays = () => [...weekdayHost.querySelectorAll('input:checked')].map(input => Number(input.value));
  const dailyMode = () => recurrenceInput.value !== 'once' && dailyInput.checked;
  const recurrenceFeedback = $('#shirley-recurring-feedback');
  const tabPanels = [...root.querySelectorAll('[data-shirley-panel]')];
  const setFeedback = (node,message,kind='') => { node.textContent=message; node.dataset.kind=kind; };
  const activeProducts = () => products.filter(p=>p.active && Number.isSafeInteger(p.priceCents) && p.priceCents>=0).slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  const selectedProfile = () => profiles.find(p=>p.user_id===selectedCustomerId);
  const linesFor = (quantities, extra = []) => [...activeProducts().filter(p=>(quantities.get(p.id)||0)>0).map(p=>{
    const quantity=quantities.get(p.id);
    if(p.unit==='kg'){const weightGrams=quantity*50;return {productId:p.id,name:p.name,quantity:1,weightGrams,kgPriceCents:p.priceCents,priceCents:window.TrameliOrderMath.weightPriceCents(p.priceCents,weightGrams)};}
    return {productId:p.id,name:p.name,quantity,priceCents:p.priceCents};
  }), ...extra];
  const chosenLines = () => linesFor(selectedQuantities, retainedLines);
  const cloneDraft = () => ({ quantities: new Map(selectedQuantities), extra: retainedLines.map(line => ({ ...line })) });
  function draftFromLines(lines) {
    const quantities = new Map(), extra = [];
    for (const line of lines || []) {
      const product = activeProducts().find(p => p.id === line.productId) || activeProducts().find(p => p.name === line.name);
      if (!product) { extra.push({ ...line }); continue; }
      quantities.set(product.id, product.unit === 'kg' ? Math.max(1, Math.round(Number(line.weightGrams || 50) / 50)) : Math.max(1, Number(line.quantity) || 1));
    }
    return { quantities, extra };
  }
  function activateDay(day) {
    if (!dayDrafts.has(day)) dayDrafts.set(day, cloneDraft());
    editingDay = day;
    selectedQuantities = dayDrafts.get(day).quantities;
    retainedLines = dayDrafts.get(day).extra;
  }
  function renderDayEditor() {
    dayEditor.hidden = !dailyMode();
    if (!dailyMode()) return;
    const days = selectedDays();
    const focusedDay = document.activeElement?.dataset.editWeekday;
    $('#shirley-day-tabs').innerHTML = days.map(day => {
      const draft = dayDrafts.get(day);
      const lines = draft ? linesFor(draft.quantities, draft.extra) : [];
      return `<button type="button" class="shirley-recurring__day" data-edit-weekday="${day}" aria-pressed="${day === editingDay}"><strong>${weekdayNames[day]}</strong><small>${lines.length ? `${lines.length} ${lines.length === 1 ? 'produto' : 'produtos'}` : 'Sem produtos'}</small></button>`;
    }).join('');
    if (focusedDay) $('#shirley-day-tabs').querySelector(`[data-edit-weekday="${focusedDay}"]`)?.focus({ preventScroll: true });
    $('#shirley-day-heading').textContent = editingDay ? `Montando o pedido de ${weekdayNames[editingDay].toLocaleLowerCase('pt-BR')}. Os produtos e o total abaixo pertencem somente a este dia.` : 'Selecione pelo menos um dia de entrega.';
    const checked = new Set([...$('#shirley-copy-days').querySelectorAll('input:checked')].map(input => Number(input.value)));
    $('#shirley-copy-days').innerHTML = days.filter(day => day !== editingDay).map(day => `<label><input type="checkbox" value="${day}" ${checked.has(day) ? 'checked' : ''}>${weekdayNames[day]}</label>`).join('');
  }
  const totalCents = () => {
    const items = chosenLines();
    return items.length ? window.TrameliOrderMath.totalCents({ items, feeCents: 200 }) : 0;
  };
  function setTab(tab){
    activeTab=tab;
    tabPanels.forEach(panel=>panel.hidden=panel.dataset.shirleyPanel!==tab);
    root.querySelectorAll('[data-shirley-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.shirleyTab===tab)));
    if(tab==='orders') renderOrders();
    if(tab==='recurring') loadSchedules();
    if(tab==='new') renderProducts();
  }
  function renderCustomers(query=customerSearch.value){
    const q=query.trim().toLocaleLowerCase('pt-BR');
    const matches=profiles.filter(p=>p.name && (!q || [p.name,p.address,p.phone].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(q)))).slice(0,8);
    customerResults.innerHTML=matches.length?matches.map(p=>'<button type="button" data-customer-id="'+esc(p.user_id)+'"><strong>'+esc(p.name)+'</strong><small>'+esc(p.address||'Endereço não informado')+(p.phone?' · '+esc(p.phone):'')+'</small></button>').join(''):'<p class="shirley-portal__empty">Nenhum cliente encontrado. Confira o nome ou cadastre o cliente primeiro.</p>';
    customerResults.hidden=false;
  }
  function chooseCustomer(id){
    const p=profiles.find(x=>x.user_id===id); if(!p)return;
    selectedCustomerId=id; customerId.value=id; customerSearch.value=p.name;
    $('#shirley-selected-customer').textContent=[p.name,p.address,p.phone].filter(Boolean).join(' · ');
    customerResults.hidden=true;
  }
  function renderProducts(){
    const q=productSearch.value.trim().toLocaleLowerCase('pt-BR');
    const list=activeProducts().filter(p=>p.name.toLocaleLowerCase('pt-BR').includes(q));
    const featuredScroll = highlightsHost.querySelector('.featured-products__rail')?.scrollLeft || 0;
    const focused = root.contains(document.activeElement) ? { id: document.activeElement.dataset.productId, step: document.activeElement.dataset.productStep, scope: highlightsHost.contains(document.activeElement) ? '#shirley-featured-products' : '#shirley-products' } : null;
    const availableHighlights = activeProducts().filter(p => !(p.unavailableFrom && p.unavailableUntil && dateInput.value >= p.unavailableFrom && dateInput.value <= p.unavailableUntil));
    highlightsHost.innerHTML = featuredProductsMarkup(availableHighlights, {
      headingId: 'shirley-featured-title', hidden: Boolean(q),
      renderPhoto: p => p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : '<span class="shirley-portal__empty">Foto em breve</span>',
      renderControls: p => {
        const qty = selectedQuantities.get(p.id) || 0;
        return `<div class="shirley-portal__stepper"><button type="button" class="button--icon-round" data-product-step="-1" data-product-id="${esc(p.id)}" aria-label="Diminuir ${esc(p.name)}" ${qty ? '' : 'disabled'}>−</button><span>${p.unit === 'kg' ? `${qty * 50} g` : qty}</span><button type="button" class="button--icon-round" data-product-step="1" data-product-id="${esc(p.id)}" aria-label="Adicionar ${esc(p.name)}" ${qty >= (p.unit === 'kg' ? 99 : 999) ? 'disabled' : ''}>+</button></div>`;
      },
    });
    const rail = highlightsHost.querySelector('.featured-products__rail');
    if (rail) rail.scrollLeft = featuredScroll;
    productsHost.innerHTML=list.length?list.map(p=>{
      const qty=selectedQuantities.get(p.id)||0;
      const image=p.image||p.photo||'';
      const price=p.unit==='kg'?money(p.priceCents)+' / kg':money(p.priceCents);
      const amount=p.unit==='kg'?(qty?qty*50+' g':'0 g'):qty;
      return '<article class="shirley-portal__product"><div class="shirley-portal__product-photo">'+(image?'<img src="'+esc(image)+'" alt="" loading="lazy">':'')+'</div><div class="shirley-portal__product-info"><strong>'+esc(p.name)+'</strong><small>'+price+'</small><div class="shirley-portal__stepper"><button type="button" class="button--icon-round" data-product-step="-1" data-product-id="'+esc(p.id)+'" aria-label="Diminuir '+esc(p.name)+'" '+(!qty?'disabled':'')+'>−</button><span>'+amount+'</span><button type="button" class="button--icon-round" data-product-step="1" data-product-id="'+esc(p.id)+'" aria-label="Adicionar '+esc(p.name)+'">+</button></div></div></article>';
    }).join(''):'<p class="shirley-portal__empty">Nenhum produto ativo corresponde à pesquisa.</p>';
    const count=chosenLines().reduce((sum,line)=>sum+(line.weightGrams?1:line.quantity),0);
    $('#shirley-item-count').textContent=count+' '+(count===1?'item selecionado':'itens selecionados');
    $('#shirley-order-total').textContent=money(totalCents());
    $('#shirley-retained-items').innerHTML = retainedLines.map((line, index) => `<article><span>${esc(recurringItemsText([line]))} — item da programação anterior</span><button type="button" class="shirley-portal__secondary" data-remove-retained="${index}">Retirar item</button></article>`).join('');
    renderDayEditor();
    if (focused?.id) {
      const selector = `${focused.scope} [data-product-id="${CSS.escape(focused.id)}"]`;
      const button = root.querySelector(`${selector}[data-product-step="${focused.step}"]:not(:disabled)`) || root.querySelector(`${selector}:not(:disabled)`);
      button?.focus({ preventScroll: true });
    }
  }
  function renderOrders(){
    if(!live?.operator){$('#shirley-orders-list').innerHTML='<p class="shirley-portal__empty">A consulta exige uma conta operacional.</p>';return;}
    const date=ordersDate.value; const q=ordersSearch.value.trim().toLocaleLowerCase('pt-BR');
    const list=(live.orders||[]).filter(o=>o.date===date && (o.status||'received')!=='cancelled' && (!q||[o.customer,o.address,...(o.items||[]).map(i=>i.name),o.publicCode].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(q)))).sort((a,b)=>String(a.customer).localeCompare(String(b.customer),'pt-BR'));
    $('#shirley-orders-list').innerHTML=list.length?list.map(o=>{
      const status=({received:'A conferir',confirmed:'Conferido',packing:'Em separação',ready:'Pronto',delivered:'Entregue',cancelled:'Cancelado'})[o.status||'received']||'A conferir';
      const items=(o.items||[]).map(i=>(i.weightGrams?i.weightGrams+' g de ':i.quantity+'× ')+i.name).join(' · ');
      const total=window.TrameliOrderMath.totalCents(o);
      return '<article class="shirley-portal__record"><div class="shirley-portal__record-main"><strong>'+esc(o.customer)+' · '+esc(o.publicCode||'Pedido')+'</strong><small>'+esc(o.address||'')+' · '+esc(status)+' · '+money(total)+'</small><p>'+esc(items)+'</p></div><div class="shirley-portal__record-actions"><button type="button" class="shirley-portal__secondary" data-edit-order="'+esc(o.id)+'">Editar pedido</button></div></article>';
    }).join(''):'<p class="shirley-portal__empty">Nenhum pedido encontrado para essa data e pesquisa.</p>';
  }
  async function loadSchedules(){
    if(!live?.operator){$('#shirley-recurring-list').innerHTML='<p class="shirley-portal__empty">A gestão de recorrências exige conexão com o banco de dados.</p>';return;}
    recurrenceFeedback.textContent='Carregando recorrências…';
    try{
      schedules=await live.recurringSchedules();
      const weekdayNames=['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
      const names={fixed:'Fixo por dias da semana',fortnightly:'Quinzenal (fechamento)',monthly:'Mensal (fechamento)'};
      $('#shirley-recurring-list').innerHTML=schedules.length?schedules.map(s=>{
        const p=profiles.find(x=>x.user_id===s.customer_id);
        const days=(s.weekdays||[1,2,3,4,5,6]).map(d=>weekdayNames[Number(d)]).filter(Boolean).join(', ');
        const items=recurringScheduleText(s).map(text => `<p>${esc(text)}</p>`).join('');
        return '<article class="shirley-portal__record"><div class="shirley-portal__record-main"><strong>'+esc(p?.name||'Cliente')+'</strong><small>'+esc(names[s.recurrence]||s.recurrence)+' · '+esc(s.active?'Ativo':'Pausado')+'</small><small>Dias: '+esc(days)+'</small>'+items+'</div><div class="shirley-portal__record-actions"><button type="button" class="shirley-portal__secondary" data-edit-schedule="'+esc(s.id)+'" '+(!s.active?'disabled':'')+'>Editar programação</button><button type="button" class="shirley-portal__secondary" data-toggle-schedule="'+esc(s.id)+'" data-active="'+String(!s.active)+'">'+(s.active?'Pausar':'Reativar')+'</button><button type="button" class="shirley-portal__secondary" data-delete-schedule="'+esc(s.id)+'">Excluir</button></div></article>';
      }).join(''):'<p class="shirley-portal__empty">Nenhuma programação recorrente cadastrada.</p>';
      recurrenceFeedback.textContent='';
    }catch(error){setFeedback(recurrenceFeedback,'Não foi possível carregar as recorrências: '+error.message,'error');}
  }
  function startScheduleEdit(schedule){
    profiles=window.TrameliPayments?.api?.profiles||profiles; products=live.products||[];
    editingScheduleId=schedule.id; selectedCustomerId=schedule.customer_id; customerId.value=schedule.customer_id;
    const p=profiles.find(x=>x.user_id===schedule.customer_id); customerSearch.value=p?.name||'';
    $('#shirley-selected-customer').textContent=[p?.name,p?.address,p?.phone].filter(Boolean).join(' · ');
    dateInput.value=schedule.starts_on||schedule.start_date||today(); recurrenceInput.value=schedule.recurrence;
    form.querySelector('.shirley-portal__step').textContent='EDITAR RECORRÊNCIA';
    $('#shirley-form-title').textContent='Editar programação';
    $('#shirley-order-notes').value=schedule.notes||'';
    weekdayHost.querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=(schedule.weekdays||[1,2,3,4,5,6]).map(Number).includes(Number(input.value)));
    dayDrafts.clear(); editingDay=null;
    const draft=draftFromLines(schedule.items);
    selectedQuantities=draft.quantities; retainedLines=draft.extra;
    editingDailySchedule=Boolean(schedule.items_by_weekday); dailyInput.checked=editingDailySchedule;
    if(dailyInput.checked){
      for(const day of selectedDays()) dayDrafts.set(day,draftFromLines(schedule.items_by_weekday[String(day)]));
      activateDay(selectedDays()[0]);
    }
    recurrenceInput.querySelector('option[value="once"]').disabled=true;
    $('#shirley-order-feedback').textContent='Você está editando uma recorrência existente. Salvar atualizará a programação futura.';
    setTab('new'); syncRecurrence(); renderProducts();
  }
  function resetForm(){
    form.reset(); editingScheduleId=null; selectedCustomerId=''; customerId.value=''; selectedQuantities=new Map();retainedLines=[];
    dayDrafts.clear();editingDay=null;editingDailySchedule=false;dailyInput.checked=false;
    recurrenceInput.querySelector('option[value="once"]').disabled=false;
    dateInput.value=shiftDate(today()); recurrenceInput.value='once'; weekdayHost.hidden=true;
    $('#shirley-selected-customer').textContent='Nenhum cliente selecionado';
    form.querySelector('.shirley-portal__step').textContent='01 / PEDIDO';
    $('#shirley-form-title').textContent='Novo pedido';
    setFeedback(feedback,'');
    syncRecurrence(); renderProducts();
  }
  function syncRecurrence(){
    const once=recurrenceInput.value==='once';
    weekdayHost.hidden=once;recurringOptions.hidden=once;
    if(dailyMode()){
      const days=selectedDays();
      for(const day of days) if(!dayDrafts.has(day)) dayDrafts.set(day,cloneDraft());
      if(!days.includes(editingDay)) { if(days.length) activateDay(days[0]); else editingDay=null; }
    }
    renderDayEditor();
  }
  dailyInput.addEventListener('change',()=>{
    if(!dailyInput.checked && !confirm('Usar o pedido deste dia em todos os dias selecionados?')){dailyInput.checked=true;return;}
    if(!dailyInput.checked){selectedQuantities=new Map(selectedQuantities);retainedLines=retainedLines.map(line=>({...line}));dayDrafts.clear();editingDay=null;}
    syncRecurrence();renderProducts();
  });
  weekdayHost.addEventListener('change',()=>{syncRecurrence();renderProducts();});
  $('#shirley-day-tabs').addEventListener('click',event=>{
    const button=event.target.closest('[data-edit-weekday]');if(!button)return;
    activateDay(Number(button.dataset.editWeekday));$('#shirley-copy-feedback').textContent='';renderProducts();
  });
  $('#shirley-copy-items').addEventListener('click',()=>{
    const days=[...$('#shirley-copy-days').querySelectorAll('input:checked')].map(input=>Number(input.value));
    if(!days.length){$('#shirley-copy-feedback').textContent='Selecione os dias que receberão a cópia.';return;}
    if(days.some(day=>{const draft=dayDrafts.get(day);return draft&&linesFor(draft.quantities,draft.extra).length;})&&!confirm('Substituir os produtos dos dias selecionados pelo pedido deste dia?'))return;
    for(const day of days)dayDrafts.set(day,cloneDraft());
    renderDayEditor();$('#shirley-copy-feedback').textContent='Pedido copiado para '+days.map(day=>weekdayNames[day]).join(', ')+'.';
  });
  $('#shirley-retained-items').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-retained]');if(!button)return;
    retainedLines.splice(Number(button.dataset.removeRetained),1);renderProducts();
  });
  customerSearch.addEventListener('input',()=>{selectedCustomerId='';customerId.value='';$('#shirley-selected-customer').textContent='Selecione o cliente correto na lista.';renderCustomers();});
  customerSearch.addEventListener('focus',()=>renderCustomers());
  customerResults.addEventListener('click',event=>{const button=event.target.closest('[data-customer-id]');if(button)chooseCustomer(button.dataset.customerId);});
  document.addEventListener('click',event=>{if(!event.target.closest('#shirley-customer-search')&&!event.target.closest('#shirley-customer-results'))customerResults.hidden=true;});
  productSearch.addEventListener('input',renderProducts);
  dateInput.addEventListener('change',renderProducts);
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-product-step]');if(!button)return;
    const p=activeProducts().find(x=>x.id===button.dataset.productId);if(!p)return;
    const next=Math.max(0,Math.min(p.unit==='kg'?99:999,(selectedQuantities.get(p.id)||0)+Number(button.dataset.productStep)));
    if(next)selectedQuantities.set(p.id,next);else selectedQuantities.delete(p.id);
    renderProducts();
  });
  recurrenceInput.addEventListener('change',syncRecurrence);
  root.querySelectorAll('[data-shirley-tab]').forEach(button=>button.addEventListener('click',()=>setTab(button.dataset.shirleyTab)));
  ordersDate.addEventListener('change',renderOrders);ordersSearch.addEventListener('input',renderOrders);
  $('#shirley-orders-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-edit-order]');if(!button)return;
    const id=button.dataset.editOrder;location.hash='#operacao';
    setTimeout(()=>window.TrameliOperation?.openOrder(id),300);
  });
  $('#shirley-recurring-list').addEventListener('click',async event=>{
    const edit=event.target.closest('[data-edit-schedule]');
    if(edit){const s=schedules.find(x=>x.id===edit.dataset.editSchedule);if(s)startScheduleEdit(s);return;}
    const toggle=event.target.closest('[data-toggle-schedule]');
    if(toggle){toggle.disabled=true;try{await live.setRecurringScheduleActive(toggle.dataset.toggleSchedule,toggle.dataset.active==='true');await loadSchedules();}catch(error){setFeedback(recurrenceFeedback,'Não foi possível alterar: '+error.message,'error');}finally{toggle.disabled=false;}return;}
    const del=event.target.closest('[data-delete-schedule]');
    if(del){if(!confirm('Excluir esta programação e os pedidos gerados por ela?'))return;del.disabled=true;try{await live.deleteRecurringSchedule(del.dataset.deleteSchedule);await loadSchedules();}catch(error){setFeedback(recurrenceFeedback,'Não foi possível excluir: '+error.message,'error');}finally{del.disabled=false;}}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault(); if(form.querySelector('[type=submit]').disabled)return;
    if(!live?.operator){setFeedback(feedback,'Esta área exige uma conta operacional conectada.','error');return;}
    const profile=selectedProfile(); const date=dateInput.value; const recurrence=recurrenceInput.value;
    const items=chosenLines(); const weekdays=[...weekdayHost.querySelectorAll('input:checked')].map(input=>Number(input.value)).filter(day=>day>=1&&day<=6);
    const itemsByWeekday=dailyMode()?Object.fromEntries(weekdays.map(day=>{
      const draft=dayDrafts.get(day);return [String(day),draft?linesFor(draft.quantities,draft.extra):[]];
    })):null;
    const emptyDay=dailyMode()?weekdays.find(day=>!itemsByWeekday[String(day)].length):null;
    if(emptyDay){activateDay(emptyDay);renderProducts();setFeedback(feedback,`Adicione pelo menos um produto para ${weekdayNames[emptyDay].toLocaleLowerCase('pt-BR')}.`,'error');return;}
    if(!profile||!date||new Date(date+'T12:00:00').getDay()===0||!items.length||(recurrence!=='once'&& !weekdays.length)){
      setFeedback(feedback,new Date(date+'T12:00:00').getDay()===0?'Não fazemos entregas aos domingos. Escolha outra data.':!profile?'Selecione um cliente cadastrado na lista.':!items.length?'Adicione pelo menos um produto.':'Selecione os dias da recorrência.','error');return;
    }
    if(recurrence==='once'&&!editingScheduleId){
      const duplicate=(live.orders||[]).find(o=>o.customerId===profile.user_id&&o.date===date&&(o.status||'received')!=='cancelled');
      if(duplicate){setFeedback(feedback,'Este cliente já tem um pedido para essa data. Use Pesquisar pedidos para abrir e alterar o pedido existente.','error');return;}
    }
    const requestId=crypto.randomUUID();
    const notes=$('#shirley-order-notes').value.trim();
    const submit=form.querySelector('[type=submit]');submit.disabled=true;setFeedback(feedback,'Salvando pedido…');
    try{
      if(recurrence==='once'&&!editingScheduleId){
        const order={id:null,publicCode:'',createdAt:new Date().toISOString(),checked:false,status:'received',editedAt:null,customerId:profile.user_id,customer:profile.name,address:profile.address||'',phone:profile.phone||'',date,feeCents:200,items,notes};
        await live.saveOperatorOrder(order,requestId,profile.user_id);
      }else{
        await live.saveRecurringOrder({customerId:profile.user_id,recurrence:recurrence==='once'?'fixed':recurrence,startDate:date,notes,feeCents:200,weekdays,items:items.map(i=>({...i})),...((dailyMode()||editingDailySchedule)?{itemsByWeekday}:{})},requestId,editingScheduleId);
        await live.materializeRecurringOrders(date);
      }
      await live.load();
      ordersDate.value=date;resetForm();setTab('orders');renderOrders();
      setFeedback($('#shirley-orders-feedback'),recurrence==='once'?'Pedido salvo com sucesso.':'Programação salva. Os pedidos serão gerados nos dias selecionados.','success');
    }catch(error){setFeedback(feedback,'Não foi possível salvar: '+error.message,'error');}
    finally{submit.disabled=false;}
  });
  window.addEventListener('trameli:orders-changed',()=>{if(activeTab==='orders')renderOrders();});
  window.addEventListener('trameli:shirley-edit-schedule',event=>startScheduleEdit(event.detail));
  window.addEventListener('trameli:catalog-changed',()=>{products=live?.products||[];renderProducts();});
  window.addEventListener('trameli:payments-changed',()=>{profiles=window.TrameliPayments?.api?.profiles||profiles;});
  window.addEventListener('trameli:shirley-portal-open',async()=>{
    if(!live?.operator){setFeedback(feedback,'Acesso exclusivo à conta operacional da Shirley.','error');return;}
    profiles=window.TrameliPayments?.api?.profiles||profiles;products=live.products||[];
    if(!dateInput.value)dateInput.value=shiftDate(today());
    if(!ordersDate.value)ordersDate.value=dateInput.value;
    renderProducts();renderOrders();
    if(activeTab==='recurring')await loadSchedules();
  });
  if(!live?.operator){
    form.innerHTML='<div class="shirley-portal__empty"><h2>Área restrita</h2><p>O Portal da Shirley está disponível somente para uma conta operacional autorizada.</p><a class="shirley-portal__back" href="#loja">Voltar ao portal do cliente</a></div>';
  }else{
    profiles=window.TrameliPayments?.api?.profiles||[];products=live.products||[];
    dateInput.value=shiftDate(today());ordersDate.value=dateInput.value;
    renderProducts();renderOrders();syncRecurrence();
  }
})();
