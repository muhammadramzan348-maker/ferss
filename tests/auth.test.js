import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../js/store.js';
import { Auth, AuthError, hashPin } from '../js/auth.js';
import { S, acts, sheetHooks, closeSheet } from '../js/ui/ctx.js';
import { loginHtml, doLogin, rememberedUsername, REMEMBER_KEY, authMessage } from '../js/ui/login.js';
import { confirmWithPin } from '../js/ui/pin_modal.js';
import { mkShop } from './helpers.js';
import { installFakeDom } from './fake-dom.js';

const dom = installFakeDom();
const mk = () => { const clock = { t: 1e12 }; return { clock, a: new Auth(new MemoryStore(), { now: () => clock.t, iterations: 1000 }) }; };
const setup = async (a) => { await a.setupFirstAdmin({ username: 'Ramzan', pin: '1234', masterPin: '9999' }); return a; };
const code = (c) => (e) => e instanceof AuthError && e.code === c;

test('first run: no users; admin account + Master PIN are created; roles and usernames', async () => {
  const { a } = mk();
  assert.equal(await a.isSetUp(), false);
  await setup(a);
  assert.equal(await a.isSetUp(), true); assert.equal(await a.hasMaster(), true);
  await a.createUser({ username: 'Bilal', pin: '5678', role: 'salesman' });
  assert.deepEqual(await a.listUsers(), [{ username: 'Bilal', role: 'salesman' }, { username: 'Ramzan', role: 'admin' }]);
  assert.deepEqual(await a.login('ramzan', '1234'), { username: 'Ramzan', role: 'admin' });      // username is not case sensitive
  assert.deepEqual(await a.login('BILAL', '5678'), { username: 'Bilal', role: 'salesman' });
  await assert.rejects(setup(a), code('exists'));                                                  // cannot run first-time setup again
});

test('validation: username rules, 4-8 digit PINs, unique names, known roles; PINs are hashed', async () => {
  const { a } = mk(); await setup(a);
  await assert.rejects(a.createUser({ username: 'ab', pin: '1234' }), code('username'));
  await assert.rejects(a.createUser({ username: 'has space', pin: '1234' }), code('username'));
  await assert.rejects(a.createUser({ username: 'Ali', pin: '12' }), code('format'));
  await assert.rejects(a.createUser({ username: 'Ali', pin: 'abcd' }), code('format'));
  await assert.rejects(a.createUser({ username: 'ramzan', pin: '4321' }), code('exists'));
  await assert.rejects(a.createUser({ username: 'Ali', pin: '1234', role: 'boss' }), code('role'));
  const rec = await a.store.get('meta', 'user:ramzan'); assert.ok(rec.hash && !JSON.stringify(rec).includes('1234'));
  assert.ok(!JSON.stringify(await a.store.get('meta', 'master')).includes('9999'));
});

test('wrong username and wrong PIN look the same; 5 failures lock that user with a growing delay', async () => {
  const { a, clock } = mk(); await setup(a);
  await assert.rejects(a.login('nobody', '1234'), (e) => e.code === 'wrong' && e.message === 'Wrong username or PIN');
  await assert.rejects(a.login('Ramzan', '0000'), (e) => e.code === 'wrong' && e.message === 'Wrong username or PIN');
  for (let i = 0; i < 2; i++) await assert.rejects(a.login('Ramzan', '0000'), code('wrong'));
  await assert.rejects(a.login('Ramzan', '0000'), (e) => e.code === 'wrong' && e.retryMs === 0);
  await assert.rejects(a.login('Ramzan', '0000'), (e) => e.code === 'wrong' && e.retryMs === 30000);
  await assert.rejects(a.login('Ramzan', '1234'), code('locked'));                                 // even the right PIN is refused
  clock.t += 31000; assert.equal((await a.login('Ramzan', '1234')).role, 'admin');
  await a.createUser({ username: 'Bilal', pin: '5678' }); assert.equal((await a.login('Bilal', '5678')).role, 'salesman');   // other users unaffected
});

test('verifyPin (used before deleting things): true/false, and locks out brute force', async () => {
  const { a } = mk(); await setup(a);
  assert.equal(await a.verifyPin('Ramzan', '1234'), true); assert.equal(await a.verifyPin('Ramzan', '1111'), false);
  for (let i = 0; i < 4; i++) await a.verifyPin('Ramzan', '1111');
  await assert.rejects(a.verifyPin('Ramzan', '1234'), code('locked'));
});

