import { MemoryStore } from '../js/store.js';
import { Shop } from '../js/db.js';

export const T0 = Date.UTC(2026, 10, 1, 7, 0); // 1 Nov 2026 12:00 PKT
export async function mkShop({ code = 'A', store = new MemoryStore(), clock = { t: T0 } } = {}) {
  let n = 0;
  const shop = new Shop({ store, now: () => clock.t, uid: () => `${code}-id${++n}-${Math.random().toString(36).slice(2, 6)}` });
  await shop.init();
  if (code !== 'A') await shop.setDeviceCode(code);
  shop.clock = clock;
  return shop;
}
export async function seed(shop) {
  const paris = await shop.saveProduct({ name: 'Paris (Gypsum)', nameUr: 'Paris Powder', baseUnit: 'kg', sellUnit: 'kg',
    units: [{ unit: 'g', num: 1, den: 1000 }], retailPrice: 6000, wholesalePrice: 5500, category: 'cat-building', costPrice: 4500 });   // cost Rs 45 per kg
  const bulb = await shop.saveProduct({ name: 'LED Bulb 12W', baseUnit: 'pc', sellUnit: 'pc', units: [{ unit: 'dozen', num: 12, den: 1 }],
    retailPrice: 25000, category: 'cat-electric', costPrice: 18000 });   // cost Rs 180 per piece
  const wire = await shop.saveProduct({ name: 'Wire 3/29', baseUnit: 'm', sellUnit: 'm', units: [{ unit: 'ft', num: 381, den: 1250 }],
    retailPrice: 5000, category: 'cat-electric', costPrice: 3500 });   // cost Rs 35 per meter
  const ali = await shop.saveCustomer({ name: 'Ali', phone: '0300-1234567', creditLimit: 500000 });
  const sup = await shop.saveSupplier({ name: 'Wholesaler', phone: '0311-7654321' });
  return { paris, bulb, wire, ali, sup };
}
