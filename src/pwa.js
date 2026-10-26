
import './pwa.css';

const MANIFEST_HREF='/manifest.webmanifest';
const SERVICE_WORKER_URL='/pwa-sw.js';
const ICON_URL='/pwa-icon.png';
let deferredInstallPrompt=null;
let registrationPromise=null;
let live=null;
let inbox=[];
let unread=0;
let operatorHistory=[];
let customers=[];
let adminLoading=false;

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches===true||window.navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const permission=()=>('Notification'in window?Notification.permission:'unsupported');
const platform=()=>isIOS()?'ios':/android/i.test(navigator.userAgent)?'android':/mobile/i.test(navigator.userAgent)?'web':'desktop';

function ensureHead(){
  if(!document.querySelector('link[rel="manifest"]')){const el=document.createElement('link');el.rel='manifest';el.href=MANIFEST_HREF;document.head.append(el);}
  for(const [name,content] of [['theme-color','#8F3D22'],['apple-mobile-web-app-capable','yes'],['apple-mobile-web-app-status-bar-style','default'],['apple-mobile-web-app-title','Pão Doce']]){
    if(document.querySelector(`meta[name="${name}"]`))continue;const el=document.createElement('meta');el.name=name;el.content=content;document.head.append(el);
  }
  if(!document.querySelector('link[rel="apple-touch-icon"]')){const el=document.createElement('link');el.rel='apple-touch-icon';el.href=ICON_URL;document.head.append(el);}
}

async function registration(){
  if(!('serviceWorker'in navigator)||!window.isSecureContext)return null;
  if(!registrationPromise){
    registrationPromise=navigator.serviceWorker.register(SERVICE_WORKER_URL,{scope:'/'}).then(async reg=>{
      if(reg.waiting)showUpdate(reg);
      reg.addEventListener('updatefound',()=>{
        const worker=reg.installing;
        worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate(reg);});
      });
      return navigator.serviceWorker.ready;
    });
  }
  return registrationPromise;
}

