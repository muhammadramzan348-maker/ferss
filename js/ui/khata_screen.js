// Khata Entry: customer details + tap items (with a note) + live total, saved as an udhaar bill.
import { esc, fmtQty, normalizePk, parseRs } from '../core.js';
import { S, acts, ins, chg, t, money, pname, unitName, qtyText, field, btn, attempt, toast, ask, $, closeSheet } from './ctx.js';
import { openLineSheet, billDone } from './main_screens.js';
import { ShopError } from '../db.js';

const newKhata = () => ({ name: '', phone: '', address: '', customerId: '', lines: [], paidNow: '', priceMode: 'retail', note: '' });
const safeRs = (s) => { try { return s ? parseRs(s) : 0; } catch { return 0; } };

export const khataInput = (k) => ({
  customerId: k.customerId || null, priceMode: k.priceMode, note: k.note || '',
  lines: k.lines.map((l) => ({ productId: l.productId, unit: l.unit, price: l.price, discount: l.discount || 0, note: l.note || '', ...(l.amount != null ? { amount: l.amount } : { qty: l.qty }) })),
});
/** Everything the screen shows, computed live from the state. */
export function khataTotals(shop, k) {
  const pv = k.lines.length ? shop.preview(khataInput(k)) : null;
  const total = pv?.calc ? pv.calc.total : 0, paid = safeRs(k.paidNow);
  const prev = k.customerId ? shop.balance('customer', k.customerId) : 0;
  return { pv, total, paid, prev, newBalance: prev + total - paid, error: pv?.error || null };
}

export async function khataScreen() {
  S.khata ||= newKhata();
  const k = S.khata;
  const names = [...S.shop.customers.values()].map((c) => `<option value="${esc(c.name)}">`).join('');
  return `<div class="khata"><h2>📒 ${t('khata_entry')}</h2><p class="sub">${t('khata_help')}</p>
  <div class="pos"><div>
    <section class="card"><h3>${t('customer_details')}</h3>
      ${field('name', t('name'), k.name, { attrs: 'list="custNames" data-in="khataField" data-chg="khataLookup" autocomplete="off"' })}<datalist id="custNames">${names}</datalist>
      ${field('phone', t('phone'), k.phone, { type: 'tel', attrs: 'data-in="khataField" data-chg="khataLookup"' })}
      ${field('address', t('address'), k.address, { attrs: 'data-in="khataField"' })}
      <p id="kh-link" class="sub">${linkText()}</p></section>
    <section class="card"><input class="search" data-in="khSearch" placeholder="🔍 ${t('search_items')}" autocomplete="off"><div id="kh-results">${results('')}</div></section>
  </div><div class="pos-right"><section class="card" id="kh-cart">${cartHtml()}</section></div></div></div>`;
}
function linkText() {
  const k = S.khata;
  if (!k.customerId) return '';
  return `✔ ${t('existing_customer')} · ${t('previous_balance')}: <b>${money(S.shop.balance('customer', k.customerId))}</b>`;
}
function results(q) {
  return S.shop.searchProducts(q, { limit: 30 }).map((p) => {
    return `<button class="item" data-act="khAdd" data-id="${p.id}"><div><b>${esc(pname(p))}</b> <small>${esc(p.size)} ${esc(p.brand)}</small></div>
      <div class="r"><b>${money(p.retailPrice)}</b><small>/${unitName(p.sellUnit)}</small></div></button>`; }).join('') || `<p class="empty">${t('empty')}</p>`;
}
function cartHtml() {
  const k = S.khata, tt = khataTotals(S.shop, k);
  return `<h3>${t('items')}</h3><div class="lines">${k.lines.length ? k.lines.map((l, i) => {
    const p = S.shop.products.get(l.productId), x = tt.pv?.lines?.[i];
    const q = x ? (l.amount != null ? `${money(l.amount)} → ${qtyText(p, x.baseQty)}` : `${fmtQty(x.qty)} ${unitName(l.unit)}`) : '';
    return `<div class="line"><div class="grow" data-act="khEdit" data-i="${i}"><b>${esc(pname(p))}</b> <small>${esc(p.size)}</small>
      <div class="sub">${q} × ${money(l.price)}/${unitName(p.sellUnit)}${l.discount ? ` − ${money(l.discount)}` : ''}</div>${l.note ? `<div class="sub">📝 ${esc(l.note)}</div>` : ''}</div>
      <b>${x ? money(x.net) : ''}</b><button class="ic" data-act="khDel" data-i="${i}">✕</button></div>`; }).join('') : `<p class="empty">${t('no_items_yet')}</p>`}</div>
    ${tt.error ? `<p class="bad">${esc(tt.error)}</p>` : ''}
    <div id="kh-totals">${totalsHtml(tt)}</div>
    <label class="f"><span>${t('paid_now')}</span><input data-in="khPaid" inputmode="decimal" value="${esc(k.paidNow)}" placeholder="0"></label>
    <button class="btn pri big" data-act="khSave" ${tt.pv?.calc ? '' : 'disabled'}>✔ ${t('save_to_khata')}</button>
    <button class="btn link" data-act="khClear">${t('clear')}</button>`;
}
function totalsHtml(tt) {
  return `<div class="total"><span>${t('this_entry')}</span><b>${money(tt.total)}</b></div>
    <div class="li"><span>${t('previous_balance')}</span><b>${money(tt.prev)}</b></div>
    ${tt.paid ? `<div class="li"><span>${t('paid_now')}</span><b>−${money(tt.paid)}</b></div>` : ''}
    <div class="li"><b>${t('new_balance')}</b><b class="warn">${money(tt.newBalance)}</b></div>`;
}
export const redrawKhata = () => { const el = $('#kh-cart'); if (el) el.innerHTML = cartHtml(); const l = $('#kh-link'); if (l) l.innerHTML = linkText(); };
const redrawTotals = () => { const el = $('#kh-totals'); if (el) el.innerHTML = totalsHtml(khataTotals(S.shop, S.khata)); };

