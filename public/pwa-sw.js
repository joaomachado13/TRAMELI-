const VERSION='pao-doce-pwa-v2';

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(['/offline.html','/pwa-icon.png'])));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('pao-doce-pwa-')&&key!==VERSION).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});

// Dados operacionais continuam network-only: nunca servimos pedidos/pagamentos antigos.
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(async()=>await caches.match('/offline.html')));
    return;
  }
  event.respondWith(fetch(request));
});

self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?.json()||{};}catch{payload={body:event.data?.text()||'Você tem uma nova atualização no Pão Doce.'};}
  const title=payload.title||'Pão Doce Delivery';
  const options={
    body:payload.body||'Você tem uma nova atualização no Pão Doce.',
    icon:payload.icon||'/pwa-icon.png',badge:payload.badge||'/pwa-icon.png',
    tag:payload.tag||VERSION,renotify:Boolean(payload.renotify),
    data:{url:payload.url||'/#loja',notificationId:payload.data?.notificationId||null,...(payload.data||{})},
  };
  event.waitUntil((async()=>{
    try{if(Number(payload.badgeCount)>0&&self.navigator?.setAppBadge)await self.navigator.setAppBadge(Number(payload.badgeCount));}catch{}
    await self.registration.showNotification(title,options);
  })());
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/#loja',self.location.origin);
  if(event.notification.data?.notificationId)target.searchParams.set('notification',event.notification.data.notificationId);
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){if('navigate'in client)await client.navigate(target.href);if('focus'in client){await client.focus();return;}}
    if(self.clients.openWindow)await self.clients.openWindow(target.href);
  })());
});
