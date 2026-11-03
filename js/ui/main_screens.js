import { esc, fmtQty, fmtDateTime, parseQty, parseRs, qtyForAmount, priceFor, toBase, pktDayStart, mulDiv } from '../core.js';
import { S, acts, ins, chg, t, money, can, isAdmin, pname, unitName, qtyText, field, select, btn, table, accountOptions,
  customerOptions, openSheet, closeSheet, sheetEl, formData, attempt, toast, go, refresh, ask, $ } from './ctx.js';
import { thermalPrint, sharePdf, a4Print, whatsappText } from './output.js';
import { ShopError, ACCOUNTS } from '../db.js';
// ================= DASHBOARD =================
export async function dashboard() {
  const d = await S.shop.dashboard();
  const low = S.shop.lowStock().slice(0, 5);
  const overdue = S.shop.activeRentals().filter((r) => r.dueAt && r.dueAt < S.shop.now()).length;
  const stat = (label, val, cls = '') => `<div class="stat ${cls}"><div class="v">${val}</div><div class="l">${label}</div></div>`;
  return `<h1 class="brand">${esc(S.shop.cfg.shopName)}</h1>
  <div style="margin:12px 0 18px;text-align:center">
  <img src="./ferss/banner.png"
       alt="Ramzan Electric Store & Hardware"
       style="display:block;width:100%;max-height:220px;object-fit:contain;border-radius:12px">
</div>
  <div class="grid stats">
    ${stat(t('today_sales'), money(d.todaySales) + ` <small>(${d.todayCount})</small>`)}
    ${d.todayProfit !== undefined ? stat(t('today_profit'), money(d.todayProfit), 'good') : ''}
    ${stat(t('receivable'), money(d.receivable), 'warn')}
    ${d.payable !== undefined ? stat(t('payable'), money(d.payable), 'bad') : ''}
    ${stat(t('low_stock'), d.lowStock, d.lowStock ? 'bad' : '')}
    ${stat(t('rentals_out'), `${d.rentalsOut}${overdue ? ` <small class="bad">(${overdue} ${t('overdue')})</small>` : ''}`)}
  </div>
  <div class="card"><h3>${t('accounts')}</h3><div class="grid stats">${ACCOUNTS.map((a) => stat(t(`acc_${a}`), money(d.accounts[a]), d.accounts[a] < 0 ? 'bad' : '')).join('')}</div></div>
  <div class="card"><h3>${t('quick_actions')}</h3><div class="row wrap">
    <a class="btn pri" href="#/sell">🛒 ${t('new_sale')}</a><a class="btn" href="#/sell" data-act="newEstimate">📝 ${t('estimate')}</a>
    <a class="btn" href="#/customers">💰 ${t('receive_payment')}</a><a class="btn" href="#/rentals">🪑 ${t('rentals')}</a>
    <a class="btn" href="#/items">📦 ${t('items')}</a>${isAdmin() ? `<a class="btn" href="#/expenses">🧾 ${t('expenses')}</a>` : ''}
  </div></div>
  ${low.length ? `<div class="card"><h3>⚠ ${t('low_stock')}</h3>${low.map((p) => `<div class="li"><span>${esc(pname(p))} ${esc(p.size)}</span><b class="bad">${qtyText(p, S.shop.stockOf(p.id).qty)}</b></div>`).join('')}</div>` : ''}
  ${d.openEstimates ? `<div class="card"><a href="#/sales?tab=estimates">📝 ${d.openEstimates} ${t('open_estimates')} →</a></div>` : ''}`;
}
acts.newEstimate = () => { S.cart = newCart(); };

// ================= POS / CART =================
const newCart = () => ({ customerId: '', priceMode: 'retail', lines: [], discount: '', pay: {}, note: '', editEstimate: null });
const cartInput = (c) => ({ customerId: c.customerId || null, priceMode: c.priceMode, discount: c.discount ? parseRs(c.discount) : 0, note: c.note,
  lines: c.lines.map((l) => ({ productId: l.productId, unit: l.unit, price: l.price, discount: l.discount || 0, ...(l.amount != null ? { amount: l.amount } : { qty: l.qty }) })) });

