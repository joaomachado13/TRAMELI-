import { enabled, LiveData } from './live-data.js';
import { requireAccess } from './auth-ui.js';
import { initAccount } from './account.js';
import { initPayments } from './payments.js';
import { initManualPix } from './manual-pix.js';
import { initShopping } from './shopping.js';
import * as orderMath from './order-math.js';
import * as financeMath from './finance-math.js';
import { init as initMotion } from './motion.js';
import clientCatalog from '../data/client-products.json';
import { withOfficialProductPhoto } from './product-photos.js';
import './live.css';
window.TrameliOrderMath = orderMath;
window.TrameliFinanceMath = financeMath;
window.TrameliSourceCatalog = clientCatalog.products.map(withOfficialProductPhoto);
window.TrameliProductPhoto = withOfficialProductPhoto;

if (enabled) {
  const live = new LiveData();
  window.TrameliLive = live;
  await requireAccess(live);
  document.querySelector('.prototype-note')?.remove();
  const notice = document.querySelector('.portal-prototype');
  if (notice) notice.textContent = 'Pedidos vinculados à sua conta. Pagamentos conferidos manualmente pela operação.';
  if (!live.operator) location.hash = '#loja';
  document.body.classList.toggle('live-customer', !live.operator);
  initAccount(live);
  live.startRealtime();
  const updateNotice = document.createElement('p');
  updateNotice.className = 'payment-notice'; updateNotice.setAttribute('role', 'status'); updateNotice.hidden = true;
  document.body.append(updateNotice);
  window.addEventListener('trameli:remote-change', event => {
    if (event.detail?.table !== 'trameli_orders' || !live.operator) return;
    updateNotice.textContent = event.detail.eventType === 'INSERT' ? 'Novo pedido recebido. A fila foi atualizada.' : 'A operação foi atualizada em outro dispositivo.';
    updateNotice.hidden = false; clearTimeout(updateNotice.timer);
    updateNotice.timer = setTimeout(() => { updateNotice.hidden = true; }, 8000);
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
  setInterval(() => { if (!document.hidden) synchronize(); }, 15000);
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
initMotion();
