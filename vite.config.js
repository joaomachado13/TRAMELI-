import { defineConfig, loadEnv } from 'vite';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (command === 'build' && mode !== 'test') {
    const url = env.VITE_SUPABASE_URL || '';
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
    if (!url.startsWith('https://') || url.includes('YOUR_PROJECT') || !key.startsWith('sb_publishable_')) {
      throw new Error('Build de publicação bloqueado: configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY. Use npm run check para testar sem publicar.');
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