ins.khataField = (el) => { S.khata[el.name] = el.value; };
chg.khataLookup = (el) => {
  const k = S.khata; k[el.name] = el.value;
  const c = S.shop.findCustomer({ phone: k.phone, name: k.name });
  if (c) {
    k.customerId = c.id;
    if (!k.name.trim() || el.name === 'phone') { k.name = c.name; const n = $('[name=name]'); if (n) n.value = c.name; }
    if (!k.address.trim()) { k.address = c.address || ''; const a = $('[name=address]'); if (a) a.value = k.address; }
    if (!k.phone.trim()) { k.phone = c.phone || ''; const p = $('[name=phone]'); if (p) p.value = k.phone; }
  } else k.customerId = '';
  redrawKhata();
};
ins.khSearch = (el) => { $('#kh-results').innerHTML = results(el.value); };
ins.khPaid = (el) => { S.khata.paidNow = el.value; redrawTotals(); };
acts.khAdd = (el) => openLineSheet(S.shop.products.get(el.dataset.id), null, S.khata, redrawKhata);
acts.khEdit = (el) => { const i = Number(el.dataset.i); openLineSheet(S.shop.products.get(S.khata.lines[i].productId), i, S.khata, redrawKhata); };
acts.khDel = (el) => { S.khata.lines.splice(Number(el.dataset.i), 1); redrawKhata(); };
acts.khClear = () => { S.khata = newKhata(); window.dispatchEvent(new Event('app:refresh')); };
acts.khSave = () => attempt(async () => {
  const k = S.khata;
  if (!k.name.trim()) throw new Error(t('name_required'));
  let cust = k.customerId ? S.shop.customers.get(k.customerId) : null;
  if (cust) {                                           // keep phone / address up to date
    if (cust.name !== k.name.trim() || (k.phone && cust.phone !== k.phone) || (k.address && cust.address !== k.address))
      cust = await S.shop.saveCustomer({ ...cust, name: k.name, phone: k.phone || cust.phone, address: k.address || cust.address });
  } else cust = await S.shop.saveCustomer({ name: k.name, phone: k.phone, address: k.address });
  const paid = safeRs(k.paidNow), input = { ...khataInput(k), customerId: cust.id, payments: paid > 0 ? [{ account: 'cash', amount: paid }] : [] };
  let sale;
  try { sale = await S.shop.postSale(input); }
  catch (e) {
    if (e instanceof ShopError && e.code === 'credit_limit' && ask(`${e.message}\n\n${t('continue_anyway')}`)) sale = await S.shop.postSale({ ...input, overrideLimit: true });
    else throw e;
  }
  S.khata = newKhata(); closeSheet(); window.dispatchEvent(new Event('app:refresh')); toast(t('khata_saved')); billDone(sale);
});
void normalizePk; void btn;