export async function pos() {
  S.cart ||= newCart();
  return `<div class="pos">
    <section class="card pos-left"><input class="search" data-in="posSearch" placeholder="🔍 ${t('search_items')}" autocomplete="off">
      <div id="pos-results">${posResults('')}</div></section>
    <section class="pos-right" id="cart">${cartHtml()}</section></div>`;
}
function posResults(q) {
  const list = S.shop.searchProducts(q, { limit: 40 });
  if (!list.length) return `<p class="empty">${t('empty')}</p>`;
  return list.map((p) => { const st = S.shop.stockOf(p.id).qty;
    return `<button class="item" data-act="addLine" data-id="${p.id}"><div><b>${esc(pname(p))}</b> <small>${esc(p.size)} ${esc(p.brand)}</small>
      <div class="sub ${st <= 0 ? 'bad' : ''}">${t('stock')}: ${qtyText(p, st)}</div></div><div class="r"><b>${money(p.retailPrice)}</b><small>/${unitName(p.sellUnit)}</small></div></button>`; }).join('');
}
ins.posSearch = (el) => { $('#pos-results').innerHTML = posResults(el.value); };

function cartHtml() {
  const c = S.cart, input = cartInput(c), pv = c.lines.length ? S.shop.preview(input) : null;
  const cust = c.customerId ? S.shop.customers.get(c.customerId) : null;
  const total = pv?.calc ? pv.calc.total : 0;
  const payTotal = ACCOUNTS.reduce((a, k) => a + (c.pay[k] ? safeRs(c.pay[k]) : 0), 0);
  return `<div class="card">
    <div class="row"><button class="btn grow" data-act="pickCustomer">👤 ${esc(cust ? cust.name : t('walk_in'))}${cust ? ` <small>(${money(S.shop.balance('customer', cust.id))})</small>` : ''}</button>
    <div class="seg"><button class="${c.priceMode === 'retail' ? 'on' : ''}" data-act="priceMode" data-m="retail">${t('retail')}</button><button class="${c.priceMode === 'wholesale' ? 'on' : ''}" data-act="priceMode" data-m="wholesale">${t('wholesale')}</button></div></div>
    <div class="lines">${c.lines.length ? c.lines.map((l, i) => {
      const p = S.shop.products.get(l.productId), x = pv?.lines?.[i];
      const q = x ? (l.amount != null ? `${money(l.amount)} → ${qtyText(p, x.baseQty)}` : `${fmtQty(x.qty)} ${unitName(l.unit)}`) : '';
      return `<div class="line"><div class="grow" data-act="editLine" data-i="${i}"><b>${esc(pname(p))}</b> <small>${esc(p.size)}</small><div class="sub">${q} × ${money(l.price)}${l.discount ? ` − ${money(l.discount)}` : ''}</div></div>
        <b>${x ? money(x.gross - x.discount) : ''}</b><button class="ic" data-act="delLine" data-i="${i}">✕</button></div>`; }).join('') : `<p class="empty">${t('cart_empty')}</p>`}</div>
    ${pv?.error ? `<p class="bad">${esc(pv.error)}</p>` : ''}
    <label class="f"><span>${t('bill_discount')}</span><input data-chg="cartDiscount" inputmode="decimal" value="${esc(c.discount)}" placeholder="0"></label>
    <div class="total"><span>${t('total')}</span><b>${money(total)}</b></div>
    <h4>${t('payment')}</h4>
    <div class="grid pay">${ACCOUNTS.map((a) => `<label class="f"><span>${t(`acc_${a}`)}</span><input data-in="payInput" data-a="${a}" inputmode="decimal" value="${esc(c.pay[a] || '')}" placeholder="0"></label>`).join('')}</div>
    <div class="row"><button class="btn" data-act="fullCash">${t('full_cash')}</button><span class="grow"></span><span>${t('udhaar')}: <b id="due">${money(Math.max(0, total - payTotal))}</b></span></div>
    <label class="f"><span>${t('note')}</span><input data-chg="cartNote" value="${esc(c.note)}"></label>
    <div class="row"><button class="btn pri grow big" data-act="finalize" ${pv?.calc ? '' : 'disabled'}>✔ ${t('finalize')}</button>
    <button class="btn" data-act="saveEstimate" ${pv?.calc ? '' : 'disabled'}>📝 ${t('save_estimate')}</button></div>
    <button class="btn link" data-act="clearCart">${t('clear')}</button></div>`;
}
const safeRs = (s) => { try { return s ? parseRs(s) : 0; } catch { return 0; } };
const redrawCart = () => { const el = $('#cart'); if (el) el.innerHTML = cartHtml(); };

