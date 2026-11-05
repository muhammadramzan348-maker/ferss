// Shared UI state + helpers. Nothing here touches the DOM at import time (so screens can be smoke-tested in Node).
import { fmtRs, esc, fmtQty, UNITS } from '../core.js';
export { esc };
import { dict } from '../i18n.js';

export const S = { shop: null, auth: null, lang: 'en', cart: null, purchase: null, rental: null, khata: null, lineCtx: null, idleMin: 5 };
/** remember when a backup was last taken (Drive or file) */
export const markBackup = () => { if (typeof localStorage !== 'undefined') { const n = String(Date.now()); localStorage.setItem('lastBackup', n); localStorage.setItem('lastDriveBackup', n); } };
/** read a local (per-phone) preference */
export const lp = (k, d) => (typeof localStorage === 'undefined' ? d : localStorage.getItem(k) ?? d);
export const acts = {}, ins = {}, chg = {};          // delegated handlers: data-act / data-in / data-chg

export const t = (k) => dict[S.lang]?.[k] ?? dict.en[k] ?? k;
export const unitName = (u) => UNITS[u]?.[S.lang] || u;
export const money = (p) => fmtRs(p);
export const can = (p) => S.shop.can(p);
export const isAdmin = () => S.shop.role === 'admin';
export const ur = () => S.lang === 'ur';
export const pname = (p) => (ur() && p.nameUr ? p.nameUr : p.name);
export const qtyText = (p, base) => (p.baseUnit === 'kg' && Math.abs(base) < 1000 ? `${base} ${unitName('g')}` : `${fmtQty(base)} ${unitName(p.baseUnit)}`);

// ----- DOM helpers (only called in a browser) -----
export const $ = (sel, root = document) => root.querySelector(sel);
export function toast(msg, { error = false } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), error ? 5000 : 2200);
}
export function openSheet(html, cls = '') {
  closeSheet();
  const el = document.createElement('div'); el.className = 'overlay'; el.id = 'sheet';
  el.innerHTML = `<div class="sheet ${cls}" role="dialog"><button class="x" data-act="closeSheet" aria-label="close">✕</button>${html}</div>`;
  document.body.appendChild(el);
  return el.firstElementChild;
}
export const closeSheet = () => document.getElementById('sheet')?.remove();
export const sheetEl = () => document.querySelector('#sheet .sheet');
export const refresh = () => window.dispatchEvent(new Event('app:refresh'));
export const go = (hash) => { if (location.hash === hash) refresh(); else location.hash = hash; };
export function formData(root) {
  const o = {};
  root.querySelectorAll('[name]').forEach((el) => { o[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
  return o;
}
/** Run an action; show any error as a toast instead of crashing the UI. */
export async function attempt(fn) {
  try { return await fn(); } catch (e) { toast(e.message || String(e), { error: true }); return undefined; }
}
export const ask = (msg) => window.confirm(msg);

// ----- HTML builders -----
export const field = (name, label, value = '', { type = 'text', attrs = '', cls = '' } = {}) =>
  `<label class="f ${cls}"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
export const select = (name, label, opts, value = '', attrs = '') =>
  `<label class="f"><span>${esc(label)}</span><select name="${name}" ${attrs}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
export const btn = (act, label, { cls = '', data = {} } = {}) =>
  `<button class="btn ${cls}" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${label}</button>`;
export const table = (heads, rows, { right = [] } = {}) =>
  `<div class="tbl"><table><thead><tr>${heads.map((h, i) => `<th class="${right.includes(i) ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c, i) => `<td class="${right.includes(i) ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${heads.length}" class="empty">${t('empty')}</td></tr>`
  }</tbody></table></div>`;
export const accountOptions = () => ['cash', 'bank', 'jazzcash', 'easypaisa'].map((a) => [a, t(`acc_${a}`)]);
export const customerOptions = (blank = true) => [...(blank ? [['', t('walk_in')]] : []), ...[...S.shop.customers.values()].filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name])];
export const dateInput = (ms) => { const d = new Date(ms + 5 * 3600000); return d.toISOString().slice(0, 10); };
export const parseDateInput = (s, endOfDay = false) => Date.parse(`${s}T00:00:00Z`) - 5 * 3600000 + (endOfDay ? 86400000 : 0);
