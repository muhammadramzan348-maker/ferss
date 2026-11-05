import { esc, fmtQty, fmtDateTime, parseQty, parseRs, presetUnits, lineAmount, UNITS } from '../core.js';
import { S, acts, ins, chg, t, money, can, isAdmin, pname, unitName, qtyText, field, select, btn, table, accountOptions,
  openSheet, closeSheet, sheetEl, formData, attempt, toast, go, refresh, ask, $ } from './ctx.js';
import { ACCOUNTS } from '../db.js';

const safeRs = (s) => { try { return s ? parseRs(s) : 0; } catch { return 0; } };

// ================= ITEMS =================
const iq = { q: '', cat: '' };
export async function itemsList() {
  const cats = [...S.shop.categories.values()];
  const list = S.shop.searchProducts(iq.q, { category: iq.cat, limit: 200, includeInactive: false });
  return `<div class="row"><h2 class="grow">${t('items')}</h2>${can('manage_items') ? `<a class="btn pri" href="#/item/new">＋ ${t('add_item')}</a>` : ''}</div>
  <input class="search" data-in="itemSearch" value="${esc(iq.q)}" placeholder="🔍 ${t('search_items')}">
  <div class="chips"><button class="${iq.cat ? '' : 'on'}" data-act="itemCat" data-id="">${t('all')}</button>${cats.map((c) => `<button class="${iq.cat === c.id ? 'on' : ''}" data-act="itemCat" data-id="${c.id}">${esc(S.lang === 'ur' ? c.nameUr : c.nameEn)}</button>`).join('')}</div>
  <div id="items-results">${itemRows(list)}</div>`;
}
function itemRows(list) {
  if (!list.length) return `<p class="empty">${t('empty')}</p>`;
  return `<div class="card">${list.map((p) => { const st = S.shop.stockOf(p.id), low = p.minStock > 0 && st.qty <= p.minStock;
    return `<a class="li link" href="#/item/${p.id}"><span><b>${esc(pname(p))}</b> <small>${esc(p.size)} ${esc(p.brand)}</small><br><small class="${low || st.qty < 0 ? 'bad' : ''}">${t('stock')}: ${qtyText(p, st.qty)}${low ? ' ⚠' : ''}</small></span>
      <span class="r"><b>${money(p.retailPrice)}</b>/${unitName(p.sellUnit)}${isAdmin() ? `<br><small>${t('cost')}: ${money(S.shop.avgCost(p.id))}/${unitName(p.baseUnit)}</small>` : ''}</span></a>`; }).join('')}</div>`;
}
ins.itemSearch = (el) => { iq.q = el.value; $('#items-results').innerHTML = itemRows(S.shop.searchProducts(iq.q, { category: iq.cat, limit: 200 })); };
acts.itemCat = (el) => { iq.cat = el.dataset.id; refresh(); };

const fracText = (u) => (u.den === 1 ? String(u.num) : `${u.num}/${u.den}`);
export function parseFactor(s) {
  const str = String(s).trim(); let m;
  if ((m = /^(\d+)\/(\d+)$/.exec(str))) { const num = Number(m[1]), den = Number(m[2]); if (num > 0 && den > 0) return { num, den }; }
  else if ((m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(str))) { const fr = m[2] || '', den = 10 ** fr.length, num = Number(m[1] + fr); if (num > 0) return { num, den }; }
  throw new Error(`Invalid conversion "${s}"`);
}
export const unitsToText = (units) => units.map((u) => `${u.unit}=${fracText(u)}`).join('\n');
export function textToUnits(txt) {
  return String(txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [unit, f] = l.split('='); if (!unit || !f) throw new Error(`Use the format unit=factor, e.g. g=1/1000 (line "${l}")`);
    return { unit: unit.trim(), ...parseFactor(f) };
  });
}

