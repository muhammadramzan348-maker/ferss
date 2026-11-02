import { esc, fmtQty, fmtDateTime, fmtDate, parseRs, pktDayStart, pktParts, mulDiv, periodKey } from '../core.js';
import { S, acts, ins, chg, t, money, can, isAdmin, unitName, field, select, btn, table, accountOptions,
  openSheet, closeSheet, sheetEl, formData, attempt, toast, go, refresh, ask, $, dateInput, parseDateInput } from './ctx.js';
import { ACCOUNTS } from '../db.js';
import { waLink } from '../core.js';

const safeRs = (s) => { try { return s ? parseRs(s) : 0; } catch { return 0; } };
const DAY = 86400000;

// ================= RENTALS =================
const rq = { tab: 'active' };
export async function rentalsScreen() {
  const items = [...S.shop.rentalItems.values()].filter((i) => i.active);
  const now = S.shop.now();
  let body = '';
  if (rq.tab === 'active') {
    const list = S.shop.activeRentals();
    body = list.map((r) => { const pv = S.shop.rentalPreview(r, null, now), late = r.dueAt && r.dueAt < now;
      return `<div class="card ${late ? 'late' : ''}"><div class="row"><b class="grow">${esc(r.customerName)}</b><small>${esc(r.no)}</small></div>
        <div class="sub">${esc(r.phone)} · ${fmtDateTime(r.outAt)}${r.dueAt ? ` → ${fmtDateTime(r.dueAt)}` : ''} ${late ? `<b class="bad">${t('overdue')}</b>` : ''}</div>
        ${r.items.map((i) => `<div class="li"><span>${esc(i.name)}</span><b>${i.qty - i.returned} / ${i.qty} <small>@ ${money(i.rate)}/${t(i.rateType === 'hour' ? 'per_hour' : 'per_day')}</small></b></div>`).join('')}
        <div class="li"><span>${t('accrued')}</span><b class="warn">${money(pv.charge)}</b></div><div class="li"><span>${t('deposit_held')}</span><b>${money(r.depositHeld)}</b></div>
        ${r.idNote ? `<div class="sub">🪪 ${esc(r.idNote)}</div>` : ''}
        <div class="row wrap">${btn('returnRental', '↩ ' + t('return_items'), { cls: 'pri', data: { id: r.id } })}
        ${r.phone ? `<a class="btn" target="_blank" href="${waLink(r.phone, S.shop.rentalReminderText(r, S.lang))}">💬 ${t('send_reminder')}</a><a class="btn" href="tel:${esc(r.phone)}">📞</a>` : ''}</div></div>`; }).join('') || `<p class="empty">${t('no_active_rentals')}</p>`;
  } else if (rq.tab === 'items') {
    body = `<div class="card">${items.map((i) => `<div class="li"><span><b>${esc(S.lang === 'ur' && i.nameUr ? i.nameUr : i.name)}</b><br><small>${money(i.rate)}/${t(i.rateType === 'hour' ? 'per_hour' : 'per_day')} · ${t('deposit')} ${money(i.deposit)}</small></span>
      <span class="r"><b>${S.shop.availability(i.id)} / ${i.total}</b><small> ${t('available')}</small>${isAdmin() ? `<br>${btn('editRentalItem', '✎', { cls: 'link', data: { id: i.id } })}` : ''}</span></div>`).join('') || `<p class="empty">${t('empty')}</p>`}
      ${isAdmin() ? btn('editRentalItem', '＋ ' + t('add_rental_item'), { cls: 'pri', data: { id: '' } }) : ''}</div>`;
  } else {
    const done = [...S.shop.rentals.values()].filter((r) => r.status === 'returned').sort((a, b) => b.closedAt - a.closedAt).slice(0, 40);
    body = `<div class="card">${done.map((r) => `<div class="li"><span><b>${esc(r.customerName)}</b> <small>${esc(r.no)} · ${fmtDate(r.closedAt)}</small></span><b>${money(r.charges)}</b></div>`).join('') || `<p class="empty">${t('empty')}</p>`}</div>`;
  }
  return `<div class="row"><h2 class="grow">${t('rentals')}</h2><a class="btn pri" href="#/rental/new">＋ ${t('new_rental')}</a></div>
  <div class="seg wide">${['active', 'items', 'history'].map((k) => `<button class="${rq.tab === k ? 'on' : ''}" data-act="rentTab" data-k="${k}">${t(`rtab_${k}`)}</button>`).join('')}</div>${body}`;
}
acts.rentTab = (el) => { rq.tab = el.dataset.k; refresh(); };
acts.editRentalItem = (el) => {
  const i = el.dataset.id ? S.shop.rentalItems.get(el.dataset.id) : null;
  openSheet(`<h3>${i ? t('edit') : t('add_rental_item')}</h3>${field('name', t('name'), i?.name)}${field('nameUr', t('name') + ' (اردو)', i?.nameUr, { attrs: 'dir="rtl"' })}
    ${field('total', t('total_qty'), i?.total ?? '', { attrs: 'inputmode="numeric"' })}${select('rateType', t('rate_type'), [['day', t('per_day')], ['hour', t('per_hour')]], i?.rateType || 'day')}
    ${field('rate', t('rate'), i ? String(i.rate / 100) : '', { attrs: 'inputmode="decimal"' })}${field('deposit', t('deposit') + ' (' + t('default') + ')', i ? String(i.deposit / 100) : '', { attrs: 'inputmode="decimal"' })}
    ${btn('saveRentalItem', t('save'), { cls: 'pri big', data: { id: i?.id || '' } })}`);
};
acts.saveRentalItem = (el) => attempt(async () => {
  const f = formData(sheetEl());
  await S.shop.saveRentalItem({ id: el.dataset.id || undefined, name: f.name, nameUr: f.nameUr, total: Number(f.total), rateType: f.rateType, rate: safeRs(f.rate), deposit: safeRs(f.deposit) });
  closeSheet(); toast(t('saved')); refresh();
});

