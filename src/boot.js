import { enabled, LiveData } from './live-data.js';
import * as orderMath from './order-math.js';
import * as financeMath from './finance-math.js';
import { init as initMotion } from './motion.js';
import clientCatalog from '../data/client-products.json';
import './live.css';
window.TrameliOrderMath = orderMath;
window.TrameliFinanceMath = financeMath;
window.TrameliSourceCatalog = clientCatalog.products;

let live = null;
if (enabled) {
  live = new LiveData();
  window.TrameliLive = live;
  const gate = document.createElement('div');
  gate.className = 'live-gate';
  gate.innerHTML = `<div class="live-gate__panel"><strong class="live-gate__brand">Trameli.</strong><h1>Entre para continuar</h1><p>Enviaremos um link seguro para seu e-mail. Seus dados e pedidos estarão disponíveis quando você voltar.</p><form><label>Seu e-mail<input name="email" type="email" autocomplete="email" required placeholder="voce@exemplo.com"></label><button type="submit">Enviar link de acesso</button></form><p class="live-gate__message" role="status"></p></div>`;
  document.body.append(gate);
  try {
    const preflight = await live.preflight();
    if (!preflight.ready) {
      gate.querySelector('h1').textContent = 'Falta instalar o banco';
      gate.querySelector('p').textContent = 'O projeto Supabase está conectado, mas as tabelas da Trameli ainda não foram criadas. Aplique a migração inicial antes de entrar.';
      gate.querySelector('form').remove();
      await new Promise(() => {});
    }
    if (!(await live.authenticate())) {
      gate.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const message = gate.querySelector('.live-gate__message');
        message.textContent = 'Enviando…';
        try {
          await live.requestLink(event.target.elements.email.value.trim());
          message.textContent = 'Confira sua caixa de entrada e abra o link neste aparelho.';
        } catch (error) { message.textContent = `Não foi possível enviar: ${error.message}`; }
      });
      await new Promise(() => {});
    }
    await live.load();
    gate.remove();
    document.querySelector('.prototype-note')?.remove();
    const portalNotice = document.querySelector('.portal-prototype');
    if (portalNotice) portalNotice.textContent = 'Pedidos vinculados à sua conta. Pagamento Pix ainda não está integrado; preços só devem ser liberados após confirmação do catálogo.';
    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'live-logout';
    logout.textContent = 'Sair';
    logout.title = `Sair de ${live.user.email || 'sua conta'}`;
    logout.addEventListener('click', async () => {
      if (!confirm('Sair desta conta neste aparelho?')) return;
      const { error } = await live.client.auth.signOut();
      if (error) { alert(`Não foi possível sair: ${error.message}`); return; }
      location.reload();
    });
    document.querySelector(live.operator ? '.account-actions' : '.portal-header__actions')?.append(logout);
    if (!live.operator && location.hash !== '#loja') location.hash = '#loja';
    document.body.classList.toggle('live-customer', !live.operator);
    setInterval(() => { if (!document.hidden) live.load().catch(console.error); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) live.load().catch(console.error); });
  } catch (error) {
    gate.querySelector('.live-gate__message').textContent = `Erro ao conectar: ${error.message}`;
    // Do not initialize the offline prototype when live mode is configured.
    throw error;
  }
}

await import('../assets/catalogo.js');
await import('../assets/clientes.js');
await import('../assets/operacao.js');
await import('../assets/screens.js');
await import('../assets/portal.js');
initMotion();
