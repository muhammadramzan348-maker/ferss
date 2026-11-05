import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dict } from '../js/i18n.js';
import { UNITS } from '../js/core.js';
import { DEFAULT_CATEGORIES } from '../js/db.js';
import { mkShop, seed } from './helpers.js';

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const ARABIC = /[\u0600-\u06FF]/;

test('Urdu script is gone: the second language is Roman Urdu everywhere', () => {
  for (const f of [...walk('js'), 'index.html', 'css/app.css']) assert.ok(!ARABIC.test(readFileSync(f, 'utf8')), `${f} still contains Urdu script`);
  for (const [k, v] of Object.entries(dict.ur)) assert.ok(!ARABIC.test(v), k);
  for (const [u, n] of Object.entries(UNITS)) assert.ok(!ARABIC.test(n.ur), u);
  for (const [, , ur] of DEFAULT_CATEGORIES) assert.ok(!ARABIC.test(ur));
  const different = Object.keys(dict.en).filter((k) => dict.en[k] !== dict.ur[k]).length;
  assert.ok(different > 250, `Roman Urdu translations present for ${different} strings`);
  assert.equal(dict.ur.today_sales, 'Aaj ki bikri'); assert.equal(dict.ur.unit_pc, 'Adad'); assert.equal(dict.ur.unit_kg, 'Kilo');
});

test('layout stays left-to-right in Roman Urdu', () => {
  const app = readFileSync('js/app.js', 'utf8');
  assert.ok(/documentElement\.dir = 'ltr'/.test(app)); assert.ok(!/rtl/.test(app));
  assert.ok(!/dir="rtl"/.test(walk('js').map((f) => readFileSync(f, 'utf8')).join('')));
});

test('WhatsApp reminders are written in Roman Urdu', async () => {
  const shop = await mkShop(); const { bulb, ali } = await seed(shop);
  await shop.postSale({ customerId: ali.id, lines: [{ productId: bulb.id, qty: 4000 }] });
  const txt = shop.reminderText(ali.id, 'ur');
  assert.match(txt, /Assalam o Alaikum Ali/); assert.match(txt, /Rs\. 1,000/); assert.match(txt, /baqi hain/); assert.ok(!ARABIC.test(txt));
  const stool = await shop.saveRentalItem({ name: 'Stool', total: 5, rate: 5000 });
  const r = await shop.checkoutRental({ customerName: 'Bashir', items: [{ itemId: stool.id, qty: 2 }] });
  assert.match(shop.rentalReminderText(r, 'ur'), /kiraye ka saman \(2 x Stool\)/);
});

test('old Urdu-script category names are switched to Roman Urdu automatically', async () => {
  const { MemoryStore } = await import('../js/store.js'); const { Shop } = await import('../js/db.js');
  const store = new MemoryStore();
  await store.batch([{ col: 'categories', obj: { id: 'cat-hardware', nameEn: 'Hardware & Tools', nameUr: '\u06C1\u0627\u0631\u0688\u0648\u06CC\u0626\u0631' } }]);
  const shop = await new Shop({ store }).init();
  assert.equal(shop.categories.get('cat-hardware').nameUr, 'Hardware aur Auzaar');
});