export async function itemForm(id) {
  const p = id === 'new' ? null : S.shop.products.get(id);
  if (id !== 'new' && !p) return `<p class="empty">${t('not_found')}</p>`;
  const cats = [...S.shop.categories.values()].map((c) => [c.id, S.lang === 'ur' ? c.nameUr : c.nameEn]);
  const base = p?.baseUnit || 'pc', admin = can('manage_items');
  const st = p ? S.shop.stockOf(p.id) : null;
  return `<a href="#/items" class="back">← ${t('items')}</a><form class="card" id="itemForm" data-id="${p?.id || ''}" onsubmit="return false">
    <h2>${p ? esc(p.name) : t('add_item')}</h2>
    ${p ? `<div class="li"><span>${t('stock')}</span><b>${qtyText(p, st.qty)}</b></div>${isAdmin() ? `<div class="li"><span>${t('avg_cost')}</span><b>${money(S.shop.avgCost(p.id))}/${unitName(p.baseUnit)}</b></div><div class="li"><span>${t('stock_value')}</span><b>${money(st.value)}</b></div>` : ''}` : ''}
    <fieldset ${admin ? '' : 'disabled'}>
    ${field('name', t('name') + ' (English)', p?.name)}${field('nameUr', t('name') + ' (Roman Urdu)', p?.nameUr)}
    <div class="row">${field('sku', t('sku'), p?.sku, { cls: 'grow' })}${field('barcode', t('barcode'), p?.barcode, { cls: 'grow' })}</div>
    ${select('category', t('category'), [['', '—'], ...cats], p?.category)}
    <div class="row">${field('brand', t('brand'), p?.brand, { cls: 'grow' })}${field('size', t('size'), p?.size, { cls: 'grow' })}</div>
    <div class="row">${select('baseUnit', t('base_unit'), Object.keys(UNITS).map((u) => [u, unitName(u)]), base, `${p && S.shop.stock.has(p.id) ? 'disabled' : ''} data-chg="baseChanged"`)}
      ${select('sellUnit', t('sell_unit'), [base, ...(p?.units || []).map((u) => u.unit)].map((u) => [u, unitName(u)]), p?.sellUnit || base)}</div>
    <label class="f"><span>${t('other_units')} <small>(${t('units_help')})</small></span><textarea name="units" rows="3" dir="ltr">${esc(unitsToText(p?.units || presetUnits(base)))}</textarea></label>
    <div class="row">${field('retail', `${t('retail_price')} / ${t('sell_unit')}`, p ? String(p.retailPrice / 100) : '', { attrs: 'inputmode="decimal"', cls: 'grow' })}${field('wholesale', t('wholesale_price'), p ? String(p.wholesalePrice / 100) : '', { attrs: 'inputmode="decimal"', cls: 'grow' })}</div>
    ${field('minStock', `${t('min_stock')} (${t('base_unit')})`, p ? fmtQty(p.minStock) : '', { attrs: 'inputmode="decimal"' })}
    ${p ? '' : `<div class="row">${field('openQty', `${t('opening_stock')} (${t('base_unit')})`, '', { attrs: 'inputmode="decimal"', cls: 'grow' })}${field('openCost', t('opening_cost'), '', { attrs: 'inputmode="decimal"', cls: 'grow' })}</div>`}
    </fieldset>
    ${admin ? btn('saveItem', t('save'), { cls: 'pri big' }) : ''}
    ${p && isAdmin() ? `<div class="row wrap">${btn('adjustItem', '± ' + t('adjust_stock'), { data: { id: p.id } })}${btn('resetItem', t('reset_stock'), { cls: 'danger', data: { id: p.id } })}${btn('archiveItem', p.active ? t('archive') : t('restore'), { data: { id: p.id } })}</div>` : ''}
  </form>`;
}
chg.baseChanged = (el) => {
  const f = el.form, base = el.value, pre = presetUnits(base);
  f.units.value = unitsToText(pre);
  f.sellUnit.innerHTML = [base, ...pre.map((u) => u.unit)].map((u) => `<option value="${u}">${esc(unitName(u))}</option>`).join('');
};
acts.saveItem = () => attempt(async () => {
  const f = formData($('#itemForm')), id = $('#itemForm').dataset.id;
  const units = textToUnits(f.units);
  const input = { id: id || undefined, name: f.name, nameUr: f.nameUr, sku: f.sku, barcode: f.barcode, category: f.category, brand: f.brand, size: f.size,
    baseUnit: f.baseUnit || S.shop.products.get(id)?.baseUnit, sellUnit: f.sellUnit, units, retailPrice: safeRs(f.retail), wholesalePrice: safeRs(f.wholesale),
    minStock: f.minStock ? parseQty(f.minStock) : 0 };
  const p = await S.shop.saveProduct(input, id ? {} : { openingQty: f.openQty ? parseQty(f.openQty) : 0, openingValue: safeRs(f.openCost) });
  toast(t('saved')); go(`#/item/${p.id}`);
});
acts.adjustItem = (el) => {
  const p = S.shop.products.get(el.dataset.id);
  openSheet(`<h3>${t('adjust_stock')}: ${esc(p.name)}</h3><p>${t('stock')}: ${qtyText(p, S.shop.stockOf(p.id).qty)}</p>
    ${field('delta', `+ / − (${unitName(p.baseUnit)})`, '', { attrs: 'inputmode="decimal"' })}${field('reason', t('reason'))}${btn('doAdjust', t('save'), { cls: 'pri big', data: { id: p.id } })}`);
};
acts.doAdjust = (el) => attempt(async () => {
  const f = formData(sheetEl());
  await S.shop.adjustStock(el.dataset.id, parseQty(f.delta), f.reason); closeSheet(); toast(t('saved')); refresh();
});
acts.resetItem = (el) => attempt(async () => {
  const reason = window.prompt(t('reset_reason')); if (!reason) return;
  await S.shop.resetStock(el.dataset.id, reason); toast(t('saved')); refresh();
});
acts.archiveItem = (el) => attempt(async () => { const p = S.shop.products.get(el.dataset.id); await S.shop.setProductActive(p.id, !p.active); toast(t('saved')); refresh(); });