function showUpdate(reg){
  if(document.querySelector('.pwa-update-toast'))return;
  const host=document.createElement('aside');host.className='pwa-update-toast';host.setAttribute('role','status');
  host.innerHTML='<span>Uma atualização do Pão Doce está pronta.</span><button type="button">Atualizar agora</button>';
  host.querySelector('button').addEventListener('click',()=>{(reg.waiting||reg.installing)?.postMessage({type:'SKIP_WAITING'});});
  document.body.append(host);
}
function setupNetworkStatus(){
  const render=()=>{
    let host=document.querySelector('.pwa-network-status');
    if(navigator.onLine){host?.remove();return;}
    if(!host){host=document.createElement('aside');host.className='pwa-network-status';host.setAttribute('role','status');document.body.append(host);}
    host.textContent='Sem internet. Pedidos e pagamentos não serão confirmados até a conexão voltar.';
  };
  addEventListener('online',render);addEventListener('offline',render);render();
}
function base64UrlToBytes(value){
  const padding='='.repeat((4-value.length%4)%4);const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
async function publicKey(){
  if(!live)throw new Error('Entre na sua conta primeiro.');
  const {data,error}=await live.client.rpc('trameli_push_public_key');
  if(error)throw error;if(!data)throw new Error('O serviço de notificações ainda está inicializando.');
  return data;
}
async function syncSubscription(create=false){
  if(!live?.user?.id)return false;
  const reg=await registration();if(!reg||!('PushManager'in window))return false;
  let sub=await reg.pushManager.getSubscription();
  if(!sub&&create){
    const key=await publicKey();
    sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToBytes(key)});
  }
  if(!sub)return false;
  const data=sub.toJSON();
  const {error}=await live.client.rpc('trameli_upsert_push_subscription',{
    p_endpoint:sub.endpoint,p_p256dh:data.keys?.p256dh||'',p_auth:data.keys?.auth||'',
    p_platform:platform(),p_user_agent:navigator.userAgent.slice(0,700),
  });
  if(error)throw error;
  return true;
}
async function enablePush(){
  if(permission()==='unsupported')throw new Error('Este navegador não oferece notificações Web Push.');
  if(isIOS()&&!isStandalone())throw new Error('No iPhone, adicione o Pão Doce à Tela de Início e abra pelo ícone antes de ativar.');
  let granted=permission();
  if(granted!=='granted')granted=await Notification.requestPermission();
  if(granted!=='granted')throw new Error('A permissão de notificações não foi liberada.');
  await syncSubscription(true);await refreshInbox();return true;
}
async function disablePush(){
  const reg=await registration();const sub=await reg?.pushManager?.getSubscription();
  if(sub&&live){await live.client.rpc('trameli_disable_push_subscription',{p_endpoint:sub.endpoint});await sub.unsubscribe();}
}
async function refreshUnread(){
  if(!live?.user?.id)return 0;
  const {data,error}=await live.client.rpc('trameli_unread_notification_count');
  if(!error)unread=Number(data||0);
  const badge=document.getElementById('portal-notification-count');
  if(badge){badge.textContent=unread>99?'99+':String(unread);badge.hidden=unread===0;}
  try{if('setAppBadge'in navigator){if(unread)await navigator.setAppBadge(unread);else await navigator.clearAppBadge();}}catch{}
  return unread;
}
async function refreshInbox(){
  if(!live?.user?.id)return [];
  const {data,error}=await live.client.rpc('trameli_notification_inbox',{p_limit:50});
  if(error)throw error;inbox=data||[];await refreshUnread();return inbox;
}
async function markRead(id){
  if(!live||!id)return;
  await live.client.rpc('trameli_mark_notification_read',{p_notification_id:id});
  const item=inbox.find(row=>row.id===id);if(item)item.read_at=new Date().toISOString();
  await refreshUnread();
}
async function dispatch(id){
  try{
    const {error}=await live.client.functions.invoke('trameli-push',{body:{action:'dispatch',notificationId:id}});
    if(error)throw error;
  }catch(error){console.warn('Notificação enfileirada; o envio automático fará nova tentativa.',error?.message||error);}
}
async function queueOrderEvent(orderId,event){
  if(!live||!orderId)return null;
  try{
    const {data,error}=await live.client.rpc('trameli_queue_order_event',{p_order_id:orderId,p_event:event});
    if(error)throw error;if(data)void dispatch(data);return data;
  }catch(error){console.warn('Pedido salvo, mas o aviso será tentado depois.',error?.message||error);return null;}
}
async function installApp(){
  if(isStandalone())return 'O Pão Doce já está instalado neste aparelho.';
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();try{await deferredInstallPrompt.userChoice;}catch{}deferredInstallPrompt=null;return 'Instalação solicitada.';}
  if(isIOS())return 'No iPhone: Safari → Compartilhar → Adicionar à Tela de Início.';
  return 'Use o menu do navegador e escolha Instalar aplicativo / Adicionar à tela inicial.';
}
function pushStatusText(){
  if(permission()==='granted')return 'Notificações permitidas neste aparelho.';
  if(permission()==='denied')return 'Notificações bloqueadas nas configurações do aparelho.';
  return 'Ative para receber confirmações, cobranças e lembretes.';
}
function inboxMarkup(){
  const rows=inbox.map(item=>`<button type="button" class="pwa-inbox__item" data-notification-open="${esc(item.id)}" data-url="${esc(item.url||'/#loja')}" data-unread="${String(!item.read_at)}"><strong>${esc(item.title)}</strong><time>${new Date(item.created_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</time><p>${esc(item.body)}</p></button>`).join('');
  return rows||'<p>Nenhum aviso por aqui ainda.</p>';
}
function ensureInboxDialog(){
  let dialog=document.getElementById('pwa-notification-dialog');if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='pwa-notification-dialog';dialog.className='pwa-notification-dialog';document.body.append(dialog);
  dialog.addEventListener('click',async event=>{
    if(event.target.closest('[data-notification-close]')){dialog.close();return;}
    const enable=event.target.closest('[data-notification-enable]');
    if(enable){const feedback=dialog.querySelector('[data-notification-feedback]');try{enable.disabled=true;await enablePush();feedback.textContent='Notificações ativadas neste aparelho.';}catch(e){feedback.textContent=e.message;}finally{enable.disabled=false;renderInboxDialog(dialog);}return;}
    const disable=event.target.closest('[data-notification-disable]');
    if(disable){await disablePush();renderInboxDialog(dialog);return;}
    const install=event.target.closest('[data-pwa-install-real]');
    if(install){dialog.querySelector('[data-notification-feedback]').textContent=await installApp();return;}
    const row=event.target.closest('[data-notification-open]');
    if(row){await markRead(row.dataset.notificationOpen);dialog.close();const url=new URL(row.dataset.url||'/#loja',location.origin);location.assign(url.href);}
  });
  return dialog;
}
function renderInboxDialog(dialog=ensureInboxDialog()){
  dialog.innerHTML=`<header class="pwa-notification-dialog__head"><div><span class="portal-eyebrow">PÃO DOCE</span><h2>Avisos</h2><p>${unread?unread+' não lido'+(unread===1?'':'s'):'Tudo lido'}</p></div><button class="pwa-notification-dialog__close" type="button" data-notification-close aria-label="Fechar">×</button></header>
  <div class="pwa-notification-dialog__body"><section class="pwa-push-card"><strong>Notificações no celular</strong><p>${esc(pushStatusText())}</p><div class="pwa-push-card__actions">${permission()==='granted'?'<button class="pwa-action" type="button" data-notification-disable>Desativar neste aparelho</button>':'<button class="pwa-action pwa-action--primary" type="button" data-notification-enable>Ativar notificações</button>'}${isStandalone()?'':'<button class="pwa-action" type="button" data-pwa-install-real>Instalar Pão Doce</button>'}</div><small data-notification-feedback></small></section><section class="pwa-inbox">${inboxMarkup()}</section></div>`;
}
async function openInbox(){
  try{await refreshInbox();}catch{}
  const dialog=ensureInboxDialog();renderInboxDialog(dialog);if(!dialog.open)dialog.showModal();
}

