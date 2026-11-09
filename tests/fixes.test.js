import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseQtyLoose, lineGross, qtyForAmount, listPrice, fmtQty } from '../js/core.js';
import { Shop } from '../js/db.js';
import { S, acts, ins, chg } from '../js/ui/ctx.js';
import * as M from '../js/ui/main_screens.js';
import * as KH from '../js/ui/khata_screen.js';
import { receiptRows } from '../js/print.js';
import { dict } from '../js/i18n.js';
import { mkShop, seed } from './helpers.js';
import { installFakeDom, form } from './fake-dom.js';

const dom = installFakeDom();
const t = (k) => dict.en[k] ?? k;

async function shopWith(price = 1500) {
  const shop = await mkShop();
  const poppy = await shop.saveProduct({ name: 'Plaster of Paris', nameUr: 'Paris Plaster', baseUnit: 'kg', sellUnit: 'kg', units: [{ unit: 'g', num: 1, den: 1000 }], retailPrice: price, costPrice: 600 });
  const bulb = await shop.saveProduct({ name: 'LED Bulb', baseUnit: 'pc', sellUnit: 'pc', retailPrice: 25000, costPrice: 18000 });
  S.shop = shop; S.cart = null; S.khata = null; S.lang = 'en'; S.lineCtx = null; dom.reset();
  return { shop, poppy, bulb };
}
const waitToasts = () => new Promise((r) => setTimeout(r, 5));

// ---------- 1. weight -> cost ----------
test('Rs 15 per kg: grams and fractions give the exact total (was Rs 5 for 250 g)', async () => {
  const { poppy } = await shopWith(1500);
  const p = S.shop.products.get(poppy.id), price = listPrice(p);
  assert.equal(price, 1500);
  assert.equal(lineGross(p, 250000, 'g', price), 375);      // 250 g  -> Rs 3.75
  assert.equal(lineGross(p, 250, 'kg', price), 375);        // 0.25 kg -> Rs 3.75
  assert.equal(lineGross(p, 1000, 'g', price), 2);          // 1 g -> 1.5 paise -> rounds once, at the end
  assert.equal(lineGross(p, 333000, 'g', price), 500);      // 499.5 paise
  assert.equal(lineGross(p, 1500, 'kg', price), 2250);
  assert.equal(lineGross(p, 500000, 'g', price) + lineGross(p, 500000, 'g', price), 1500); // two halves = 1 kg
  assert.equal(qtyForAmount(1500, price), 1000);            // Rs 15 buys exactly 1 kg
  assert.equal(qtyForAmount(375, price), 250);              // Rs 3.75 buys 250 g
});

test('selling 250 g posts Rs 3.75 and the cost is exact', async () => {
  const { shop, poppy } = await shopWith(1500);
  const sale = await shop.postSale({ lines: [{ productId: poppy.id, unit: 'g', qty: 250000 }], payments: [{ account: 'cash', amount: 375 }] });
  assert.equal(sale.total, 375); assert.equal(sale.lines[0].baseQty, 250); assert.equal(sale.lines[0].cogs, 150);   // 250 g x Rs 6/kg
  assert.equal(sale.lines[0].priceUnit, 'kg'); assert.equal(shop.accountBalance('cash'), 375);
});

test('quantity input accepts decimals, fractions and ½ symbols', () => {
  const cases = { '0.25': 250, '250': 250000, '1/4': 250, '1 1/2': 1500, '½': 500, '1½': 1500, '¾': 750, '2,5': 2500, '0.2555': 256, '3/8': 375 };
  for (const [input, milli] of Object.entries(cases)) assert.equal(parseQtyLoose(input), milli, input);
  for (const bad of ['abc', '1/0', '', '1..2', '-1']) assert.throws(() => parseQtyLoose(bad), bad);
  assert.equal(fmtQty(parseQtyLoose('1/3')), '0.333');
});

