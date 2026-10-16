import { defineConfig, loadEnv } from 'vite';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (command === 'build' && mode !== 'test') {
    const url = env.VITE_SUPABASE_URL || '';
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
    const configurationIssues = [];
    if (!url.startsWith('https://') || url.includes('YOUR_PROJECT') || !url.endsWith('.supabase.co')) {
      configurationIssues.push('VITE_SUPABASE_URL ausente ou inválida (esperado https://<projeto>.supabase.co)');
    }
    if (!key.startsWith('sb_publishable_')) {
      configurationIssues.push('VITE_SUPABASE_PUBLISHABLE_KEY ausente ou com formato inesperado (esperado prefixo sb_publishable_)');
    }
    if (configurationIssues.length) {
      throw new Error(
        `Build de publicação bloqueado. Problemas de configuração: ${configurationIssues.join('; ')}. ` +
        'Confira as variáveis disponíveis no ambiente de build. Os valores não são exibidos por segurança.'
      );
    }
  }
  const input = {
    main: resolve('index.html'),
    operationRedirect: resolve('operacao.html'),
  };
  if (mode === 'test') {
    Object.assign(input, {
      authFixture: resolve('tests/auth-fixture.html'),
      paymentsFixture: resolve('tests/payments-fixture.html'),
      photosFixture: resolve('tests/photos-fixture.html'),
    });
  }
  return {
    base: mode === 'github-pages' ? '/TRAMELI-/' : '/',
    optimizeDeps: { noDiscovery: true, include: ['qrcode'] },
    build: { rollupOptions: { input } },
    plugins: [{
      name: 'copy-static-product-media',
      closeBundle() {
        cpSync('assets/products', 'dist/assets/products', { recursive: true });
      },
    }],
  };
});