const statusLabel=status=>({queued:'Na fila',sending:'Enviando',sent:'Enviado',partial:'Parcial',failed:'Falhou'})[status]||status;
function renderOperatorShell(){return '<section class="notifications-admin" data-notifications-admin><p>Carregando Central de Notificações…</p></section>';}
async function loadOperator(){
  if(!live?.operator||adminLoading)return;adminLoading=true;
  try{
    const [historyResult,profilesResult]=await Promise.all([
      live.client.from('trameli_notifications').select('*').order('created_at',{ascending:false}).limit(50),
      live.client.from('trameli_profiles').select('user_id,name').order('name'),
    ]);
    if(historyResult.error)throw historyResult.error;if(profilesResult.error)throw profilesResult.error;
    operatorHistory=historyResult.data||[];customers=(profilesResult.data||[]).filter(row=>row.user_id!==live.user.id);
  }finally{adminLoading=false;}
}
function operatorMarkup(){
  const options=customers.map(c=>`<option value="${esc(c.user_id)}">${esc(c.name)}</option>`).join('');
  const rows=operatorHistory.map(n=>`<div class="notifications-history__row"><div><strong>${esc(n.title)}</strong><small>${new Date(n.created_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</small></div><span class="notifications-status">${esc(statusLabel(n.status))}</span><span>${Number(n.sent_count||0)}/${Number(n.target_count||0)}</span><span>${esc(n.audience)}</span></div>`).join('');
  return `<div class="notifications-admin__grid"><section class="notifications-admin__card"><span class="screen-eyebrow">ENVIO MANUAL</span><h2>Nova notificação</h2><form class="notifications-admin__form" data-notification-form><label>Título<input name="title" maxlength="80" placeholder="Ex.: Pedidos de amanhã" required></label><label>Mensagem<textarea name="body" maxlength="360" rows="4" placeholder="Escreva o aviso para os clientes…" required></textarea></label><label>Destinatários<select name="audience" data-notification-audience><option value="all">Todos os clientes</option><option value="selected">Clientes selecionados</option><option value="order_tomorrow">Quem tem pedido amanhã</option><option value="payment_pending">Com pagamento pendente</option><option value="operators">Equipe / aparelhos da operação</option></select></label><label data-selected-customers hidden>Clientes<select name="customers" multiple size="8">${options}</select><small>Segure Ctrl/Cmd para selecionar mais de um.</small></label><label>Abrir ao tocar<select name="url"><option value="/#loja">Início do Pão Doce</option><option value="/?portal=orders#loja">Meus pedidos / pagamentos</option><option value="/?portal=catalog#loja">Catálogo</option></select></label><button class="screen-primary" type="submit">Enviar notificação</button><p class="notifications-admin__feedback" data-notification-admin-feedback></p></form></section><section class="notifications-admin__card notifications-admin__device"><span class="screen-eyebrow">ESTE APARELHO</span><h2>Push da operação</h2><p>${esc(pushStatusText())}</p><div><button class="pwa-action pwa-action--primary" type="button" data-notification-enable-admin>Ativar neste aparelho</button> <button class="pwa-action" type="button" data-pwa-test-real>Testar local</button></div><small data-device-feedback></small></section></div><section class="notifications-admin__card"><span class="screen-eyebrow">HISTÓRICO</span><h2>Últimos envios</h2><div class="notifications-history">${rows||'<p>Nenhum envio registrado ainda.</p>'}</div></section>`;
}
async function hydrateOperator(){
  const host=document.querySelector('[data-notifications-admin]');if(!host||!live?.operator)return;
  try{await loadOperator();host.innerHTML=operatorMarkup();}catch(e){host.innerHTML=`<p>Não foi possível carregar as notificações: ${esc(e.message)}</p>`;}
}
async function submitManual(form){
  const feedback=form.querySelector('[data-notification-admin-feedback]');const button=form.querySelector('[type="submit"]');
  const audience=form.elements.audience.value;
  const ids=audience==='selected'?[...form.elements.customers.selectedOptions].map(o=>o.value):null;
  button.disabled=true;feedback.textContent='Enfileirando…';
  try{
    const {data,error}=await live.client.rpc('trameli_create_notification',{
      p_title:form.elements.title.value.trim(),p_body:form.elements.body.value.trim(),
      p_url:form.elements.url.value,p_audience:audience,p_customer_ids:ids,
    });
    if(error)throw error;
    feedback.textContent='Notificação criada. Enviando agora…';form.reset();
    await dispatch(data);
    await loadOperator();document.querySelector('[data-notifications-admin]').innerHTML=operatorMarkup();
  }catch(e){feedback.textContent=e.message||'Não foi possível enviar.';}finally{button.disabled=false;}
}
async function testLocal(){
  const reg=await registration();if(!reg)throw new Error('PWA indisponível.');
  if(permission()!=='granted')await enablePush();
  await reg.showNotification('Pão Doce Delivery 🍞',{body:'Notificação local de teste funcionando.',icon:ICON_URL,badge:ICON_URL,tag:'pao-doce-local-'+Date.now(),renotify:true,data:{url:'/#loja'}});
}
async function handleIncomingRead(){
  if(!live)return;const params=new URLSearchParams(location.search);const id=params.get('notification');if(!id)return;
  try{await markRead(id);}catch{}
  params.delete('notification');const query=params.toString();history.replaceState(history.state,'',location.pathname+(query?'?'+query:'')+location.hash);
}

