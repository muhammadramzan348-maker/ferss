// Recycle Bin: deleted invoices/sales and customer khata stay here for 30 days (then they are removed automatically).
import { esc, fmtDateTime } from '../core.js';
import { S, acts, t, money, btn, attempt, toast, refresh, go } from './ctx.js';
import { confirmWithPin } from './pin_modal.js';
import { BIN_DAYS } from '../db.js';

const badge = (d) => `<span class="chip-left ${d <= 3 ? 'bad' : ''}">${d} ${t('days_left')}</span>`;

export async function binScreen() {
  const { sales, customers } = await S.shop.binList();
  const row = (kind, o, title, sub, right) => `<div class="li bin-row"><span><b>${title}</b><br><small>${sub}</small><br><small>${t('deleted_on')} ${fmtDateTime(o.deletedAt)}${o.deletedBy ? ` · ${t('deleted_by')} ${esc(o.deletedBy)}` : ''}</small></span>
    <span class="r"><b>${right}</b><br>${badge(o.daysLeft)}<div class="row wrap end">${btn('restoreRecord', '↩ ' + t('restore_record'), { cls: 'link', data: { kind, id: o.id } })}${btn('purgeRecord', '✕ ' + t('delete_forever'), { cls: 'link danger', data: { kind, id: o.id } })}</div></span></div>`;
  return `<h2>🗑 ${t('recycle_bin')}</h2><p class="sub">${t('bin_note').replace('30', String(BIN_DAYS))}</p>
  <div class="card"><h3>${t('deleted_bills')}</h3>${sales.map((x) => row('sale', x, `${esc(x.no)} ${x.type === 'estimate' ? `<small>(${t('estimate')})</small>` : ''}`, esc(S.shop.customers.get(x.customerId)?.name || t('walk_in')), money(x.total))).join('') || `<p class="empty">${t('bin_empty')}</p>`}</div>
  <div class="card"><h3>${t('deleted_khata')}</h3>${customers.map((x) => row('customer', x, esc(x.name), `${esc(x.phone || '')} ${esc(x.address || '')}`, money(x.balance))).join('') || `<p class="empty">${t('bin_empty')}</p>`}</div>`;
}

acts.restoreRecord = (el) => attempt(async () => { await S.shop.restoreRecord(el.dataset.kind, el.dataset.id); toast(t('restored')); refresh(); });
acts.purgeRecord = (el) => attempt(async () => {
  if (!(await confirmWithPin({ title: t('delete_forever'), message: t('purge_msg') }))) return;
  await S.shop.purgeRecord(el.dataset.kind, el.dataset.id); toast(t('purged')); refresh();
});

// ----- the delete buttons used on the bill page and the customer profile (both ask for the user's PIN first) -----
acts.deleteBill = (el) => attempt(async () => {
  const sale = await S.shop.store.get('sales', el.dataset.id);
  if (!(await confirmWithPin({ title: t('delete_bill'), message: `${sale.no} · ${money(sale.total)}\n${t('delete_bill_msg')}` }))) return;
  await S.shop.deleteSale(sale.id, S.user?.username || ''); toast(t('moved_to_bin')); go('#/sales');
});
acts.deleteKhata = (el) => attempt(async () => {
  const c = S.shop.customers.get(el.dataset.id);
  if (!(await confirmWithPin({ title: t('delete_khata'), message: `${c.name} · ${money(S.shop.balance('customer', c.id))}\n${t('delete_khata_msg')}` }))) return;
  await S.shop.deleteCustomer(c.id, S.user?.username || ''); toast(t('moved_to_bin')); go('#/customers');
});
