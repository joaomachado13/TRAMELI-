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

  async signUp(method, identity, password, confirmation, profile = null) {
    validateNewPassword(password, confirmation);
    if (profile && (!profile.name || !profile.phone || !profile.address)) throw new Error('Informe nome, telefone e endereço.');
    const { data, error } = await this.client.auth.signUp({
      ...identityFields(method, identity), password,
      options: { emailRedirectTo: this.redirect(), ...(profile ? { data: { ...profile, full_name: profile.name } } : {}) },
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

  async updateProfile(profile) {
    if (!profile.name || !profile.address) throw new Error('Informe nome e endereço.');
    const { error } = await this.client.auth.updateUser({ data: { ...profile, full_name: profile.name } });
    if (error) throw error;
  }

  async mfaStatus() {
    const [aalResult, factorsResult] = await Promise.all([
      this.client.auth.mfa.getAuthenticatorAssuranceLevel(),
      this.client.auth.mfa.listFactors(),
    ]);
    if (aalResult.error) throw aalResult.error;
    if (factorsResult.error) throw factorsResult.error;
    const factors = factorsResult.data || {};
    const all = Array.isArray(factors.all) ? factors.all : [];
    const totp = Array.isArray(factors.totp)
      ? factors.totp
      : all.filter(factor => (factor.factor_type || factor.factorType || factor.type) === 'totp');
    return {
      currentLevel: aalResult.data?.currentLevel || 'aal1',
      nextLevel: aalResult.data?.nextLevel || 'aal1',
      currentAuthenticationMethods: aalResult.data?.currentAuthenticationMethods || [],
      totp,
    };
  }

  async enrollTotp() {
    const { data, error } = await this.client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Trameli Master',
    });
    if (error) throw error;
    return data;
  }

  async verifyTotp(factorId, code) {
    const token = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(token)) throw new Error('Informe o código de 6 dígitos do autenticador.');
    const { data, error } = await this.client.auth.mfa.challengeAndVerify({ factorId, code: token });
    if (error) throw error;
    return data;
  }

  async stepUpTotp(code) {
    const status = await this.mfaStatus();
    const factor = status.totp.find(item => item.status === 'verified');
    if (!factor) throw new Error('Ative a verificação em duas etapas antes de continuar.');
    return this.verifyTotp(factor.id, code);
  }

  async removeMfaFactor(factorId) {
    const { data, error } = await this.client.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    return data;
  }

}
