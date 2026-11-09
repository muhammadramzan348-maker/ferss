// "Confirm with PIN": a modal that must be passed (with the signed-in user's PIN) before something is deleted.
import { S, acts, t, openSheet, closeSheet, sheetHooks, $, esc } from './ctx.js';
import { AuthError } from '../auth.js';

let pending = null;                      // resolver of the open modal
const finish = (ok) => { const r = pending; pending = null; sheetHooks.onClose = null; if (r) r(ok); };

/** Resolves true ONLY if the correct PIN of the signed-in user was entered. Cancel / close / wrong PIN -> no action. */
export function confirmWithPin({ title, message, okLabel, danger = true }) {
  return new Promise((resolve) => {
    if (pending) finish(false);
    openSheet(`<h3>🔒 ${esc(title || t('pin_confirm_title'))}</h3><p>${esc(message || '')}</p><p class="sub">${t('pin_confirm_help')}</p>
      <input id="pinConfirmInput" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="${t('enter_pin')}" class="pin-input">
      <p class="bad" id="pinConfirmErr"></p>
      <div class="row"><button class="btn grow" data-act="pinCancel">${t('cancel')}</button><button class="btn ${danger ? 'danger' : 'pri'} grow" data-act="pinOk">${esc(okLabel || t('confirm_btn'))}</button></div>`, 'pinbox');
    pending = resolve; sheetHooks.onClose = () => finish(false);
  });
}
acts.pinCancel = () => { closeSheet(); };
acts.pinOk = async () => {
  const input = $('#pinConfirmInput'), err = $('#pinConfirmErr'), show = (m) => { if (err) err.textContent = m; if (input) input.value = ''; };
  try {
    if (!S.user) return show(t('incorrect_pin'));
    if (!(await S.auth.verifyPin(S.user.username, input?.value ?? ''))) return show(t('incorrect_pin'));
  } catch (e) { return show(e instanceof AuthError && e.code === 'locked' ? `${t('pin_locked')} (${Math.ceil(e.retryMs / 1000)}s)` : e.message); }
  sheetHooks.onClose = null; closeSheet(); finish(true);
};
