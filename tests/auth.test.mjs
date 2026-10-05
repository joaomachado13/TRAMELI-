import assert from 'node:assert/strict';
import { AuthService } from '../src/auth-service.js';
import { identityFields, normalizePhone, validateNewPassword, authError, displayName } from '../src/auth-utils.js';

assert.equal(normalizePhone('(34) 99999-9999'), '+5534999999999');
assert.equal(normalizePhone('+55 34 99999-9999'), '+5534999999999');
assert.throws(() => normalizePhone('999'), /DDD/);
assert.deepEqual(identityFields('email', ' CLIENTE@EXEMPLO.COM '), { email: 'cliente@exemplo.com' });
assert.throws(() => identityFields('email', 'não é email'), /válido/);
assert.throws(() => validateNewPassword('curta', 'curta'), /8 caracteres/);
assert.throws(() => validateNewPassword('senha-de-teste', 'diferente'), /iguais/);
assert.equal(displayName({ user_metadata: { full_name: 'Nome do Google', role: 'master' } }, null), 'Nome do Google');
assert.equal(displayName({ user_metadata: { full_name: 'Google' } }, { name: 'Nome corrigido' }), 'Nome corrigido');
assert.match(authError({ code: 'invalid_credentials' }), /recuperar senha/);
assert.match(authError({ code: 'email_not_confirmed' }), /confirmar/);
assert.match(authError({ name: 'AuthRetryableFetchError' }), /conectar/);
const calls = [];
const auth = Object.fromEntries(['signInWithPassword', 'signUp', 'signInWithOAuth', 'resetPasswordForEmail', 'signInWithOtp', 'verifyOtp', 'updateUser', 'resend'].map(name => [name, async (...args) => {
  calls.push({ name, args }); return { data: { session: { user: { id: 'example' } } }, error: null };
}]));
globalThis.location = { origin: 'http://127.0.0.1:4173', pathname: '/', hash: '#loja' };
globalThis.fetch = async url => {
  if (String(url).startsWith('https://api.pwnedpasswords.com/range/')) {
    return new Response('', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  throw new Error(`Unexpected fetch in auth test: ${url}`);
};
const service = new AuthService({ auth }, 'https://example.supabase.co', 'public-test-key');
await service.signIn('email', ' A@EXAMPLE.COM ', 'test-password');
assert.deepEqual(calls.at(-1), { name: 'signInWithPassword', args: [{ email: 'a@example.com', password: 'test-password' }] });
await service.signIn('phone', '(34) 99999-9999', 'test-password');
assert.equal(calls.at(-1).args[0].phone, '+5534999999999');
await service.signUp('email', 'a@example.com', 'test-password', 'test-password');
assert.equal(calls.at(-1).args[0].options.emailRedirectTo, 'http://127.0.0.1:4173/');
assert.equal(calls.at(-1).args[0].options.data, undefined, 'Sign-up must never assign a role from user metadata');
await service.recover('phone', '(34) 99999-9999');
assert.equal(calls.at(-1).args[0].options.shouldCreateUser, false);
await service.recover('email', 'a@example.com');
assert.equal(calls.at(-1).args[1].redirectTo, 'http://127.0.0.1:4173/?auth=recovery');
await service.google();
assert.deepEqual(calls.at(-1).args[0], { provider: 'google', options: { redirectTo: 'http://127.0.0.1:4173/' } });
await service.verifyPhone('(34) 99999-9999', '123456');
assert.deepEqual(calls.at(-1).args[0], { phone: '+5534999999999', token: '123456', type: 'sms' });
await service.setPassword('test-password', 'test-password');
assert.deepEqual(calls.at(-1).args[0], { password: 'test-password' });
auth.signInWithPassword = async () => ({ error: { code: 'invalid_credentials' } });
await assert.rejects(service.signIn('email', 'a@example.com', 'wrong'), { code: 'invalid_credentials' });
console.log('Autenticação: credenciais, Google, telefone e recuperação OK');
