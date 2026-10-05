import assert from 'node:assert/strict';
import { assertPasswordNotBreached, breachedCountFromRange, passwordSha1Parts } from '../src/password-security.js';

const known = await passwordSha1Parts('password');
assert.equal(known.prefix, '5BAA6');
assert.equal(known.suffix, '1E4C9B93F3F0682250B6CF8331B7EE68FD8');

const range = [
  '00000000000000000000000000000000000:1',
  '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3303003',
].join('\r\n');

assert.equal(breachedCountFromRange(range, known.suffix), 3303003);
await assert.rejects(
  assertPasswordNotBreached('password', async prefix => {
    assert.equal(prefix, '5BAA6');
    return range;
  }),
  /vazamentos conhecidos/,
);

await assertPasswordNotBreached('Trameli-Unique-Test-Password-93!', async () => 'ABCDEF0123456789ABCDEF0123456789ABC:1');

console.log('Senhas: consulta k-anônima e bloqueio de senha vazada OK.');
