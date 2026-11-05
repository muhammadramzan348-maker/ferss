import { fmtDateTime, parseRs, esc } from '../core.js';
import { markBackup } from './ctx.js';
import { S, acts, chg, t, isAdmin, field, select, btn, formData, attempt, toast, refresh, ask, lp, $ } from './ctx.js';
import { ACCOUNTS } from '../db.js';
import { AuthError } from '../auth.js';
import { getTheme, setTheme, browserEnv } from '../theme.js';
import './backup_actions.js';

export async function settingsScreen() {
  const c = S.shop.cfg, admin = isAdmin();
  const set = (k, label, v, attrs = '') => field(k, label, v, { attrs: `data-chg="cfg" data-k="${k}" ${attrs}` });
  const theme = typeof localStorage === 'undefined' ? 'light' : getTheme(browserEnv());
  const last = Math.max(Number(lp('lastBackup', 0)), Number(lp('lastDriveBackup', 0)));
  let used = '';
  try { const e = await navigator.storage?.estimate?.(); if (e?.usage != null) used = `${(e.usage / 1048576).toFixed(1)} MB`; } catch { /* not available */ }
  const nSales = (await S.shop.store.all('sales')).length;
  return `<h2>${t('settings')}</h2>
  <div class="card"><h3>${t('language')}</h3><div class="seg wide"><button class="${S.lang === 'en' ? 'on' : ''}" data-act="setLang" data-l="en">English</button><button class="${S.lang === 'ur' ? 'on' : ''}" data-act="setLang" data-l="ur">Roman Urdu</button></div>
    <h3>${t('theme')}</h3><div class="seg wide"><button class="${theme === 'light' ? 'on' : ''}" data-act="setTheme" data-th="light">☀ ${t('theme_light')}</button><button class="${theme === 'dark' ? 'on' : ''}" data-act="setTheme" data-th="dark">🌙 ${t('theme_dark')}</button></div>
    ${select('printMethod', t('print_method'), [['rawbt', t('pm_rawbt')], ['bluetooth', t('pm_bt')], ['browser', t('pm_browser')]], lp('printMethod', 'rawbt'), 'data-chg="localPref" data-k="printMethod"')}
    ${select('receiptWidth', t('paper_width'), [['80', '80 mm'], ['58', '58 mm']], c.receiptWidth, 'data-chg="cfg" data-k="receiptWidth"')}
    ${select('idleMin', t('auto_lock'), [['1', '1 min'], ['5', '5 min'], ['15', '15 min'], ['0', t('never')]], lp('idleMin', '5'), 'data-chg="localPref" data-k="idleMin"')}
    ${btn('lockNow', '🔒 ' + t('lock_now'))}</div>
  ${admin ? `<div class="card"><h3>${t('shop_info')}</h3>${set('shopName', t('shop_name'), c.shopName)}${set('shopAddress', t('address'), c.shopAddress)}${set('shopPhone', t('phone'), c.shopPhone)}${set('footer', t('receipt_footer'), c.footer)}${set('invoicePrefix', t('invoice_prefix'), c.invoicePrefix)}
    ${select('deviceCode', t('phone_letter'), ['A', 'B', 'C', 'D'].map((x) => [x, x]), S.shop.deviceCode, 'data-chg="deviceCode"')}<p class="sub">${t('device_help')}</p>
    <label class="f chk"><input type="checkbox" data-chg="cfg" data-k="allowNegative" ${c.allowNegative ? 'checked' : ''}> ${t('allow_negative')}</label>
    <label class="f chk"><input type="checkbox" data-chg="cfg" data-k="showBanner" ${c.showBanner !== false ? 'checked' : ''}> ${t('show_banner')}</label>
    <label class="f chk"><input type="checkbox" data-chg="cfg" data-k="logoOnThermal" ${c.logoOnThermal ? 'checked' : ''}> ${t('logo_on_thermal')}</label>
    ${set('rentalGraceMin', t('rental_grace'), c.rentalGraceMin, 'inputmode="numeric"')}</div>
  <div class="card"><h3>${t('opening_balances')}</h3>${ACCOUNTS.map((a) => set(`opening_${a}`, t(`acc_${a}`), String((c[`opening_${a}`] | 0) / 100), 'inputmode="decimal"')).join('')}</div>
  <div class="card"><h3>${t('pin_security')}</h3><p class="sub">${t('pin_help')}</p>
    ${field('adminPin', t('admin_pin'), '', { type: 'password', attrs: 'inputmode="numeric" maxlength="8" autocomplete="off"' })}${btn('savePin', t('save'), { data: { role: 'admin' } })}
    ${field('salesPin', t('salesman_pin'), '', { type: 'password', attrs: 'inputmode="numeric" maxlength="8" autocomplete="off"' })}<div class="row">${btn('savePin', t('save'), { data: { role: 'salesman' } })}${await S.auth.hasSalesman() ? btn('removeSalesman', t('remove'), { cls: 'danger' }) : ''}</div></div>
  <div class="card"><h3>🛡 ${t('data_safety')}</h3><p class="sub">${t('autosave_note')}</p>
    <div class="li"><span>${t('storage_persistent')}</span><b class="${S.persisted ? 'good' : 'warn'}">${S.persisted ? t('yes') : t('no')}</b></div>
    <div class="li"><span>${t('records_count')}</span><b>${S.shop.products.size} ${t('items')} · ${S.shop.customers.size} ${t('customers')} · ${nSales} ${t('bills')} · ${S.shop.rentals.size} ${t('rentals')}</b></div>
    ${used ? `<div class="li"><span>${t('storage_used')}</span><b>${used}</b></div>` : ''}
    <div class="li"><span>${t('last_backup')}</span><b class="${last && Date.now() - last < 7 * 86400000 ? 'good' : 'bad'}">${last ? fmtDateTime(last) : '—'}</b></div>
    <div class="row wrap">${btn('runCheck', '✔ ' + t('run_check'))}${btn('exportJson', '⬇ ' + t('backup_now'), { cls: 'pri' })}</div></div>
  <div class="card"><h3>☁ ${t('gd_title')}</h3><p class="sub">${t('gd_help')}</p>
    ${set('googleClientId', t('gd_client_id'), c.googleClientId || '', 'autocapitalize="off" autocomplete="off" placeholder="1234567890-abc….apps.googleusercontent.com"')}
    <div class="row wrap">${btn('googleBackup', '⬆ ' + t('gd_backup'), { cls: 'pri' })}${btn('googleRestore', '⬇ ' + t('gd_restore'))}</div>
    <p class="sub">${t('gd_last')}: ${last ? fmtDateTime(last) : '—'}</p></div>
  <div class="card"><h3>${t('backup')} (JSON)</h3><div class="row wrap">${btn('exportJson', '⬇ ' + t('export_backup'), { cls: 'pri' })}<label class="btn">⬆ ${t('import_backup')}<input type="file" accept="application/json" data-chg="importFile" hidden></label></div>
    <hr>${btn('resetAll', t('reset_all_stock'), { cls: 'danger' })}</div>` : ''}
  <div class="card about"><img class="about-logo" src="img/logo-256.png" alt=""><div><b>${esc(c.shopName)}</b><br><small>${esc(c.shopPhone)} · ${esc(c.shopAddress)}</small></div></div>
  <div class="card"><h3>${t('install_app')}</h3><p class="sub">${t('install_help')}</p><p class="sub">v1.1 · ${S.shop.deviceCode}</p></div>`;
}

