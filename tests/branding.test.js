import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { receiptRows, layoutRows, renderRows, renderA4Pages } from '../js/print.js';
import { S } from '../js/ui/ctx.js';
import * as M from '../js/ui/main_screens.js';
import { settingsScreen } from '../js/ui/settings_screen.js';
import { Auth } from '../js/auth.js';
import { dict } from '../js/i18n.js';
import { mkShop, seed } from './helpers.js';

const pngSize = (f) => { const b = readFileSync(f); assert.equal(b.toString('latin1', 1, 4), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const jpgSize = (f) => { const b = readFileSync(f); assert.equal(b[0], 0xff); let i = 2; while (i < b.length) { if (b[i] === 0xff && b[i + 1] >= 0xc0 && b[i + 1] <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); } };

test('logo, banner and every PWA icon exist with the declared sizes', () => {
  assert.deepEqual(pngSize('img/logo-512.png'), [512, 512]); assert.deepEqual(pngSize('img/logo-256.png'), [256, 256]);
  const [w, h] = jpgSize('img/banner.jpg'); assert.equal(w, 1200); assert.ok(Math.abs(w / h - 1658 / 949) < 0.01, 'banner keeps its shape');
  const m = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
  for (const ic of m.icons) { const [iw, ih] = pngSize(ic.src); assert.equal(`${iw}x${ih}`, ic.sizes, ic.src); }
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
  const html = readFileSync('index.html', 'utf8');
  for (const ref of ['icons/favicon-64.png', 'icons/apple-touch-icon.png']) { assert.ok(html.includes(ref)); assert.ok(existsSync(ref)); }
});

test('offline cache (sw.js) contains the logo, banner and icons', () => {
  const sw = readFileSync('sw.js', 'utf8');
  for (const f of ['img/logo-256.png', 'img/logo-512.png', 'img/banner.jpg', 'icons/icon-192.png', 'icons/maskable-512.png']) assert.ok(sw.includes(`./${f}`), f);
});

test('app shell shows the logo on lock screen, header and sidebar; images used by the code exist', () => {
  const app = readFileSync('js/app.js', 'utf8');
  for (const cls of ['lock-logo', 'top-logo', 'side-logo']) assert.ok(app.includes(cls), cls);
  const used = new Set(); for (const f of ['js/app.js', 'js/ui/main_screens.js', 'js/ui/settings_screen.js', 'js/ui/output.js'])
    for (const m of readFileSync(f, 'utf8').matchAll(/img\/[\w-]+\.(?:png|jpg)/g)) used.add(m[0]);
  assert.ok(used.size >= 3); for (const f of used) assert.ok(existsSync(f), f);
});

test('dashboard shows the contact banner (tap = share) and settings show the shop card + thermal-logo switch', async () => {
  const shop = await mkShop(); await seed(shop); S.shop = shop; S.auth = new Auth(shop.store, { iterations: 1000 }); S.lang = 'en';
  const dash = await M.dashboard();
  assert.match(dash, /<img src="img\/banner\.jpg"/); assert.match(dash, /data-act="shareCard"/); assert.match(dash, /RAMZAN ELECTRIC STORE &amp; HARDWARE/);
  const set = await settingsScreen();
  assert.match(set, /about-logo/); assert.match(set, /03006703028/); assert.match(set, /Rahim Yar Khan/); assert.match(set, /data-k="logoOnThermal"/);
  assert.equal(shop.cfg.logoOnThermal, false);                                   // off by default on thermal paper
  for (const k of ['share_card', 'logo_on_thermal']) assert.ok(dict.en[k] && dict.ur[k]);
});

test('receipts: the shop phone/address from the banner are the defaults and print under the name', async () => {
  const shop = await mkShop(); const { paris } = await seed(shop);
  const sale = await shop.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });
  const txt = JSON.stringify(receiptRows(shop, sale, (k) => k, 'en'));
  assert.match(txt, /Noor-e-Wali, Rahim Yar Khan/); assert.match(txt, /03006703028/);
});

test('logo row: scaled, centred, keeps aspect ratio, painted with drawImage, works on A4 and thermal', async () => {
  const shop = await mkShop(); const { paris } = await seed(shop);
  const sale = await shop.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });
  const logo = { width: 512, height: 512 };
  const rows = receiptRows(shop, sale, (k) => k, 'en', { logo, logoFrac: 0.4 });
  assert.equal(rows[0].t, 'image');
  assert.equal(receiptRows(shop, sale, (k) => k, 'en')[0].t, 'center');            // no logo -> unchanged
  const lay = layoutRows((f, t) => t.length * 10, rows, 576);
  const img = lay.ops[0]; assert.deepEqual([img.k, img.w, img.h, img.x, img.y], ['img', 230, 230, 173, 10]);
  assert.ok(lay.ops.find((o) => o.k === 'text').y > img.y + img.h);                  // text starts below the logo
  const calls = [];
  const mk = (w, h) => ({ width: w, height: h, getContext: () => ({ measureText: (t) => ({ width: t.length * 10 }), fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    drawImage: (...a) => calls.push(a.slice(1)), set font(v) {}, get font() { return ''; } }) });
  renderRows(mk, rows, { widthPx: 576 });
  assert.deepEqual(calls[0], [173, 10, 230, 230]);
  calls.length = 0; renderA4Pages(mk, receiptRows(shop, sale, (k) => k, 'ur', { logo, logoFrac: 0.22 }), 'ur');
  assert.equal(calls.length, 1);
});
