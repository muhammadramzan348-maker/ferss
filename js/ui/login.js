// Login screen logic: Username + PIN, "Remember username", first-run setup, and PIN recovery with the Master Admin PIN.
import { S, acts, t, esc, field, select, openSheet, closeSheet, toast, formData, $ } from './ctx.js';
import { AuthError } from '../auth.js';

export const REMEMBER_KEY = 'rememberedUsername';
const ls = () => (typeof localStorage === 'undefined' ? null : localStorage);
export const rememberedUsername = () => ls()?.getItem(REMEMBER_KEY) || '';
export function setRemembered(username, on) { if (!ls()) return; if (on) ls().setItem(REMEMBER_KEY, username); else ls().removeItem(REMEMBER_KEY); }

/** translated, human message for an auth failure */
export function authMessage(e, context = 'pin') {
  if (!(e instanceof AuthError)) return e.message;
  if (e.code === 'locked') return `${t('pin_locked')} (${Math.ceil(e.retryMs / 1000)}s)`;
  if (e.code === 'wrong') return context === 'login' ? t('wrong_login') : t('pin_wrong');
  return t(`pin_${e.code}`);
}

export function loginHtml({ setup }) {
  const remembered = rememberedUsername();
  const top = `<img class="lock-logo" src="img/logo-256.png" alt="Ramzan Electric Store & Hardware"><h1>${esc(S.shop.cfg.shopName)}</h1>`;
  const bottom = `<p class="bad" id="loginErr"></p><div class="row center"><button class="btn link" id="langBtn">${S.lang === 'en' ? 'Roman Urdu' : 'English'}</button><button class="btn link" id="themeBtn">🌓</button></div>`;
  if (setup) return `<div class="lock"><div class="lock-box" id="setupBox">${top}<h3>${t('setup_admin')}</h3><p class="sub">${t('first_run')}</p>
    ${field('username', t('username'), '', { attrs: 'id="setupUser" autocomplete="username" autocapitalize="off"' })}<p class="sub">${t('username_rules')}</p>
    ${field('pin', t('pin'), '', { type: 'password', attrs: 'id="setupPin" inputmode="numeric" maxlength="8" autocomplete="new-password"' })}
    ${field('pin2', t('confirm_pin'), '', { type: 'password', attrs: 'id="setupPin2" inputmode="numeric" maxlength="8" autocomplete="new-password"' })}
    <h4>${t('master_set')}</h4><p class="sub">${t('master_hint')}</p>
    ${field('master', t('master_pin'), '', { type: 'password', attrs: 'id="setupMaster" inputmode="numeric" maxlength="8" autocomplete="off"' })}
    ${field('master2', t('confirm_pin'), '', { type: 'password', attrs: 'id="setupMaster2" inputmode="numeric" maxlength="8" autocomplete="off"' })}
    <button class="btn pri big" data-act="setupSubmit">${t('save')}</button>${bottom}</div></div>`;
  return `<div class="lock"><div class="lock-box">${top}
    <label class="f"><span>${t('username')}</span><input id="loginUser" value="${esc(remembered)}" autocomplete="username" autocapitalize="off" ${remembered ? '' : 'autofocus'}></label>
    <label class="f"><span>${t('pin')}</span><input id="loginPin" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password" placeholder="${t('enter_pin')}" ${remembered ? 'autofocus' : ''}></label>
    <label class="f chk"><input type="checkbox" id="loginRemember" ${remembered ? 'checked' : ''}> ${t('remember_username')}</label>
    <button class="btn pri big" data-act="loginSubmit">🔓 ${t('login_btn')}</button>
    <button class="btn link" data-act="forgotPin">${t('forgot_pin')}</button>${bottom}</div></div>`;
}

const setErr = (m) => { const e = $('#loginErr'); if (e) e.textContent = m; };

/** validate the form, sign in, remember the username (or forget it), and tell the app. */
export async function doLogin({ username, pin, remember }) {
  const user = await S.auth.login(username, pin);
  setRemembered(user.username, remember);
  S.user = user;
  return user;
}
acts.loginSubmit = async () => {
  try {
    const user = await doLogin({ username: $('#loginUser').value, pin: $('#loginPin').value, remember: $('#loginRemember').checked });
    window.dispatchEvent(new CustomEvent('app:login', { detail: user }));
  } catch (e) { setErr(authMessage(e, 'login')); const p = $('#loginPin'); if (p) p.value = ''; }
};
acts.setupSubmit = async () => {
  try {
    const v = { username: $('#setupUser').value, pin: $('#setupPin').value, pin2: $('#setupPin2').value, master: $('#setupMaster').value, master2: $('#setupMaster2').value };
    if (v.pin !== v.pin2 || v.master !== v.master2) return setErr(t('pin_mismatch'));
    await S.auth.setupFirstAdmin({ username: v.username, pin: v.pin, masterPin: v.master });
    const user = await doLogin({ username: v.username, pin: v.pin, remember: true });
    window.dispatchEvent(new CustomEvent('app:login', { detail: user }));
  } catch (e) { setErr(authMessage(e)); }
};

// ----- Forgot PIN: verify the Master Admin PIN first, then set a new PIN for a user -----
acts.forgotPin = () => {
  openSheet(`<h3>🔑 ${t('master_verify_title')}</h3><p class="sub">${t('master_help')}</p>
    <input id="fpMaster" type="password" inputmode="numeric" maxlength="8" autocomplete="off" class="pin-input" placeholder="${t('master_pin')}">
    <p class="bad" id="fpErr"></p><button class="btn pri big" data-act="forgotVerify">${t('verify')}</button>`);
};
acts.forgotVerify = async () => {
  const err = $('#fpErr');
  try {
    if (!(await S.auth.verifyMaster($('#fpMaster').value))) { err.textContent = t('master_wrong'); $('#fpMaster').value = ''; return; }
  } catch (e) { err.textContent = authMessage(e); return; }
  S.forgotUntil = Date.now() + 3 * 60000;                       // the reset must be finished within 3 minutes
  const users = await S.auth.listUsers();
  openSheet(`<h3>🔑 ${t('reset_pin')}</h3>${select('fpUser', t('choose_user'), users.map((u) => [u.username, `${u.username} (${t(`role_${u.role}`)})`]), rememberedUsername() || users[0]?.username, 'id="fpUser"')}
    ${field('fpPin', t('new_pin'), '', { type: 'password', attrs: 'id="fpPin" inputmode="numeric" maxlength="8" autocomplete="new-password"' })}
    ${field('fpPin2', t('confirm_pin'), '', { type: 'password', attrs: 'id="fpPin2" inputmode="numeric" maxlength="8" autocomplete="new-password"' })}
    <p class="bad" id="fpErr"></p><button class="btn pri big" data-act="forgotReset">${t('reset_pin')}</button>`);
};
acts.forgotReset = async () => {
  const err = $('#fpErr');
  if (!(S.forgotUntil > Date.now())) { err.textContent = t('master_expired'); return; }
  if ($('#fpPin').value !== $('#fpPin2').value) { err.textContent = t('pin_mismatch'); return; }
  try { await S.auth.resetPin($('#fpUser').value, $('#fpPin').value); }
  catch (e) { err.textContent = authMessage(e); return; }
  const who = $('#fpUser').value; S.forgotUntil = 0;
  closeSheet(); toast(t('pin_reset_done'));
  const u = $('#loginUser'); if (u) u.value = who;
  const p = $('#loginPin'); if (p) p.focus?.();
};
void formData;
