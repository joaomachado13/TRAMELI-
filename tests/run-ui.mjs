import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = createServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Não foi possível reservar uma porta local para os testes.');
const previewPort = String(address.port);
await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
const origin = `http://127.0.0.1:${previewPort}/`;
const vite = resolve(root, 'node_modules/vite/bin/vite.js');
const allTests = ['auth-ui.mjs', 'payments-ui.mjs', 'photos-ui.mjs', 'motion-ui.mjs', 'operation-ui.mjs', 'design-ui.mjs'];
const tests = process.env.TRAMELI_UI_TEST ? [process.env.TRAMELI_UI_TEST] : allTests;
const build = spawn(process.execPath, [vite, 'build', '--configLoader', 'runner', '--mode', 'test'], {
  cwd: root,
  windowsHide: true,
  stdio: ['ignore', 'inherit', 'inherit'],
});
const [buildCode] = await once(build, 'exit');
if (buildCode !== 0) throw new Error(`Build isolado dos testes falhou com código ${buildCode}.`);

const preview = spawn(process.execPath, [vite, 'preview', '--configLoader', 'runner', '--host', '127.0.0.1', '--port', previewPort, '--strictPort'], {
  cwd: root,
  windowsHide: true,
  stdio: ['ignore', 'inherit', 'inherit'],
});

const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
let stopped = false;
const stopPreview = () => {
  if (stopped) return;
  stopped = true;
  preview.kill();
};

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (preview.exitCode !== null) throw new Error(`Vite preview encerrou com código ${preview.exitCode}.`);
    try {
      const response = await fetch(origin);
      if (response.ok) { ready = true; break; }
    } catch { /* Preview is still starting. */ }
    await pause(100);
    if (preview.exitCode !== null) throw new Error(`Vite preview encerrou com código ${preview.exitCode}.`);
  }
  if (!ready) throw new Error(`Vite preview não iniciou em ${origin}.`);

  for (const test of tests) {
    const child = spawn(process.execPath, ['--experimental-websocket', resolve(root, 'tests', test)], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, TRAMELI_TEST_URL: origin },
    });
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`${test} falhou com código ${code}.`);
  }
} finally {
  stopPreview();
  if (preview.exitCode === null) await Promise.race([once(preview, 'exit'), pause(3000)]);
}
