// Boot, lock screen, router, shell, event delegation, auto-sync, idle lock, service worker.
import { IdbStore } from './store.js';
import { Shop } from './db.js';
import { Auth, AuthError } from './auth.js';
import { Sync } from './sync.js';
import { S, acts, ins, chg, t, toast, openSheet, closeSheet, $, isAdmin, can, attempt } from './ui/ctx.js';
import * as M from './ui/main_screens.js';
import * as K from './ui/stock_screens.js';
import * as O from './ui/ops_screens.js';
import { settingsScreen } from './ui/settings_screen.js';
import { esc } from './core.js';

const root = document.getElementById('app');
let syncTimer = null, idleTimer = null, autoTimer = null;

export const ROUTES = [
  [/^$/, () => M.dashboard()], [/^sell$/, () => M.pos()], [/^sales$/, (m, q) => M.salesList(q)], [/^sale\/(.+)$/, (m) => M.saleDetail(m[1])],
  [/^items$/, () => K.itemsList()], [/^item\/(.+)$/, (m) => K.itemForm(m[1])],
  [/^customers$/, () => K.partyList('customer')], [/^customer\/(.+)$/, (m) => K.partyDetail('customer', m[1])],
  [/^suppliers$/, () => K.partyList('supplier')], [/^supplier\/(.+)$/, (m) => K.partyDetail('supplier', m[1])],
  [/^purchase$/, (m, q) => K.purchaseScreen(q)], [/^rentals$/, () => O.rentalsScreen()], [/^rental\/new$/, () => O.rentalNew()],
  [/^expenses$/, () => O.expensesScreen()], [/^reports$/, () => O.reportsScreen()], [/^settings$/, () => settingsScreen()],
];
const ADMIN_ONLY = /^(suppliers|supplier\/|purchase|expenses)/;

async function boot() {
  const store = await new IdbStore().open();
  S.shop = await new Shop({ store }).init();
  S.shop.role = null;
  S.auth = new Auth(store); S.sync = new Sync(S.shop, { onlineCheck: () => navigator.onLine });
  S.lang = localStorage.getItem('lang') || 'en'; S.idleMin = Number(localStorage.getItem('idleMin') ?? 5);
  applyLang();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  showLock();
}
function applyLang() { document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === 'ur' ? 'rtl' : 'ltr'; }

// ---------- lock screen ----------
async function showLock() {
  clearTimeout(idleTimer); clearInterval(autoTimer); closeSheet();
  S.shop.role = null;
  const setup = !(await S.auth.isSetUp());
  root.innerHTML = `<div class="lock"><div class="lock-box"><h1>${esc(S.shop.cfg.shopName)}</h1>
    ${setup ? `<p>${t('first_run')}</p><input id="pin1" type="password" inputmode="numeric" maxlength="8" placeholder="${t('new_pin')}" autocomplete="off"><input id="pin2" type="password" inputmode="numeric" maxlength="8" placeholder="${t('confirm_pin')}" autocomplete="off">
    <button class="btn pri big" id="pinSet">${t('save')}</button>`
      : `<input id="pin" type="password" inputmode="numeric" maxlength="8" placeholder="${t('enter_pin')}" autocomplete="off" autofocus><button class="btn pri big" id="pinGo">🔓 ${t('unlock')}</button>`}
    <p class="bad" id="pinErr"></p><div class="row"><button class="btn link" id="langBtn">${S.lang === 'en' ? 'اردو' : 'English'}</button></div></div></div>`;
  $('#langBtn').onclick = () => { setLang(S.lang === 'en' ? 'ur' : 'en'); showLock(); };
  const err = (m) => { $('#pinErr').textContent = m; };
  if (setup) {
    $('#pinSet').onclick = async () => {
      const a = $('#pin1').value, b = $('#pin2').value;
      if (a !== b) return err(t('pin_mismatch'));
      try { await S.auth.setPin('admin', a); S.shop.role = 'admin'; startApp(); } catch (e) { err(e instanceof AuthError ? t(`pin_${e.code}`) : e.message); }
    };
  } else {
    const go = async () => {
      try { const role = await S.auth.login($('#pin').value); S.shop.role = role; startApp(); }
      catch (e) { err(e.code === 'locked' ? `${t('pin_locked')} (${Math.ceil(e.retryMs / 1000)}s)` : t('pin_wrong')); $('#pin').value = ''; }
    };
    $('#pinGo').onclick = go; $('#pin').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }
}
window.addEventListener('app:lock', showLock);

// ---------- shell ----------
function setLang(l) { S.lang = l; localStorage.setItem('lang', l); applyLang(); }
window.addEventListener('app:lang', (e) => { setLang(e.detail); if (S.shop.role) startApp(); });

