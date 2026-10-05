import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter(path => !/\.(?:png|jpe?g|webp|gif|ico|ttf|woff2?|zip|pdf)$/i.test(path))
  .filter(path => !path.endsWith('assets/vendor/gsap.min.js'));

const findings = [];
const patterns = [
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{16,}\b/g],
  ['GitHub personal access token', /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const decodeJwtPayload = token => {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

for (const path of files) {
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text == null) continue;

  for (const [label, regex] of patterns) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      findings.push({ path, line: lineOf(text, match.index), label });
    }
  }

  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g)) {
    const payload = decodeJwtPayload(match[0]);
    if (payload?.role === 'service_role') {
      findings.push({ path, line: lineOf(text, match.index), label: 'Supabase service_role JWT' });
    }
  }

  for (const match of text.matchAll(/postgres(?:ql)?:\/\/[^\s/@:]+:([^\s@]+)@[^\s]+/gi)) {
    const password = match[1];
    if (!/[<$>{}]|YOUR_|EXAMPLE|PASSWORD/i.test(password)) {
      findings.push({ path, line: lineOf(text, match.index), label: 'Database URL with literal password' });
    }
  }
}

if (findings.length) {
  console.error('Possíveis segredos encontrados no repositório:');
  for (const finding of findings) console.error(`- ${finding.path}:${finding.line} — ${finding.label}`);
  process.exit(1);
}

console.log(`Segredos: ${files.length} arquivos de texto verificados; nenhum segredo administrativo conhecido encontrado.`);