export function initPwa(){
  const hadController=Boolean(navigator.serviceWorker?.controller);
  ensureHead();setupNetworkStatus();void registration().catch(()=>{});
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;});
  addEventListener('appinstalled',()=>{deferredInstallPrompt=null;});
  navigator.serviceWorker?.addEventListener('controllerchange',()=>{if(hadController)location.reload();});
}
export async function connectPwa(liveData){
  live=liveData;if(!live?.user?.id)return;
  window.TrameliNotifications={renderOperatorShell,hydrateOperator,openInbox,enablePush,disablePush,queueOrderEvent,refreshInbox,refreshUnread,installApp,testLocal,share:async data=>{
    if(navigator.share){await navigator.share(data);return true;}
    if(navigator.clipboard){await navigator.clipboard.writeText([data.title,data.text,data.url].filter(Boolean).join('\n'));return true;}
    return false;
  }};
  if(permission()==='granted'){try{await syncSubscription(true);}catch(error){console.warn('Não foi possível sincronizar o push deste aparelho.',error?.message||error);}}
  await handleIncomingRead();await refreshUnread();
  const portalButton=document.getElementById('portal-notifications-link');portalButton?.addEventListener('click',()=>void openInbox());
  if(new URLSearchParams(location.search).get('portal')==='notifications')setTimeout(()=>void openInbox(),50);
  addEventListener('trameli:route-rendered',event=>{if(event.detail?.route==='notificacoes')void hydrateOperator();});
  document.addEventListener('change',event=>{const select=event.target.closest('[data-notification-audience]');if(select){const host=select.form?.querySelector('[data-selected-customers]');if(host)host.hidden=select.value!=='selected';}});
  document.addEventListener('submit',event=>{const form=event.target.closest('[data-notification-form]');if(form){event.preventDefault();void submitManual(form);}});
  document.addEventListener('click',async event=>{
    const enable=event.target.closest('[data-notification-enable-admin]');if(enable){const out=document.querySelector('[data-device-feedback]');try{enable.disabled=true;await enablePush();out.textContent='Este aparelho está inscrito para push real.';}catch(e){out.textContent=e.message;}finally{enable.disabled=false;}return;}
    const test=event.target.closest('[data-pwa-test-real]');if(test){const out=document.querySelector('[data-device-feedback]');try{await testLocal();out.textContent='Teste enviado para este aparelho.';}catch(e){out.textContent=e.message;}return;}
  });
}