// ---------- 2. the cart crash: S.shop.preview is not a function ----------
test('every method the UI calls on S.shop really exists', () => {
  const files = ['js/app.js', ...readdirSync('js/ui').map((f) => `js/ui/${f}`)];
  const used = new Set();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/S\.shop\.([A-Za-z_]+)\(/g)) used.add(m[1]);
  const inst = ['now'];                                     // instance fields (functions), not prototype methods
  const missing = [...used].filter((n) => !inst.includes(n) && typeof Shop.prototype[n] !== 'function');
  assert.deepEqual(missing, []);
});

test('Add item to the cart via the real UI actions (no more "preview is not a function")', async () => {
  const { shop, poppy } = await shopWith(1500);
  assert.equal(typeof shop.preview, 'function');
  S.cart = { customerId: '', priceMode: 'retail', lines: [], discount: '', pay: {}, note: '' };
  // user taps Paris, types 250, picks gram, presses "Add to cart"
  M.openLineSheet(shop.products.get(poppy.id), null, S.cart, () => {});
  dom.reg.set('#lineForm', form({ pid: poppy.id, idx: '', mode: 'qty' }, { qty: '250', unit: 'g', price: '15.00', discount: '', note: 'fine quality', amount: '' }));
  await acts.lineSave(); await waitToasts();
  assert.equal(dom.toasts.filter((x) => x.error).length, 0, JSON.stringify(dom.toasts));
  assert.equal(S.cart.lines.length, 1);
  assert.deepEqual([S.cart.lines[0].qty, S.cart.lines[0].unit, S.cart.lines[0].price, S.cart.lines[0].note], [250000, 'g', 1500, 'fine quality']);
  const html = await M.pos();                                // renders the cart with the line + live total
  assert.match(html, /Plaster of Paris/); assert.match(html, /Rs\. 3\.75/); assert.match(html, /fine quality/);
  // "Rs 15 worth" mode
  dom.reg.set('#lineForm', form({ pid: poppy.id, idx: '', mode: 'amt' }, { qty: '1', unit: 'kg', price: '15.00', discount: '', note: '', amount: '15' }));
  await acts.lineSave();
  assert.equal(S.cart.lines[1].amount, 1500);
  const pv = shop.preview({ lines: S.cart.lines.map((l) => ({ productId: l.productId, unit: l.unit, price: l.price, ...(l.amount != null ? { amount: l.amount } : { qty: l.qty }) })) });
  assert.equal(pv.calc.total, 375 + 1500); assert.equal(pv.lines[1].baseQty, 1000);
  // finalize
  S.cart.pay = { cash: '18.75' };
  await acts.finalize(); await waitToasts();
  const [sale] = await shop.sales();
  assert.equal(sale.total, 1875); assert.equal(sale.credit, 0);
});

test('preview never throws: bad lines come back as {error}', async () => {
  const { shop, poppy } = await shopWith(1500);
  assert.match(shop.preview({ lines: [{ productId: 'nope', qty: 1000 }] }).error, /not found/i);
  assert.match(shop.preview({ lines: [{ productId: poppy.id, qty: 0 }] }).error, /greater than zero/);
  assert.match(shop.preview({ lines: [] }).error, /at least one/i);
  assert.ok(shop.preview({ lines: [{ productId: poppy.id, qty: 1000 }] }).calc.total === 1500);
  shop.role = 'salesman';
  assert.match(shop.preview({ lines: [{ productId: poppy.id, qty: 1000, price: 100 }] }).error, /not allowed to change prices/);
});

test('estimate keeps quoted amounts when converted (even for old-style estimates)', async () => {
  const { shop, poppy } = await shopWith(1500);
  const est = await shop.saveEstimate({ lines: [{ productId: poppy.id, unit: 'g', qty: 250000 }] });
  const sale = await shop.convertEstimate(est.id, { payments: [{ account: 'cash', amount: 375 }] });
  assert.equal(sale.total, 375);
});