export async function rentalNew() {
  const items = [...S.shop.rentalItems.values()].filter((i) => i.active);
  S.rental ||= {};
  return `<a href="#/rentals" class="back">← ${t('rentals')}</a><div class="card" id="rentalForm"><h2>${t('new_rental')}</h2>
    ${field('customerName', t('customer_name'))}${field('phone', t('phone'), '', { type: 'tel' })}
    ${select('customerId', t('link_khata'), [['', '—'], ...[...S.shop.customers.values()].map((c) => [c.id, c.name])])}
    <h4>${t('items')}</h4>${items.map((i) => `<div class="li"><span><b>${esc(S.lang === 'ur' && i.nameUr ? i.nameUr : i.name)}</b><br><small>${money(i.rate)}/${t(i.rateType === 'hour' ? 'per_hour' : 'per_day')} · ${t('available')} ${S.shop.availability(i.id)}</small></span>
      <input class="qty" name="q_${i.id}" inputmode="numeric" placeholder="0"></div>`).join('') || `<p class="empty">${t('add_rental_first')}</p>`}
    <div class="row">${field('deposit', t('security_deposit'), '', { attrs: 'inputmode="decimal"', cls: 'grow' })}${select('account', t('account'), accountOptions(), 'cash')}</div>
    ${field('idNote', t('id_kept'), '', { attrs: 'placeholder="CNIC / licence / …"' })}
    ${field('dueAt', t('expected_return'), '', { type: 'datetime-local' })}${field('note', t('note'))}
    ${btn('saveRental', '✔ ' + t('give_on_rent'), { cls: 'pri big' })}</div>`;
}
acts.saveRental = () => attempt(async () => {
  const f = formData($('#rentalForm')), items = [...S.shop.rentalItems.values()].map((i) => ({ itemId: i.id, qty: Number(f[`q_${i.id}`] || 0) })).filter((i) => i.qty > 0);
  const dueAt = f.dueAt ? Date.parse(f.dueAt + 'Z') - 5 * 3600000 : null;
  const r = await S.shop.checkoutRental({ customerId: f.customerId || null, customerName: f.customerName, phone: f.phone, items, deposit: safeRs(f.deposit), account: f.account, idNote: f.idNote, note: f.note, dueAt });
  toast(`${t('saved')} ${r.no}`); rq.tab = 'active'; go('#/rentals');
});
acts.returnRental = (el) => {
  const r = S.shop.rentals.get(el.dataset.id);
  openSheet(`<h3>${t('return_items')} — ${esc(r.customerName)}</h3><div id="retForm" data-id="${r.id}">
    ${r.items.filter((i) => i.qty > i.returned).map((i) => `<div class="li"><span>${esc(i.name)} <small>(${i.qty - i.returned})</small></span><input class="qty" name="r_${i.itemId}" data-in="retCalc" inputmode="numeric" value="${i.qty - i.returned}"></div>`).join('')}
    <div class="li"><span>${t('charge')}</span><b id="retCharge"></b></div><div class="li"><span>${t('deposit_held')}</span><b>${money(r.depositHeld)}</b></div>
    <div class="li"><span>${t('to_collect')}</span><b id="retDue" class="warn"></b></div>
    <div class="grid pay">${ACCOUNTS.map((a) => `<label class="f"><span>${t(`acc_${a}`)}</span><input name="p_${a}" data-in="retCalc" inputmode="decimal" placeholder="0"></label>`).join('')}</div>
    <div class="li"><span>${t('udhaar')}</span><b id="retCredit"></b></div>${select('refundAccount', t('refund_from'), accountOptions(), 'cash')}
    ${btn('doReturn', '✔ ' + t('return_items'), { cls: 'pri big', data: { id: r.id } })}</div>`);
  ins.retCalc();
};
const retItems = (r, f) => r.items.map((i) => ({ itemId: i.itemId, qty: Number(f[`r_${i.itemId}`] || 0) })).filter((x) => x.qty > 0);
ins.retCalc = () => {
  const root = $('#retForm'); if (!root) return;
  const r = S.shop.rentals.get(root.dataset.id), f = formData(root);
  try {
    const pv = S.shop.rentalPreview(r, retItems(r, f)), applied = Math.min(r.depositHeld, pv.charge), due = pv.charge - applied;
    const paid = ACCOUNTS.reduce((a, k) => a + safeRs(f[`p_${k}`]), 0);
    $('#retCharge').textContent = money(pv.charge); $('#retDue').textContent = money(due); $('#retCredit').textContent = money(Math.max(0, due - paid));
  } catch (e) { $('#retCharge').textContent = '—'; }
};
acts.doReturn = (el) => attempt(async () => {
  const root = $('#retForm'), r = S.shop.rentals.get(el.dataset.id), f = formData(root);
  const payments = ACCOUNTS.map((a) => ({ account: a, amount: safeRs(f[`p_${a}`]) })).filter((p) => p.amount > 0);
  const res = await S.shop.returnRental(r.id, { items: retItems(r, f), payments, refundAccount: f.refundAccount });
  closeSheet(); toast(`${t('saved')} · ${t('charge')} ${money(res.charge)}${res.refund ? ` · ${t('refund')} ${money(res.refund)}` : ''}`); refresh();
});

