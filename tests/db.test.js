import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../js/store.js';
import { Shop, ShopError } from '../js/db.js';
import { mkShop, seed, T0 } from './helpers.js';

const rejects = (p, code) => assert.rejects(p, (e) => e instanceof ShopError && (!code || e.code === code));

test('Rs 15 of Paris at Rs 60/kg: 250 g added to cart, cash and profit are exact', async () => {
  const s = await mkShop(); const { paris } = await seed(s);
  const sale = await s.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });
  assert.equal(sale.lines[0].qty, 250);          // 0.250 kg
  assert.equal(sale.lines[0].baseQty, 250);
  assert.equal(sale.total, 1500);
  assert.equal(sale.cogs, 1125);                 // 250/10000 of Rs 450
  assert.equal(s.accountBalance('cash'), 1500);
  assert.match(sale.no, /^RES-2026-A000001$/);
});

test('sell in grams, multi-unit pricing (dozen bulbs, feet of wire)', async () => {
  const s = await mkShop(); const { paris, bulb, wire } = await seed(s);
  const a = await s.postSale({ lines: [{ productId: paris.id, unit: 'g', qty: 500000 }], payments: [{ account: 'cash', amount: 3000 }] });
  assert.equal(a.total, 3000);                   // 500 g x 6 paise
  const b = await s.postSale({ lines: [{ productId: bulb.id, unit: 'dozen', qty: 2000, price: 22500 }], payments: [{ account: 'bank', amount: 540000 }] });   // price is per PIECE (Rs 225) -> 24 pcs
  assert.equal(b.cogs, 24 * 18000);
  const c = await s.postSale({ lines: [{ productId: wire.id, unit: 'ft', qty: 10000 }], payments: [{ account: 'cash', amount: 15240 }] });
  assert.equal(c.lines[0].baseQty, 3048);        // 10 ft = 3.048 m
  assert.equal(c.total, 15240);                  // 3.048 m x Rs 50
});

test('wholesale price mode', async () => {
  const s = await mkShop(); const { paris } = await seed(s);
  const sale = await s.postSale({ priceMode: 'wholesale', lines: [{ productId: paris.id, qty: 2000 }], payments: [{ account: 'cash', amount: 11000 }] });
  assert.equal(sale.total, 11000);
});

test('NO STOCK TRACKING: any quantity can be billed - nothing blocks, nothing warns', async () => {
  const s = await mkShop(); const { paris } = await seed(s);
  const sale = await s.postSale({ lines: [{ productId: paris.id, qty: 500000 }], payments: [{ account: 'cash', amount: 3000000 }] });   // 500 kg
  assert.equal(sale.total, 3000000); assert.equal(sale.lines[0].cogs, 500 * 4500);
  for (const m of ['stockOf', 'avgCost', 'adjustStock', 'resetStock', 'lowStock', 'stockValue']) assert.equal(typeof Shop.prototype[m], 'undefined', m);
  assert.equal(s.cfg.allowNegative, undefined);
  await rejects(s.postSale({ lines: [{ productId: paris.id, unit: 'kg', qty: 1000 }], payments: [{ account: 'cash', amount: 1 }] }), undefined);   // only a payment error remains
  assert.equal((await s.store.all('sales')).length, 1);                           // a failed bill writes nothing
});

test('udhaar: walk-in rejected, credit limit warning + override, khata balance', async () => {
  const s = await mkShop(); const { bulb, ali } = await seed(s);
  const line = { productId: bulb.id, qty: 4000 };                                // Rs 1000
  await rejects(s.postSale({ lines: [line] }), 'walkin_credit');
  const sale = await s.postSale({ customerId: ali.id, lines: [line], payments: [{ account: 'cash', amount: 40000 }] });
  assert.equal(sale.credit, 60000);
  assert.equal(s.balance('customer', ali.id), 60000);
  assert.equal(s.accountBalance('cash'), 40000);                                 // credit is NOT cash
  const big = { productId: bulb.id, qty: 30000 };                                // Rs 7,500
  await rejects(s.postSale({ customerId: ali.id, lines: [big] }), 'credit_limit');
  const ok = await s.postSale({ customerId: ali.id, lines: [big], overrideLimit: true });
  assert.equal(ok.credit, 750000);
  await s.receivePayment({ customerId: ali.id, account: 'jazzcash', amount: 800000 });
  assert.equal(s.balance('customer', ali.id), 10000);
  assert.equal(s.accountBalance('jazzcash'), 800000);
  const st = await s.statement('customer', ali.id);
  assert.equal(st.at(-1).running, 10000);
});

