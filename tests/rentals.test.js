import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rentalDays, rentalDayList, dateToTs, fmtDate, pktDayStart } from '../js/core.js';
import { MemoryStore, IdbStore } from '../js/store.js';
import { Shop, ShopError } from '../js/db.js';
import { S, acts, ins, markBackup } from '../js/ui/ctx.js';
import * as M from '../js/ui/main_screens.js';
import * as O from '../js/ui/ops_screens.js';
import { settingsScreen } from '../js/ui/settings_screen.js';
import { Auth } from '../js/auth.js';
import { mkShop, seed } from './helpers.js';
import { installFakeDom, formRoot } from './fake-dom.js';

const dom = installFakeDom();
const pkt = (m, d, h = 12, mi = 0) => Date.UTC(2026, m - 1, d, h - 5, mi);     // a Pakistan-time moment in 2026
const rejects = (p, re) => assert.rejects(p, (e) => e instanceof ShopError && (!re || re.test(e.message)));

async function rentalShop(clock) {
  const shop = await mkShop({ clock });
  const rehri = await shop.saveRentalItem({ name: 'Rehri', total: 5, rateType: 'day', rate: 10000 });      // Rs 100 per day
  const stool = await shop.saveRentalItem({ name: 'Stool', total: 20, rateType: 'day', rate: 2500 });        // Rs 25 per day
  const ali = await shop.saveCustomer({ name: 'Ali', phone: '0300-1112223' });
  S.shop = shop; S.lang = 'en'; S.auth = new Auth(shop.store, { iterations: 1000 }); dom.reset();
  return { shop, rehri, stool, ali };
}

test('rentalDays: every calendar day counts, both the day given and the day returned', () => {
  assert.equal(rentalDays(pkt(11, 4, 15), pkt(11, 5, 9)), 2);          // 4th evening -> 5th morning = 2 days (4th and 5th)
  assert.equal(rentalDays(pkt(11, 4, 9), pkt(11, 4, 21)), 1);          // same day
  assert.equal(rentalDays(pkt(11, 4), pkt(11, 7)), 4);
  assert.equal(rentalDays(pkt(11, 30), pkt(12, 2)), 3);                // across a month end
  assert.equal(rentalDays(pkt(11, 4, 23, 59), pkt(11, 5, 0, 1)), 2);   // midnight boundary uses Pakistan time
  assert.deepEqual(rentalDayList(pkt(11, 4, 15), pkt(11, 6, 9)).map(fmtDate), ['04-11-2026', '05-11-2026', '06-11-2026']);
  assert.throws(() => rentalDays(pkt(11, 5), pkt(11, 4)), /before the date it was given/);
});

test('dateToTs: today keeps the real time, past dates become noon, future refused', () => {
  const now = pkt(11, 10, 15, 30);
  assert.equal(dateToTs('2026-11-10', now), now);
  assert.equal(dateToTs('2026-11-06', now), pkt(11, 6, 12));
  assert.equal(dateToTs('2026-11-06', now, pkt(11, 6, 15)), pkt(11, 6, 15));   // same day as given -> never before it was given
  assert.throws(() => dateToTs('2026-11-11', now), /future/); assert.throws(() => dateToTs('', now), /valid date/);
});

test('YOUR EXAMPLE: Rs 100/day, taken on the 4th, returned on the 5th = Rs 200 (Rs 100 for each date)', async () => {
  const clock = { t: pkt(11, 4, 15) };
  const { shop, rehri, ali } = await rentalShop(clock);
  const r = await shop.checkoutRental({ customerId: ali.id, customerName: 'Ali', phone: '0300-1112223', address: 'Model Town', items: [{ itemId: rehri.id, qty: 1 }], deposit: 0 });
  assert.equal(r.address, 'Model Town'); assert.equal(fmtDate(r.outAt), '04-11-2026');
  clock.t = pkt(11, 5, 10);
  const pv = shop.rentalPreview(shop.rentals.get(r.id), null, clock.t);
  assert.equal(pv.charge, 20000);
  assert.deepEqual(pv.dayRows.map((d) => [fmtDate(d.day), d.amount]), [['04-11-2026', 10000], ['05-11-2026', 10000]]);
  const res = await shop.returnRental(r.id);
  assert.equal(res.charge, 20000); assert.equal(res.credit, 20000);
  assert.equal(shop.balance('customer', ali.id), 20000);                       // "is customer ka itna banta hai"
});

