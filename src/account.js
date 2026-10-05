import { authError, displayName, escapeHtml, roleLabel } from './auth-utils.js';

export function initAccount(live) {
  let name = displayName(live.user, live.profile);
  let mfaState = null;
  let mfaEnrollment = null;
  const button = document.querySelector('.profile-button');
  const syncIdentity = () => {
    if (!button) return;
    button.querySelector('.av').textContent = name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    button.querySelector('.av + span').innerHTML = `${escapeHtml(name)}<small class="account-role">${roleLabel(live.role)}</small>`;
  };
  syncIdentity();
  const passwordForm = () => `<form data-account-password><label>Nova senha<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirme a senha<input name="confirmation" type="password" autocomplete="new-password" minlength="8" required></label><p class="account-message" role="status"></p><button type="submit">Salvar senha</button></form>`;
  const identity = () => `<p><strong>${escapeHtml(name)}</strong><br>${escapeHtml(live.user.email || live.user.phone || '')} · ${roleLabel(live.role)}</p>`;
  const accountSection = () => `<div class="account-panel">${identity()}<form data-account-profile><label>Nome<input name="name" value="${escapeHtml(live.profile?.name || live.user.user_metadata?.full_name || live.user.user_metadata?.name || '')}" maxlength="90" required></label><label>Telefone<input name="phone" type="tel" value="${escapeHtml(live.profile?.phone || live.user.user_metadata?.phone || live.user.phone || '')}" maxlength="25"></label><label>Endereço e referência<input name="address" value="${escapeHtml(live.profile?.address || live.user.user_metadata?.address || '')}" maxlength="180" required></label><p class="account-message" role="status"></p><button type="submit">Salvar meus dados</button></form><details><summary>Alterar senha</summary>${passwordForm()}</details></div>`;
  const hasRecentTotp = status => Boolean(status?.currentAuthenticationMethods?.some(method =>
    method.method === 'totp' && Number(method.timestamp) * 1000 >= Date.now() - 30 * 60 * 1000
  ));
  const mfaPanel = () => {
    if (live.role !== 'master') return '';
    const verified = mfaState?.totp?.find(factor => factor.status === 'verified');
    const active = mfaState?.currentLevel === 'aal2' && hasRecentTotp(mfaState);
    const enroll = mfaEnrollment?.totp;
    return `<div class="account-panel" data-mfa-panel><h3>Verificação em duas etapas</h3>
      <p>Protege alterações críticas, como destino Pix, acessos da equipe e exclusões administrativas.</p>
      ${verified ? `<p><strong>${active ? 'Proteção ativa para ações críticas' : '2FA cadastrado — confirme um código para liberar ações críticas por 30 minutos'}</strong></p>
        ${active ? '' : '<form data-mfa-stepup><label>Código do autenticador<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><p class="account-message" role="status"></p><button type="submit">Confirmar código</button></form>'}`
        : enroll ? `<p>Escaneie o QR no seu autenticador e confirme um código.</p><img src="${escapeHtml(enroll.qr_code || '')}" alt="QR Code para configurar 2FA" width="220" height="220"><details><summary>Não consegue escanear?</summary><code>${escapeHtml(enroll.secret || '')}</code></details><form data-mfa-enroll-verify data-factor-id="${escapeHtml(mfaEnrollment.id)}"><label>Código do autenticador<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><p class="account-message" role="status"></p><button type="submit">Ativar 2FA</button></form>`
        : '<button type="button" data-mfa-enroll>Ativar verificação em duas etapas</button>'}
    </div>`;
  };
  const teamSection = () => live.role === 'master' ? `${mfaPanel()}<div class="account-panel"><p>Operadoras cuidam dos pedidos; contas master também gerenciam a equipe.</p><ul class="account-team-list" data-team-list><li>Carregando equipe…</li></ul><form data-team-access><label>E-mail ou telefone cadastrado<input name="identity" autocomplete="off" placeholder="E-mail ou telefone com +55" required></label><label>Permissão<select name="role"><option value="operator">Operadora</option><option value="master">Master</option><option value="customer">Cliente — retirar acesso à equipe</option></select></label><p class="account-message" role="status"></p><button type="submit">Atualizar acesso</button></form></div>` : '<p>Somente uma conta Master pode alterar os acessos da equipe.</p>';
  const render = section => section === 'team' ? teamSection() : accountSection();
  async function refreshTeam() {
    const host = document.querySelector('[data-team-list]');
    if (!host || live.role !== 'master') return;
    const { data, error } = await live.client.rpc('trameli_list_team');
    if (!host.isConnected) return;
    host.innerHTML = error ? `<li>${escapeHtml(authError(error))}</li>` : data.map(member => `<li><span>${escapeHtml(member.email || member.phone || member.user_id)}${member.user_id === live.user.id ? ' (você)' : ''}</span><strong>${roleLabel(member.role)}</strong></li>`).join('');
  }
  async function refreshMfa() {
    if (live.role !== 'master') return null;
    mfaState = await live.auth.mfaStatus();
    return mfaState;
  }
  async function ensureMasterAal2() {
    if (live.role !== 'master') throw new Error('Apenas Master pode executar esta ação.');
    const status = await refreshMfa();
    if (status.currentLevel === 'aal2' && hasRecentTotp(status)) return true;
    const factor = status.totp.find(item => item.status === 'verified');
    if (!factor) throw new Error('Ative a verificação em duas etapas em Configurações → Acessos antes de continuar.');
    const code = prompt('Digite o código de 6 dígitos do seu autenticador para confirmar esta ação:');
    if (!code) throw new Error('Ação cancelada.');
    await live.auth.verifyTotp(factor.id, code);
    const elevated = await refreshMfa();
    if (elevated.currentLevel !== 'aal2' || !hasRecentTotp(elevated)) throw new Error('Não foi possível confirmar recentemente o segundo fator.');
    return true;
  }
  window.TrameliAccount = { render, renderMfa: mfaPanel, refreshTeam, refreshMfa, ensureMasterAal2 };
  const logout = document.createElement('button');
  logout.type = 'button'; logout.className = 'live-logout'; logout.textContent = 'Sair';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    const { error } = await live.client.auth.signOut({ scope: 'local' });
    if (error) { alert(authError(error)); logout.disabled = false; return; }
    // The cart is per device; do not show the previous person's shopping bag to another account.
    try { localStorage.removeItem('trameli-portal-cart-v1'); sessionStorage.removeItem('trameli-checkout-request-v1'); } catch { /* Optional storage. */ }
    location.reload();
  });
  if (live.operator) document.querySelector('.account-actions')?.append(logout);
  const accountButton = document.createElement('button');
  accountButton.type = 'button'; accountButton.className = 'live-account'; accountButton.textContent = 'Minha conta';
  accountButton.title = name;
  const dialog = document.createElement('dialog'); dialog.className = 'account-dialog account-panel';
  dialog.setAttribute('aria-label', 'Minha conta');
  document.body.append(dialog);
  accountButton.addEventListener('click', async () => {
    if (live.role === 'master') { try { await refreshMfa(); } catch { mfaState = null; } }
    dialog.innerHTML = `<button type="button" class="account-dialog__close" aria-label="Fechar">×</button><h2>Minha conta</h2>${identity()}<p>Crie ou altere a senha da sua conta.</p>${live.role === 'master' ? mfaPanel() : ''}${passwordForm()}<button type="button" class="account-signout">Sair deste aparelho</button>`;
    dialog.querySelector('.account-dialog__close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.account-signout').addEventListener('click', () => logout.click());
    dialog.showModal();
  });
  document.querySelector('.portal-header__actions')?.append(accountButton);
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-account-password], [data-account-profile], [data-team-access]')) return;
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit.disabled) return;
    const message = form.querySelector('.account-message');
    const fields = new FormData(form);
    if (form.matches('[data-team-access]') && !confirm(`Aplicar acesso ${roleLabel(fields.get('role'))} à conta ${fields.get('identity')}?`)) return;
    submit.disabled = true;
    try {
      if (form.matches('[data-account-password]')) {
        if (live.role === 'master') await ensureMasterAal2();
        await live.auth.setPassword(fields.get('password'), fields.get('confirmation'));
        form.reset(); message.textContent = 'Senha salva. No próximo acesso, entre com ela.';
      } else if (form.matches('[data-account-profile]')) {
        const profile = { name: fields.get('name').trim(), phone: fields.get('phone').trim(), address: fields.get('address').trim() };
        await live.auth.updateProfile(profile);
        await live.saveProfile(profile);
        Object.assign(live.user.user_metadata, { name: profile.name, full_name: profile.name, phone: profile.phone, address: profile.address });
        if (live.profile) Object.assign(live.profile, profile);
        name = profile.name; syncIdentity(); accountButton.title = profile.name;
        message.textContent = 'Seus dados foram atualizados.';
      } else {
        await ensureMasterAal2();
        const { error } = await live.client.rpc('trameli_set_team_role', { p_identity: fields.get('identity').trim(), p_role: fields.get('role') });
        if (error) throw error;
        form.reset(); message.textContent = 'Acesso atualizado.'; await refreshTeam();
      }
    } catch (error) { message.textContent = authError(error); }
    finally { submit.disabled = false; }
  });
  document.addEventListener('click', async event => {
    const enrollButton = event.target.closest('[data-mfa-enroll]');
    if (!enrollButton || live.role !== 'master') return;
    enrollButton.disabled = true;
    try {
      mfaEnrollment = await live.auth.enrollTotp();
      await refreshMfa();
      const host = enrollButton.closest('[data-mfa-panel]');
      if (host) host.outerHTML = mfaPanel();
    } catch (error) {
      alert(authError(error));
      enrollButton.disabled = false;
    }
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-mfa-stepup], [data-mfa-enroll-verify]')) return;
    event.preventDefault();
    const message = form.querySelector('.account-message');
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true; message.textContent = '';
    try {
      const code = new FormData(form).get('code');
      if (form.matches('[data-mfa-enroll-verify]')) {
        await live.auth.verifyTotp(form.dataset.factorId, code);
        mfaEnrollment = null;
      } else {
        const status = await refreshMfa();
        const factor = status.totp.find(item => item.status === 'verified');
        if (!factor) throw new Error('Nenhum autenticador verificado foi encontrado.');
        await live.auth.verifyTotp(factor.id, code);
      }
      await refreshMfa();
      const host = form.closest('[data-mfa-panel]');
      if (host) host.outerHTML = mfaPanel();
    } catch (error) {
      message.textContent = authError(error);
      submit.disabled = false;
    }
  });

}