test('split payment across cash / easypaisa; overpayment rejected', async () => {
  const s = await mkShop(); const { bulb } = await seed(s);
  const sale = await s.postSale({ lines: [{ productId: bulb.id, qty: 2000 }], payments: [{ account: 'cash', amount: 20000 }, { account: 'easypaisa', amount: 30000 }] });
  assert.equal(sale.method, 'split');
  assert.equal(s.accountBalance('easypaisa'), 30000);
  await rejects(s.postSale({ lines: [{ productId: bulb.id, qty: 1000 }], payments: [{ account: 'cash', amount: 99999 }] }));
});

test('estimate does not touch stock; converts to a bill in one click; not counted as sales', async () => {
  const s = await mkShop(); const { paris, ali } = await seed(s);
  const est = await s.saveEstimate({ customerId: ali.id, lines: [{ productId: paris.id, amount: 3000 }, { productId: paris.id, qty: 1000 }] });
  assert.equal(est.type, 'estimate'); assert.match(est.no, /^EST-/);
  assert.equal((await s.sales()).length, 0);
  const sale = await s.convertEstimate(est.id, { payments: [{ account: 'cash', amount: 5000 }] });
  assert.equal(sale.total, 9000);
  const e2 = await s.store.get('sales', est.id);
  assert.equal(e2.status, 'converted'); assert.equal(e2.convertedTo, sale.id);
  await rejects(s.convertEstimate(est.id), undefined);                           // cannot convert twice
});

test('cancel sale reverses cash and khata with traceable rows', async () => {
  const s = await mkShop(); const { bulb, ali } = await seed(s);
  const sale = await s.postSale({ customerId: ali.id, lines: [{ productId: bulb.id, qty: 4000 }], payments: [{ account: 'cash', amount: 40000 }] });
  await s.cancelSale(sale.id, 'wrong item');
  assert.equal(s.accountBalance('cash'), 0);
  assert.equal(s.balance('customer', ali.id), 0);
  assert.equal((await s.store.get('sales', sale.id)).status, 'cancelled');
  assert.ok((await s.store.all('ledger')).some((m) => m.kind === 'reversal' && m.reversalOf));
  assert.equal((await s.store.all('movements')).length, 0);                      // no stock rows are written any more
  await rejects(s.cancelSale(sale.id));                                           // not twice
});

test('purchase: supplier payable, landed cost becomes the item cost price (no stock)', async () => {
  const s = await mkShop(); const { bulb, sup } = await seed(s);
  const pur = await s.postPurchase({ supplierId: sup.id, extra: 6000,
    lines: [{ productId: bulb.id, unit: 'dozen', qty: 1000, cost: 264000 }], payments: [{ account: 'cash', amount: 100000 }] });
  assert.equal(pur.total, 270000);
  assert.equal(s.products.get(bulb.id).costPrice, 22500);                          // Rs 2700 / 12 pcs = Rs 225 per piece
  assert.equal(s.balance('supplier', sup.id), 170000);
  await s.paySupplier({ supplierId: sup.id, account: 'bank', amount: 170000 });
  assert.equal(s.balance('supplier', sup.id), 0); assert.equal(s.accountBalance('bank'), -170000);
  const sale = await s.postSale({ lines: [{ productId: bulb.id, qty: 2000 }], payments: [{ account: 'cash', amount: 50000 }] });
  assert.equal(sale.cogs, 2 * 22500);                                              // profit now uses the new cost
  await s.cancelPurchase(pur.id);                                                  // allowed even if the goods were sold: nothing to check
  assert.equal(s.balance('supplier', sup.id), -170000);                            // the payment made afterwards stays as an advance
});

test('Salesman: can sell but not see profit, buy, add items or cancel', async () => {
  const s = await mkShop(); const { paris, sup } = await seed(s);
  s.role = 'salesman';
  await s.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });
  await rejects(s.itemReport({ from: 0, to: Infinity }), 'forbidden');
  await rejects(s.profitReport({ from: 0, to: Infinity }), 'forbidden');
  await rejects(s.postPurchase({ supplierId: sup.id, lines: [{ productId: paris.id, qty: 1000, cost: 1 }] }), 'forbidden');
  await rejects(s.addExpense({ category: 'Tea', amount: 100 }), 'forbidden');
  await rejects(s.saveProduct({ name: 'X' }), 'forbidden');
  const d = await s.dashboard();
  assert.equal(d.todayProfit, undefined); assert.equal(d.payable, undefined);
  assert.equal(d.todaySales, 1500);
});