test('old installs: the single Admin/Salesman PINs become users and the Master PIN starts as the old admin PIN', async () => {
  const store = new MemoryStore(), a = new Auth(store, { iterations: 1000 });
  const rec = async (id, pin) => { const salt = btoa('0123456789abcdef'); return { id, salt, iter: 1000, hash: await hashPin(pin, salt, 1000) }; };
  await store.batch([{ col: 'meta', obj: await rec('pin:admin', '2468') }, { col: 'meta', obj: await rec('pin:salesman', '1357') }]);
  assert.equal(await a.isSetUp(), true);
  assert.deepEqual((await a.listUsers()).map((u) => [u.username, u.role]), [['admin', 'admin'], ['salesman', 'salesman']]);
  assert.equal((await a.login('admin', '2468')).role, 'admin'); assert.equal((await a.login('salesman', '1357')).role, 'salesman');
  assert.equal(await a.verifyMaster('2468'), true); assert.equal(await store.get('meta', 'pin:admin'), undefined);
});

test('Master Admin PIN: recovery resets any PIN; wrong master is refused and locks out', async () => {
  const { a, clock } = mk(); await setup(a); await a.createUser({ username: 'Bilal', pin: '5678' });
  assert.equal(await a.verifyMaster('0000'), false); assert.equal(await a.verifyMaster('9999'), true);
  await a.resetPin('Bilal', '1111');
  await assert.rejects(a.login('Bilal', '5678'), code('wrong')); assert.equal((await a.login('Bilal', '1111')).username, 'Bilal');
  await assert.rejects(a.resetPin('ghost', '1111'), code('nouser')); await assert.rejects(a.resetPin('Bilal', '1'), code('format'));
  for (let i = 0; i < 5; i++) await a.verifyMaster('0000');
  await assert.rejects(a.verifyMaster('9999'), code('locked')); clock.t += 31000; assert.equal(await a.verifyMaster('9999'), true);
  await a.setMasterPin('7777'); assert.equal(await a.verifyMaster('9999'), false); assert.equal(await a.verifyMaster('7777'), true);
});

test('changePin needs the old PIN; removeUser keeps at least one admin', async () => {
  const { a } = mk(); await setup(a); await a.createUser({ username: 'Bilal', pin: '5678' });
  await assert.rejects(a.changePin('Bilal', '0000', '1111'), code('wrong'));
  await a.changePin('Bilal', '5678', '1111'); assert.equal((await a.login('Bilal', '1111')).role, 'salesman');
  await assert.rejects(a.removeUser('Ramzan'), code('last_admin'));
  await a.removeUser('Bilal'); assert.equal((await a.listUsers()).length, 1);
  await assert.rejects(a.removeUser('Bilal'), code('nouser'));
});

// ------------------------------- login screen -------------------------------
async function ui() {
  const shop = await mkShop(); const { a } = mk(); await setup(a); await a.createUser({ username: 'Bilal', pin: '5678' });
  S.shop = shop; S.auth = a; S.lang = 'en'; S.user = null; localStorage.removeItem(REMEMBER_KEY); dom.reset();
  return { shop, a };
}
test('login page has Username, PIN, Remember username and Forgot PIN; first run shows setup with Master PIN', async () => {
  await ui();
  const h = loginHtml({ setup: false });
  for (const w of ['id="loginUser"', 'id="loginPin"', 'type="password"', 'id="loginRemember"', 'Remember username', 'data-act="forgotPin"', 'Forgot PIN?', 'data-act="loginSubmit"']) assert.ok(h.includes(w), w);
  const s = loginHtml({ setup: true });
  for (const w of ['id="setupUser"', 'id="setupMaster"', 'Master Admin PIN', 'data-act="setupSubmit"']) assert.ok(s.includes(w), w);
  S.lang = 'ur'; assert.match(loginHtml({ setup: false }), /Username yaad rakhein/); assert.match(loginHtml({ setup: false }), /PIN bhool gaye\?/);
});

test('Remember username: saved in localStorage, pre-filled next time, forgotten when unticked', async () => {
  await ui();
  assert.equal(rememberedUsername(), '');
  await doLogin({ username: 'bilal', pin: '5678', remember: true });
  assert.equal(localStorage.getItem(REMEMBER_KEY), 'Bilal'); assert.equal(rememberedUsername(), 'Bilal');
  const h = loginHtml({ setup: false }); assert.match(h, /id="loginUser" value="Bilal"/); assert.match(h, /id="loginRemember" checked/);
  await doLogin({ username: 'Bilal', pin: '5678', remember: false });
  assert.equal(rememberedUsername(), ''); assert.match(loginHtml({ setup: false }), /id="loginUser" value=""/);
  assert.equal(S.user.role, 'salesman');
  await assert.rejects(doLogin({ username: 'Bilal', pin: '0000', remember: true }), (e) => authMessage(e, 'login') === 'Wrong username or PIN');
  assert.equal(rememberedUsername(), '');                                                          // a failed login remembers nothing
});

