const VERSION = 'pao-doce-pwa-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Piloto propositalmente sem cache.
// Pedidos, pagamentos, catálogo e autenticação continuam sempre dependentes da rede
// e das fontes atuais do sistema, evitando servir dados antigos durante os testes.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(request));
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || 'Você tem uma nova atualização no Pão Doce.' };
  }

  const title = payload.title || 'Pão Doce Delivery';
  const options = {
    body: payload.body || 'Você tem uma nova atualização no Pão Doce.',
    icon: payload.icon || '/pwa-icon.png',
    badge: payload.badge || '/pwa-icon.png',
    tag: payload.tag || VERSION,
    renotify: Boolean(payload.renotify),
    data: {
      url: payload.url || '/#loja',
      ...(payload.data || {}),
    },
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    try {
      const count = Number(payload.badgeCount || 0);
      if (count > 0 && 'setAppBadge' in navigator) await navigator.setAppBadge(count);
      else if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
    } catch { /* Badge support varies by platform. */ }

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach(client => client.postMessage({ type: 'trameli:push-received', notificationId: payload.data?.notificationId || null }));
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/#loja', self.location.origin);
  const notificationId = event.notification.data?.notificationId;
  if (notificationId) targetUrl.searchParams.set('notification', notificationId);
  const target = targetUrl.href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('navigate' in client) {
        await client.navigate(target);
      }
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