// ================= EXPENSES & ACCOUNTS (admin) =================
const CATS = ['Rent', 'Electricity', 'Salaries', 'Tea & Food', 'Transport', 'Repairs', 'Other'];
export async function expensesScreen() {
  const list = (await S.shop.store.all('expenses')).sort((a, b) => b.at - a.at).slice(0, 40);
  return `<h2>${t('expenses')}</h2><div class="card"><h3>${t('add_expense')}</h3><div id="expForm">
    ${select('category', t('category'), CATS.map((c) => [c, t(`exp_${c}`)]))}${field('custom', t('other_category'))}
    <div class="row">${field('amount', t('amount'), '', { attrs: 'inputmode="decimal"', cls: 'grow' })}${select('account', t('account'), accountOptions(), 'cash')}</div>${field('note', t('note'))}
    ${btn('saveExpense', t('save'), { cls: 'pri big' })}</div></div>
  <div class="card"><h3>${t('accounts')}</h3>${ACCOUNTS.map((a) => `<div class="li"><span>${t(`acc_${a}`)}</span><b class="${S.shop.accountBalance(a) < 0 ? 'bad' : ''}">${money(S.shop.accountBalance(a))}</b></div>`).join('')}
    <div class="row wrap">${btn('transferSheet', '⇄ ' + t('transfer'))}${btn('ownerSheet', '👤 ' + t('owner_money'))}</div></div>
  <div class="card"><h3>${t('recent_expenses')}</h3>${list.map((e) => `<div class="li"><span><b>${esc(e.category)}</b> <small>${fmtDateTime(e.at)} · ${t(`acc_${e.account}`)} ${e.status !== 'posted' ? `[${e.status}]` : ''}</small><br><small>${esc(e.note)}</small></span>
    <span class="r"><b>${money(e.amount)}</b>${e.status === 'posted' ? `<br>${btn('cancelExpense', t('cancel'), { cls: 'link', data: { id: e.id } })}` : ''}</span></div>`).join('') || `<p class="empty">${t('empty')}</p>`}</div>`;
}
acts.saveExpense = () => attempt(async () => {
  const f = formData($('#expForm'));
  await S.shop.addExpense({ category: f.custom.trim() || f.category, amount: parseRs(f.amount), account: f.account, note: f.note }); toast(t('saved')); refresh();
});
acts.cancelExpense = (el) => attempt(async () => { if (!ask(t('confirm'))) return; await S.shop.cancelExpense(el.dataset.id); refresh(); });
acts.transferSheet = () => openSheet(`<h3>${t('transfer')}</h3>${select('from', t('from'), accountOptions(), 'cash')}${select('to', t('to'), accountOptions(), 'bank')}${field('amount', t('amount'), '', { attrs: 'inputmode="decimal"' })}${btn('doTransfer', t('save'), { cls: 'pri big' })}`);
acts.doTransfer = () => attempt(async () => { const f = formData(sheetEl()); await S.shop.transfer({ from: f.from, to: f.to, amount: parseRs(f.amount) }); closeSheet(); refresh(); });
acts.ownerSheet = () => openSheet(`<h3>${t('owner_money')}</h3>${select('dir', t('type'), [['in', t('owner_in')], ['out', t('owner_out')]])}${select('account', t('account'), accountOptions(), 'cash')}${field('amount', t('amount'), '', { attrs: 'inputmode="decimal"' })}${btn('doOwner', t('save'), { cls: 'pri big' })}`);
acts.doOwner = () => attempt(async () => { const f = formData(sheetEl()); await S.shop.ownerTx({ account: f.account, amount: parseRs(f.amount), contribution: f.dir === 'in' }); closeSheet(); refresh(); });