function navItems() {
  const a = isAdmin();
  return [['#/', '🏠', t('home')], ['#/sell', '🛒', t('sell')], ['#/sales', '🧾', t('sales')], ['#/items', '📦', t('items')], ['#/customers', '👥', t('customers')], ['#/rentals', '🪑', t('rentals')],
    ...(a ? [['#/suppliers', '🚚', t('suppliers')], ['#/expenses', '💸', t('expenses')]] : []), ['#/reports', '📊', t('reports')], ['#/settings', '⚙', t('settings')]];
}
function startApp() {
  const items = navItems(), primary = items.slice(0, 5);
  root.innerHTML = `<div class="shell"><aside class="side"><div class="logo">⚡ ${esc(S.shop.cfg.shopName)}</div>${items.map(([h, i, l]) => `<a href="${h}" data-nav="${h}">${i} <span>${l}</span></a>`).join('')}</aside>
    <div class="content"><header class="top"><b class="ttl">${esc(S.shop.cfg.shopName)}</b><span class="grow"></span><span class="role">${S.shop.role === 'admin' ? '👑' : '🧑‍💼'}</span>
      <button class="ic" id="syncBtn" title="sync">⟳</button><button class="ic" id="langTop">${S.lang === 'en' ? 'اردو' : 'EN'}</button><button class="ic" id="lockTop">🔒</button></header>
      <main id="main"></main></div>
    <nav class="bottom">${primary.map(([h, i, l]) => `<a href="${h}" data-nav="${h}">${i}<span>${l}</span></a>`).join('')}<a href="#/settings" data-nav="#/settings">⋯<span>${t('more')}</span></a></nav></div>`;
  $('#lockTop').onclick = showLock; $('#langTop').onclick = () => { setLang(S.lang === 'en' ? 'ur' : 'en'); startApp(); };
  $('#syncBtn').onclick = () => acts.syncNow();
  render(); resetIdle(); setupAutoSync();
}

async function render() {
  const main = $('#main'); if (!main || !S.shop.role) return;
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?'), q = new URLSearchParams(qs);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', (a.dataset.nav === '#/' ? path === '' : path.startsWith(a.dataset.nav.slice(2)))));
  if (!isAdmin() && ADMIN_ONLY.test(path)) { toast(t('admin_only'), { error: true }); location.hash = '#/'; return; }
  const scroll = window.scrollY;
  try {
    for (const [re, fn] of ROUTES) { const m = re.exec(path); if (m) { main.innerHTML = await fn(m, q); window.scrollTo(0, scroll); return; } }
    main.innerHTML = `<p class="empty">404</p>`;
  } catch (e) { main.innerHTML = `<p class="bad">${esc(e.message)}</p>`; console.error(e); }
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
window.addEventListener('app:refresh', render);

// ---------- delegated events ----------
const run = (table, key, el, ev) => { const f = table[el.dataset[key]]; if (f) { const r = f(el, ev); if (r && r.catch) r.catch((e) => toast(e.message, { error: true })); } };
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); resetIdle();
  if (el) { if (el.tagName === 'A' && el.getAttribute('href')?.startsWith('#')) { /* let navigation happen too */ } run(acts, 'act', el, e); }
  else if (e.target.id === 'sheet') closeSheet();
});
document.addEventListener('input', (e) => { const el = e.target.closest('[data-in]'); resetIdle(); if (el) run(ins, 'in', el, e); });
document.addEventListener('change', (e) => { const el = e.target.closest('[data-chg]'); if (el) run(chg, 'chg', el, e); });
document.addEventListener('keydown', resetIdle);

// ---------- idle lock ----------
function resetIdle() {
  clearTimeout(idleTimer);
  if (S.shop?.role && S.idleMin > 0) idleTimer = setTimeout(showLock, S.idleMin * 60000);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) S.hiddenAt = Date.now();
  else if (S.shop?.role && S.idleMin > 0 && S.hiddenAt && Date.now() - S.hiddenAt > S.idleMin * 60000) showLock();
});

// ---------- auto sync ----------
function setupAutoSync() {
  clearInterval(autoTimer);
  const go = async () => {
    if (localStorage.getItem('autoSync') === '0' || !S.shop.role || !(await S.sync.signedIn())) return;
    const r = await S.sync.syncNow();
    if (!r.error && r.pulled > 0) render();
    const b = $('#syncBtn'); if (b) b.classList.toggle('err', !!r.error && r.error !== 'Offline');
  };
  autoTimer = setInterval(go, 3 * 60000); go();
  S.shop.onChange = () => { clearTimeout(syncTimer); syncTimer = setTimeout(go, 8000); };
  window.addEventListener('online', go);
}

boot().catch((e) => { root.innerHTML = `<p class="bad" style="padding:20px">Startup error: ${esc(e.message)}</p>`; console.error(e); });
void can; void attempt; void openSheet;
