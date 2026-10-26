import { getPwaRegistration, isPwaStandalone, promptPwaInstall } from './pwa.js';
import './notifications.css';

const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const formatDateTime = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/windows|macintosh|linux/i.test(ua)) return 'desktop';
  return 'web';
}

function base64UrlToBytes(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

function pushCapability() {
  if (!window.isSecureContext) return { supported: false, reason: 'O navegador precisa estar em conexão segura.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { supported: false, reason: 'Este navegador não oferece Web Push.' };
  }
  return { supported: true, reason: '' };
}

class TrameliNotifications {
  constructor(live) {
    this.live = live;
    this.inbox = [];
    this.operatorHistory = [];
    this.unread = 0;
    this.subscription = null;
    this.busy = false;
    this.portalDialog = null;
    this.portalButton = null;
    this.initialized = false;
  }

  async init() {
    if (!this.live?.user || this.initialized) return;
    this.initialized = true;
    this.ensurePortalUi();
    this.bindGlobalEvents();

    // Se a pessoa já autorizou notificações durante o piloto ou em uma visita
    // anterior, conclui silenciosamente o cadastro real do aparelho.
    if (pushCapability().supported && Notification.permission === 'granted') {
      try { await this.ensureSubscription(false); } catch (error) { console.warn('Não foi possível sincronizar a inscrição push.', error?.message || error); }
    }

    await this.refreshInbox().catch(() => {});
    await this.handleDeepLink().catch(() => {});
  }

  ensurePortalUi() {
    const actions = document.querySelector('.portal-header__actions');
    if (actions && !document.getElementById('portal-notifications-link')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'portal-notifications-link';
      button.className = 'portal-notifications-link';
      button.innerHTML = '<span aria-hidden="true">🔔</span><span>Avisos</span><strong data-notification-count hidden>0</strong>';
      button.setAttribute('aria-label', 'Abrir avisos');
      actions.insertBefore(button, document.getElementById('portal-orders-link'));
      this.portalButton = button;
    } else {
      this.portalButton = document.getElementById('portal-notifications-link');
    }

    if (!document.getElementById('notification-inbox-dialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'notification-inbox-dialog';
      dialog.className = 'notification-inbox-dialog';
      dialog.innerHTML = '<div data-notification-inbox-host></div>';
      document.body.append(dialog);
      this.portalDialog = dialog;
    } else {
      this.portalDialog = document.getElementById('notification-inbox-dialog');
    }
  }

  bindGlobalEvents() {
    this.portalButton?.addEventListener('click', () => this.openInbox());
    this.portalDialog?.addEventListener('click', event => {
      if (event.target === this.portalDialog) this.portalDialog.close();
    });

    document.addEventListener('click', event => {
      if (event.target.closest('[data-notification-close]')) {
        this.portalDialog?.close();
        return;
      }
      const enable = event.target.closest('[data-notification-enable]');
      if (enable) { void this.enablePush(enable); return; }
      const install = event.target.closest('[data-notification-install]');
      if (install) { void this.installApp(install); return; }
      const item = event.target.closest('[data-notification-open]');
      if (item) { void this.openNotification(item.dataset.notificationOpen); return; }
      const refresh = event.target.closest('[data-notification-refresh]');
      if (refresh) { void this.refreshCurrentViews(); return; }
      const resend = event.target.closest('[data-notification-dispatch]');
      if (resend && this.live.operator) { void this.dispatch(resend.dataset.notificationDispatch, resend); return; }
    });

    document.addEventListener('submit', event => {
      if (!event.target.matches('[data-notification-form]')) return;
      event.preventDefault();
      void this.sendManual(event.target);
    });

    document.addEventListener('change', event => {
      if (!event.target.matches('[name="audience"]')) return;
      document.querySelectorAll('[data-notification-selected-customers]').forEach(host => {
        host.hidden = event.target.value !== 'selected';
      });
    });

    window.addEventListener('trameli:route-rendered', event => {
      if (event.detail?.route === 'notificacoes') void this.refreshOperatorCentral();
    });
    window.addEventListener('trameli:portal-open', () => {
      this.ensurePortalUi();
      this.syncCounters();
    });

    navigator.serviceWorker?.addEventListener('message', event => {
      if (event.data?.type === 'trameli:push-received') void this.refreshInbox();
    });
  }

  async ensureSubscription(requestPermission = true) {
    const capability = pushCapability();
    if (!capability.supported) throw new Error(capability.reason);

    if (Notification.permission === 'default' && requestPermission) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('As notificações não foram autorizadas neste aparelho.');
    }
    if (Notification.permission !== 'granted') throw new Error('As notificações estão desativadas neste aparelho.');

    const registration = await getPwaRegistration();
    if (!registration) throw new Error('O serviço do aplicativo ainda não ficou pronto.');

    const keyResult = await this.live.client.rpc('trameli_push_public_key');
    if (keyResult.error) throw keyResult.error;
    if (!keyResult.data) throw new Error('A chave de notificações ainda não está disponível.');

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(keyResult.data),
      });
    }

    const json = subscription.toJSON();
    const upsert = await this.live.client.rpc('trameli_upsert_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys?.p256dh || '',
      p_auth: json.keys?.auth || '',
      p_platform: detectPlatform(),
      p_user_agent: navigator.userAgent || '',
    });
    if (upsert.error) throw upsert.error;

    this.subscription = subscription;
    return subscription;
  }

  async enablePush(button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Ativando…';
    try {
      await this.ensureSubscription(true);
      await this.refreshInbox();
      this.renderInbox();
    } catch (error) {
      this.setFeedback(error.message || 'Não foi possível ativar as notificações.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async installApp(button) {
    const original = button.textContent;
    button.disabled = true;
    try {
      const result = await promptPwaInstall();
      if (!result?.available && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
        this.setFeedback('No iPhone: Safari → Compartilhar → Adicionar à Tela de Início.', 'info');
      } else if (result?.accepted) {
        this.setFeedback('Pão Doce instalado neste aparelho.', 'success');
      }
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async refreshInbox() {
    if (!this.live?.user) return;
    const [inboxResult, countResult] = await Promise.all([
      this.live.client.rpc('trameli_notification_inbox', { p_limit: 60 }),
      this.live.client.rpc('trameli_unread_notification_count'),
    ]);
    if (inboxResult.error) throw inboxResult.error;
    if (countResult.error) throw countResult.error;
    this.inbox = inboxResult.data || [];
    this.unread = Number(countResult.data || 0);
    this.syncCounters();
    await this.syncAppBadge();
    if (this.portalDialog?.open) this.renderInbox();
  }

  async syncAppBadge() {
    try {
      if (this.unread > 0 && 'setAppBadge' in navigator) await navigator.setAppBadge(this.unread);
      else if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
    } catch { /* Badge is optional. */ }
  }

  syncCounters() {
    const count = Math.max(0, this.unread);
    document.querySelectorAll('[data-notification-count]').forEach(node => {
      node.textContent = String(count);
      node.hidden = count === 0;
    });
    const top = document.querySelector('.notification-button .notification-count');
    if (top) {
      top.textContent = String(count);
      top.hidden = count === 0;
    }
    const nav = document.getElementById('nav-notification-count');
    if (nav) {
      nav.textContent = String(count);
      nav.hidden = count === 0;
    }
    this.portalButton?.setAttribute('aria-label', count ? `${count} avisos não lidos` : 'Abrir avisos');
  }

  async openInbox() {
    this.ensurePortalUi();
    await this.refreshInbox().catch(() => {});
    this.renderInbox();
    this.portalDialog?.showModal();
  }

  pushStatusMarkup() {
    const capability = pushCapability();
    if (!capability.supported) return `<div class="notification-permission notification-permission--muted"><strong>Notificações indisponíveis</strong><span>${escapeHtml(capability.reason)}</span></div>`;
    if (Notification.permission === 'granted') {
      return `<div class="notification-permission notification-permission--ok"><strong>Notificações ativadas</strong><span>Este aparelho pode receber avisos do Pão Doce.</span></div>`;
    }
    if (Notification.permission === 'denied') {
      return `<div class="notification-permission notification-permission--muted"><strong>Notificações bloqueadas</strong><span>Libere o Pão Doce nas configurações de notificações do aparelho.</span></div>`;
    }
    const installHint = !isPwaStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)
      ? '<button type="button" class="notification-secondary" data-notification-install>Como instalar no iPhone</button>' : '';
    return `<div class="notification-permission"><div><strong>Receba avisos do Pão Doce</strong><span>Pedidos, pagamentos e lembretes importantes.</span></div><div><button type="button" class="notification-primary" data-notification-enable>Ativar notificações</button>${installHint}</div></div>`;
  }

  renderInbox() {
    const host = this.portalDialog?.querySelector('[data-notification-inbox-host]');
    if (!host) return;
    const rows = this.inbox.length
      ? this.inbox.map(item => `
        <button type="button" class="notification-inbox-item ${item.read_at ? '' : 'is-unread'}" data-notification-open="${escapeHtml(item.id)}">
          <span class="notification-inbox-item__dot" aria-hidden="true"></span>
          <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body)}</small><time>${escapeHtml(formatDateTime(item.created_at))}</time></span>
        </button>`).join('')
      : '<div class="notification-empty"><strong>Nenhum aviso por aqui.</strong><span>Quando houver algo importante, ele também ficará salvo nesta caixa.</span></div>';
    host.innerHTML = `
      <header class="notification-inbox-head"><div><span>PAO DOCE</span><h2>Avisos</h2></div><button type="button" data-notification-close aria-label="Fechar">×</button></header>
      ${this.pushStatusMarkup()}
      <div class="notification-inbox-list">${rows}</div>
    `;
  }

  async openNotification(id) {
    const item = this.inbox.find(row => row.id === id);
    if (!item) return;
    if (!item.read_at) {
      const result = await this.live.client.rpc('trameli_mark_notification_read', { p_notification_id: id });
      if (!result.error) {
        item.read_at = new Date().toISOString();
        this.unread = Math.max(0, this.unread - 1);
        this.syncCounters();
        await this.syncAppBadge();
      }
    }
    this.portalDialog?.close();
    if (item.url) location.href = item.url;
  }

  async handleDeepLink() {
    const params = new URLSearchParams(location.search);
    const notificationId = params.get('notification');
    if (notificationId) {
      await this.live.client.rpc('trameli_mark_notification_read', { p_notification_id: notificationId });
      params.delete('notification');
      history.replaceState(history.state, '', `${location.pathname}${params.toString() ? '?' + params.toString() : ''}${location.hash}`);
      await this.refreshInbox();
    }
  }

  operatorCustomers() {
    return (window.TrameliClients?.list?.() || [])
      .filter(client => client.customerId)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { sensitivity: 'base' }));
  }

  renderOperator() {
    if (!this.live?.operator) return '<div class="friendly-empty"><strong>Acesso restrito.</strong><span>Somente a operação pode enviar notificações.</span></div>';
    const customers = this.operatorCustomers();
    return `
      <section class="notification-center" data-notification-center>
        <header class="notification-center__header">
          <div><p class="screen-eyebrow">COMUNICACAO</p><h1>Notificações</h1><p>Envie avisos manuais e acompanhe o que o sistema já disparou.</p></div>
          <button type="button" class="screen-secondary" data-notification-refresh>Atualizar</button>
        </header>
        <div class="notification-center__grid">
          <form class="notification-compose" data-notification-form>
            <div><span class="notification-kicker">NOVO AVISO</span><h2>Enviar notificação</h2></div>
            <label>Título<input name="title" maxlength="80" required placeholder="Ex.: Entregas de amanhã"></label>
            <label>Mensagem<textarea name="body" maxlength="360" rows="4" required placeholder="Escreva uma mensagem curta e clara."></textarea></label>
            <div class="notification-compose__row">
              <label>Destinatários
                <select name="audience">
                  <option value="all">Todos os clientes</option>
                  <option value="selected">Clientes selecionados</option>
                  <option value="order_tomorrow">Com pedido amanhã</option>
                  <option value="payment_pending">Com pagamento pendente</option>
                  <option value="operators">Operação / Shirley</option>
                </select>
              </label>
              <label>Abrir em
                <select name="url">
                  <option value="/#loja">Início do Pão Doce</option>
                  <option value="/?portal=orders#loja">Meus pedidos / pagamentos</option>
                  <option value="/?portal=catalog#loja">Catálogo</option>
                  <option value="/#operacao">Operação diária</option>
                  <option value="/#notificacoes">Central de notificações</option>
                </select>
              </label>
            </div>
            <div class="notification-customer-picker" data-notification-selected-customers hidden>
              <strong>Escolha os clientes</strong>
              <label class="notification-customer-search">Pesquisar<input type="search" data-notification-customer-search placeholder="Nome do cliente"></label>
              <div class="notification-customer-list">
                ${customers.map(client => `<label data-notification-customer-name="${escapeHtml(String(client.name || '').toLowerCase())}"><input type="checkbox" name="customerId" value="${escapeHtml(client.customerId)}"><span>${escapeHtml(client.name)}</span></label>`).join('')}
              </div>
            </div>
            <p class="notification-compose__feedback" data-notification-feedback role="status"></p>
            <button type="submit" class="screen-primary">Enviar notificação</button>
          </form>
          <section class="notification-history">
            <div class="notification-history__head"><div><span class="notification-kicker">HISTORICO</span><h2>Envios recentes</h2></div></div>
            <div data-notification-history><div class="friendly-empty"><strong>Carregando envios…</strong></div></div>
          </section>
        </div>
      </section>
    `;
  }

  async refreshOperatorCentral() {
    if (!this.live?.operator || location.hash !== '#notificacoes') return;
    const result = await this.live.client.from('trameli_notifications')
      .select('id,title,body,audience,status,target_count,sent_count,failed_count,created_at,sent_at,kind')
      .order('created_at', { ascending: false })
      .limit(40);
    if (result.error) {
      this.setFeedback('Não foi possível carregar o histórico.', 'error');
      return;
    }
    this.operatorHistory = result.data || [];
    const host = document.querySelector('[data-notification-history]');
    if (!host) return;
    host.innerHTML = this.operatorHistory.length ? this.operatorHistory.map(item => {
      const status = ({ queued:'Na fila',sending:'Enviando',sent:'Enviada',partial:'Parcial',failed:'Falhou' })[item.status] || item.status;
      const stats = item.status === 'queued' || item.status === 'sending'
        ? `${item.target_count || 0} destinatários`
        : `${item.sent_count || 0} enviados · ${item.failed_count || 0} sem entrega`;
      return `<article class="notification-history-item"><div><span class="notification-history-item__status notification-history-item__status--${escapeHtml(item.status)}">${escapeHtml(status)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p><small>${escapeHtml(formatDateTime(item.created_at))} · ${escapeHtml(stats)}</small></div>${item.status === 'queued' ? `<button type="button" class="notification-secondary" data-notification-dispatch="${escapeHtml(item.id)}">Enviar agora</button>` : ''}</article>`;
    }).join('') : '<div class="friendly-empty"><strong>Nenhum envio ainda.</strong><span>Os avisos manuais e automáticos aparecerão aqui.</span></div>';

    const search = document.querySelector('[data-notification-customer-search]');
    if (search && !search.dataset.bound) {
      search.dataset.bound = 'true';
      search.addEventListener('input', () => {
        const query = search.value.trim().toLocaleLowerCase('pt-BR');
        document.querySelectorAll('[data-notification-customer-name]').forEach(label => {
          label.hidden = query && !label.dataset.notificationCustomerName.includes(query);
        });
      });
    }
  }

  async sendManual(form) {
    if (this.busy) return;
    const data = new FormData(form);
    const audience = String(data.get('audience') || 'all');
    const customerIds = data.getAll('customerId').map(String).filter(Boolean);
    if (audience === 'selected' && !customerIds.length) {
      this.setFeedback('Selecione pelo menos um cliente.', 'error');
      return;
    }

    const submit = form.querySelector('[type="submit"]');
    const original = submit.textContent;
    this.busy = true;
    submit.disabled = true;
    submit.textContent = 'Enviando…';
    this.setFeedback('');

    try {
      const created = await this.live.client.rpc('trameli_create_notification', {
        p_title: String(data.get('title') || '').trim(),
        p_body: String(data.get('body') || '').trim(),
        p_url: String(data.get('url') || '/#loja'),
        p_audience: audience,
        p_customer_ids: audience === 'selected' ? customerIds : null,
      });
      if (created.error) throw created.error;
      const notificationId = created.data;

      const dispatched = await this.live.client.functions.invoke('trameli-push', {
        body: { action: 'dispatch', notificationId },
      });
      if (dispatched.error) throw dispatched.error;

      const summary = dispatched.data?.result;
      if (summary?.skipped) this.setFeedback('O aviso já estava sendo processado pela fila automática.', 'info');
      else this.setFeedback(`Aviso enviado: ${summary?.sent || 0} aparelho(s) alcançado(s).`, 'success');
      form.reset();
      form.querySelector('[data-notification-selected-customers]')?.setAttribute('hidden', '');
      await this.refreshOperatorCentral();
    } catch (error) {
      this.setFeedback(error.message || 'Não foi possível enviar a notificação.', 'error');
    } finally {
      this.busy = false;
      submit.disabled = false;
      submit.textContent = original;
    }
  }

  async dispatch(id, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Enviando…';
    try {
      const result = await this.live.client.functions.invoke('trameli-push', { body: { action: 'dispatch', notificationId: id } });
      if (result.error) throw result.error;
      await this.refreshOperatorCentral();
    } catch (error) {
      this.setFeedback(error.message || 'Não foi possível reenviar.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async refreshCurrentViews() {
    await Promise.all([this.refreshInbox().catch(() => {}), this.refreshOperatorCentral().catch(() => {})]);
  }

  setFeedback(message, kind = '') {
    document.querySelectorAll('[data-notification-feedback]').forEach(node => {
      node.textContent = message || '';
      node.dataset.kind = kind;
    });
  }
}

export async function initNotifications(live) {
  if (!live?.user) return null;
  const notifications = new TrameliNotifications(live);
  window.TrameliNotifications = notifications;
  await notifications.init();
  return notifications;
}
