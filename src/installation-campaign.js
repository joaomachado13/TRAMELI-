import { isPwaStandalone } from './pwa.js';

const CAMPAIGN_DATE = '2026-10-28';
const TABLE = 'trameli_install_campaign';

function dateInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function platform() {
  const agent = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(agent)) return 'android';
  if (/Windows|Macintosh|Linux/i.test(agent)) return 'desktop';
  return 'other';
}

function permission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function styles() {
  if (document.getElementById('install-campaign-styles')) return;
  const css = document.createElement('style');
  css.id = 'install-campaign-styles';
  css.textContent = `
    .install-campaign-dialog{width:min(470px,calc(100vw - 24px));max-height:calc(100dvh - 32px);margin:auto;padding:0;overflow:auto;border:1px solid #decabc;border-radius:22px;background:#fffaf5;color:#3d2118;box-shadow:0 28px 85px #30170f45;font-family:Manrope,system-ui,sans-serif}
    .install-campaign-dialog::backdrop{background:#2b130dcc;backdrop-filter:blur(3px)}
    .install-campaign-body{display:grid;gap:15px;padding:26px 23px}
    .install-campaign-kicker{color:#8f3d22;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    .install-campaign-body h2{margin:0;font-size:clamp(1.36rem,5vw,1.75rem);line-height:1.18;font-weight:800}
    .install-campaign-body p{margin:0;font-size:14px;line-height:1.55;color:#6a544b}
    .install-campaign-notice{display:grid;gap:6px;padding:15px;border:1px solid #dfb99f;border-radius:14px;background:#fff0df}
    .install-campaign-notice strong{font-size:15px;color:#733319}
    .install-campaign-notice p{color:#6d4430;font-size:13px}
    .install-campaign-actions{display:grid;gap:9px}
    .install-campaign-actions button{min-height:46px;min-width:0;padding:12px 14px;border:1px solid #cfb2a0;border-radius:12px;background:#fff;color:#74351f;font:700 14px Manrope,system-ui,sans-serif;cursor:pointer}
    .install-campaign-actions button[data-campaign-choice="vamos_la"]{background:#8f3d22;border-color:#8f3d22;color:#fff;font-weight:800}
    .install-campaign-actions button:disabled{opacity:.6;cursor:wait}
    .install-campaign-feedback{min-height:18px;color:#ad2828!important;font-size:12px!important}
    .pwa-settings.is-campaign-focus{outline:3px solid #e3ae67;outline-offset:2px}
    @media(max-width:600px){.install-campaign-body{padding:24px 19px}.install-campaign-dialog{border-radius:18px}.install-campaign-actions button{min-height:49px}}
  `;
  document.head.append(css);
}

function openInstallationSettings() {
  const trigger = document.querySelector('.live-account');
  if (!trigger) return;
  trigger.click(); // Abre Minha conta, onde ja existem instalacao e ativacao de push reais.
  const panel = document.querySelector('.account-dialog[open] [data-pwa-settings]');
  if (!panel) return;
  panel.classList.add('is-campaign-focus');
  panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const target = platform() === 'ios' && !isPwaStandalone()
    ? panel.querySelector('[data-notification-install]')
    : panel.querySelector('[data-notification-enable]:not(:disabled), [data-notification-install]:not(:disabled)');
  target?.focus({ preventScroll: true });
}

export function initInstallationCampaign(live) {
  // O aviso e uma enquete pontual, apenas para clientes autenticados no dia 28/10.
  if (!live?.user?.id || live.operator || dateInSaoPaulo() !== CAMPAIGN_DATE) return;
  void (async () => {
    const userId = live.user.id;
    const row = { user_id: userId, campaign_date: CAMPAIGN_DATE };
    const { data, error } = await live.client.from(TABLE)
      .select('choice').eq('user_id', userId).eq('campaign_date', CAMPAIGN_DATE).maybeSingle();
    if (error) { console.warn('Enquete de instalacao indisponivel:', error.code || error.message); return; }
    if (data?.choice) return; // Uma unica resposta por conta, inclusive em outro aparelho.

    if (!data) {
      const seen = await live.client.from(TABLE).insert({
        ...row, platform: platform(), standalone: isPwaStandalone(), permission_status: permission(),
      });
      if (seen.error && seen.error.code !== '23505') {
        console.warn('Nao foi possivel registrar visualizacao da enquete:', seen.error.message);
        return;
      }
      // Se outro aparelho respondeu ao mesmo tempo, nao mostrar o modal.
      if (seen.error?.code === '23505') {
        const latest = await live.client.from(TABLE).select('choice')
          .eq('user_id', userId).eq('campaign_date', CAMPAIGN_DATE).maybeSingle();
        if (latest.data?.choice) return;
      }
    }

    styles();
    const dialog = document.createElement('dialog');
    dialog.className = 'install-campaign-dialog';
    dialog.setAttribute('aria-label', 'Pesquisa rapida: aplicativo Pao Doce');
    dialog.innerHTML = `
      <div class="install-campaign-body">
        <span class="install-campaign-kicker">Pão Doce Delivery · aviso importante 🍞</span>
        <h2>Você já instalou o Pão Doce no celular?</h2>
        <p>Tenha seus pedidos sempre à mão. Instalar é grátis e leva poucos passos, sem precisar baixar na loja de aplicativos.</p>
        <div class="install-campaign-notice">
          <strong>🔔 Não esqueça de ativar as notificações!</strong>
          <p>Depois de instalar, abra o Pão Doce pelo ícone do celular e toque em <b>Ativar notificações</b> → <b>Permitir</b>. Assim você pode receber avisos sobre seus pedidos e pagamentos.</p>
        </div>
        <div class="install-campaign-actions" role="group" aria-label="Sua resposta">
          <button type="button" data-campaign-choice="vamos_la">Vamos lá! Quero instalar</button>
          <button type="button" data-campaign-choice="ja_instalei">Já instalei</button>
          <button type="button" data-campaign-choice="agora_nao">Agora não</button>
        </div>
        <p class="install-campaign-feedback" role="status" aria-live="polite"></p>
      </div>
    `;
    dialog.addEventListener('click', async event => {
      const choice = event.target.closest('[data-campaign-choice]')?.dataset.campaignChoice;
      if (!choice || dialog.dataset.busy) return;
      dialog.dataset.busy = 'true';
      dialog.querySelectorAll('[data-campaign-choice]').forEach(button => { button.disabled = true; });
      const result = await live.client.from(TABLE).upsert({
        ...row, choice, platform: platform(), standalone: isPwaStandalone(),
        permission_status: permission(), answered_at: new Date().toISOString(),
      }, { onConflict: 'user_id,campaign_date' });
      if (result.error) {
        dialog.querySelector('.install-campaign-feedback').textContent = 'Não foi possível salvar sua resposta. Tente novamente.';
        dialog.querySelectorAll('[data-campaign-choice]').forEach(button => { button.disabled = false; });
        delete dialog.dataset.busy;
        return;
      }
      dialog.close();
      dialog.remove();
      if (choice === 'vamos_la' || (choice === 'ja_instalei' && permission() !== 'granted')) {
        openInstallationSettings();
      }
    });
    document.body.append(dialog);
    const showWhenAvailable = attempts => {
      if (!dialog.isConnected || dateInSaoPaulo() !== CAMPAIGN_DATE) { dialog.remove(); return; }
      if (document.querySelector('dialog[open]')) {
        if (attempts < 30) setTimeout(() => showWhenAvailable(attempts + 1), 1000);
        return;
      }
      dialog.showModal();
    };
    setTimeout(() => showWhenAvailable(0), 450);
  })();
}
