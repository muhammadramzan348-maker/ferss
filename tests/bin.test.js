import test from 'node:test';
import assert from 'node:assert/strict';
import { BIN_DAYS, Shop, ShopError } from '../js/db.js';
import { MemoryStore } from '../js/store.js';
import { Auth } from '../js/auth.js';
import { S, acts } from '../js/ui/ctx.js';
import * as M from '../js/ui/main_screens.js';
import * as K from '../js/ui/stock_screens.js';
import { binScreen } from '../js/ui/bin_screen.js';
import { mkShop, seed, T0 } from './helpers.js';
import { installFakeDom } from './fake-dom.js';

const dom = installFakeDom(), DAY = 86400000;
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof ShopError && (!code || e.code === code));
async function world() {
  const clock = { t: T0 }, shop = await mkShop({ clock }); const ids = await seed(shop);
  const sale = await shop.postSale({ customerId: ids.ali.id, lines: [{ productId: ids.paris.id, amount: 6000 }], payments: [{ account: 'cash', amount: 2000 }] });
  S.shop = shop; S.lang = 'en'; S.cart = null; S.khata = null; S.user = { username: 'Ramzan', role: 'admin' }; S.auth = new Auth(shop.store, { iterations: 1000 }); dom.reset();
  return { clock, shop, sale, ...ids };
}

test('deleting a bill moves it to the bin: gone from lists/reports, cash and khata reversed', async () => {
  const { shop, sale, ali } = await world();
  assert.equal(shop.accountBalance('cash'), 2000); assert.equal(shop.balance('customer', ali.id), 4000);
  await shop.deleteSale(sale.id, 'Ramzan');
  const d = await shop.store.get('sales', sale.id);
  assert.equal(d.status, 'deleted'); assert.equal(d.deletedFrom, 'posted'); assert.equal(d.deletedBy, 'Ramzan'); assert.equal(d.purgeAt - d.deletedAt, BIN_DAYS * DAY);
  assert.equal(shop.accountBalance('cash'), 0); assert.equal(shop.balance('customer', ali.id), 0);
  assert.equal((await shop.sales()).length, 0);                                    // reports ignore it
  assert.equal((await shop.profitReport({ from: 0, to: Infinity })).revenue, 0);
  assert.ok(!(await M.salesList(new URLSearchParams('tab=bills'))).includes(sale.no));
  const bin = await shop.binList(); assert.deepEqual(bin.sales.map((x) => [x.no, x.daysLeft]), [[sale.no, 30]]);
  await rejects(shop.deleteSale(sale.id), undefined);                              // cannot delete twice
});

test('restore brings everything back exactly (cash, khata, reports)', async () => {
  const { shop, sale, ali } = await world();
  await shop.deleteSale(sale.id, 'Ramzan'); await shop.restoreRecord('sale', sale.id);
  const r = await shop.store.get('sales', sale.id);
  assert.equal(r.status, 'posted'); assert.equal(r.deletedAt, undefined); assert.equal(r.deletedFrom, undefined);
  assert.equal(shop.accountBalance('cash'), 2000); assert.equal(shop.balance('customer', ali.id), 4000);
  assert.equal((await shop.sales()).length, 1); assert.equal((await shop.binList()).sales.length, 0);
  assert.equal((await shop.selfCheck()).ok, true);
  await shop.deleteSale(sale.id); await shop.restoreRecord('sale', sale.id);       // can be repeated
  assert.equal(shop.accountBalance('cash'), 2000);
});

test('permanent delete removes the bill and all its rows; balances stay correct', async () => {
  const { shop, sale, ali } = await world();
  await rejects(shop.purgeRecord('sale', sale.id), undefined);                     // only from the bin
  await shop.deleteSale(sale.id); await shop.purgeRecord('sale', sale.id);
  assert.equal(await shop.store.get('sales', sale.id), undefined);
  assert.equal((await shop.store.all('ledger')).filter((r) => r.refId === sale.id).length, 0);
  assert.equal((await shop.store.all('cashTx')).filter((r) => r.refId === sale.id).length, 0);
  assert.equal(shop.accountBalance('cash'), 0); assert.equal(shop.balance('customer', ali.id), 0);
  assert.equal((await shop.binList()).sales.length, 0); assert.equal((await shop.selfCheck()).ok, true);
});