acts.priceMode = (el) => {
  S.cart.priceMode = el.dataset.m;
  for (const l of S.cart.lines) if (!l.manual) l.price = priceFor(S.shop.products.get(l.productId), l.unit, S.cart.priceMode);
  redrawCart();
};
chg.cartDiscount = (el) => { S.cart.discount = el.value; redrawCart(); };
chg.cartNote = (el) => { S.cart.note = el.value; };
ins.payInput = (el) => { S.cart.pay[el.dataset.a] = el.value; updateDue(); };
function updateDue() {
  const pv = S.cart.lines.length ? S.shop.preview(cartInput(S.cart)) : null, total = pv?.calc?.total || 0;
  const paid = ACCOUNTS.reduce((a, k) => a + safeRs(S.cart.pay[k]), 0);
  const el = $('#due'); if (el) el.textContent = money(Math.max(0, total - paid));
}
acts.fullCash = () => {
  const pv = S.shop.preview(cartInput(S.cart)); if (!pv.calc) return;
  S.cart.pay = { cash: String(pv.calc.total / 100) }; redrawCart();
};
acts.clearCart = () => { S.cart = newCart(); redrawCart(); };
acts.delLine = (el) => { S.cart.lines.splice(Number(el.dataset.i), 1); redrawCart(); };
acts.pickCustomer = () => {
  const opts = customerOptions(true);
  const sh = openSheet(`<h3>${t('customer')}</h3><input class="search" data-in="custSearch" placeholder="🔍 ${t('search')}"><div id="cust-results">${custList('')}</div>
    <hr>${btn('quickCustomer', '＋ ' + t('add_customer'), { cls: 'pri' })}`);
  return sh;
};
const custList = (q) => {
  const s = q.toLowerCase();
  const rows = [['', t('walk_in')], ...[...S.shop.customers.values()].filter((c) => c.active && (!s || c.name.toLowerCase().includes(s) || (c.phone || '').includes(s))).map((c) => [c.id, `${c.name} ${c.phone ? '· ' + c.phone : ''}`])];
  return rows.map(([id, label]) => `<button class="item" data-act="setCustomer" data-id="${id}">${esc(label)}</button>`).join('');
};
ins.custSearch = (el) => { $('#cust-results').innerHTML = custList(el.value); };
acts.setCustomer = (el) => { S.cart.customerId = el.dataset.id; closeSheet(); redrawCart(); };
acts.quickCustomer = () => {
  openSheet(`<h3>${t('add_customer')}</h3>${field('name', t('name'))}${field('phone', t('phone'), '', { type: 'tel' })}${field('limit', t('credit_limit'), '', { attrs: 'inputmode="decimal"' })}${btn('saveQuickCustomer', t('save'), { cls: 'pri big' })}`);
};
acts.saveQuickCustomer = () => attempt(async () => {
  const f = formData(sheetEl());
  const c = await S.shop.saveCustomer({ name: f.name, phone: f.phone, creditLimit: f.limit ? parseRs(f.limit) : 0 });
  S.cart.customerId = c.id; closeSheet(); redrawCart();
});

