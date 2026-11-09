// ONE description of the invoice, used by the on-screen preview (HTML) and by the PDF / image / print drawing,
// so they always match. L(key) = translator.
import { fmtRs, fmtQty, fmtDateTime } from './core.js';

const DEFAULT_THANKS = 'Thank you for your business';
export function invoiceModel(shop, sale, L) {
  const cfg = shop.cfg, cust = sale.customerId ? shop.customers.get(sale.customerId) : null, est = sale.type === 'estimate';
  const money = (p) => fmtRs(p, { sym: false }), rs = (p) => fmtRs(p);
  const itemDisc = sale.lines.reduce((a, l) => a + l.discount, 0);
  const totals = [{ label: L('subtotal'), value: rs(sale.subtotal) }];
  if (itemDisc + sale.discount > 0) totals.push({ label: L('discount'), value: `-${rs(itemDisc + sale.discount)}` });
  totals.push({ label: L('grand_total'), value: rs(sale.total), bold: true, big: true, hl: true });
  if (!est) {
    totals.push({ label: L('paid'), value: rs(sale.paid) });
    totals.push({ label: L('balance_due'), value: rs(sale.credit), bold: true });
    if (cust) totals.push({ label: L('khata_balance'), value: rs(shop.balance('customer', cust.id)) });
  }
  return {
    shop: { name: cfg.shopName, address: cfg.shopAddress || '', phone: cfg.shopPhone || '' },
    title: est ? L('estimate') : L('invoice'), no: sale.no, date: fmtDateTime(sale.at), cancelled: sale.status === 'cancelled' || sale.status === 'deleted',
    customer: cust ? { name: cust.name, phone: cust.phone || '' } : null,
    heads: [L('inv_item'), L('inv_qty'), L('inv_price'), L('inv_total')],
    lines: sale.lines.map((l) => ({
      desc: `${L('lang') === 'ur' && l.nameUr ? l.nameUr : l.name}${l.size ? ' ' + l.size : ''}`, note: l.note || '',
      qty: `${fmtQty(l.qty)} ${L(`unit_${l.unit}`)}`, price: `${money(l.price)}/${L(`unit_${l.priceUnit || l.unit}`)}`, total: money(l.gross - l.discount),
    })),
    totals,
    thanks: !cfg.footer || cfg.footer === DEFAULT_THANKS ? L('thank_you_default') : cfg.footer,
    policy: cfg.returnPolicy || L('return_policy_default'),
  };
}