test('AUTO PURGE after 30 days (not before), on startup and when the bin is opened', async () => {
  const { clock, shop, sale, ali } = await world();
  await shop.deleteSale(sale.id, 'Ramzan'); await shop.deleteCustomer(ali.id, 'Ramzan');
  clock.t += 29 * DAY + 3600000;
  let bin = await shop.binList(); assert.equal(bin.sales.length, 1); assert.equal(bin.customers.length, 1); assert.equal(bin.sales[0].daysLeft, 1);
  clock.t += 2 * DAY;                                                              // now past 30 days
  const again = new Shop({ store: shop.store, now: () => clock.t }); await again.init();   // "app start"
  assert.equal(await again.store.get('sales', sale.id), undefined); assert.equal(await again.store.get('customers', ali.id), undefined);
  assert.equal((await again.store.all('ledger')).filter((r) => r.partyId === ali.id).length, 0);
  again.role = 'admin'; bin = await again.binList(); assert.deepEqual([bin.sales.length, bin.customers.length], [0, 0]);
  // and when the bin is opened without a restart
  const s2 = await mkShop({ clock: { t: T0 } }); const x = await seed(s2);
  const b = await s2.postSale({ lines: [{ productId: x.bulb.id, qty: 1000 }], payments: [{ account: 'cash', amount: 25000 }] });
  await s2.deleteSale(b.id); s2.clock.t += 31 * DAY; assert.equal((await s2.binList()).sales.length, 0);
});

test('deleting a customer khata hides the customer everywhere; restore brings the khata back', async () => {
  const { shop, ali, sale } = await world();
  await shop.deleteCustomer(ali.id, 'Ramzan');
  assert.ok(!shop.customers.has(ali.id)); assert.equal(shop.findCustomer({ phone: '0300-1234567' }), null);
  assert.ok(!(await K.partyList('customer')).includes('Ali')); assert.equal(shop.balances('customer').length, 0);
  assert.match(await K.partyDetail('customer', ali.id), /Not found|Nahi mila/);
  assert.equal((await shop.dashboard()).receivable, 0);
  assert.equal((await shop.sales()).length, 1);                                    // the bill itself is not deleted
  const bin = await shop.binList(); assert.equal(bin.customers[0].name, 'Ali'); assert.equal(bin.customers[0].balance, 4000);
  await shop.restoreRecord('customer', ali.id);
  assert.equal(shop.customers.get(ali.id).name, 'Ali'); assert.equal(shop.balance('customer', ali.id), 4000);
  assert.ok((await K.partyList('customer')).includes('Ali')); void sale;
  await shop.deleteCustomer(ali.id); await shop.purgeRecord('customer', ali.id);
  assert.equal(await shop.store.get('customers', ali.id), undefined); assert.equal(shop.balance('customer', ali.id), 0);
});

test('estimates can be deleted too; old cancelled bills go to the bin and come back as cancelled', async () => {
  const { shop, sale, paris } = await world();
  const est = await shop.saveEstimate({ lines: [{ productId: paris.id, qty: 1000 }] });
  await shop.deleteSale(est.id); assert.equal((await shop.binList()).sales.find((x) => x.id === est.id).type, 'estimate');
  await shop.restoreRecord('sale', est.id); assert.equal((await shop.store.get('sales', est.id)).status, 'open');
  await shop.cancelSale(sale.id, 'old style');
  await shop.deleteSale(sale.id); await shop.restoreRecord('sale', sale.id);
  assert.equal((await shop.store.get('sales', sale.id)).status, 'cancelled'); assert.equal(shop.accountBalance('cash'), 0);
});

