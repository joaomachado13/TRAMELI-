import { authError, escapeHtml } from './auth-utils.js';

export async function requireAccess(live) {
  const gate = document.createElement('main');
  gate.className = 'live-gate';
  gate.setAttribute('aria-label', 'Acesso à Trameli');
  document.body.classList.add('auth-pending');
  document.body.append(gate);
  let mode = 'signin';
  let method = 'email';
  let identity = '';
  let busy = false;
  let phoneRecovery = false;
  let providers = null;
  let settled = false;
  let finish;
  const complete = new Promise(resolve => { finish = resolve; });

  const descriptions = {
    signin: ['Bom ter você aqui.', 'Entre com sua conta. No próximo acesso, a gente lembra de você.'],
    signup: ['Vamos começar?', 'Crie seu acesso. Seu nome e endereço vêm na próxima etapa.'],
    recover: ['Vamos recuperar seu acesso.', 'Você só precisa fazer isso para criar ou recuperar sua senha.'],
    reset: ['Escolha sua senha.', 'Depois, você poderá entrar diretamente com ela.'],
    verify: ['Confirme seu telefone.', 'Digite o código que enviamos por SMS.'],
    connected: ['Preparando seu espaço.', 'Sua conta foi reconhecida. Estamos carregando seus pedidos.'],
  };
  function message(text, isError = false) {
    const host = gate.querySelector('.live-gate__message');
    host.textContent = text;
    host.setAttribute('role', isError ? 'alert' : 'status');
    host.classList.toggle('is-error', isError);
  }
  function render(note = '') {
    const [title, description] = descriptions[mode];
    const newPassword = mode === 'signup' || mode === 'reset';
    const credentials = ['signin', 'signup', 'recover'].includes(mode);
    gate.innerHTML = `<aside class="auth-story"><a class="auth-brand" href="${location.pathname}">Trameli<span>.</span></a><p class="auth-eyebrow">CADA PEDIDO NO SEU CAMINHO</p><h2>Menos passos.<br>Mais tempo para<br><em>o seu dia.</em></h2><p>Seu pedido, seus dados e sua rotina.<br>Tudo pronto para quando você voltar.</p><span class="auth-story__line" aria-hidden="true"></span></aside>
      <section class="live-gate__panel"><span class="live-gate__brand">Trameli.</span>
      ${['signin', 'signup'].includes(mode) ? `<div class="auth-tabs" aria-label="Tipo de acesso"><button type="button" data-mode="signin" aria-pressed="${mode === 'signin'}">Entrar</button><button type="button" data-mode="signup" aria-pressed="${mode === 'signup'}">Criar conta</button></div>` : ''}
      <h1>${title}</h1><p class="auth-description">${description}</p>
      ${['signin', 'signup'].includes(mode) ? `<button class="auth-google" type="button" data-action="google" ${providers?.external?.google ? '' : 'disabled'}><span aria-hidden="true">G</span> Continuar com Google</button><p class="auth-provider-note">${providers === null ? 'Verificando disponibilidade do Google…' : providers.external?.google ? 'Use sua conta Google para entrar.' : 'O acesso com Google ainda não está disponível.'}</p><div class="auth-divider"><span>ou use sua conta</span></div>` : ''}
      ${credentials && providers?.external?.phone ? `<div class="auth-methods" aria-label="Identificação"><button type="button" data-method="email" aria-pressed="${method === 'email'}">E-mail</button><button type="button" data-method="phone" aria-pressed="${method === 'phone'}">Telefone</button></div>` : ''}
      <form>
      ${credentials ? `<label>${method === 'phone' ? 'Telefone com DDD' : 'E-mail'}<input name="identity" type="${method === 'phone' ? 'tel' : 'email'}" autocomplete="${method === 'phone' ? 'tel' : 'username'}" value="${escapeHtml(identity)}" placeholder="${method === 'phone' ? '(34) 99999-9999' : 'voce@exemplo.com'}" required></label>` : ''}
      ${['signin', 'signup', 'reset'].includes(mode) ? `<label>Senha<span class="auth-password"><input name="password" type="password" autocomplete="${newPassword ? 'new-password' : 'current-password'}" ${newPassword ? 'minlength="8"' : ''} required><button type="button" data-action="reveal" aria-label="Mostrar senha" aria-pressed="false">Mostrar</button></span></label>${newPassword ? '<small class="auth-hint">Pelo menos 8 caracteres.</small><label>Confirme a senha<input name="confirmation" type="password" autocomplete="new-password" minlength="8" required></label>' : ''}` : ''}
      ${mode === 'verify' ? '<label>Código por SMS<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>' : ''}
      ${mode === 'signin' ? '<button class="auth-text" type="button" data-mode="recover">Criar ou recuperar senha</button>' : ''}
      <p class="live-gate__message" role="status">${escapeHtml(note)}</p>
      <button class="auth-submit" type="submit">${({ signin: 'Entrar na minha conta', signup: 'Criar minha conta', recover: method === 'phone' ? 'Enviar código por SMS' : 'Enviar recuperação de senha', reset: 'Salvar senha e entrar', verify: 'Confirmar código', connected: 'Tentar carregar novamente' })[mode]}</button></form>
      ${['recover', 'reset', 'verify'].includes(mode) ? '<button class="auth-text auth-back" type="button" data-action="back">Voltar para entrar</button>' : ''}
      ${mode === 'connected' ? '<button class="auth-text" type="button" data-action="logout">Entrar com outra conta</button>' : ''}
      ${mode === 'signin' ? '<p class="auth-team-note">Cliente, operadora ou master: entre com sua conta. Seu acesso é reconhecido automaticamente.</p>' : ''}
      <div class="auth-help" hidden><button type="button" class="auth-text" data-action="resend">Reenviar confirmação</button></div>
      <p class="auth-connection"><button type="button" class="auth-text" data-action="providers">Verificar conexão</button></p></section>`;
    gate.querySelector('input')?.focus();
  }
  function setBusy(value) {
    busy = value;
    gate.setAttribute('aria-busy', String(value));
    gate.querySelectorAll('button, input').forEach(element => { element.disabled = value; });
    if (!value) {
      const google = gate.querySelector('[data-action="google"]');
      if (google) google.disabled = !providers?.external?.google;
    }
  }
  async function enter(alreadyAuthenticated = false) {
    if (!alreadyAuthenticated && !(await live.authenticate())) throw new Error('Sua sessão expirou. Entre novamente.');
    mode = 'connected';
    render();
    setBusy(true);
    const preflight = await live.preflight();
    if (!preflight.ready) throw new Error('Sua conta está pronta, mas a operação ainda precisa ser ativada pela administração.');
    await live.load();
    settled = true;
    document.body.classList.remove('auth-pending');
    gate.remove();
    finish();
  }
  async function checkProviders() {
    try {
      providers = await live.auth.providers();
      const input = gate.querySelector('[name="identity"]');
      if (input) identity = input.value;
      if (!settled && !busy) {
        const draft = new FormData(gate.querySelector('form'));
        const active = document.activeElement?.name;
        const text = gate.querySelector('.live-gate__message').textContent;
        const isError = gate.querySelector('.live-gate__message').classList.contains('is-error');
        const confirmationVisible = !gate.querySelector('.auth-help').hidden;
        render();
        for (const [name, value] of draft) {
          const field = gate.querySelector('form').elements.namedItem(name);
          if (field) field.value = value;
        }
        if (active) gate.querySelector('form').elements.namedItem(active)?.focus();
        message(text, isError);
        gate.querySelector('.auth-help').hidden = !confirmationVisible;
      }
    } catch (error) {
      providers = { external: {} };
      if (!settled && !busy) {
        const providerNote = gate.querySelector('.auth-provider-note');
        if (providerNote) providerNote.textContent = 'Não foi possível verificar o Google. Tente a conexão novamente.';
        message(authError(error), true);
      }
    }
  }
  render();
  gate.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    identity = gate.querySelector('[name="identity"]')?.value || identity;
    if (button.dataset.mode) { mode = button.dataset.mode; render(); return; }
    if (button.dataset.method) { method = button.dataset.method; identity = ''; render(); return; }
    if (button.dataset.action === 'reveal') {
      const input = gate.querySelector('[name="password"]');
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'Ocultar' : 'Mostrar';
      button.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
      button.setAttribute('aria-pressed', String(visible));
      return;
    }
    if (button.dataset.action === 'providers') { await checkProviders(); return; }
    if (!button.dataset.action) return;
    setBusy(true);
    try {
      if (button.dataset.action === 'google') await live.auth.google();
      if (button.dataset.action === 'resend') { await live.auth.resend(method, identity); message('Confirmação solicitada. Confira sua caixa de entrada e o spam.'); }
      if (button.dataset.action === 'back' || button.dataset.action === 'logout') {
        if (live.recovery || mode === 'connected' || mode === 'reset') {
          const { error } = await live.client.auth.signOut({ scope: 'local' });
          if (error) throw error;
        }
        live.recovery = false;
        history.replaceState(null, '', location.pathname);
        mode = 'signin'; render();
      }
    } catch (error) { message(authError(error), true); }
    finally { if (!settled) setBusy(false); }
  });
  gate.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.target);
    identity = fields.get('identity') || identity;
    setBusy(true);
    message('Só um instante…');
    try {
      if (mode === 'signin') { await live.auth.signIn(method, identity, fields.get('password')); await enter(); }
      else if (mode === 'signup') {
        const result = await live.auth.signUp(method, identity, fields.get('password'), fields.get('confirmation'));
        if (result.session) await enter();
        else if (method === 'phone') { mode = 'verify'; phoneRecovery = false; render(); }
        else { mode = 'signin'; render('Cadastro solicitado. Se necessário, confirme o e-mail uma vez; depois entre com sua senha. Se já tem conta, use a recuperação.'); gate.querySelector('.auth-help').hidden = false; }
      } else if (mode === 'recover') {
        await live.auth.recover(method, identity);
        if (method === 'phone') { phoneRecovery = true; mode = 'verify'; render(); }
        else message('Se este e-mail tiver uma conta, você receberá a recuperação de senha. Confira também o spam.');
      } else if (mode === 'verify') {
        await live.auth.verifyPhone(identity, fields.get('code'));
        if (phoneRecovery) { live.recovery = true; mode = 'reset'; render(); }
        else await enter();
      } else if (mode === 'reset') {
        await live.auth.setPassword(fields.get('password'), fields.get('confirmation'));
        live.recovery = false;
        history.replaceState(null, '', location.pathname);
        await enter();
      } else if (mode === 'connected') await enter();
    } catch (error) {
      message(authError(error), true);
      if (error.code === 'email_not_confirmed') gate.querySelector('.auth-help').hidden = false;
      if (error.code === 'phone_not_confirmed') { mode = 'verify'; render('Confirme seu telefone. Solicite outro código se necessário.'); gate.querySelector('.auth-help').hidden = false; }
    } finally { if (!settled) setBusy(false); }
  });
  // The listener is installed by LiveData before Supabase consumes a recovery callback.
  setBusy(true);
  try {
    const authenticated = await live.authenticate();
    if (authenticated && live.recovery) { mode = 'reset'; render(); }
    else if (authenticated) await enter(true);
    else {
      const callback = new URLSearchParams(location.hash.slice(1));
      if (callback.has('error')) {
        message('Não foi possível concluir o acesso. O link pode ter expirado; entre com sua senha ou solicite recuperação.', true);
        history.replaceState(null, '', location.pathname);
      }
    }
  } catch (error) { message(authError(error), true); }
  finally { if (!settled) setBusy(false); }
  if (!settled) checkProviders();
  return complete;
}