// ================= REPORTS =================
const rp = { range: 'today', kind: 'sales', period: 'day', account: 'cash', from: '', to: '' };
let lastCsv = [];
function rangeMs() {
  const now = S.shop.now(), day = pktDayStart(now);
  if (rp.range === 'today') return [day, day + DAY];
  if (rp.range === '7') return [day - 6 * DAY, day + DAY];
  if (rp.range === '30') return [day - 29 * DAY, day + DAY];
  if (rp.range === 'month') { const p = pktParts(now); return [pktDayStart(Date.UTC(p.y, p.m - 1, 1, 7)), day + DAY]; }
  if (rp.range === 'custom' && rp.from && rp.to) return [parseDateInput(rp.from), parseDateInput(rp.to, true)];
  return [0, Infinity];
}
export async function reportsScreen() {
  const [from, to] = rangeMs(), kinds = ['sales', 'items', 'profit', 'expenses', 'customers', 'suppliers', 'cashbook', 'lowstock', 'stockvalue']
    .filter((k) => isAdmin() || ['sales', 'customers', 'lowstock'].includes(k));
  const out = await buildReport(rp.kind, from, to);
  lastCsv = out.csv;
  return `<h2>${t('reports')}</h2>
  <div class="chips">${kinds.map((k) => `<button class="${rp.kind === k ? 'on' : ''}" data-act="repKind" data-k="${k}">${t(`rep_${k}`)}</button>`).join('')}</div>
  <div class="row wrap"><div class="seg">${[['today', t('today')], ['7', '7d'], ['30', '30d'], ['month', t('this_month')], ['all', t('all')], ['custom', '…']].map(([k, l]) => `<button class="${rp.range === k ? 'on' : ''}" data-act="repRange" data-k="${k}">${l}</button>`).join('')}</div>
    ${rp.kind === 'sales' ? `<div class="seg">${['day', 'week', 'month'].map((k) => `<button class="${rp.period === k ? 'on' : ''}" data-act="repPeriod" data-k="${k}">${t(`rp_${k}`)}</button>`).join('')}</div>` : ''}
    ${rp.kind === 'cashbook' ? select('acc', t('account'), accountOptions(), rp.account, 'data-chg="repAccount"') : ''}</div>
  ${rp.range === 'custom' ? `<div class="row"><input type="date" data-chg="repFrom" value="${esc(rp.from)}"><input type="date" data-chg="repTo" value="${esc(rp.to)}"></div>` : ''}
  <div class="card"><h3>${t(`rep_${rp.kind}`)}</h3>${out.html}<div class="row wrap">${btn('exportCsv', '⬇ CSV')}<button class="btn" onclick="print()">🖨 ${t('print')}</button></div></div>`;
}
acts.repKind = (el) => { rp.kind = el.dataset.k; refresh(); };
acts.repRange = (el) => { rp.range = el.dataset.k; refresh(); };
acts.repPeriod = (el) => { rp.period = el.dataset.k; refresh(); };
chg.repAccount = (el) => { rp.account = el.value; refresh(); };
chg.repFrom = (el) => { rp.from = el.value; refresh(); };
chg.repTo = (el) => { rp.to = el.value; refresh(); };
acts.exportCsv = () => {
  const csv = '\uFEFF' + lastCsv.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `report-${rp.kind}.csv`; a.click();
};
const m2 = (p) => (p / 100).toFixed(2);
export async function buildReport(kind, from, to) {
  const sh = S.shop;
  const mk = (heads, rows, right = []) => ({ html: table(heads, rows.map((r) => r.map((c) => (typeof c === 'object' ? c.html : esc(c)))), { right }), csv: [heads, ...rows.map((r) => r.map((c) => (typeof c === 'object' ? c.csv : c)))] });
  const mny = (p) => ({ html: money(p), csv: m2(p) });
  if (kind === 'sales') {
    const rows = await sh.salesReport({ from, to, period: rp.period });
    const tot = rows.reduce((a, r) => ({ c: a.c + r.count, t: a.t + r.total, p: a.p + r.paid, u: a.u + r.credit, d: a.d + r.discount }), { c: 0, t: 0, p: 0, u: 0, d: 0 });
    return mk([t('period'), t('bills'), t('total'), t('paid'), t('udhaar'), t('discount')], [...rows.map((r) => [r.key, r.count, mny(r.total), mny(r.paid), mny(r.credit), mny(r.discount)]), ['TOTAL', tot.c, mny(tot.t), mny(tot.p), mny(tot.u), mny(tot.d)]], [1, 2, 3, 4, 5]);
  }
  if (kind === 'items') {
    const rows = await sh.itemReport({ from, to });
    return mk([t('item'), t('qty_base'), t('revenue'), t('cost'), t('profit'), t('margin')], rows.map((r) => { const p = sh.products.get(r.productId);
      return [r.name, `${fmtQty(r.baseQty)} ${p ? unitName(p.baseUnit) : ''}`, mny(r.revenue), mny(r.cogs), mny(r.profit), `${(r.marginBp / 100).toFixed(1)}%`]; }), [1, 2, 3, 4, 5]);
  }
  if (kind === 'profit') {
    const p = await sh.profitReport({ from, to });
    return mk([t('item'), t('amount')], [[t('sales_revenue'), mny(p.revenue)], [t('cost_of_goods'), mny(-p.cogs)], [t('gross_profit'), mny(p.grossProfit)], [t('rental_income'), mny(p.rentalIncome)], [t('expenses'), mny(-p.expenses)], [t('net_profit'), mny(p.netProfit)], [t('discounts_given') + ' (info)', mny(p.discounts)]], [1]);
  }
  if (kind === 'expenses') { const rows = await sh.expensesReport({ from, to }); return mk([t('category'), t('amount')], [...rows.map((r) => [r.category, mny(r.amount)]), ['TOTAL', mny(rows.reduce((a, r) => a + r.amount, 0))]], [1]); }
  if (kind === 'customers' || kind === 'suppliers') {
    const rows = sh.balances(kind === 'customers' ? 'customer' : 'supplier');
    return mk([t('name'), t('phone'), t('balance')], [...rows.map((r) => [r.name, r.phone || '', mny(r.balance)]), ['TOTAL', '', mny(rows.reduce((a, r) => a + r.balance, 0))]], [2]);
  }
  if (kind === 'cashbook') {
    const rows = await sh.cashBook(rp.account, from, to);
    return mk([t('date'), t('type'), t('in'), t('out'), t('balance')], rows.map((r) => [fmtDateTime(r.at), `${r.kind} ${r.note || ''}`, r.amount > 0 ? mny(r.amount) : '', r.amount < 0 ? mny(-r.amount) : '', mny(r.running)]), [2, 3, 4]);
  }
  if (kind === 'lowstock') return mk([t('item'), t('stock'), t('min_stock')], sh.lowStock().map((p) => [p.name, `${fmtQty(sh.stockOf(p.id).qty)} ${unitName(p.baseUnit)}`, `${fmtQty(p.minStock)}`]), [1, 2]);
  if (kind === 'stockvalue') {
    const rows = [...sh.products.values()].filter((p) => p.active).map((p) => ({ p, s: sh.stockOf(p.id) })).sort((a, b) => b.s.value - a.s.value);
    return mk([t('item'), t('stock'), t('avg_cost'), t('stock_value')], [...rows.map(({ p, s }) => [p.name, `${fmtQty(s.qty)} ${unitName(p.baseUnit)}`, mny(sh.avgCost(p.id)), mny(s.value)]), ['TOTAL', '', '', mny(rows.reduce((a, r) => a + r.s.value, 0))]], [1, 2, 3]);
  }
  return mk([], []);
}
void mulDiv; void periodKey; void dateInput;
