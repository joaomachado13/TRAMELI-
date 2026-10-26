const PILOT_QUERY = 'pwa-pilot';
const PILOT_VALUE = '1';
const MANIFEST_HREF = '/manifest.webmanifest';
const SERVICE_WORKER_URL = '/pwa-sw.js';
const ICON_URL = '/pwa-icon.png';

const qs = new URLSearchParams(window.location.search);
const pilotEnabled = qs.get(PILOT_QUERY) === PILOT_VALUE;

let deferredInstallPrompt = null;
let registrationPromise = null;

function ensureHeadMetadata() {
  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = MANIFEST_HREF;
    document.head.append(manifest);
  }

  const metas = [
    ['theme-color', '#8F3D22'],
    ['apple-mobile-web-app-capable', 'yes'],
    ['apple-mobile-web-app-status-bar-style', 'default'],
    ['apple-mobile-web-app-title', 'Pão Doce'],
  ];
  for (const [name, content] of metas) {
    if (document.querySelector(`meta[name="${name}"]`)) continue;
    const meta = document.createElement('meta');
    meta.name = name;
    meta.content = content;
    document.head.append(meta);
  }

  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const icon = document.createElement('link');
    icon.rel = 'apple-touch-icon';
    icon.href = ICON_URL;
    document.head.append(icon);
  }
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function getRegistration() {
  if (!pilotEnabled) return null;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: '/' })
      .then(() => navigator.serviceWorker.ready);
  }
  return registrationPromise;
}

function notificationPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function addPilotStyles() {
  if (document.getElementById('pwa-pilot-styles')) return;
  const style = document.createElement('style');
  style.id = 'pwa-pilot-styles';
  style.textContent = `
    .pwa-pilot {
      position: fixed; left: 12px; bottom: 12px; z-index: 2147483000;
      font: 600 13px/1.35 Manrope, system-ui, sans-serif; color: #32170E;
    }
    .pwa-pilot details {
      width: min(330px, calc(100vw - 24px)); border: 1px solid #C9B6A8;
      border-radius: 16px; background: #FFFBF6; box-shadow: 0 16px 44px rgba(50,23,14,.18);
      overflow: hidden;
    }
    .pwa-pilot summary {
      cursor: pointer; list-style: none; padding: 10px 14px; color: #FFF9F5; background: #8F3D22;
      letter-spacing: .02em; user-select: none;
    }
    .pwa-pilot summary::-webkit-details-marker { display: none; }
    .pwa-pilot__body { padding: 13px; display: grid; gap: 10px; }
    .pwa-pilot__status { margin: 0; color: #62504A; font-weight: 500; }
    .pwa-pilot__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .pwa-pilot button {
      min-height: 40px; border: 1px solid #C9A491; border-radius: 11px;
      padding: 8px 10px; background: #FFFBF6; color: #7A331C; font: inherit; cursor: pointer;
    }
    .pwa-pilot button[data-primary="true"] { background: #8F3D22; color: #FFF9F5; border-color: #8F3D22; }
    .pwa-pilot button:disabled { opacity: .55; cursor: not-allowed; }
    .pwa-pilot__hint { margin: 0; color: #7A706A; font-size: 12px; font-weight: 500; }
  `;
  document.head.append(style);
}

