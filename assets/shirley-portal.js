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
  const form = $('#shirley-order-form');
  const feedback = $('#shirley-order-feedback');
  const dateInput = $('#shirley-delivery-date');
  const ordersDate = $('#shirley-orders-date');
  const ordersSearch = $('#shirley-orders-search');
  const weekdayHost = $('#shirley-weekdays');
  const recurrenceInput = $('#shirley-recurrence');
  const recurrenceFeedback = $('#shirley-recurring-feedback');
  const tabPanels = [...root.querySelectorAll('[data-shirley-panel]')];
  const setFeedback = (node,message,kind='') => { node.textContent=message; node.dataset.kind=kind; };
  const activeProducts = () => products.filter(p=>p.active && Number.isSafeInteger(p.priceCents) && p.priceCents>=0).slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  const selectedProfile = () => profiles.find(p=>p.user_id===selectedCustomerId);
  const chosenLines = () => activeProducts().filter(p=>(selectedQuantities.get(p.id)||0)>0).map(p=>{
    const quantity=selectedQuantities.get(p.id);
    if(p.unit==='kg'){const weightGrams=quantity*50;return {productId:p.id,name:p.name,quantity:1,weightGrams,kgPriceCents:p.priceCents,priceCents:window.TrameliOrderMath.weightPriceCents(p.priceCents,weightGrams)};}
    return {productId:p.id,name:p.name,quantity,priceCents:p.priceCents};
  });
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
    productsHost.innerHTML=list.length?list.map(p=>{
      const qty=selectedQuantities.get(p.id)||0;
      const image=p.image||p.photo||'';
      const price=p.unit==='kg'?money(p.priceCents)+' / kg':money(p.priceCents);
      const amount=p.unit==='kg'?(qty?qty*50+' g':'0 g'):qty;
      return '<article class="shirley-portal__product"><div class="shirley-portal__product-photo">'+(image?'<img src="'+esc(image)+'" alt="" loading="lazy">':'')+'</div><div class="shirley-portal__product-info"><strong>'+esc(p.name)+'</strong><small>'+price+'</small><div class="shirley-portal__stepper"><button type="button" data-product-step="-1" data-product-id="'+esc(p.id)+'" aria-label="Diminuir '+esc(p.name)+'" '+(!qty?'disabled':'')+'>−</button><span>'+amount+'</span><button type="button" data-product-step="1" data-product-id="'+esc(p.id)+'" aria-label="Adicionar '+esc(p.name)+'">+</button></div></div></article>';
    }).join(''):'<p class="shirley-portal__empty">Nenhum produto ativo corresponde à pesquisa.</p>';
    const count=chosenLines().reduce((sum,line)=>sum+(line.weightGrams?1:line.quantity),0);
    $('#shirley-item-count').textContent=count+' '+(count===1?'item selecionado':'itens selecionados');
    $('#shirley-order-total').textContent=money(totalCents());
  }
  function renderOrders(){
    if(!live?.operator){$('#shirley-orders-list').innerHTML='<p class="shirley-portal__empty">A consulta exige uma conta operacional.</p>';return;}
    const date=ordersDate.value; const q=ordersSearch.value.trim().toLocaleLowerCase('pt-BR');
    const list=(live.orders||[]).filter(o=>o.date===date && (o.status||'received')!=='cancelled' && (!q||[o.customer,o.address,...(o.items||[]).map(i=>i.name),o.publicCode].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(q)))).sort((a,b)=>String(a.customer).localeCompare(String(b.customer),'pt-BR'));
    $('#shirley-orders-list').innerHTML=list.length?list.map(o=>{
      const status=({received:'A conferir',confirmed:'Conferido',packing:'Em separação',ready:'Pronto',delivered:'Entregue',cancelled:'Cancelado'})[o.status||'received']||'A conferir';
      const items=(o.items||[]).map(i=>(i.weightGrams?i.weightGrams+' g de ':i.quantity+'× ')+i.name).join(' · ');
      const total=window.TrameliOrderMath.totalCents(o);
      return '<article class="shirley-portal__record"><div class="shirley-portal__record-main"><strong>'+esc(o.customer)+' · '+esc(o.publicCode||'Pedido')+'</strong><small>'+esc(o.address||'')+' · '+esc(status)+' · '+money(total)+'</small><p>'+esc(items)+'</p></div><div class="shirley-portal__record-actions"><button type="button" data-edit-order="'+esc(o.id)+'">Editar pedido</button></div></article>';
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
        const items=(s.items||[]).map(i=>(i.weightGrams?i.weightGrams+' g de ':i.quantity+'× ')+i.name).join(' · ');
        return '<article class="shirley-portal__record"><div class="shirley-portal__record-main"><strong>'+esc(p?.name||'Cliente')+'</strong><small>'+esc(names[s.recurrence]||s.recurrence)+' · '+esc(s.active?'Ativo':'Pausado')+'</small><small>Dias: '+esc(days)+'</small><p>'+esc(items)+'</p></div><div class="shirley-portal__record-actions"><button type="button" data-edit-schedule="'+esc(s.id)+'" '+(!s.active?'disabled':'')+'>Editar programação</button><button type="button" data-toggle-schedule="'+esc(s.id)+'" data-active="'+String(!s.active)+'">'+(s.active?'Pausar':'Reativar')+'</button><button type="button" data-delete-schedule="'+esc(s.id)+'">Excluir</button></div></article>';
      }).join(''):'<p class="shirley-portal__empty">Nenhuma programação recorrente cadastrada.</p>';
      recurrenceFeedback.textContent='';
    }catch(error){setFeedback(recurrenceFeedback,'Não foi possível carregar as recorrências: '+error.message,'error');}
  }
  function startScheduleEdit(schedule){
    editingScheduleId=schedule.id; selectedCustomerId=schedule.customer_id; customerId.value=schedule.customer_id;
    const p=profiles.find(x=>x.user_id===schedule.customer_id); customerSearch.value=p?.name||'';
    $('#shirley-selected-customer').textContent=[p?.name,p?.address,p?.phone].filter(Boolean).join(' · ');
    dateInput.value=schedule.start_date||today(); recurrenceInput.value=schedule.recurrence;
    form.querySelector('.shirley-portal__step').textContent='EDITAR RECORRÊNCIA';
    $('#shirley-form-title').textContent='Editar programação';
    $('#shirley-order-notes').value=schedule.notes||'';
    weekdayHost.querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=(schedule.weekdays||[1,2,3,4,5,6]).map(Number).includes(Number(input.value)));
    selectedQuantities.clear();
    for(const line of schedule.items||[]){
      const product=activeProducts().find(p=>p.id===line.productId)||activeProducts().find(p=>p.name===line.name);
      if(!product)continue;
      selectedQuantities.set(product.id,product.unit==='kg'?Math.max(1,Math.round(Number(line.weightGrams||50)/50)):Math.max(1,Number(line.quantity)||1));
    }
    $('#shirley-order-feedback').textContent='Você está editando uma recorrência existente. Salvar atualizará a programação futura.';
    setTab('new'); syncRecurrence(); renderProducts();
  }
  function resetForm(){
    form.reset(); editingScheduleId=null; selectedCustomerId=''; customerId.value=''; selectedQuantities.clear();
    dateInput.value=shiftDate(today()); recurrenceInput.value='once'; weekdayHost.hidden=true;
    $('#shirley-selected-customer').textContent='Nenhum cliente selecionado';
    form.querySelector('.shirley-portal__step').textContent='01 / PEDIDO';
    $('#shirley-form-title').textContent='Novo pedido';
    setFeedback(feedback,'');
    renderProducts();
  }
  function syncRecurrence(){weekdayHost.hidden=recurrenceInput.value==='once';}
  customerSearch.addEventListener('input',()=>{selectedCustomerId='';customerId.value='';$('#shirley-selected-customer').textContent='Selecione o cliente correto na lista.';renderCustomers();});
  customerSearch.addEventListener('focus',()=>renderCustomers());
  customerResults.addEventListener('click',event=>{const button=event.target.closest('[data-customer-id]');if(button)chooseCustomer(button.dataset.customerId);});
  document.addEventListener('click',event=>{if(!event.target.closest('#shirley-customer-search')&&!event.target.closest('#shirley-customer-results'))customerResults.hidden=true;});
  productSearch.addEventListener('input',renderProducts);
  productsHost.addEventListener('click',event=>{
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
    event.preventDefault(); if(!live?.operator){setFeedback(feedback,'Esta área exige uma conta operacional conectada.','error');return;}
    const profile=selectedProfile(); const date=dateInput.value; const recurrence=recurrenceInput.value;
    const items=chosenLines(); const weekdays=[...weekdayHost.querySelectorAll('input:checked')].map(input=>Number(input.value)).filter(day=>day>=1&&day<=6);
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
        await live.saveRecurringOrder({customerId:profile.user_id,recurrence:recurrence==='once'?'fixed':recurrence,startDate:date,notes,feeCents:200,weekdays,items:items.map(i=>({...i}))},requestId,editingScheduleId);
        await live.materializeRecurringOrders(date);
      }
      await live.load();
      ordersDate.value=date;resetForm();setTab('orders');renderOrders();
      setFeedback($('#shirley-orders-feedback'),'Pedido salvo com sucesso.','success');
    }catch(error){setFeedback(feedback,'Não foi possível salvar: '+error.message,'error');}
    finally{submit.disabled=false;}
  });
  window.addEventListener('trameli:orders-changed',()=>{if(activeTab==='orders')renderOrders();});
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