// ----- add / edit a line (by quantity OR by amount) -----
acts.addLine = (el) => openLineSheet(S.shop.products.get(el.dataset.id), null);
acts.editLine = (el) => { const i = Number(el.dataset.i); openLineSheet(S.shop.products.get(S.cart.lines[i].productId), i); };
function openLineSheet(p, idx) {
  const l = idx != null ? S.cart.lines[idx] : null, byAmt = l?.amount != null;
  const units = [p.baseUnit, ...p.units.map((u) => u.unit)];
  const unit = l?.unit || p.sellUnit, price = l?.price ?? priceFor(p, unit, S.cart.priceMode);
  openSheet(`<h3>${esc(pname(p))} <small>${esc(p.size)}</small></h3><p class="sub">${t('stock')}: ${qtyText(p, S.shop.stockOf(p.id).qty)}</p>
    <div class="seg wide"><button class="${byAmt ? '' : 'on'}" data-act="lineMode" data-mode="qty">${t('by_qty')}</button><button class="${byAmt ? 'on' : ''}" data-act="lineMode" data-mode="amt">${t('by_amount')}</button></div>
    <form data-pid="${p.id}" data-idx="${idx ?? ''}" data-mode="${byAmt ? 'amt' : 'qty'}" onsubmit="return false" id="lineForm">
      <div data-pane="qty" ${byAmt ? 'hidden' : ''}><div class="row">${field('qty', t('quantity'), l && !byAmt ? fmtQty(l.qty) : '1', { attrs: 'inputmode="decimal" data-in="lineCalc"', cls: 'grow' })}
        ${select('unit', t('unit'), units.map((u) => [u, unitName(u)]), unit, 'data-chg="lineUnit"')}</div></div>
      <div data-pane="amt" ${byAmt ? '' : 'hidden'}>${field('amount', `${t('amount')} (Rs)`, l?.amount ? String(l.amount / 100) : '', { attrs: 'inputmode="decimal" data-in="lineCalc"' })}
        <div class="big-result" id="amtResult"></div></div>
      ${field('price', `${t('price')} / ${unitName(unit)}`, String(price / 100), { attrs: `inputmode="decimal" data-in="lineCalc" ${can('edit_price') ? '' : 'readonly'}` })}
      ${field('discount', t('discount'), l?.discount ? String(l.discount / 100) : '', { attrs: 'inputmode="decimal"' })}
      ${btn('lineSave', l ? t('update') : t('add_to_cart'), { cls: 'pri big' })}</form>`);
  ins.lineCalc();
}
acts.lineMode = (el) => {
  const f = $('#lineForm'), m = el.dataset.mode; f.dataset.mode = m;
  f.querySelector('[data-pane=qty]').hidden = m !== 'qty'; f.querySelector('[data-pane=amt]').hidden = m !== 'amt';
  el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
  if (m === 'amt') { const p = S.shop.products.get(f.dataset.pid); f.unit.value = p.sellUnit; chg.lineUnit(f.unit); }
  ins.lineCalc();
};
chg.lineUnit = (el) => {
  const f = el.form || $('#lineForm'), p = S.shop.products.get(f.dataset.pid);
  if (can('edit_price') || true) f.price.value = String(priceFor(p, f.unit.value, S.cart.priceMode) / 100);
  ins.lineCalc();
};
ins.lineCalc = () => {
  const f = $('#lineForm'); if (!f) return;
  const p = S.shop.products.get(f.dataset.pid), out = $('#amtResult');
  try {
    if (f.dataset.mode === 'amt') {
      const q = qtyForAmount(parseRs(f.amount.value || '0') || 1, parseRs(f.price.value));
      const base = toBase(p, q, f.unit.value);
      out.textContent = f.amount.value ? `${money(parseRs(f.amount.value))} = ${fmtQty(q)} ${unitName(f.unit.value)} (${qtyText(p, base)})` : '';
    }
  } catch (e) { if (out) out.textContent = ''; }
};
acts.lineSave = () => attempt(async () => {
  const f = $('#lineForm'), p = S.shop.products.get(f.dataset.pid), amt = f.dataset.mode === 'amt';
  const unit = f.unit.value, price = parseRs(f.price.value), idx = f.dataset.idx === '' ? null : Number(f.dataset.idx);
  const line = { productId: p.id, unit, price, discount: f.discount.value ? parseRs(f.discount.value) : 0, manual: price !== priceFor(p, unit, S.cart.priceMode) };
  if (amt) { line.amount = parseRs(f.amount.value); if (!(line.amount > 0)) throw new Error(t('enter_amount')); }
  else { line.qty = parseQty(f.qty.value); if (!(line.qty > 0)) throw new Error(t('enter_qty')); }
  if (idx != null) S.cart.lines[idx] = line; else S.cart.lines.push(line);
  closeSheet(); redrawCart();
});

