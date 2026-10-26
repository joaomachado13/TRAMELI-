import { formatCustomerName } from './customer-display.js';
import { enabled, LiveData } from './live-data.js';
import { requireAccess } from './auth-ui.js';
import { initAccount } from './account.js';
import { initPayments } from './payments.js';
import { initManualPix } from './manual-pix.js';
import { initShopping } from './shopping.js';
import * as orderMath from './order-math.js';
import * as financeMath from './finance-math.js';
import { init as initMotion } from './motion.js';
import { initPwa, connectPwa } from './pwa.js';
import clientCatalog from '../data/client-products.json';
import { withOfficialProductPhoto } from './product-photos.js';
import './live.css';
window.TrameliOrderMath = orderMath;
window.TrameliFinanceMath = financeMath;
window.TrameliSourceCatalog = clientCatalog.products.map(withOfficialProductPhoto);
window.TrameliProductPhoto = withOfficialProductPhoto;

// PWA de produção: instalação, atualização e camada de conectividade.
// Dados operacionais continuam sempre vindos da rede/Supabase.
initPwa();

// A raiz pública sempre começa no portal do cliente, antes de carregar qualquer tela.
// Preserve hashes de callback do Supabase e rotas internas explícitas.
if (!location.hash) {
  history.replaceState(history.state, '', `${location.pathname}${location.search}#loja`);
}
const deepLinkOrder = new URLSearchParams(location.search).get('open-order');
if (deepLinkOrder) {
  try { sessionStorage.setItem('trameli-pending-open-order', deepLinkOrder); } catch { /* Direct hash navigation still works. */ }
  if (location.hash !== '#operacao') location.hash = '#operacao';
}

