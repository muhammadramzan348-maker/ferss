import { esc, fmtDateTime, parseRs } from '../core.js';
import { S, acts, chg, t, money, isAdmin, field, select, btn, openSheet, closeSheet, sheetEl, formData, attempt, toast, refresh, ask, $ } from './ctx.js';
import { ACCOUNTS } from '../db.js';
import { AuthError } from '../auth.js';

const lp = (k, d) => (typeof localStorage === 'undefined' ? d : localStorage.getItem(k) ?? d);

export async function settingsScreen() {
  const c = S.shop.cfg, admin = isAdmin();
  const set = (k, label, v, attrs = '') => field(k, label, v, { attrs: `data-chg="cfg" data-k="${k}" ${attrs}` });
  return `<h2>${t('settings')}</h2>
  <div class="card"><h3>${t('language')}</h3><div class="seg wide"><button class="${S.lang === 'en' ? 'on' : ''}" data-act="setLang" data-l="en">English</button><button class="${S.lang === 'ur' ? 'on' : ''}" data-act="setLang" data-l="ur">اردو</button></div>
    ${select('printMethod', t('print_method'), [['rawbt', t('pm_rawbt')], ['bluetooth', t('pm_bt')], ['browser', t('pm_browser')]], lp('printMethod', 'rawbt'), 'data-chg="localPref" data-k="printMethod"')}
    ${select('receiptWidth', t('paper_width'), [['80', '80 mm'], ['58', '58 mm']], c.receiptWidth, 'data-chg="cfg" data-k="receiptWidth"')}
    ${select('idleMin', t('auto_lock'), [['1', '1 min'], ['5', '5 min'], ['15', '15 min'], ['0', t('never')]], lp('idleMin', '5'), 'data-chg="localPref" data-k="idleMin"')}
    ${btn('lockNow', '🔒 ' + t('lock_now'))}</div>
  ${admin ? `<div class="card"><h3>${t('shop_info')}</h3>${set('shopName', t('shop_name'), c.shopName)}${set('shopAddress', t('address'), c.shopAddress)}${set('shopPhone', t('phone'), c.shopPhone)}${set('footer', t('receipt_footer'), c.footer)}${set('invoicePrefix', t('invoice_prefix'), c.invoicePrefix)}
    <label class="f chk"><input type="checkbox" data-chg="cfg" data-k="allowNegative" ${c.allowNegative ? 'checked' : ''}> ${t('allow_negative')}</label>
    ${set('rentalGraceMin', t('rental_grace'), c.rentalGraceMin, 'inputmode="numeric"')}</div>
  <div class="card"><h3>${t('opening_balances')}</h3>${ACCOUNTS.map((a) => set(`opening_${a}`, t(`acc_${a}`), String((c[`opening_${a}`] | 0) / 100), 'inputmode="decimal"')).join('')}</div>
  <div class="card"><h3>${t('pin_security')}</h3><p class="sub">${t('pin_help')}</p>
    ${field('adminPin', t('admin_pin'), '', { type: 'password', attrs: 'inputmode="numeric" maxlength="8" autocomplete="off"' })} ${btn('savePin', t('save'), { data: { role: 'admin' } })}
    ${field('salesPin', t('salesman_pin'), '', { type: 'password', attrs: 'inputmode="numeric" maxlength="8" autocomplete="off"' })}<div class="row">${btn('savePin', t('save'), { data: { role: 'salesman' } })}${await S.auth.hasSalesman() ? btn('removeSalesman', t('remove'), { cls: 'danger' }) : ''}</div></div>
  <div class="card"><h3>☁ Google Drive Backup</h3><p class="sub">Apna sara dukan ka data apni Google Drive par mehfooz karein.</p>
    <div class="row wrap">
      <button onclick="startGoogleBackup()" style="background: #4285F4; color: white; padding: 8px 12px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">Backup to Drive</button>
      <button onclick="startGoogleRestore()" style="background: #34A853; color: white; padding: 8px 12px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">Restore from Drive</button>
    </div>
    <p id="syncStatus" class="sub" style="margin-top: 5px; font-weight: bold;"></p></div>
  <div class="card"><h3>${t('backup')}</h3><div class="row wrap"><label class="btn">⬆ ${t('import_backup')}<input type="file" accept="application/json" data-chg="importFile" hidden></label></div>
    <hr>${btn('resetAll', t('reset_all_stock'), { cls: 'danger' })}</div>` : ''}
  <div class="card"><h3>${t('install_app')}</h3><p class="sub">${t('install_help')}</p><p class="sub">v1.0 · ${S.shop.deviceCode}</p></div>`;
}

chg.cfg = (el) => attempt(async () => {
  const k = el.dataset.k; let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k.startsWith('opening_')) v = parseRs(v || '0'); else if (k === 'rentalGraceMin') v = Number(v) | 0;
  await S.shop.setCfg(k, v); toast(t('saved'));
});
chg.localPref = (el) => { localStorage.setItem(el.dataset.k, el.value); if (el.dataset.k === 'idleMin') S.idleMin = Number(el.value); toast(t('saved')); };
chg.localPrefBool = (el) => { localStorage.setItem(el.dataset.k, el.checked ? '1' : '0'); };
chg.deviceCode = (el) => attempt(async () => { await S.shop.setDeviceCode(el.value); toast(t('saved')); });
acts.setLang = (el) => { window.dispatchEvent(new CustomEvent('app:lang', { detail: el.dataset.l })); };
acts.lockNow = () => window.dispatchEvent(new Event('app:lock'));
acts.savePin = (el) => attempt(async () => {
  const role = el.dataset.role, v = $(role === 'admin' ? '[name=adminPin]' : '[name=salesPin]').value;
  try { await S.auth.setPin(role, v); } catch (e) { if (e instanceof AuthError) throw new Error(t(`pin_${e.code}`)); throw e; }
  toast(t('saved')); refresh();
});
acts.removeSalesman = () => attempt(async () => { await S.auth.removeSalesman(); refresh(); });
chg.importFile = (el) => attempt(async () => {
  const file = el.files[0]; if (!file) return;
  if (!ask(t('confirm_import'))) return;
  const n = await S.shop.importAll(JSON.parse(await file.text())); toast(`${t('saved')} (${n})`); refresh();
});
acts.resetAll = () => attempt(async () => {
  if (window.prompt(t('type_reset')) !== 'RESET') return;
  const n = await S.shop.resetStock(null, 'Full stock reset by admin'); toast(`${t('saved')} (${n})`); refresh();
});
void esc; void money; void closeSheet; void sheetEl; void openSheet;