// ----- finalize -----
function payments() { return ACCOUNTS.map((a) => ({ account: a, amount: safeRs(S.cart.pay[a]) })).filter((p) => p.amount > 0); }
acts.finalize = () => attempt(async () => {
  const input = { ...cartInput(S.cart), payments: payments() };
  let sale;
  try { sale = await S.shop.postSale(input); }
  catch (e) {
    if (e instanceof ShopError && e.code === 'credit_limit' && ask(`${e.message}\n\n${t('continue_anyway')}`)) sale = await S.shop.postSale({ ...input, overrideLimit: true });
    else throw e;
  }
  const est = S.cart.editEstimate;
  S.cart = newCart(); redrawCart(); billDone(sale); void est;
});
acts.saveEstimate = () => attempt(async () => {
  const e = await S.shop.saveEstimate(cartInput(S.cart));
  S.cart = newCart(); redrawCart(); billDone(e);
});
export function billDone(sale) {
  const est = sale.type === 'estimate';
  openSheet(`<h3>✔ ${est ? t('estimate_saved') : t('bill_saved')}</h3><p class="big">${esc(sale.no)} — ${money(sale.total)}</p>
    <div class="col">${btn('doThermal', '🖨 ' + t('thermal_print'), { cls: 'pri big', data: { id: sale.id } })}
    ${btn('doPdf', '📲 ' + t('send_pdf_whatsapp'), { cls: 'big', data: { id: sale.id } })}
    ${btn('doA4', '📄 ' + t('print_a4'), { data: { id: sale.id } })}${btn('doWaText', '💬 ' + t('send_text_whatsapp'), { data: { id: sale.id } })}
    ${btn('closeSheet', t('new_sale'), { cls: 'link' })}</div>`);
}
const saleOf = (el) => S.shop.store.get('sales', el.dataset.id);
acts.doThermal = async (el) => thermalPrint(await saleOf(el));
acts.doPdf = async (el) => sharePdf(await saleOf(el));
acts.doA4 = async (el) => a4Print(await saleOf(el));
acts.doWaText = async (el) => whatsappText(await saleOf(el));
acts.closeSheet = () => closeSheet();

// ================= SALES HISTORY =================
const hq = { tab: 'bills', range: 'today', q: '' };
export async function salesList(params) {
  if (params.get('tab')) hq.tab = params.get('tab');
  const now = S.shop.now(), day = pktDayStart(now);
  const from = hq.range === 'today' ? day : hq.range === '7' ? day - 6 * 86400000 : hq.range === '30' ? day - 29 * 86400000 : 0;
  const type = hq.tab === 'estimates' ? 'estimate' : 'sale', status = hq.tab === 'estimates' ? 'open' : hq.tab === 'cancelled' ? 'cancelled' : 'posted';
  const all = (await S.shop.sales({ from, to: Infinity, status, type })).reverse();
  const q = hq.q.toLowerCase();
  const rows = all.filter((s) => !q || s.no.toLowerCase().includes(q) || (S.shop.customers.get(s.customerId)?.name || '').toLowerCase().includes(q));
  const total = rows.reduce((a, s) => a + s.total, 0);
  return `<h2>${t('sales')}</h2>
  <div class="row wrap"><div class="seg">${['bills', 'estimates', 'cancelled'].map((k) => `<button class="${hq.tab === k ? 'on' : ''}" data-act="histTab" data-k="${k}">${t(`tab_${k}`)}</button>`).join('')}</div>
    <div class="seg">${[['today', t('today')], ['7', '7d'], ['30', '30d'], ['all', t('all')]].map(([k, l]) => `<button class="${hq.range === k ? 'on' : ''}" data-act="histRange" data-k="${k}">${l}</button>`).join('')}</div></div>
  <input class="search" data-chg="histSearch" value="${esc(hq.q)}" placeholder="🔍 ${t('invoice_or_customer')}">
  <div class="card">${rows.map((s) => `<a class="li link" href="#/sale/${s.id}"><span><b>${esc(s.no)}</b> <small>${fmtDateTime(s.at)}</small><br><small>${esc(S.shop.customers.get(s.customerId)?.name || t('walk_in'))}${s.credit ? ` · ${t('udhaar')} ${money(s.credit)}` : ''}</small></span><b>${money(s.total)}</b></a>`).join('') || `<p class="empty">${t('empty')}</p>`}
    <div class="li"><b>${t('total')} (${rows.length})</b><b>${money(total)}</b></div></div>`;
}
acts.histTab = (el) => { hq.tab = el.dataset.k; refresh(); };
acts.histRange = (el) => { hq.range = el.dataset.k; refresh(); };
chg.histSearch = (el) => { hq.q = el.value; refresh(); };

