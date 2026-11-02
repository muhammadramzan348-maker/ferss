import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../js/store.js';
import { Sync } from '../js/sync.js';
import { mkShop, seed } from './helpers.js';
import { mockSupabase } from './mock-supabase.js';

async function device(code, srv, clock) {
  const shop = await mkShop({ code, clock });
  const sync = new Sync(shop, { fetchFn: srv.fetchFn });
  await sync.saveConfig({ url: 'https://x.supabase.co', anon: 'anon', email: 'o@x.pk' });
  await sync.signIn('o@x.pk', 'secret');
  return { shop, sync };
}
const sale = (s, pid, qty, cash) => s.postSale({ lines: [{ productId: pid, qty }], payments: cash ? [{ account: 'cash', amount: cash }] : [] });

test('sign-in fails with wrong password; sync before sign-in reports an error but loses nothing', async () => {
  const srv = mockSupabase(), shop = await mkShop(), sync = new Sync(shop, { fetchFn: srv.fetchFn });
  await sync.saveConfig({ url: 'https://x.supabase.co', anon: 'a' });
  await assert.rejects(sync.signIn('o@x.pk', 'bad'));
  assert.match((await sync.syncNow()).error, /Sign in/);
});

test('phone A data appears on phone B (products, stock, customers)', async () => {
  const srv = mockSupabase(), clock = { t: Date.UTC(2026, 10, 1, 7) };
  const A = await device('A', srv, clock), B = await device('B', srv, clock);
  const { paris, ali } = await seed(A.shop);
  assert.equal((await A.sync.syncNow()).error, null);
  const rb = await B.sync.syncNow();
  assert.equal(rb.error, null); assert.ok(rb.pulled > 0);
  assert.equal(B.shop.products.size, 3);
  assert.equal(B.shop.stockOf(paris.id).qty, 10000);
  assert.equal(B.shop.customers.get(ali.id).name, 'Ali');
});

test('TWO PHONES SELL OFFLINE: after sync both show identical stock, cash and khata (nothing lost)', async () => {
  const srv = mockSupabase(), clock = { t: Date.UTC(2026, 10, 1, 7) };
  const A = await device('A', srv, clock), B = await device('B', srv, clock);
  const { paris, bulb, ali } = await seed(A.shop);
  await A.sync.syncNow(); await B.sync.syncNow();

  srv.state.down = true;                                       // both phones lose internet
  clock.t += 1000; await A.shop.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });
  clock.t += 1000; await sale(A.shop, bulb.id, 2000, 0).catch(() => {});   // walk-in credit -> rejected, must not leave junk
  clock.t += 1000; await B.shop.postSale({ customerId: ali.id, lines: [{ productId: paris.id, qty: 2000 }, { productId: bulb.id, qty: 4000 }], payments: [{ account: 'cash', amount: 10000 }] });
  assert.match((await A.sync.syncNow()).error, /network/);
  assert.ok((await A.shop.store.all('outbox')).length > 0);   // still queued

  srv.state.down = false;
  assert.equal((await A.sync.syncNow()).error, null);
  assert.equal((await B.sync.syncNow()).error, null);
  assert.equal((await A.sync.syncNow()).error, null);          // A picks up B's work

  for (const d of [A, B]) {
    assert.equal(d.shop.stockOf(paris.id).qty, 10000 - 250 - 2000);
    assert.equal(d.shop.stockOf(bulb.id).qty, 120000 - 4000);
    assert.equal(d.shop.accountBalance('cash'), 1500 + 10000);
    assert.equal(d.shop.balance('customer', ali.id), 12000 + 100000 - 10000);   // Rs 120 paris + Rs 1000 bulbs - paid
  }
  assert.equal((await A.shop.store.all('sales')).length, 2);
  assert.equal((await B.shop.store.all('sales')).length, 2);
  const nos = (await A.shop.store.all('sales')).map((s) => s.no).sort();
  assert.deepEqual(nos, ['RES-2026-A000001', 'RES-2026-B000001']);              // numbers never collide
  assert.equal((await A.shop.store.all('outbox')).length, 0);
});

test('sync is idempotent and does not re-download own rows', async () => {
  const srv = mockSupabase(), clock = { t: Date.UTC(2026, 10, 1, 7) };
  const A = await device('A', srv, clock); await seed(A.shop);
  await A.sync.syncNow();
  const again = await A.sync.syncNow();
  assert.deepEqual([again.pushed, again.pulled, again.error], [0, 0, null]);
});

test('same item edited on both phones: latest edit wins; older edit does not overwrite', async () => {
  const srv = mockSupabase(), clock = { t: Date.UTC(2026, 10, 1, 7) };
  const A = await device('A', srv, clock), B = await device('B', srv, clock);
  const { paris } = await seed(A.shop);
  await A.sync.syncNow(); await B.sync.syncNow();
  clock.t += 1000; await A.shop.saveProduct({ ...A.shop.products.get(paris.id), retailPrice: 7000 });
  clock.t += 5000; await B.shop.saveProduct({ ...B.shop.products.get(paris.id), retailPrice: 6500 });   // later edit
  await A.sync.syncNow(); await B.sync.syncNow(); await A.sync.syncNow();
  assert.equal(A.shop.products.get(paris.id).retailPrice, 6500);
  assert.equal(B.shop.products.get(paris.id).retailPrice, 6500);
});

test('server error keeps outbox and local data; next sync succeeds', async () => {
  const srv = mockSupabase({ failPush: true }), clock = { t: Date.UTC(2026, 10, 1, 7) };
  const A = await device('A', srv, clock); await seed(A.shop);
  const n = (await A.shop.store.all('outbox')).length;
  const r = await A.sync.syncNow();
  assert.match(r.error, /Upload failed/);
  assert.equal((await A.shop.store.all('outbox')).length, n);
  srv.state.failPush = false;
  assert.equal((await A.sync.syncNow()).error, null);
  assert.equal((await A.shop.store.all('outbox')).length, 0);
});

test('a cancelled bill on one phone reaches the other', async () => {
  const srv = mockSupabase(), clock = { t: Date.UTC(2026, 10, 1, 7) };
  const A = await device('A', srv, clock), B = await device('B', srv, clock);
  const { paris } = await seed(A.shop);
  const s = await A.shop.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });
  await A.sync.syncNow(); await B.sync.syncNow();
  assert.equal(B.shop.stockOf(paris.id).qty, 9750);
  clock.t += 1000; await A.shop.cancelSale(s.id, 'oops');
  await A.sync.syncNow(); await B.sync.syncNow();
  assert.equal(B.shop.stockOf(paris.id).qty, 10000);
  assert.equal(B.shop.accountBalance('cash'), 0);
  assert.equal((await B.shop.store.get('sales', s.id)).status, 'cancelled');
});