test('quantities, several items, same-day and longer rentals', async () => {
  const clock = { t: pkt(11, 4, 9) };
  const { shop, rehri, stool } = await rentalShop(clock);
  const mk = async (items) => shop.checkoutRental({ customerName: 'Walk', items, at: pkt(11, 4, 9) });
  const a = await mk([{ itemId: rehri.id, qty: 2 }, { itemId: stool.id, qty: 4 }]);
  clock.t = pkt(11, 4, 20);                                                    // same day = 1 day
  assert.equal(shop.rentalPreview(shop.rentals.get(a.id)).charge, 2 * 10000 + 4 * 2500);
  clock.t = pkt(11, 7, 10);                                                    // 4th..7th = 4 days
  assert.equal(shop.rentalPreview(shop.rentals.get(a.id)).charge, 4 * (2 * 10000 + 4 * 2500));
  const rows = shop.rentalPreview(shop.rentals.get(a.id)).dayRows;
  assert.equal(rows.length, 4); assert.ok(rows.every((d) => d.amount === 30000));
  const ok = await shop.returnRental(a.id, { payments: [{ account: 'cash', amount: 120000 }] });   // walk-in pays in full
  assert.equal(ok.charge, 120000); assert.equal(shop.accountBalance('cash'), 120000);
});

test('back-dated return: pick the date it actually came back', async () => {
  const clock = { t: pkt(11, 4, 15) };
  const { shop, rehri, ali } = await rentalShop(clock);
  const r = await shop.checkoutRental({ customerId: ali.id, customerName: 'Ali', items: [{ itemId: rehri.id, qty: 1 }] });
  clock.t = pkt(11, 10, 11);                                                   // today is the 10th, but it came back on the 6th
  const at = dateToTs('2026-11-06', clock.t, r.outAt);
  const res = await shop.returnRental(r.id, { at });
  assert.equal(res.charge, 3 * 10000);                                         // 4th, 5th, 6th
  assert.equal(fmtDate(res.rental.closedAt), '06-11-2026');
});

test('partial returns on different dates are charged separately', async () => {
  const clock = { t: pkt(11, 4, 10) };
  const { shop, rehri, stool, ali } = await rentalShop(clock);
  const r = await shop.checkoutRental({ customerId: ali.id, customerName: 'Ali', items: [{ itemId: rehri.id, qty: 1 }, { itemId: stool.id, qty: 10 }] });
  clock.t = pkt(11, 5, 10);
  const p1 = await shop.returnRental(r.id, { items: [{ itemId: stool.id, qty: 10 }] });
  assert.equal(p1.charge, 2 * 10 * 2500);                                      // stools: 2 days
  assert.equal((await shop.store.get('rentals', r.id)).status, 'partial');
  clock.t = pkt(11, 8, 10);
  const p2 = await shop.returnRental(r.id);
  assert.equal(p2.charge, 5 * 10000);                                          // rehri: 4th..8th = 5 days
  assert.equal(shop.balance('customer', ali.id), 50000 + 50000);
  assert.equal(shop.rentals.get(r.id).charges, 100000);
});

test('deposit, refund, and validation of dates', async () => {
  const clock = { t: pkt(11, 4, 10) };
  const { shop, rehri, ali } = await rentalShop(clock);
  await rejects(shop.checkoutRental({ customerName: 'X', items: [{ itemId: rehri.id, qty: 1 }], at: pkt(11, 6) }), /future/);
  const r = await shop.checkoutRental({ customerId: ali.id, customerName: 'Ali', items: [{ itemId: rehri.id, qty: 1 }], deposit: 50000 });
  clock.t = pkt(11, 5, 10);
  await rejects(shop.returnRental(r.id, { at: pkt(11, 3, 12) }), /before the date it was given/);
  await rejects(shop.returnRental(r.id, { at: pkt(11, 9, 12) }), /future/);
  const x = await shop.returnRental(r.id);                                     // Rs 200 rent, Rs 500 deposit
  assert.deepEqual([x.charge, x.applied, x.refund, x.credit], [20000, 20000, 30000, 0]);
  assert.equal(shop.accountBalance('cash'), 50000 - 30000); assert.equal(shop.balance('customer', ali.id), 0);
});

test('hourly items still work (unchanged rule)', async () => {
  const clock = { t: pkt(11, 4, 9) };
  const shop = await mkShop({ clock });
  const phatta = await shop.saveRentalItem({ name: 'Phatta', total: 50, rateType: 'hour', rate: 1000 });
  const r = await shop.checkoutRental({ customerName: 'W', items: [{ itemId: phatta.id, qty: 10 }] });
  clock.t = pkt(11, 4, 14, 10);                                                // 5h10m -> 5 chargeable hours (30 min grace)
  assert.equal(shop.rentalPreview(shop.rentals.get(r.id)).charge, 5 * 1000 * 10);
});

