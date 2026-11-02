import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../js/store.js';
import { Auth, AuthError } from '../js/auth.js';

const mk = () => { const clock = { t: 1e12 }; return { clock, a: new Auth(new MemoryStore(), { now: () => clock.t, iterations: 1000 }) }; };

test('first run has no PIN; admin and salesman PINs give the right roles', async () => {
  const { a } = mk();
  assert.equal(await a.isSetUp(), false);
  await a.setPin('admin', '1234'); await a.setPin('salesman', '5678');
  assert.equal(await a.isSetUp(), true);
  assert.equal(await a.login('1234'), 'admin');
  assert.equal(await a.login('5678'), 'salesman');
});
test('PIN validation: digits only, 4-8, different per role; hashes not plain text', async () => {
  const { a } = mk();
  await assert.rejects(a.setPin('admin', '12'), (e) => e.code === 'format');
  await assert.rejects(a.setPin('admin', 'abcd'), (e) => e.code === 'format');
  await a.setPin('admin', '1234');
  await assert.rejects(a.setPin('salesman', '1234'), (e) => e.code === 'same');
  const rec = await a.store.get('meta', 'pin:admin');
  assert.ok(rec.hash && !JSON.stringify(rec).includes('1234'));
});
test('wrong PIN rejected; 5 failures lock out with growing delay; lock expires; success resets', async () => {
  const { a, clock } = mk();
  await a.setPin('admin', '1234');
  for (let i = 0; i < 4; i++) await assert.rejects(a.login('0000'), (e) => e.code === 'wrong' && e.retryMs === 0);
  await assert.rejects(a.login('0000'), (e) => e.code === 'wrong' && e.retryMs === 30000);
  await assert.rejects(a.login('1234'), (e) => e instanceof AuthError && e.code === 'locked');   // even the right PIN is refused
  clock.t += 31000;
  assert.equal(await a.login('1234'), 'admin');
  await assert.rejects(a.login('0000'));                                                           // counter was reset
  assert.equal((await a.store.get('meta', 'lockout')).fails, 1);
});