test('profit uses each item\'s cost price; editing the cost price only affects new bills', async () => {
  const s = await mkShop(); const { paris } = await seed(s);
  const a = await s.postSale({ lines: [{ productId: paris.id, amount: 6000 }], payments: [{ account: 'cash', amount: 6000 }] });
  assert.equal(a.cogs, 4500);
  await s.saveProduct({ ...s.products.get(paris.id), costPrice: 5000 });
  const b = await s.postSale({ lines: [{ productId: paris.id, amount: 6000 }], payments: [{ account: 'cash', amount: 6000 }] });
  assert.equal(b.cogs, 5000); assert.equal((await s.store.get('sales', a.id)).cogs, 4500);
  const p = await s.profitReport({ from: 0, to: Infinity });
  assert.equal(p.grossProfit, 12000 - 9500);
  const d = await s.dashboard(); assert.equal(d.lowStock, undefined);
});

test('expenses, transfer, owner money affect cash only, and net profit', async () => {
  const s = await mkShop(); const { paris } = await seed(s);
  await s.ownerTx({ account: 'cash', amount: 500000, contribution: true });
  await s.transfer({ from: 'cash', to: 'bank', amount: 200000 });
  await s.addExpense({ category: 'Rent', amount: 50000, account: 'cash' });
  await s.addExpense({ category: 'Tea', amount: 1000, account: 'cash' });
  await s.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });
  assert.equal(s.accountBalance('cash'), 500000 - 200000 - 51000 + 1500);
  assert.equal(s.accountBalance('bank'), 200000);
  const p = await s.profitReport({ from: 0, to: Infinity });
  assert.deepEqual([p.revenue, p.cogs, p.grossProfit, p.expenses, p.netProfit], [1500, 1125, 375, 51000, 375 - 51000]);
  const ex = await s.expensesReport({ from: 0, to: Infinity });
  assert.deepEqual(ex.map((e) => e.category), ['Rent', 'Tea']);
});

test('reports: daily sales, item-wise margin', async () => {
  const s = await mkShop(); const { paris, bulb } = await seed(s);
  await s.postSale({ lines: [{ productId: paris.id, amount: 6000 }], payments: [{ account: 'cash', amount: 6000 }] });
  s.clock.t += 86400000;
  await s.postSale({ lines: [{ productId: bulb.id, qty: 2000 }], payments: [{ account: 'cash', amount: 50000 }] });
  const days = await s.salesReport({ from: 0, to: Infinity, period: 'day' });
  assert.deepEqual(days.map((d) => [d.key, d.total]), [['2026-11-01', 6000], ['2026-11-02', 50000]]);
  const items = await s.itemReport({ from: 0, to: Infinity });
  const b = items.find((i) => i.name === 'LED Bulb 12W');
  assert.equal(b.profit, 50000 - 36000); assert.equal(b.marginBp, 2800);          // 28.00%
});

test('rental: checkout, availability, partial return, deposit applied, refund, khata', async () => {
  const s = await mkShop(); const { ali } = await seed(s);
  const stool = await s.saveRentalItem({ name: 'Stool', total: 10, rateType: 'day', rate: 5000, deposit: 20000 });
  const phatta = await s.saveRentalItem({ name: 'Phatta', total: 50, rateType: 'hour', rate: 1000 });
  const r = await s.checkoutRental({ customerId: ali.id, customerName: 'Ali', phone: '0300-1234567', idNote: 'CNIC kept',
    items: [{ itemId: stool.id, qty: 4 }, { itemId: phatta.id, qty: 20 }], deposit: 100000, account: 'cash' });
  assert.match(r.no, /^RNT-2026-A/);
  assert.equal(s.availability(stool.id), 6); assert.equal(s.availability(phatta.id), 30);
  assert.equal(s.accountBalance('cash'), 100000);
  await rejects(s.checkoutRental({ customerName: 'Bob', items: [{ itemId: stool.id, qty: 7 }] }), 'rental_stock');

  s.clock.t += 5 * 3600000 + 10 * 60000;                                          // 5h10m later
  const p1 = await s.returnRental(r.id, { items: [{ itemId: phatta.id, qty: 20 }] });
  assert.equal(p1.charge, 5 * 1000 * 20);                                         // 5 chargeable hours (grace 30m)
  assert.equal(p1.applied, 100000);                                               // all from deposit
  assert.equal((await s.store.get('rentals', r.id)).status, 'partial');
  assert.equal(s.availability(phatta.id), 50);

  s.clock.t += 2 * 86400000;                                                      // 2 more days
  const p2 = await s.returnRental(r.id, { payments: [{ account: 'cash', amount: 20000 }] });
  assert.equal(p2.charge, 3 * 5000 * 4);                                          // 3 days x 4 stools
  assert.equal(p2.applied, 0);                                                    // deposit already used
  assert.equal(p2.paid, 20000); assert.equal(p2.credit, 40000);
  assert.equal(s.balance('customer', ali.id), 40000);                             // rest goes to khata
  assert.equal((await s.store.get('rentals', r.id)).status, 'returned');
  assert.equal(s.availability(stool.id), 10);
  const prof = await s.profitReport({ from: 0, to: Infinity });
  assert.equal(prof.rentalIncome, 100000 + 60000);
});