test('rental bill text for WhatsApp lists every date and the totals (English and Roman Urdu)', async () => {
  const clock = { t: pkt(11, 4, 15) };
  const { shop, rehri, ali } = await rentalShop(clock);
  const r = await shop.checkoutRental({ customerId: ali.id, customerName: 'Ali', phone: '0300-1112223', items: [{ itemId: rehri.id, qty: 2 }], deposit: 10000 });
  clock.t = pkt(11, 5, 10);
  const { rental } = await shop.returnRental(r.id, { payments: [{ account: 'cash', amount: 10000 }] });
  const en = shop.rentalBillText(rental, 'en'), ro = shop.rentalBillText(rental, 'ur');
  for (const w of ['Rental bill', '04-11-2026: Rs. 200', '05-11-2026: Rs. 200', 'Total rent: Rs. 400', 'Deposit taken: Rs. 100', 'Balance (udhaar): Rs. 200']) assert.ok(en.includes(w), w);
  for (const w of ['Kiraye ka bill', 'Tareekh ke hisab se kiraya', 'Kul kiraya: Rs. 400']) assert.ok(ro.includes(w), w);
  assert.match(shop.rentalBillLink(rental, 'en'), /^https:\/\/wa\.me\/923001112223\?text=/);
});

test('REAL SCREEN FLOW: choose return date, see the date-wise rent, return, get the bill', async () => {
  const clock = { t: pkt(11, 4, 15) };
  const { shop, rehri, ali } = await rentalShop(clock);
  const r = await shop.checkoutRental({ customerId: ali.id, customerName: 'Ali', phone: '0300-1112223', items: [{ itemId: rehri.id, qty: 2 }], deposit: 10000 });
  clock.t = pkt(11, 5, 15);
  assert.match(await O.rentalsScreen(), /Given on: <b>04-11-2026<\/b> · Day 2/);          // list shows given date and the day number
  acts.returnRental({ dataset: { id: r.id } });
  assert.ok(dom.sheets.some((h) => h.includes('Return date') && h.includes('Rent date-wise') && h.includes('type="date"')));
  const itemKey = `r_${rehri.id}`, stubs = { '#retDays': { innerHTML: '' }, '#retCharge': {}, '#retDue': {}, '#retCredit': {} };
  for (const [k, v] of Object.entries(stubs)) dom.reg.set(k, v);
  const setForm = (vals) => dom.reg.set('#retForm', formRoot({ id: r.id }, { retDate: '2026-11-05', [itemKey]: '2', p_cash: '', refundAccount: 'cash', ...vals }));
  setForm({}); ins.retCalc();
  assert.equal(stubs['#retCharge'].textContent, 'Rs. 400'); assert.equal(stubs['#retDue'].textContent, 'Rs. 300');   // Rs 400 - Rs 100 deposit
  for (const w of ['04-11-2026', '05-11-2026', 'Rs. 200', '2 days']) assert.ok(stubs['#retDays'].innerHTML.includes(w), w);
  setForm({ retDate: '2026-11-04' }); ins.retCalc(); assert.equal(stubs['#retCharge'].textContent, 'Rs. 200');            // returned the same day
  setForm({ retDate: '2026-11-03' }); ins.retCalc(); assert.match(stubs['#retDays'].innerHTML, /before the date it was given/);
  setForm({ p_cash: '100' }); ins.retCalc(); assert.equal(stubs['#retCredit'].textContent, 'Rs. 200');
  dom.reset(); await acts.doReturn({ dataset: { id: r.id } });
  assert.equal(dom.toasts.filter((x) => x.error).length, 0, JSON.stringify(dom.toasts));
  assert.equal(shop.balance('customer', ali.id), 20000);
  assert.ok(dom.sheets.some((h) => h.includes('Total rent') && h.includes('Rs. 400') && h.includes('wa.me') && h.includes('04-11-2026')));
  assert.equal(shop.rentals.get(r.id).status, 'returned');
});

test('rental screens render (English + Roman Urdu), including the detail page', async () => {
  const clock = { t: pkt(11, 4, 15) };
  const { shop, rehri, ali } = await rentalShop(clock);
  const r = await shop.checkoutRental({ customerId: ali.id, customerName: 'Ali', phone: '0300-1112223', items: [{ itemId: rehri.id, qty: 1 }], deposit: 5000, idNote: 'CNIC kept' });
  clock.t = pkt(11, 6, 10);
  for (const lang of ['en', 'ur']) {
    S.lang = lang;
    const pages = [await O.rentalsScreen(), await O.rentalNew(), await O.rentalDetail(r.id)];
    for (const h of pages) assert.ok(h.length > 80 && !/undefined|\[object Object\]|NaN/.test(h));
    assert.match(pages[2], /04-11-2026/); assert.match(pages[2], /06-11-2026/); assert.match(pages[1], /type="date"/);
  }
  S.lang = 'ur'; assert.match(await O.rentalDetail(r.id), /Kul kiraya/);
  await shop.returnRental(r.id, { payments: [{ account: 'cash', amount: 25000 }] });      // Rs 300 rent - Rs 50 deposit = Rs 250
  S.lang = 'en'; assert.match(await O.rentalDetail(r.id), /Returned on 06-11-2026/);
});