// ---------- 3. Khata entry ----------
test('Khata Entry: customer details + items with notes + live total, saved as udhaar', async () => {
  const { shop, poppy, bulb } = await shopWith(1500);
  S.khata = { name: '', phone: '', address: '', customerId: '', lines: [], paidNow: '', priceMode: 'retail', note: '' };
  const html = await KH.khataScreen();
  for (const w of ['name', 'phone', 'address']) assert.match(html, new RegExp(`name="${w}"`));
  // live total after each item
  const add = async (pid, vals) => {
    acts.khAdd({ dataset: { id: pid } });
    dom.reg.set('#lineForm', form({ pid, idx: '', mode: 'qty' }, { discount: '', amount: '', ...vals }));
    await acts.lineSave();
  };
  await add(poppy.id, { qty: '250', unit: 'g', price: '15.00', note: '2 bags' });
  assert.equal(KH.khataTotals(shop, S.khata).total, 375);
  await add(bulb.id, { qty: '2', unit: 'pc', price: '250.00', note: 'Philips 12W' });
  assert.equal(KH.khataTotals(shop, S.khata).total, 375 + 50000);
  assert.equal(S.khata.lines.length, 2);
  // customer typed in
  S.khata.name = 'Haji Bashir'; S.khata.phone = '0300-5551234'; S.khata.address = 'Gulshan Colony, Lahore'; S.khata.paidNow = '100';
  const tt = KH.khataTotals(shop, S.khata);
  assert.deepEqual([tt.total, tt.paid, tt.prev, tt.newBalance], [50375, 10000, 0, 40375]);
  await acts.khSave(); await waitToasts();
  assert.equal(dom.toasts.filter((x) => x.error).length, 0, JSON.stringify(dom.toasts));
  const cust = shop.findCustomer({ phone: '03005551234' });
  assert.deepEqual([cust.name, cust.address], ['Haji Bashir', 'Gulshan Colony, Lahore']);
  assert.equal(shop.balance('customer', cust.id), 40375);
  const [sale] = await shop.sales();
  assert.deepEqual(sale.lines.map((l) => l.note), ['2 bags', 'Philips 12W']);
  assert.ok(JSON.stringify(receiptRows(shop, sale, (k) => k, 'en')).includes('Philips 12W'));     // note is on the receipt
  assert.equal(S.khata.lines.length, 0);                                                              // screen reset
});

test('Khata Entry: existing customer is recognised by phone, previous balance + new total update live', async () => {
  const { shop, poppy } = await shopWith(1500);
  const c = await shop.saveCustomer({ name: 'Ali', phone: '0311-1112222', address: 'Model Town', openingBalance: 100000 });
  S.khata = { name: '', phone: '0311 1112222', address: '', customerId: '', lines: [], paidNow: '', priceMode: 'retail', note: '' };
  chg.khataLookup({ name: 'phone', value: '0311 1112222' });
  assert.equal(S.khata.customerId, c.id); assert.equal(S.khata.name, 'Ali'); assert.equal(S.khata.address, 'Model Town');
  S.khata.lines.push({ productId: poppy.id, unit: 'kg', qty: 2000, price: 1500, discount: 0, note: '' });
  const tt = KH.khataTotals(shop, S.khata);
  assert.deepEqual([tt.prev, tt.total, tt.newBalance], [100000, 3000, 103000]);
  ins.khataField({ name: 'name', value: 'Ali Khan' });
  await acts.khSave();
  assert.equal(shop.customers.get(c.id).name, 'Ali Khan'); assert.equal(shop.customers.size, 1);      // updated, not duplicated
  assert.equal(shop.balance('customer', c.id), 103000);
});

test('Khata Entry: name is required; credit limit asks before continuing', async () => {
  const { shop, poppy } = await shopWith(1500);
  S.khata = { name: '', phone: '', address: '', customerId: '', lines: [{ productId: poppy.id, unit: 'kg', qty: 1000, price: 1500, discount: 0, note: '' }], paidNow: '', priceMode: 'retail', note: '' };
  dom.reset(); await acts.khSave(); await waitToasts();
  assert.ok(dom.toasts.some((x) => x.error && /name/i.test(x.text)));
  assert.equal((await shop.sales()).length, 0);
});