test('rental: deposit larger than charges is refunded; walk-in cannot take credit', async () => {
  const s = await mkShop();
  const stool = await s.saveRentalItem({ name: 'Stool', total: 10, rateType: 'day', rate: 5000 });
  const r = await s.checkoutRental({ customerName: 'Walk', items: [{ itemId: stool.id, qty: 2 }], deposit: 50000 });
  s.clock.t += 3600000;
  const x = await s.returnRental(r.id);
  assert.equal(x.charge, 10000); assert.equal(x.refund, 40000);
  assert.equal(s.accountBalance('cash'), 50000 - 40000);
  const r2 = await s.checkoutRental({ customerName: 'Walk2', items: [{ itemId: stool.id, qty: 1 }], deposit: 0 });
  s.clock.t += 3600000;
  await rejects(s.returnRental(r2.id), 'walkin_credit');
  const ok = await s.returnRental(r2.id, { payments: [{ account: 'cash', amount: 5000 }] });
  assert.equal(ok.credit, 0);
});

test('state survives restart: balances rebuilt from storage equal the live ones', async () => {
  const store = new MemoryStore(); const clock = { t: T0 };
  const s = await mkShop({ store, clock }); const { paris, ali, bulb } = await seed(s);
  await s.postSale({ customerId: ali.id, lines: [{ productId: paris.id, amount: 1500 }, { productId: bulb.id, qty: 1000 }], payments: [{ account: 'cash', amount: 1000 }] });
  const s2 = new Shop({ store, now: () => clock.t }); await s2.init();
  assert.deepEqual([...s2.bal], [...s.bal]); assert.deepEqual([...s2.acct], [...s.acct]);
  assert.equal(s2.products.size, 3);
});

test('concurrent sales get distinct invoice numbers; device code in number', async () => {
  const s = await mkShop({ code: 'B' }); const { bulb } = await seed(s);
  const mk = () => s.postSale({ lines: [{ productId: bulb.id, qty: 1000 }], payments: [{ account: 'cash', amount: 25000 }] });
  const r = await Promise.all([mk(), mk(), mk()]);
  assert.deepEqual(r.map((x) => x.no), ['RES-2026-B000001', 'RES-2026-B000002', 'RES-2026-B000003']);
});

test('backup export / import round trip', async () => {
  const s = await mkShop(); const { paris } = await seed(s);
  await s.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });
  const json = JSON.parse(JSON.stringify(await s.exportAll()));
  const s2 = await mkShop();
  await s2.importAll(json);
  assert.equal(s2.products.size, 3); assert.equal(s2.products.get(paris.id).costPrice, 4500); assert.equal(s2.accountBalance('cash'), 1500); assert.equal((await s2.sales()).length, 1);
  await assert.rejects(s2.importAll({ nope: 1 }));
});

test('reminders: WhatsApp link with balance', async () => {
  const s = await mkShop(); const { bulb, ali } = await seed(s);
  await s.postSale({ customerId: ali.id, lines: [{ productId: bulb.id, qty: 4000 }] });
  const link = s.reminderLink(ali.id, 'en');
  assert.match(link, /^https:\/\/wa\.me\/923001234567\?text=/);
  assert.match(decodeURIComponent(link), /Rs\. 1,000/);
  assert.match(s.reminderText(ali.id, 'ur'), /Rs\. 1,000/);
});

test('no stock wording is left anywhere in the screens or translations', async () => {
  const { dict } = await import('../js/i18n.js'); const fs = await import('node:fs');
  const words = [...Object.values(dict.en), ...Object.values(dict.ur)].filter((v) => /\bstock\b|\bstock\s?(count|level)|Kam stock|0 items left/i.test(v));
  assert.deepEqual(words, []);
  const src = ['js/db.js', 'js/ui/main_screens.js', 'js/ui/stock_screens.js', 'js/ui/khata_screen.js', 'js/ui/ops_screens.js', 'js/ui/settings_screen.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(!/stockOf|lowStock|minStock|allowNegative|adjustStock|resetStock|insufficient/i.test(src));
});