test('who may do what: salesman can delete (with PIN) but cannot open the bin, restore or purge', async () => {
  const { shop, sale } = await world();
  shop.role = 'salesman';
  await shop.deleteSale(sale.id, 'Bilal');
  await rejects(shop.binList(), 'forbidden'); await rejects(shop.restoreRecord('sale', sale.id), 'forbidden'); await rejects(shop.purgeRecord('sale', sale.id), 'forbidden');
  shop.role = 'admin'; assert.equal((await shop.binList()).sales[0].deletedBy, 'Bilal');
});

test('REAL SCREENS: delete asks for the PIN; wrong PIN deletes nothing; right PIN moves it to the bin', async () => {
  const { shop, sale, ali } = await world();
  S.user = await S.auth.login('x', 'y').catch(() => null);
  await S.auth.setupFirstAdmin({ username: 'Ramzan', pin: '1234', masterPin: '9999' }); S.user = await S.auth.login('Ramzan', '1234');
  const input = { value: '' }, err = { textContent: '' }; dom.reg.set('#pinConfirmInput', input); dom.reg.set('#pinConfirmErr', err);
  // the bill page offers Delete (not the old cancel)
  const page = await M.saleDetail(sale.id); assert.match(page, /data-act="deleteBill"/); assert.ok(!page.includes('cancelBill'));
  const pending = acts.deleteBill({ dataset: { id: sale.id } });
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(dom.sheets.some((h) => h.includes('Delete bill') && h.includes(sale.no) && h.includes('id="pinConfirmInput"')));
  input.value = '0000'; await acts.pinOk(); assert.match(err.textContent, /Incorrect PIN/);
  assert.equal((await shop.store.get('sales', sale.id)).status, 'posted');         // wrong PIN: NOTHING happened
  assert.equal(shop.accountBalance('cash'), 2000);
  input.value = '1234'; await acts.pinOk(); await pending;
  assert.equal((await shop.store.get('sales', sale.id)).status, 'deleted'); assert.equal((await shop.store.get('sales', sale.id)).deletedBy, 'Ramzan');
  assert.ok(dom.toasts.some((x) => /Recycle Bin/.test(x.text)));
  // bin screen: both lists, days left, restore + delete-permanently buttons
  await shop.deleteCustomer(ali.id, 'Ramzan');
  const html = await binScreen();
  for (const w of ['Deleted Records / Recycle Bin', 'Deleted invoices / sales', 'Deleted khata (customers)', sale.no, 'Ali', '30 days left', 'data-act="restoreRecord"', 'data-act="purgeRecord"', '30 days']) assert.ok(html.includes(w), w);
  await acts.restoreRecord({ dataset: { kind: 'sale', id: sale.id } });
  assert.equal((await shop.store.get('sales', sale.id)).status, 'posted');
  // permanent delete needs the PIN as well
  await shop.deleteSale(sale.id);
  const p2 = acts.purgeRecord({ dataset: { kind: 'sale', id: sale.id } }); await new Promise((r) => setTimeout(r, 5));
  input.value = '1234'; await acts.pinOk(); await p2;
  assert.equal(await shop.store.get('sales', sale.id), undefined);
});

test('delete khata button on the customer profile is PIN-protected too; menu has the Recycle Bin', async () => {
  const { shop, ali } = await world();
  await S.auth.setupFirstAdmin({ username: 'Ramzan', pin: '1234', masterPin: '9999' }); S.user = await S.auth.login('Ramzan', '1234');
  const input = { value: '' }, err = { textContent: '' }; dom.reg.set('#pinConfirmInput', input); dom.reg.set('#pinConfirmErr', err);
  assert.match(await K.partyDetail('customer', ali.id), /data-act="deleteKhata"/);
  const p = acts.deleteKhata({ dataset: { id: ali.id } }); await new Promise((r) => setTimeout(r, 5));
  input.value = '1111'; await acts.pinOk(); assert.ok(shop.customers.has(ali.id));
  input.value = '1234'; await acts.pinOk(); await p; assert.ok(!shop.customers.has(ali.id));
  const app = (await import('node:fs')).readFileSync('js/app.js', 'utf8');
  assert.match(app, /#\/bin/); assert.match(app, /ADMIN_ONLY = .*bin/);
});
