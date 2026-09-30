export const roleLabel = role => ({ master: 'Master', operator: 'Operadora', customer: 'Cliente' })[role] || 'Cliente';

export function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!/^55[1-9]\d{9,10}$/.test(digits)) throw new Error('Informe um telefone com DDD. Ex.: (34) 99999-9999.');
  return `+${digits}`;
}

export function identityFields(method, value) {
  if (method === 'phone') return { phone: normalizePhone(value) };
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
  return { email };
}

export function validateNewPassword(password, confirmation) {
  if (password.length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.');
  if (password !== confirmation) throw new Error('As senhas não são iguais. Confira os dois campos.');
}

export function displayName(user, profile) {
  return profile?.name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Minha conta';
}

export function authError(error) {
  const code = error?.code || '';
  const message = error?.message || '';
  if (code === 'invalid_credentials') return 'E-mail ou telefone e senha não conferem. Se você entrava por link, use “Criar ou recuperar senha”.';
  if (code === 'email_not_confirmed') return 'Falta confirmar seu e-mail. Confira a caixa de entrada e o spam ou reenvie a confirmação.';
  if (code === 'phone_not_confirmed') return 'Confirme seu telefone com o código recebido por SMS.';
  if (code === 'user_already_exists' || code === 'email_exists') return 'Essa conta já existe. Entre com sua senha ou use a recuperação.';
  if (code === 'weak_password') return 'Escolha uma senha mais forte, com pelo menos 8 caracteres.';
  if (code === 'same_password') return 'Escolha uma senha diferente da atual.';
  if (code === 'reauthentication_needed') return 'Por segurança, saia e entre novamente antes de trocar a senha.';
  if (['over_email_send_rate_limit', 'over_sms_send_rate_limit', 'over_request_rate_limit'].includes(code) || error?.status === 429) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.';
  if (code === 'otp_expired') return 'Este código ou link expirou. Solicite outro para continuar.';
  if (code === 'provider_disabled' || code === 'oauth_provider_not_supported') return 'Este método de acesso ainda não está disponível. Use e-mail e senha.';
  if (code === 'signup_disabled') return 'O cadastro de novas contas está fechado neste momento. Quem já tem conta pode entrar normalmente.';
  if (code === 'email_address_not_authorized' || /smtp|sending.*email/i.test(message)) return 'O serviço de e-mail não conseguiu enviar a mensagem. Quem já tem senha pode entrar normalmente; o envio precisa ser regularizado pela administração.';
  if (error?.name === 'AuthRetryableFetchError' || error?.name === 'AbortError' || /fetch|network|ENOTFOUND|conexão/i.test(message)) return 'Não conseguimos conectar ao serviço de acesso. Confira a internet e tente novamente. Se continuar, a administração precisa verificar a disponibilidade do serviço.';
  if (code === 'PGRST202') return 'Esta função ainda precisa ser ativada pela administração.';
  return message || 'Não foi possível concluir. Tente novamente.';
}

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
