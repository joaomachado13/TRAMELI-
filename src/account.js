import { authError, displayName, escapeHtml, roleLabel } from './auth-utils.js';

export function initAccount(live) {
  const name = displayName(live.user, live.profile);
  const button = document.querySelector('.profile-button');
  if (button) {
    button.querySelector('.av').textContent = name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    button.querySelector('.av + span').innerHTML = `${escapeHtml(name)}<small class="account-role">${roleLabel(live.role)}</small>`;
  }
  const passwordForm = () => `<form data-account-password><label>Nova senha<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirme a senha<input name="confirmation" type="password" autocomplete="new-password" minlength="8" required></label><p class="account-message" role="status"></p><button type="submit">Salvar senha</button></form>`;
  const identity = () => `<p><strong>${escapeHtml(name)}</strong><br>${escapeHtml(live.user.email || live.user.phone || '')} · ${roleLabel(live.role)}</p>`;
  const accountSection = () => `<div class="account-panel">${identity()}<form data-account-profile><label>Nome<input name="name" value="${escapeHtml(live.profile?.name || live.user.user_metadata?.full_name || live.user.user_metadata?.name || '')}" maxlength="90" required></label><label>Telefone<input name="phone" type="tel" value="${escapeHtml(live.profile?.phone || live.user.user_metadata?.phone || live.user.phone || '')}" maxlength="25"></label><label>Endereço e referência<input name="address" value="${escapeHtml(live.profile?.address || live.user.user_metadata?.address || '')}" maxlength="180" required></label><p class="account-message" role="status"></p><button type="submit">Salvar meus dados</button></form><details><summary>Alterar senha</summary>${passwordForm()}</details></div>`;
  const teamSection = () => live.role === 'master' ? `<div class="account-panel"><p>Operadoras cuidam dos pedidos; contas master também gerenciam a equipe.</p><ul class="account-team-list" data-team-list><li>Carregando equipe…</li></ul><form data-team-access><label>E-mail ou telefone cadastrado<input name="identity" autocomplete="off" placeholder="E-mail ou telefone com +55" required></label><label>Permissão<select name="role"><option value="operator">Operadora</option><option value="master">Master</option><option value="customer">Cliente — retirar acesso à equipe</option></select></label><p class="account-message" role="status"></p><button type="submit">Atualizar acesso</button></form></div>` : '<p>Somente uma conta Master pode alterar os acessos da equipe.</p>';
  const render = section => section === 'team' ? teamSection() : accountSection();
  async function refreshTeam() {
    const host = document.querySelector('[data-team-list]');
    if (!host || live.role !== 'master') return;
    const { data, error } = await live.client.rpc('trameli_list_team');
    if (!host.isConnected) return;
    host.innerHTML = error ? `<li>${escapeHtml(authError(error))}</li>` : data.map(member => `<li><span>${escapeHtml(member.email || member.phone || member.user_id)}${member.user_id === live.user.id ? ' (você)' : ''}</span><strong>${roleLabel(member.role)}</strong></li>`).join('');
  }
  window.TrameliAccount = { render, refreshTeam };
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
  accountButton.addEventListener('click', () => {
    dialog.innerHTML = `<button type="button" class="account-dialog__close" aria-label="Fechar">×</button><h2>Minha conta</h2>${identity()}<p>Crie ou altere a senha da sua conta.</p>${passwordForm()}<button type="button" class="account-signout">Sair deste aparelho</button>`;
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
        await live.auth.setPassword(fields.get('password'), fields.get('confirmation'));
        form.reset(); message.textContent = 'Senha salva. No próximo acesso, entre com ela.';
      } else if (form.matches('[data-account-profile]')) {
        const profile = { name: fields.get('name').trim(), phone: fields.get('phone').trim(), address: fields.get('address').trim() };
        await live.auth.updateProfile(profile);
        Object.assign(live.user.user_metadata, { name: profile.name, full_name: profile.name, phone: profile.phone, address: profile.address });
        if (live.profile) Object.assign(live.profile, profile);
        message.textContent = 'Seus dados foram atualizados.';
      } else {
        const { error } = await live.client.rpc('trameli_set_team_role', { p_identity: fields.get('identity').trim(), p_role: fields.get('role') });
        if (error) throw error;
        form.reset(); message.textContent = 'Acesso atualizado.'; await refreshTeam();
      }
    } catch (error) { message.textContent = authError(error); }
    finally { submit.disabled = false; }
  });
}
