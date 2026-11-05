import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dict } from '../js/i18n.js';
import { UNITS } from '../js/core.js';
import { S } from '../js/ui/ctx.js';
import { mkShop, seed } from './helpers.js';
import { Auth } from '../js/auth.js';
import * as KH from '../js/ui/khata_screen.js';
import * as M from '../js/ui/main_screens.js';
import * as K from '../js/ui/stock_screens.js';
import * as O from '../js/ui/ops_screens.js';
import { settingsScreen } from '../js/ui/settings_screen.js';

const files = ['print.js', ...readdirSync(new URL('../js/ui', import.meta.url)).map((f) => `ui/${f}`), 'app.js'];
const src = files.map((f) => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8')).join('\n');

test('every translation key used in the code exists in English AND Urdu', () => {
  const keys = new Set([...src.matchAll(/\b[tL]\('([^']+)'\)/g)].map((m) => m[1]));
  ['per_day', 'per_hour'].forEach((k) => keys.add(k));
  for (const a of ['cash', 'bank', 'jazzcash', 'easypaisa']) keys.add(`acc_${a}`);
  for (const k of ['Rent', 'Electricity', 'Salaries', 'Tea & Food', 'Transport', 'Repairs', 'Other']) keys.add(`exp_${k}`);
  for (const k of ['format', 'same', 'wrong', 'locked', 'mismatch', 'role']) keys.add(`pin_${k}`);
  for (const k of ['sales', 'items', 'profit', 'expenses', 'customers', 'suppliers', 'cashbook', 'lowstock', 'stockvalue']) keys.add(`rep_${k}`);
  for (const k of ['day', 'week', 'month']) keys.add(`rp_${k}`);
  for (const k of ['active', 'items', 'history']) keys.add(`rtab_${k}`);
  for (const k of ['bills', 'estimates', 'cancelled']) keys.add(`tab_${k}`);
  for (const k of ['sale', 'payment', 'opening', 'purchase', 'rental', 'adjust', 'reversal']) keys.add(`k_${k}`);
  for (const u of Object.keys(UNITS)) keys.add(`unit_${u}`);
  const missing = [...keys].filter((k) => !dict.en[k] || !dict.ur[k]);
  assert.deepEqual(missing, []);
});

test('every data-act / data-in / data-chg used in HTML has a handler', async () => {
  const { acts, ins, chg } = await import('../js/ui/ctx.js');
  await import('../js/ui/main_screens.js'); await import('../js/ui/khata_screen.js'); await import('../js/ui/backup_actions.js'); await import('../js/ui/stock_screens.js'); await import('../js/ui/ops_screens.js'); await import('../js/ui/settings_screen.js');
  const data = (attr) => new Set([...src.matchAll(new RegExp(`data-${attr}=\\\\?"([A-Za-z]+)\\\\?"`, 'g'))].map((m) => m[1]));
  const btns = new Set([...src.matchAll(/\bbtn\('([A-Za-z]+)'/g)].map((m) => m[1]));
  const used = (attr) => (attr === 'act' ? new Set([...data('act'), ...btns]) : data(attr));
  const missing = [];
  const inAppJs = new Set(['moreMenu']);                      // registered in app.js (needs the real DOM)
  for (const a of used('act')) if (!acts[a] && !inAppJs.has(a)) missing.push(`act:${a}`);
  for (const a of used('in')) if (!ins[a]) missing.push(`in:${a}`);
  for (const a of used('chg')) if (!chg[a]) missing.push(`chg:${a}`);
  assert.deepEqual(missing, []);
});

async function ready(role = 'admin') {
  const shop = await mkShop(); const ids = await seed(shop);
  S.shop = shop; S.auth = new Auth(shop.store, { iterations: 1000 });
  S.cart = null; S.purchase = null; S.khata = null; S.lang = 'en';
  await shop.postSale({ customerId: ids.ali.id, lines: [{ productId: ids.paris.id, amount: 1500 }, { productId: ids.bulb.id, qty: 2000 }], payments: [{ account: 'cash', amount: 20000 }] });
  await shop.saveEstimate({ lines: [{ productId: ids.wire.id, unit: 'ft', qty: 10000 }] });
  const stool = await shop.saveRentalItem({ name: 'Stool', total: 10, rate: 5000, deposit: 10000 });
  await shop.checkoutRental({ customerName: 'Bashir', phone: '0300-1', items: [{ itemId: stool.id, qty: 2 }], deposit: 10000, dueAt: shop.now() - 1000 });
  await shop.addExpense({ category: 'Rent', amount: 10000 });
  await shop.postPurchase({ supplierId: ids.sup.id, lines: [{ productId: ids.bulb.id, qty: 1000, unit: 'dozen', cost: 200000 }], payments: [{ account: 'cash', amount: 100000 }] });
  shop.role = role;
  return ids;
}
const q = (s = '') => new URLSearchParams(s);

for (const lang of ['en', 'ur']) {
  test(`all screens render without errors (admin, ${lang})`, async () => {
    const ids = await ready(); S.lang = lang;
    const sale = (await S.shop.sales())[0], est = (await S.shop.sales({ status: 'open', type: 'estimate' }))[0];
    const pages = {
      dashboard: await M.dashboard(), pos: await M.pos(), sales: await M.salesList(q()), estimates: await M.salesList(q('tab=estimates')),
      sale: await M.saleDetail(sale.id), est: await M.saleDetail(est.id), items: await K.itemsList(), itemNew: await K.itemForm('new'), item: await K.itemForm(ids.paris.id),
      customers: await K.partyList('customer'), customer: await K.partyDetail('customer', ids.ali.id), suppliers: await K.partyList('supplier'), supplier: await K.partyDetail('supplier', ids.sup.id),
      khata: await KH.khataScreen(), purchase: await K.purchaseScreen(q()), rentals: await O.rentalsScreen(), rentalNew: await O.rentalNew(), expenses: await O.expensesScreen(), reports: await O.reportsScreen(), settings: await settingsScreen(),
    };
    for (const [name, html] of Object.entries(pages)) { assert.ok(html.length > 50, name); assert.ok(!/undefined|\[object Object\]|NaN/.test(html), `${name} contains junk: ${html.match(/.{30}(undefined|\[object Object\]|NaN).{30}/)?.[0]}`); }
    assert.match(pages.dashboard, /RAMZAN ELECTRIC STORE &amp; HARDWARE/);
    assert.match(pages.sale, /Paris/); assert.match(pages.rentals, /Bashir/);
    if (lang === 'ur') assert.match(pages.pos, /Paris Powder/);
  });
}

test('every report type builds for admin; salesman gets no cost/profit screens', async () => {
  await ready();
  for (const kind of ['sales', 'items', 'profit', 'expenses', 'customers', 'suppliers', 'cashbook', 'lowstock', 'stockvalue']) {
    const r = await O.buildReport(kind, 0, Infinity); assert.ok(r.html.includes('<table') && r.csv.length >= 1, kind);
  }
  S.shop.role = 'salesman';
  const dash = await M.dashboard(); assert.ok(!dash.includes('Today&#39;s profit') && !dash.includes('To pay'));
  const rep = await O.reportsScreen(); assert.ok(!rep.includes('Profit &amp; loss') && !rep.includes('Item profit'));
  const item = await K.itemForm([...S.shop.products.keys()][0]); assert.ok(!item.includes('Average cost')); assert.ok(item.includes('disabled'));
  const set = await settingsScreen(); assert.ok(!set.includes('Admin PIN'));
  await assert.rejects(O.buildReport('items', 0, Infinity));
});

test('report numbers: profit report and sales report agree with the ledger', async () => {
  await ready();
  const p = await S.shop.profitReport({ from: 0, to: Infinity });
  assert.equal(p.revenue, 1500 + 50000); assert.equal(p.expenses, 10000);
  const html = (await O.buildReport('profit', 0, Infinity)).html;
  assert.match(html, /NET PROFIT/);
});