function createPilotPanel() {
  if (!pilotEnabled || document.getElementById('pwa-pilot-panel')) return;

  addPilotStyles();
  const host = document.createElement('aside');
  host.id = 'pwa-pilot-panel';
  host.className = 'pwa-pilot';
  host.setAttribute('aria-label', 'Teste privado do aplicativo Pão Doce');
  host.innerHTML = `
    <details>
      <summary>PWA TESTE · privado</summary>
      <div class="pwa-pilot__body">
        <p class="pwa-pilot__status" data-pwa-status>Verificando este aparelho…</p>
        <div class="pwa-pilot__actions">
          <button type="button" data-pwa-install data-primary="true">Instalar app</button>
          <button type="button" data-pwa-permission>Ativar notificações</button>
          <button type="button" data-pwa-test-notification>Testar notificação</button>
          <button type="button" data-pwa-refresh>Atualizar status</button>
        </div>
        <p class="pwa-pilot__hint" data-pwa-hint></p>
      </div>
    </details>
  `;
  document.body.append(host);

  const installButton = host.querySelector('[data-pwa-install]');
  const permissionButton = host.querySelector('[data-pwa-permission]');
  const testButton = host.querySelector('[data-pwa-test-notification]');
  const refreshButton = host.querySelector('[data-pwa-refresh]');
  const status = host.querySelector('[data-pwa-status]');
  const hint = host.querySelector('[data-pwa-hint]');

  const refresh = async () => {
    const standalone = isStandalone();
    const permission = notificationPermission();
    const swSupported = 'serviceWorker' in navigator && window.isSecureContext;
    let workerReady = false;
    try { workerReady = Boolean(await getRegistration()); } catch { workerReady = false; }

    status.textContent = [
      standalone ? 'App instalado/aberto como PWA' : 'Aberto no navegador',
      `notificações: ${permission}`,
      workerReady ? 'serviço PWA pronto' : 'serviço PWA indisponível',
    ].join(' · ');

    installButton.disabled = standalone || (!deferredInstallPrompt && !isIOS());
    permissionButton.disabled = permission === 'granted' || permission === 'unsupported' || !workerReady;
    testButton.disabled = permission !== 'granted' || !workerReady;

    if (standalone) {
      hint.textContent = 'Piloto ativo somente neste endereço de teste. Nenhum dado do sistema é armazenado pelo PWA.';
    } else if (isIOS()) {
      hint.textContent = 'No iPhone: Safari → Compartilhar → Adicionar à Tela de Início. Depois abra o Pão Doce pelo ícone.';
    } else if (!deferredInstallPrompt) {
      hint.textContent = 'Se o botão Instalar ainda estiver bloqueado, atualize a página após o serviço PWA ficar pronto.';
    } else {
      hint.textContent = 'O piloto está pronto para instalação neste aparelho.';
    }
  };

  installButton.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try { await deferredInstallPrompt.userChoice; } catch { /* Browser can close the prompt. */ }
      deferredInstallPrompt = null;
      await refresh();
      return;
    }
    if (isIOS()) {
      hint.textContent = 'Use Safari → Compartilhar → Adicionar à Tela de Início.';
    }
  });

  permissionButton.addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    try {
      await Notification.requestPermission();
    } catch {
      hint.textContent = 'O navegador não liberou a solicitação. No iPhone, abra primeiro pelo ícone instalado.';
    }
    await refresh();
  });

  testButton.addEventListener('click', async () => {
    try {
      const registration = await getRegistration();
      if (!registration || notificationPermission() !== 'granted') return;
      await registration.showNotification('Pão Doce Delivery 🍞', {
        body: 'Notificação de teste funcionando neste aparelho.',
        icon: ICON_URL,
        badge: ICON_URL,
        tag: 'pao-doce-pwa-local-test',
        data: { url: '/?pwa-pilot=1#loja' },
      });
      hint.textContent = 'Notificação de teste enviada somente para este aparelho.';
    } catch {
      hint.textContent = 'Não foi possível exibir a notificação de teste neste navegador.';
    }
  });

  refreshButton.addEventListener('click', () => { void refresh(); });
  void refresh();
}

export async function showPwaNotification({ title, body, tag, url = '/#loja' } = {}) {
  if (!pilotEnabled || notificationPermission() !== 'granted') return false;
  const registration = await getRegistration();
  if (!registration) return false;
  await registration.showNotification(title || 'Pão Doce Delivery', {
    body: body || 'Você tem uma nova atualização.',
    icon: ICON_URL,
    badge: ICON_URL,
    tag: tag || 'pao-doce-update',
    data: { url },
  });
  return true;
}

export function initPwaPilot() {
  if (!pilotEnabled) return;

  ensureHeadMetadata();

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.querySelector('[data-pwa-refresh]')?.click();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.querySelector('[data-pwa-refresh]')?.click();
  });

  void getRegistration().catch(error => {
    console.warn('Piloto PWA indisponível neste navegador.', error?.name || error);
  });

  if (document.body) createPilotPanel();
  else window.addEventListener('DOMContentLoaded', createPilotPanel, { once: true });
}
