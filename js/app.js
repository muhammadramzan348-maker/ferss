// Boot, lock screen, router, shell, event delegation, idle lock, theme, service worker.
import { IdbStore } from './store.js';
import { Shop } from './db.js';
import { Auth, AuthError } from './auth.js';
import { S, acts, ins, chg, t, toast, openSheet, closeSheet, $, isAdmin } from './ui/ctx.js';
import * as M from './ui/main_screens.js';
import * as K from './ui/stock_screens.js';
import * as O from './ui/ops_screens.js';
import { khataScreen } from './ui/khata_screen.js';
import { settingsScreen } from './ui/settings_screen.js';
import { loginHtml } from './ui/login.js';
import { binScreen } from './ui/bin_screen.js';
import './ui/pin_modal.js';
import { esc } from './core.js';
import { applyTheme, getTheme, toggleTheme, browserEnv } from './theme.js';

const root = document.getElementById('app');
let idleTimer = null;

export const ROUTES = [
  [/^$/, () => M.dashboard()], [/^sell$/, () => M.pos()], [/^khata$/, () => khataScreen()], [/^sales$/, (m, q) => M.salesList(q)], [/^sale\/(.+)$/, (m) => M.saleDetail(m[1])],
  [/^items$/, () => K.itemsList()], [/^item\/(.+)$/, (m) => K.itemForm(m[1])],
  [/^customers$/, () => K.partyList('customer')], [/^customer\/(.+)$/, (m) => K.partyDetail('customer', m[1])],
  [/^suppliers$/, () => K.partyList('supplier')], [/^supplier\/(.+)$/, (m) => K.partyDetail('supplier', m[1])],
  [/^purchase$/, (m, q) => K.purchaseScreen(q)], [/^rentals$/, () => O.rentalsScreen()], [/^rental\/new$/, () => O.rentalNew()], [/^rental\/(.+)$/, (m) => O.rentalDetail(m[1])],
  [/^expenses$/, () => O.expensesScreen()], [/^reports$/, () => O.reportsScreen()], [/^settings$/, () => settingsScreen()], [/^bin$/, () => binScreen()],
];
const ADMIN_ONLY = /^(suppliers|supplier\/|purchase|expenses|bin)/;

async function boot() {
  applyTheme(getTheme(browserEnv()), document);
  const store = await new IdbStore().open();
  S.shop = await new Shop({ store }).init();
  S.shop.role = null;
  S.auth = new Auth(store);
  try { S.persisted = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; } catch { S.persisted = false; }
  S.lang = localStorage.getItem('lang') || 'en'; S.idleMin = Number(localStorage.getItem('idleMin') ?? 5);
  applyLang();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  showLock();
}
// Roman Urdu is written in English letters, so the layout is always left-to-right.
function applyLang() { document.documentElement.lang = S.lang === 'ur' ? 'ur-Latn' : 'en'; document.documentElement.dir = 'ltr'; }

// ---------- login screen (Username + PIN) ----------
async function showLock() {
  clearTimeout(idleTimer); closeSheet();
  S.shop.role = null; S.user = null;
  root.innerHTML = loginHtml({ setup: !(await S.auth.isSetUp()) });
  $('#langBtn').onclick = () => { setLang(S.lang === 'en' ? 'ur' : 'en'); showLock(); };
  $('#themeBtn').onclick = () => toggleTheme(browserEnv());
  const pin = $('#loginPin'); if (pin) pin.onkeydown = (e) => { if (e.key === 'Enter') acts.loginSubmit(); };
}
window.addEventListener('app:login', (e) => { S.user = e.detail; S.shop.role = e.detail.role; startApp(); });
window.addEventListener('app:lock', showLock);

// ---------- shell ----------
function setLang(l) { S.lang = l; localStorage.setItem('lang', l); applyLang(); }
window.addEventListener('app:lang', (e) => { setLang(e.detail); if (S.shop.role) startApp(); });
const themeIcon = () => (getTheme(browserEnv()) === 'dark' ? '☀' : '🌙');
window.addEventListener('app:theme', () => { const b = $('#themeTop'); if (b) b.textContent = themeIcon(); });

function navItems() {
  const a = isAdmin();
  return [['#/', '🏠', t('home')], ['#/sell', '🛒', t('sell')], ['#/khata', '📒', t('khata_entry')], ['#/items', '📦', t('items')], ['#/sales', '🧾', t('sales')], ['#/customers', '👥', t('customers')], ['#/rentals', '🪑', t('rentals')],
    ...(a ? [['#/suppliers', '🚚', t('suppliers')], ['#/expenses', '💸', t('expenses')], ['#/bin', '🗑', t('recycle_bin')]] : []), ['#/reports', '📊', t('reports')], ['#/settings', '⚙', t('settings')]];
}
function startApp() {
  const items = navItems(), primary = items.slice(0, 4);
  root.innerHTML = `<div class="shell"><aside class="side"><div class="logo"><img class="side-logo" src="img/logo-256.png" alt=""><span>${esc(S.shop.cfg.shopName)}</span></div>${items.map(([h, i, l]) => `<a href="${h}" data-nav="${h}">${i} <span>${l}</span></a>`).join('')}</aside>
    <div class="content"><header class="top"><img class="top-logo" src="img/logo-256.png" alt=""><b class="ttl">${esc(S.shop.cfg.shopName)}</b><span class="grow"></span><span class="role" title="${t('logged_in_as')}">${S.user?.role === 'admin' ? '👑' : '🧑‍💼'} ${esc(S.user?.username || '')}</span>
      <button class="ic" id="themeTop" title="Light / Dark">${themeIcon()}</button><button class="ic" id="langTop">${S.lang === 'en' ? 'RU' : 'EN'}</button><button class="ic" id="lockTop" title="${t('logout')}">🔒</button></header>
      <main id="main"></main></div>
    <nav class="bottom">${primary.map(([h, i, l]) => `<a href="${h}" data-nav="${h}">${i}<span>${l}</span></a>`).join('')}<a href="#" data-act="moreMenu">☰<span>${t('more')}</span></a></nav></div>`;
  $('#lockTop').onclick = showLock;
  $('#themeTop').onclick = () => { toggleTheme(browserEnv()); window.dispatchEvent(new Event('app:theme')); };
  $('#langTop').onclick = () => { setLang(S.lang === 'en' ? 'ur' : 'en'); startApp(); };
  render(); resetIdle();
}
acts.moreMenu = (el, e) => {
  e?.preventDefault();
  openSheet(`<h3>${t('menu')}</h3><div class="grid menu">${navItems().map(([h, i, l]) => `<a class="btn" href="${h}" data-act="closeSheet">${i} ${l}</a>`).join('')}</div>`);
};

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
  if (el) run(acts, 'act', el, e);
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

boot().catch((e) => { root.innerHTML = `<p class="bad" style="padding:20px">Startup error: ${esc(e.message)}</p>`; console.error(e); });
void openSheet;
