import { identityFields, validateNewPassword } from './auth-utils.js';

// Credentials are passed to Supabase Auth; the application never stores passwords.
export class AuthService {
  constructor(client, url, key) {
    this.client = client;
    this.url = url;
    this.key = key;
    this.settings = null;
  }

  redirect(recovery = false) {
    return `${location.origin}${location.pathname}${recovery ? '?auth=recovery' : ''}`;
  }

  async providers() {
    const response = await fetch(`${this.url}/auth/v1/settings`, {
      headers: { apikey: this.key }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Não foi possível verificar os métodos de acesso. Confira a conexão.');
    this.settings = await response.json();
    return this.settings;
  }

  async signIn(method, identity, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ ...identityFields(method, identity), password });
    if (error) throw error;
    return data;
  }

  async signUp(method, identity, password, confirmation) {
    validateNewPassword(password, confirmation);
    const { data, error } = await this.client.auth.signUp({
      ...identityFields(method, identity), password,
      options: { emailRedirectTo: this.redirect() },
    });
    if (error) throw error;
    return data;
  }

  async google() {
    const { error } = await this.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: this.redirect() } });
    if (error) throw error;
  }

  async recover(method, identity) {
    const fields = identityFields(method, identity);
    const result = method === 'phone'
      ? await this.client.auth.signInWithOtp({ ...fields, options: { shouldCreateUser: false } })
      : await this.client.auth.resetPasswordForEmail(fields.email, { redirectTo: this.redirect(true) });
    if (result.error) throw result.error;
  }

  async resend(method, identity) {
    const { error } = await this.client.auth.resend({ ...identityFields(method, identity),
      type: method === 'phone' ? 'sms' : 'signup', options: { emailRedirectTo: this.redirect() } });
    if (error) throw error;
  }

  async verifyPhone(phone, token) {
    const { data, error } = await this.client.auth.verifyOtp({ ...identityFields('phone', phone), token: token.trim(), type: 'sms' });
    if (error) throw error;
    return data;
  }

  async setPassword(password, confirmation) {
    validateNewPassword(password, confirmation);
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw error;
  }
}
