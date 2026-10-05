const encoder = new TextEncoder();

export async function passwordSha1Parts(password) {
  const bytes = encoder.encode(String(password || ''));
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
}

export function breachedCountFromRange(rangeText, suffix) {
  const target = String(suffix || '').trim().toUpperCase();
  if (!/^[A-F0-9]{35}$/.test(target)) return 0;
  for (const line of String(rangeText || '').split(/\r?\n/)) {
    const [candidate, count] = line.trim().split(':');
    if (candidate?.toUpperCase() === target) return Number.parseInt(count, 10) || 1;
  }
  return 0;
}

export async function assertPasswordNotBreached(password, lookupRange) {
  const { prefix, suffix } = await passwordSha1Parts(password);
  const rangeText = await lookupRange(prefix);
  const count = breachedCountFromRange(rangeText, suffix);
  if (count > 0) {
    throw new Error('Essa senha já apareceu em vazamentos conhecidos. Escolha outra senha.');
  }
}