if (enabled) {
  const live = new LiveData();
  window.TrameliLive = live;
  await requireAccess(live);
  document.querySelector('.prototype-note')?.remove();
  document.querySelector('.portal-prototype')?.remove();
  if (!live.operator) location.hash = '#loja';
  document.body.classList.toggle('live-customer', !live.operator);
  initAccount(live);
  void connectPwa(live).catch(error => console.warn('PWA conectado sem push.', error?.message || error));
  live.startRealtime();
  const updateNotice = document.createElement('p');
  updateNotice.className = 'payment-notice'; updateNotice.setAttribute('role', 'status'); updateNotice.hidden = true;
  document.body.append(updateNotice);

  const realtimeNotifications = document.createElement('section');
  realtimeNotifications.className = 'realtime-order-notifications';
  realtimeNotifications.setAttribute('aria-label', 'Pedidos recebidos agora');
  realtimeNotifications.setAttribute('aria-live', 'polite');
  document.body.append(realtimeNotifications);

  const realtimeOrderIds = new Set();
  let orderAudioContext = null;
  const armOrderSound = () => {
    if (!live.operator) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      if (!orderAudioContext) orderAudioContext = new AudioContext();
      if (orderAudioContext.state === 'suspended') void orderAudioContext.resume().catch(() => {});
    } catch { /* Visual alert still works. */ }
  };
  armOrderSound();
  document.addEventListener('pointerdown', armOrderSound, { once: true, passive: true });
  document.addEventListener('keydown', armOrderSound, { once: true });

  const playOrderSound = async () => {
    if (!orderAudioContext) return;
    try {
      if (orderAudioContext.state === 'suspended') await orderAudioContext.resume();
      const now = orderAudioContext.currentTime;
      const gain = orderAudioContext.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      gain.connect(orderAudioContext.destination);
      for (const [frequency, delay] of [[740, 0], [980, 0.13]]) {
        const oscillator = orderAudioContext.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, now + delay);
        oscillator.connect(gain);
        oscillator.start(now + delay);
        oscillator.stop(now + delay + 0.22);
      }
    } catch { /* Browser autoplay policy can block sound before interaction. */ }
  };

  const formatDeliveryDate = value => {
    if (!value) return 'Entrega a confirmar';
    try { return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }); }
    catch { return value; }
  };

  const openRealtimeOrder = async orderId => {
    if (!orderId) return;
    try { window.focus(); } catch { /* Optional. */ }
    try { await live.load(true); } catch { /* Existing cache can still open the order. */ }
    if (window.TrameliOperation?.openOrder) {
      await window.TrameliOperation.openOrder(orderId);
      return;
    }
    try { sessionStorage.setItem('trameli-pending-open-order', orderId); } catch { /* Hash navigation remains available. */ }
    location.hash = '#operacao';
  };

  const dismissRealtimeToast = toast => {
    if (!toast?.isConnected || toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 260);
  };

  const showRealtimeOrder = row => {
    const id = row?.id;
    if (!id || realtimeOrderIds.has(id)) return;
    realtimeOrderIds.add(id);
    if (realtimeOrderIds.size > 120) realtimeOrderIds.delete(realtimeOrderIds.values().next().value);

    const toast = document.createElement('article');
    toast.className = 'realtime-order-toast';
    toast.dataset.orderId = id;

    const icon = document.createElement('span');
    icon.className = 'realtime-order-toast__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '+';

    const body = document.createElement('div');
    body.className = 'realtime-order-toast__body';
    const eyebrow = document.createElement('span');
    eyebrow.textContent = 'NOVO PEDIDO';
    const customer = document.createElement('strong');
    customer.textContent = formatCustomerName(row.customer_name || 'Cliente');
    const details = document.createElement('small');
    const code = row.public_code ? `#${row.public_code} · ` : '';
    details.textContent = `${code}${formatDeliveryDate(row.delivery_date)}`;
    body.append(eyebrow, customer, details);

    const actions = document.createElement('div');
    actions.className = 'realtime-order-toast__actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'realtime-order-toast__open';
    open.textContent = 'Abrir pedido';
    open.addEventListener('click', () => { dismissRealtimeToast(toast); void openRealtimeOrder(id); });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'realtime-order-toast__close';
    close.setAttribute('aria-label', 'Fechar aviso');
    close.textContent = '×';
    close.addEventListener('click', () => dismissRealtimeToast(toast));
    actions.append(open, close);
    toast.append(icon, body, actions);
    realtimeNotifications.prepend(toast);

    [...realtimeNotifications.querySelectorAll('.realtime-order-toast')].slice(4).forEach(dismissRealtimeToast);
    setTimeout(() => dismissRealtimeToast(toast), 12000);
    void playOrderSound();
    navigator.vibrate?.(120);

    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const browserNotification = new Notification('Novo pedido recebido', {
          body: `${formatCustomerName(row.customer_name || 'Cliente')} · ${formatDeliveryDate(row.delivery_date)}`,
          tag: `trameli-order-${id}`,
        });
        browserNotification.onclick = () => { browserNotification.close(); void openRealtimeOrder(id); };
      } catch { /* In-app alert remains the source of truth. */ }
    }
  };

  window.addEventListener('trameli:remote-change', event => {
    if (event.detail?.table !== 'trameli_orders' || !live.operator) return;
    const payload = event.detail;
    const row = payload.new || {};
    if (payload.eventType === 'INSERT' && row.source === 'portal') {
      updateNotice.hidden = true;
      showRealtimeOrder(row);
      return;
    }
    updateNotice.textContent = payload.eventType === 'INSERT' ? 'Novo pedido da operação registrado.' : 'A operação foi atualizada em outro dispositivo.';
    updateNotice.hidden = false; clearTimeout(updateNotice.timer);
    updateNotice.timer = setTimeout(() => { updateNotice.hidden = true; }, 5000);
  });
  const currentUserId = live.user.id;
  live.client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      try { localStorage.removeItem('trameli-portal-cart-v1'); sessionStorage.removeItem('trameli-checkout-request-v1'); } catch { /* Optional storage. */ }
    }
    if (event === 'SIGNED_OUT' || (session?.user && session.user.id !== currentUserId)) location.reload();
    if (event === 'PASSWORD_RECOVERY') location.reload();
  });
  const synchronize = async () => {
    try {
      const previousRole = live.role;
      if (!(await live.authenticate())) { location.reload(); return; }
      if (live.role !== previousRole) { location.reload(); return; }
      await live.load();
    } catch (error) { console.error('Não foi possível atualizar os dados da operação.', error.code || error.name); }
  };
  // Realtime handles normal changes. This is only a quiet fallback and must not keep repainting the UI.
  setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) synchronize(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) synchronize(); });
}

initPayments(window.TrameliLive);
initManualPix(window.TrameliLive);
initShopping(window.TrameliLive);
await import('../assets/catalogo.js');
await import('../assets/clientes.js');
await import('../assets/operacao.js');
await import('../assets/screens.js');
await import('../assets/portal.js');
await import('../assets/shirley-portal.js');
initMotion();
// Só revela a aplicação depois que a rota correta e seus componentes estão prontos.
document.body.classList.remove('app-booting');


/* Modal UX: clicking the backdrop closes any non-busy dialog. */
document.addEventListener('click', event => {
  const dialog = event.target instanceof HTMLDialogElement ? event.target : null;
  if (!dialog || !dialog.open || dialog.querySelector('[data-busy="true"], [data-busy]')) return;
  const rect = dialog.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outside) dialog.close();
});