// ---------------- reliability ----------------
test('data survives closing and reopening the app (rentals, khata, stock, cash)', async () => {
  const store = new MemoryStore(), clock = { t: pkt(11, 4, 15) };
  const { shop, rehri, ali } = await rentalShop(clock); // separate store; build the real scenario on `store` below
  const s1 = await mkShop({ store, clock }); const { paris, ali: ali2 } = await seed(s1);
  const rh = await s1.saveRentalItem({ name: 'Rehri', total: 3, rate: 10000 });
  const r = await s1.checkoutRental({ customerId: ali2.id, customerName: 'Ali', items: [{ itemId: rh.id, qty: 1 }], deposit: 20000 });
  await s1.postSale({ customerId: ali2.id, lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 500 }] });
  clock.t = pkt(11, 5, 12); await s1.returnRental(r.id);
  const s2 = new Shop({ store, now: () => clock.t }); await s2.init();            // "restart"
  assert.equal(s2.rentals.get(r.id).status, 'returned'); assert.equal(s2.rentals.get(r.id).charges, 20000);
  assert.equal(s2.balance('customer', ali2.id), 1000); assert.equal(s2.stockOf(paris.id).qty, 9750); assert.equal(s2.accountBalance('cash'), 20000 + 500 - 0);
  assert.equal((await s2.selfCheck()).ok, true); void shop; void rehri; void ali;
});

test('selfCheck passes on healthy data and catches damaged data', async () => {
  const shop = await mkShop(); const { paris, ali } = await seed(shop);
  const sale = await shop.postSale({ customerId: ali.id, lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1000 }] });
  const ok = await shop.selfCheck(); assert.equal(ok.ok, true); assert.deepEqual(ok.issues, []); assert.equal(ok.counts.bills, 1);
  await shop.store.batch([{ col: 'sales', obj: { ...(await shop.store.get('sales', sale.id)), total: 1501 } }]);           // someone edits a bill
  const mv = (await shop.store.all('movements'))[0];
  await shop.store.batch([{ col: 'movements', obj: { ...mv, qty: mv.qty + 5 } }]);                                        // and a stock row
  const bad = await shop.selfCheck();
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => /total does not match/.test(i))); assert.ok(bad.issues.some((i) => /does not match its movements/.test(i)));
});

test('IndexedDB writes ask the browser for strict durability and are atomic', async () => {
  const seen = []; const objs = [];
  const fakeTx = (names, mode, opts) => { seen.push({ names, mode, opts }); const tx = { objectStore: () => ({ put: (o) => objs.push(o), delete() {} }) };
    Object.defineProperty(tx, 'oncomplete', { set(f) { setTimeout(f, 0); } }); return tx; };
  const st = new IdbStore(); st.db = { transaction: fakeTx };
  await st.batch([{ col: 'sales', obj: { id: 'a' } }, { col: 'ledger', obj: { id: 'b' } }]);
  assert.equal(seen.length, 1);                                                                   // ONE transaction for the whole posting
  assert.deepEqual(seen[0].names.sort(), ['ledger', 'sales']); assert.equal(seen[0].opts.durability, 'strict'); assert.equal(objs.length, 2);
});

test('app asks for permanent storage; Settings shows a data-safety card; backups are tracked', async () => {
  assert.match(readFileSync('js/app.js', 'utf8'), /navigator\.storage\?\.persist/);
  const shop = await mkShop(); await seed(shop); S.shop = shop; S.lang = 'en'; S.auth = new Auth(shop.store, { iterations: 1000 }); S.persisted = true; localStorage.removeItem('lastBackup'); localStorage.removeItem('lastDriveBackup');
  const set = await settingsScreen();
  for (const w of ['Data safety', 'Permanent storage', 'Check my data', 'Download backup now', 'saved on this phone']) assert.ok(set.includes(w), w);
  assert.match(await M.dashboard(), /No recent backup/);                                        // reminder until a backup is taken
  markBackup(); assert.ok(!(await M.dashboard()).includes('No recent backup'));
  assert.ok(pktDayStart(Date.now()) > 0);
});