test('LOGIN BUTTON: right credentials start the app, wrong ones show an error', async () => {
  await ui(); let started = null;
  const stub = (sel, v) => dom.reg.set(sel, v); const events = [];
  globalThis.window.dispatchEvent = (e) => { events.push(e); }; globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
  stub('#loginErr', { textContent: '' }); stub('#loginRemember', { checked: true });
  stub('#loginUser', { value: 'Ramzan' }); stub('#loginPin', { value: '0000' });
  await acts.loginSubmit(); assert.equal(dom.reg.get('#loginErr').textContent, 'Wrong username or PIN'); assert.equal(events.length, 0);
  dom.reg.get('#loginPin').value = '1234'; await acts.loginSubmit();
  started = events.find((e) => e.type === 'app:login'); assert.deepEqual(started.detail, { username: 'Ramzan', role: 'admin' });
  assert.equal(localStorage.getItem(REMEMBER_KEY), 'Ramzan');
});

test('FORGOT PIN: Master Admin PIN is verified first; only then a new PIN can be set', async () => {
  const { a } = await ui();
  const err = { textContent: '' }; dom.reg.set('#fpErr', err); dom.reg.set('#fpMaster', { value: '0000' });
  acts.forgotPin(); assert.ok(dom.sheets.some((h) => h.includes('Verify Master Admin PIN') && h.includes('id="fpMaster"')));
  await acts.forgotVerify(); assert.equal(err.textContent, 'Wrong Master PIN');                       // wrong master: no way forward
  assert.ok(!dom.sheets.some((h) => h.includes('id="fpUser"')));
  await acts.forgotReset(); assert.match(err.textContent, /Verify the Master PIN again/);             // cannot skip verification
  assert.equal((await a.login('Bilal', '5678')).role, 'salesman');                                    // PIN unchanged
  dom.reg.get('#fpMaster').value = '9999'; await acts.forgotVerify();
  const second = dom.sheets.at(-1); assert.ok(second.includes('id="fpUser"') && second.includes('Bilal') && second.includes('Ramzan') && second.includes('id="fpPin2"'));
  dom.reg.set('#fpUser', { value: 'Bilal' }); dom.reg.set('#fpPin', { value: '4321' }); dom.reg.set('#fpPin2', { value: '4000' });
  await acts.forgotReset(); assert.equal(err.textContent, 'PIN aik jaise nahi' && 'PINs do not match');
  dom.reg.get('#fpPin2').value = '4321'; await acts.forgotReset();
  assert.equal((await a.login('Bilal', '4321')).username, 'Bilal'); await assert.rejects(a.login('Bilal', '5678'), code('wrong'));
  assert.ok(dom.toasts.some((x) => /PIN changed/.test(x.text)));
  S.forgotUntil = Date.now() - 1; err.textContent = ''; await acts.forgotReset(); assert.match(err.textContent, /Time is up/);   // the permission expires
});

// ------------------------------- confirm with PIN -------------------------------
test('CONFIRM WITH PIN: wrong PIN keeps the action blocked, right PIN allows it, cancel/close never does', async () => {
  const { a } = await ui(); S.user = await a.login('Ramzan', '1234');
  const input = { value: '' }, err = { textContent: '' }; dom.reg.set('#pinConfirmInput', input); dom.reg.set('#pinConfirmErr', err);
  let result; const p = confirmWithPin({ title: 'Delete bill', message: 'RES-1' }).then((v) => { result = v; });
  assert.ok(dom.sheets.at(-1).includes('Delete bill') && dom.sheets.at(-1).includes('data-act="pinOk"'));
  input.value = '0000'; await acts.pinOk(); assert.match(err.textContent, /Incorrect PIN/); assert.equal(result, undefined);   // still waiting: nothing happens
  input.value = '1234'; await acts.pinOk(); await p; assert.equal(result, true);
  // cancel
  let r2; const p2 = confirmWithPin({ title: 'x' }).then((v) => { r2 = v; }); acts.pinCancel(); closeSheet(); await p2; assert.equal(r2, false);
  // closing the dialog some other way (X / tapping outside) also means "no"
  let r3; const p3 = confirmWithPin({ title: 'x' }).then((v) => { r3 = v; }); sheetHooks.onClose(); await p3; assert.equal(r3, false);
  // another user's PIN does not work: the SIGNED-IN user's PIN is required
  S.user = await a.login('Bilal', '5678'); let r4; const p4 = confirmWithPin({ title: 'x' }).then((v) => { r4 = v; });
  input.value = '1234'; await acts.pinOk(); assert.equal(r4, undefined);
  input.value = '5678'; await acts.pinOk(); await p4; assert.equal(r4, true);
});

test('five wrong PINs in the confirm dialog lock it (no brute forcing a delete)', async () => {
  const { a } = await ui(); S.user = await a.login('Ramzan', '1234');
  const input = { value: '' }, err = { textContent: '' }; dom.reg.set('#pinConfirmInput', input); dom.reg.set('#pinConfirmErr', err);
  let res; const p = confirmWithPin({ title: 'x' }).then((v) => { res = v; });
  for (let i = 0; i < 5; i++) { input.value = '0000'; await acts.pinOk(); }
  input.value = '1234'; await acts.pinOk(); assert.match(err.textContent, /Too many attempts|Bohat zyada/); assert.equal(res, undefined);
  acts.pinCancel(); await p; assert.equal(res, false);
});