export async function saleDetail(id) {
  const s = await S.shop.store.get('sales', id);
  if (!s) return `<p class="empty">${t('not_found')}</p>`;
  const cust = s.customerId ? S.shop.customers.get(s.customerId) : null, est = s.type === 'estimate';
  return `<a href="#/sales" class="back">← ${t('sales')}</a><div class="card"><h2>${est ? t('estimate') : t('invoice')} ${esc(s.no)}</h2>
    <p>${fmtDateTime(s.at)} · ${esc(cust?.name || t('walk_in'))} ${s.status !== 'posted' && s.status !== 'open' ? `<b class="bad">[${s.status}]</b>` : ''}</p>
    ${table([t('item'), t('quantity'), t('price'), t('total')], s.lines.map((l) => [esc(l.name) + (l.size ? ` <small>${esc(l.size)}</small>` : ''), `${fmtQty(l.qty)} ${unitName(l.unit)}`, money(l.price), money(l.gross - l.discount)]), { right: [1, 2, 3] })}
    <div class="li"><span>${t('subtotal')}</span><b>${money(s.subtotal)}</b></div>
    ${s.discount ? `<div class="li"><span>${t('bill_discount')}</span><b>−${money(s.discount)}</b></div>` : ''}
    <div class="li"><span>${t('total')}</span><b>${money(s.total)}</b></div>
    ${est ? '' : `<div class="li"><span>${t('paid')}</span><b>${money(s.paid)}</b></div><div class="li"><span>${t('udhaar')}</span><b>${money(s.credit)}</b></div>
    ${isAdmin() ? `<div class="li"><span>${t('cost')}</span><b>${money(s.cogs)}</b></div><div class="li"><span>${t('profit')}</span><b class="good">${money(s.total - s.cogs)}</b></div>` : ''}`}
    <div class="col">${btn('doThermal', '🖨 ' + t('thermal_print'), { cls: 'pri', data: { id } })}${btn('doPdf', '📲 ' + t('send_pdf_whatsapp'), { data: { id } })}
    ${btn('doA4', '📄 ' + t('print_a4'), { data: { id } })}${btn('doWaText', '💬 ' + t('send_text_whatsapp'), { data: { id } })}
    ${est && s.status === 'open' ? btn('convertEstimate', '✔ ' + t('convert_to_bill'), { cls: 'pri big', data: { id } }) : ''}
    ${!est && s.status === 'posted' && isAdmin() ? btn('cancelBill', '✕ ' + t('cancel_bill'), { cls: 'danger', data: { id } }) : ''}</div></div>`;
}
acts.cancelBill = (el) => attempt(async () => {
  if (!ask(t('confirm_cancel_bill'))) return;
  await S.shop.cancelSale(el.dataset.id, 'cancelled by admin'); toast(t('saved')); refresh();
});
acts.convertEstimate = async (el) => {
  const s = await saleOf(el), cust = s.customerId;
  openSheet(`<h3>${t('convert_to_bill')} ${esc(s.no)}</h3><p class="big">${money(s.total)}</p>
    <label class="f"><span>${t('customer')}</span><select name="cust" id="convCust">${customerOptions(true).map(([v, l]) => `<option value="${v}" ${v === (cust || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <div class="grid pay">${ACCOUNTS.map((a) => `<label class="f"><span>${t(`acc_${a}`)}</span><input name="p_${a}" inputmode="decimal" placeholder="0"></label>`).join('')}</div>
    ${btn('doConvert', t('finalize'), { cls: 'pri big', data: { id: s.id } })}`);
};
acts.doConvert = (el) => attempt(async () => {
  const f = formData(sheetEl()), pays = ACCOUNTS.map((a) => ({ account: a, amount: safeRs(f[`p_${a}`]) })).filter((p) => p.amount > 0);
  let sale;
  try { sale = await S.shop.convertEstimate(el.dataset.id, { payments: pays, customerId: f.cust || null }); }
  catch (e) { if (e.code === 'credit_limit' && ask(`${e.message}\n\n${t('continue_anyway')}`)) sale = await S.shop.convertEstimate(el.dataset.id, { payments: pays, customerId: f.cust || null, overrideLimit: true }); else throw e; }
  closeSheet(); billDone(sale); refresh();
});
void mulDiv; void unitName; void select; void accountOptions; void go;
