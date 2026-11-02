import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptRows, layoutRows, paint, renderRows, escposRaster, makePdfFromJpegs, renderA4Pages, rawbtUrl, toBase64 } from '../js/print.js';
import { mkShop, seed } from './helpers.js';

const L = (k) => k;
const measure = (f, t) => t.length * 11;                       // fake: 11px per character
function fakeCanvas(w, h) {
  const calls = [];
  const ctx = { calls, measureText: (t) => ({ width: t.length * 11 }), fillRect: (...a) => calls.push(['rect', ...a]), fillText: (...a) => calls.push(['text', ...a]),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, set font(v) {}, get font() { return ''; } };
  return { width: w, height: h, getContext: () => ctx, ctx };
}

test('receipt rows contain shop name, items, totals, and Urdu names in Urdu mode', async () => {
  const s = await mkShop(); const { paris } = await seed(s);
  const sale = await s.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1000 }], customerId: [...s.customers.keys()][0] });
  const en = JSON.stringify(receiptRows(s, sale, L, 'en')), ur = JSON.stringify(receiptRows(s, sale, L, 'ur'));
  assert.match(en, /RAMZAN ELECTRIC STORE & HARDWARE/); assert.match(en, /Paris \(Gypsum\)/); assert.match(en, /Rs\. 15/);
  assert.match(en, /balance_due/);                         // Rs 5 left on udhaar
  assert.match(ur, /پیرس/);
});

test('layout wraps long text, right-aligns amounts, and RTL mirrors the sides', () => {
  const rows = [{ t: 'text', text: 'word '.repeat(40) }, { t: 'lr', l: 'Total', r: 'Rs. 99' }, { t: 'line' }, { t: 'center', text: 'Hi' }];
  const en = layoutRows(measure, rows, 384, { lang: 'en' }), ur = layoutRows(measure, rows, 384, { lang: 'ur' });
  const texts = en.ops.filter((o) => o.k === 'text');
  assert.ok(texts.filter((o) => o.text.startsWith('word')).length > 3);              // wrapped
  assert.ok(texts.every((o) => measure('', o.text) <= 384));
  assert.equal(en.ops.find((o) => o.text === 'Rs. 99').align, 'right');
  assert.equal(ur.ops.find((o) => o.text === 'Rs. 99').align, 'left');                // mirrored
  assert.equal(ur.ops.find((o) => o.text === 'Total').align, 'right');
  assert.ok(en.height > 100);
});

test('renderRows paints onto a canvas (fake) without errors', async () => {
  const s = await mkShop(); const { paris } = await seed(s);
  const sale = await s.postSale({ lines: [{ productId: paris.id, amount: 1500 }], payments: [{ account: 'cash', amount: 1500 }] });
  const r = renderRows(fakeCanvas, receiptRows(s, sale, L, 'en'), { widthPx: 576 });
  assert.ok(r.ctx.calls.filter((c) => c[0] === 'text').length > 8);
  assert.equal(r.canvas.width, 576);
  const pages = renderA4Pages(fakeCanvas, receiptRows(s, sale, L, 'ur'), 'ur');
  assert.ok(pages.length >= 1);
});

test('ESC/POS raster: header, bytes per row, black pixel becomes a set bit, banding, cut', () => {
  const w = 16, h = 2, px = new Uint8Array(w * h * 4).fill(255);
  px.set([0, 0, 0, 255], 0);                                   // pixel (0,0) black
  const b = escposRaster(px, w, h);
  assert.deepEqual([...b.slice(0, 2)], [0x1b, 0x40]);          // init
  assert.deepEqual([...b.slice(2, 10)], [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0]);   // GS v 0, 2 bytes wide, 2 rows
  assert.equal(b[10], 0x80); assert.equal(b[11], 0x00);        // first byte: leftmost bit set
  assert.deepEqual([...b.slice(-4)], [0x1d, 0x56, 0x42, 0]);   // cut
  const tall = escposRaster(new Uint8Array(8 * 300 * 4).fill(255), 8, 300);
  const headers = [...tall].reduce((n, v, i, a) => n + (v === 0x1d && a[i + 1] === 0x76 && a[i + 2] === 0x30 ? 1 : 0), 0);
  assert.equal(headers, 3);                                    // 300 rows -> 128 + 128 + 44
  assert.match(rawbtUrl(b), /^rawbt:base64,/);
  assert.equal(toBase64(Uint8Array.from([72, 105])), 'SGk=');
});

test('PDF writer: valid structure, correct xref offsets, page count, embedded JPEG bytes', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = makePdfFromJpegs([{ jpeg, w: 1240, h: 1754 }, { jpeg, w: 1240, h: 900 }]);
  const txt = Buffer.from(pdf).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4')); assert.ok(txt.trimEnd().endsWith('%%EOF'));
  assert.match(txt, /\/Count 2/);
  const sx = Number(/startxref\n(\d+)/.exec(txt)[1]);
  assert.ok(txt.slice(sx).startsWith('xref'));
  const entries = [...txt.slice(sx).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  assert.equal(entries.length, 8);                              // objects 1..8
  entries.forEach((off, i) => assert.ok(txt.slice(off).startsWith(`${i + 1} 0 obj`), `xref offset of object ${i + 1}`));
  assert.ok(Buffer.from(pdf).includes(Buffer.from(jpeg)));
});