// ================= CUSTOMERS & SUPPLIERS (khata) =================
const pq = { customer: '', supplier: '' };
export async function partyList(kind) {
  const src = kind === 'customer' ? S.shop.customers : S.shop.suppliers;
  const q = pq[kind].toLowerCase();
  const list = [...src.values()].filter((x) => x.active && (!q || x.name.toLowerCase().includes(q) || (x.phone || '').includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const tot = list.reduce((a, x) => a + Math.max(0, S.shop.balance(kind, x.id)), 0);
  return `<div class="row wrap"><h2 class="grow">${t(kind === 'customer' ? 'customers' : 'suppliers')}</h2>${kind === 'customer' ? `<a class="btn" href="#/khata">📒 ${t('khata_entry')}</a>` : ''}${btn('editParty', '＋ ' + t(kind === 'customer' ? 'add_customer' : 'add_supplier'), { cls: 'pri', data: { kind, id: '' } })}</div>
  <input class="search" data-chg="partySearch" data-kind="${kind}" value="${esc(pq[kind])}" placeholder="🔍 ${t('name')} / ${t('phone')}">
  <div class="card"><div class="li"><b>${t(kind === 'customer' ? 'receivable' : 'payable')}</b><b class="${kind === 'customer' ? 'warn' : 'bad'}">${money(tot)}</b></div>
  ${list.map((x) => { const b = S.shop.balance(kind, x.id);
    return `<a class="li link" href="#/${kind}/${x.id}"><span><b>${esc(x.name)}</b><br><small>${esc(x.phone)}</small></span><b class="${b > 0 ? (kind === 'customer' ? 'warn' : 'bad') : b < 0 ? 'good' : ''}">${b < 0 ? `${money(-b)} ${t('advance')}` : money(b)}</b></a>`; }).join('') || `<p class="empty">${t('empty')}</p>`}</div>`;
}
chg.partySearch = (el) => { pq[el.dataset.kind] = el.value; refresh(); };

acts.editParty = (el) => {
  const kind = el.dataset.kind, x = el.dataset.id ? (kind === 'customer' ? S.shop.customers : S.shop.suppliers).get(el.dataset.id) : null;
  openSheet(`<h3>${x ? t('edit') : t(kind === 'customer' ? 'add_customer' : 'add_supplier')}</h3>${field('name', t('name'), x?.name)}${field('phone', t('phone'), x?.phone, { type: 'tel' })}${field('address', t('address'), x?.address)}
    ${kind === 'customer' ? field('limit', t('credit_limit'), x ? String(x.creditLimit / 100) : '', { attrs: 'inputmode="decimal"' }) : ''}
    ${x ? '' : field('opening', `${t('opening_balance')} (${kind === 'customer' ? t('they_owe') : t('you_owe')})`, '', { attrs: 'inputmode="decimal"' })}
    ${btn('saveParty', t('save'), { cls: 'pri big', data: { kind, id: x?.id || '' } })}`);
};
acts.saveParty = (el) => attempt(async () => {
  const f = formData(sheetEl()), kind = el.dataset.kind;
  const input = { id: el.dataset.id || undefined, name: f.name, phone: f.phone, address: f.address, creditLimit: f.limit ? parseRs(f.limit) : 0, openingBalance: f.opening ? parseRs(f.opening) : 0 };
  const x = kind === 'customer' ? await S.shop.saveCustomer(input) : await S.shop.saveSupplier(input);
  closeSheet(); toast(t('saved')); go(`#/${kind}/${x.id}`);
});

export async function partyDetail(kind, id) {
  const x = (kind === 'customer' ? S.shop.customers : S.shop.suppliers).get(id);
  if (!x) return `<p class="empty">${t('not_found')}</p>`;
  const bal = S.shop.balance(kind, id), st = await S.shop.statement(kind, id);
  const kindLabel = { sale: t('k_sale'), payment: t('k_payment'), opening: t('k_opening'), purchase: t('k_purchase'), rental: t('k_rental'), adjustment: t('k_adjust'), reversal: t('k_reversal') };
  return `<a href="#/${kind}s" class="back">← ${t(kind === 'customer' ? 'customers' : 'suppliers')}</a>
  <div class="card"><div class="row"><h2 class="grow">${esc(x.name)}</h2>${btn('editParty', '✎', { data: { kind, id } })}</div><p>${esc(x.phone)} ${esc(x.address)}</p>
    <div class="stat ${bal > 0 ? (kind === 'customer' ? 'warn' : 'bad') : 'good'}"><div class="v">${bal < 0 ? `${money(-bal)} ${t('advance')}` : money(bal)}</div><div class="l">${t(kind === 'customer' ? 'they_owe' : 'you_owe')}${x.creditLimit ? ` · ${t('credit_limit')} ${money(x.creditLimit)}` : ''}</div></div>
    <div class="row wrap">${btn('partyPay', '💰 ' + t(kind === 'customer' ? 'receive_payment' : 'pay_supplier'), { cls: 'pri', data: { kind, id } })}
    ${kind === 'customer' && x.phone ? btn('remind', '💬 ' + t('send_reminder'), { data: { id } }) : ''}
    ${kind === 'supplier' ? `<a class="btn" href="#/purchase?supplier=${id}">📦 ${t('new_purchase')}</a>` : ''}
    ${btn('shareStatement', '📤 ' + t('share_statement'), { data: { kind, id } })}${isAdmin() ? btn('partyAdjust', '± ' + t('adjust'), { data: { kind, id } }) : ''}</div></div>
  <div class="card"><h3>${t('statement')}</h3>${table([t('date'), t('type'), t('amount'), t('balance')],
    st.slice().reverse().map((l) => [fmtDateTime(l.at), esc(kindLabel[l.kind] || l.kind) + (l.no ? ` <small>${esc(l.no)}</small>` : ''), `<span class="${l.amount > 0 ? 'warn' : 'good'}">${l.amount > 0 ? '+' : ''}${money(l.amount)}</span>`, money(l.running)]), { right: [2, 3] })}</div>
  ${kind === 'supplier' ? await supplierPurchases(id) : ''}`;
}
async function supplierPurchases(id) {
  const list = (await S.shop.store.all('purchases')).filter((p) => p.supplierId === id).sort((a, b) => b.at - a.at).slice(0, 15);
  return `<div class="card"><h3>${t('purchases')}</h3>${list.map((p) => `<div class="li"><span><b>${esc(p.no)}</b> <small>${fmtDateTime(p.at)} ${p.status !== 'posted' ? `[${p.status}]` : ''}</small><br><small>${p.items.map((i) => esc(i.name)).join(', ')}</small></span>
    <span class="r"><b>${money(p.total)}</b>${p.status === 'posted' ? `<br>${btn('cancelPurchase', t('cancel'), { cls: 'link', data: { id: p.id } })}` : ''}</span></div>`).join('') || `<p class="empty">${t('empty')}</p>`}</div>`;
}
acts.cancelPurchase = (el) => attempt(async () => { if (!ask(t('confirm_cancel_bill'))) return; await S.shop.cancelPurchase(el.dataset.id, 'cancelled'); toast(t('saved')); refresh(); });
acts.partyPay = (el) => {
  const { kind, id } = el.dataset;
  openSheet(`<h3>${t(kind === 'customer' ? 'receive_payment' : 'pay_supplier')}</h3>${field('amount', t('amount'), '', { attrs: 'inputmode="decimal"' })}${select('account', t('account'), accountOptions(), 'cash')}${field('note', t('note'))}
    ${btn('doPartyPay', t('save'), { cls: 'pri big', data: { kind, id } })}`);
};
acts.doPartyPay = (el) => attempt(async () => {
  const f = formData(sheetEl()), { kind, id } = el.dataset, args = { amount: parseRs(f.amount), account: f.account, note: f.note };
  if (kind === 'customer') await S.shop.receivePayment({ customerId: id, ...args }); else await S.shop.paySupplier({ supplierId: id, ...args });
  closeSheet(); toast(t('saved')); refresh();
});
acts.partyAdjust = (el) => {
  const { kind, id } = el.dataset;
  openSheet(`<h3>${t('adjust')}</h3><p class="sub">+ ${t('increase_balance')} / − ${t('decrease_balance')}</p>${field('amount', t('amount'), '', { attrs: 'inputmode="decimal"' })}${field('note', t('reason'))}${btn('doPartyAdjust', t('save'), { cls: 'pri big', data: { kind, id } })}`);
};
acts.doPartyAdjust = (el) => attempt(async () => { const f = formData(sheetEl()); await S.shop.adjustParty(el.dataset.kind, el.dataset.id, parseRs(f.amount), f.note); closeSheet(); refresh(); });
acts.remind = (el) => window.open(S.shop.reminderLink(el.dataset.id, S.lang), '_blank');
acts.shareStatement = (el) => attempt(async () => {
  const { kind, id } = el.dataset, x = (kind === 'customer' ? S.shop.customers : S.shop.suppliers).get(id);
  const rows = (await S.shop.statement(kind, id)).slice(-15).map((l) => `${fmtDateTime(l.at)}  ${l.amount > 0 ? '+' : ''}${money(l.amount)}  (${money(l.running)})`).join('\n');
  const { waLink } = await import('../core.js');
  window.open(waLink(x.phone, `${S.shop.cfg.shopName}\n${x.name}\n${rows}\n${t('balance')}: ${money(S.shop.balance(kind, id))}`), '_blank');
});

// ================= PURCHASE ENTRY (admin) =================
const newPurchase = (supplierId = '') => ({ supplierId, lines: [], extra: '', discount: '', pay: {}, ref: '', note: '' });
export async function purchaseScreen(params) {
  S.purchase ||= newPurchase();
  if (params.get('supplier')) S.purchase.supplierId = params.get('supplier');
  return `<div id="purchase">${purchaseHtml()}</div>`;
}
function purchaseHtml() {
  const p = S.purchase;
  const rows = p.lines.map((l) => { const pr = S.shop.products.get(l.productId); return { l, pr, gross: lineAmount(l.qty, l.cost) }; });
  const total = rows.reduce((a, r) => a + r.gross, 0) + safeRs(p.extra) - safeRs(p.discount);
  const paid = ACCOUNTS.reduce((a, k) => a + safeRs(p.pay[k]), 0);
  return `<a href="#/suppliers" class="back">← ${t('suppliers')}</a><div class="card"><h2>${t('new_purchase')}</h2>
    ${select('supplier', t('supplier'), [['', '—'], ...[...S.shop.suppliers.values()].map((s) => [s.id, s.name])], p.supplierId, 'data-chg="pSupplier"')}
    ${rows.map((r, i) => `<div class="line"><div class="grow"><b>${esc(r.pr.name)}</b><div class="sub">${fmtQty(r.l.qty)} ${unitName(r.l.unit)} × ${money(r.l.cost)}</div></div><b>${money(r.gross)}</b><button class="ic" data-act="pDel" data-i="${i}">✕</button></div>`).join('')}
    ${btn('pAdd', '＋ ' + t('add_line'), { cls: 'big' })}
    <div class="row">${field('extra', t('extra_cost'), p.extra, { attrs: 'inputmode="decimal" data-chg="pField"', cls: 'grow' })}${field('discount', t('bill_discount'), p.discount, { attrs: 'inputmode="decimal" data-chg="pField"', cls: 'grow' })}</div>
    ${field('ref', t('supplier_ref'), p.ref, { attrs: 'data-chg="pField"' })}
    <div class="total"><span>${t('total')}</span><b>${money(total)}</b></div><h4>${t('payment')}</h4>
    <div class="grid pay">${ACCOUNTS.map((a) => `<label class="f"><span>${t(`acc_${a}`)}</span><input data-chg="pPay" data-a="${a}" inputmode="decimal" value="${esc(p.pay[a] || '')}" placeholder="0"></label>`).join('')}</div>
    <div class="li"><span>${t('payable')}</span><b>${money(Math.max(0, total - paid))}</b></div>
    ${btn('pSave', '✔ ' + t('save_purchase'), { cls: 'pri big' })}</div>`;
}
const redrawP = () => { const el = $('#purchase'); if (el) el.innerHTML = purchaseHtml(); };
chg.pSupplier = (el) => { S.purchase.supplierId = el.value; };
chg.pField = (el) => { S.purchase[el.name] = el.value; redrawP(); };
chg.pPay = (el) => { S.purchase.pay[el.dataset.a] = el.value; redrawP(); };
acts.pDel = (el) => { S.purchase.lines.splice(Number(el.dataset.i), 1); redrawP(); };
acts.pAdd = () => openSheet(`<h3>${t('add_line')}</h3><input class="search" data-in="pSearch" placeholder="🔍 ${t('search_items')}"><div id="p-results"></div>`);
ins.pSearch = (el) => {
  $('#p-results').innerHTML = S.shop.searchProducts(el.value, { limit: 25 }).map((p) => `<button class="item" data-act="pPick" data-id="${p.id}"><b>${esc(pname(p))}</b> <small>${esc(p.size)}</small></button>`).join('');
};
acts.pPick = (el) => {
  const p = S.shop.products.get(el.dataset.id), units = [p.baseUnit, ...p.units.map((u) => u.unit)];
  openSheet(`<h3>${esc(p.name)}</h3><p class="sub">${t('last_cost')}: ${money(p.lastCost)}/${unitName(p.baseUnit)}</p>
    <div class="row">${field('qty', t('quantity'), '1', { attrs: 'inputmode="decimal"', cls: 'grow' })}${select('unit', t('unit'), units.map((u) => [u, unitName(u)]), p.baseUnit)}</div>
    ${field('cost', `${t('cost')} / ${t('unit')}`, p.lastCost ? String(p.lastCost / 100) : '', { attrs: 'inputmode="decimal"' })}${btn('pLineSave', t('add_to_cart'), { cls: 'pri big', data: { id: p.id } })}`);
};
acts.pLineSave = (el) => attempt(async () => {
  const f = formData(sheetEl()); const qty = parseQty(f.qty), cost = parseRs(f.cost);
  if (!(qty > 0) || !(cost >= 0)) throw new Error(t('invalid'));
  S.purchase.lines.push({ productId: el.dataset.id, unit: f.unit, qty, cost }); closeSheet(); redrawP();
});
acts.pSave = () => attempt(async () => {
  const p = S.purchase;
  const payments = ACCOUNTS.map((a) => ({ account: a, amount: safeRs(p.pay[a]) })).filter((x) => x.amount > 0);
  await S.shop.postPurchase({ supplierId: p.supplierId, lines: p.lines, extra: safeRs(p.extra), discount: safeRs(p.discount), payments, ref: p.ref, note: p.note });
  S.purchase = newPurchase(); toast(t('saved')); go('#/suppliers');
});