chg.cfg = (el) => attempt(async () => {
  const k = el.dataset.k; let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k.startsWith('opening_')) v = parseRs(v || '0'); else if (k === 'rentalGraceMin') v = Number(v) | 0; else if (typeof v === 'string') v = v.trim();
  await S.shop.setCfg(k, v); toast(t('saved'));
});
chg.localPref = (el) => { localStorage.setItem(el.dataset.k, el.value); if (el.dataset.k === 'idleMin') S.idleMin = Number(el.value); toast(t('saved')); };
chg.deviceCode = (el) => attempt(async () => { await S.shop.setDeviceCode(el.value); toast(t('saved')); });
acts.setLang = (el) => { window.dispatchEvent(new CustomEvent('app:lang', { detail: el.dataset.l })); };
acts.setTheme = (el) => { setTheme(el.dataset.th, browserEnv()); window.dispatchEvent(new Event('app:theme')); refresh(); };
acts.lockNow = () => window.dispatchEvent(new Event('app:lock'));
acts.savePin = (el) => attempt(async () => {
  const role = el.dataset.role, v = $(role === 'admin' ? '[name=adminPin]' : '[name=salesPin]').value;
  try { await S.auth.setPin(role, v); } catch (e) { if (e instanceof AuthError) throw new Error(t(`pin_${e.code}`)); throw e; }
  toast(t('saved')); refresh();
});
acts.removeSalesman = () => attempt(async () => { await S.auth.removeSalesman(); refresh(); });
acts.exportJson = () => attempt(async () => {
  const data = await S.shop.exportAll(); markBackup();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `ramzan-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
});
chg.importFile = (el) => attempt(async () => {
  const file = el.files[0]; if (!file) return;
  if (!ask(t('confirm_import'))) return;
  const n = await S.shop.importAll(JSON.parse(await file.text())); toast(`${t('saved')} (${n})`); refresh();
});
acts.runCheck = () => attempt(async () => {
  const r = await S.shop.selfCheck();
  if (r.ok) toast(`${t('check_ok')} (${r.counts.entries})`); else toast(`${t('check_issues')}: ${r.issues.slice(0, 3).join(' · ')}`, { error: true });
});
acts.resetAll = () => attempt(async () => {
  if (window.prompt(t('type_reset')) !== 'RESET') return;
  const n = await S.shop.resetStock(null, 'Full stock reset by admin'); toast(`${t('saved')} (${n})`); refresh();
});
void formData;
