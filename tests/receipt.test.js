import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePdfFromJpegs, invoiceRows, renderRows } from '../js/print.js';
import { S } from '../js/ui/ctx.js';
import { invoiceHtml, openInvoicePreview, printInvoiceHtml, invoiceButtons } from '../js/ui/invoice_view.js';
import { downloadInvoice, outputEnv } from '../js/ui/output.js';
import { dict } from '../js/i18n.js';
import { MemoryStore } from '../js/store.js';
import { Shop } from '../js/db.js';
import { Auth } from '../js/auth.js';
import { mkShop, seed } from './helpers.js';
import { installFakeDom } from './fake-dom.js';

const dom = installFakeDom(), T = (k) => dict.en[k] ?? k;
async function bill() {
  const shop = await mkShop(); const ids = await seed(shop);
  const sale = await shop.postSale({ lines: [{ productId: ids.paris.id, amount: 1500 }, { productId: ids.bulb.id, qty: 2000 }], payments: [{ account: 'cash', amount: 51500 }] });
  S.shop = shop; S.lang = 'en'; S.user = { username: 'o', role: 'admin' }; S.auth = new Auth(shop.store, { iterations: 1000 }); dom.reset();
  return { shop, sale };
}

test('the address is "Noor E Wali, Rahim Yar Khan" by default and old spellings are corrected once', async () => {
  const shop = await mkShop(); assert.equal(shop.cfg.shopAddress, 'Noor E Wali, Rahim Yar Khan');
  const store = new MemoryStore(); await store.batch([{ col: 'settings', obj: { id: 'shopAddress', value: 'Noor-e-Wali, Rahim Yar Khan' } }]);
  const old = await new Shop({ store }).init(); assert.equal(old.cfg.shopAddress, 'Noor E Wali, Rahim Yar Khan');
  const store2 = new MemoryStore(); await store2.batch([{ col: 'settings', obj: { id: 'shopAddress', value: 'My own address' } }]);
  assert.equal((await new Shop({ store: store2 }).init()).cfg.shopAddress, 'My own address');          // custom addresses are never touched
  const { sale } = await bill(); assert.match(invoiceHtml(sale), /<p>Noor E Wali, Rahim Yar Khan<\/p>/);
});

test('receipt is a standard 80 mm roll (302 px): fixed width, compact typography, same in preview / bill page / print', async () => {
  const css = readFileSync('css/app.css', 'utf8');
  const inv = /\.inv\{([^}]*)\}/.exec(css)[1];
  assert.match(inv, /width:302px/); assert.match(inv, /max-width:100%/); assert.match(inv, /font:12px\/1\.35/);
  assert.match(css, /\.inv\.w58\{width:219px/);                                                          // 58 mm roll
  assert.match(css, /\.sheet\.preview\{width:min\(400px,100%\)\}/);                                      // narrow popup that fits the receipt
  assert.match(css, /@media print\{\.inv\{width:80mm;/);
  assert.match(css, /\.inv-head h1\{[^}]*font-size:15px/); assert.match(css, /\.inv-totals \.grand\{[^}]*font-size:14px;font-weight:800/);
  assert.match(css, /\.inv-table\{[^}]*table-layout:fixed/);
  assert.ok(!/\.inv\{[^}]*max-width:760px/.test(css));                                                    // the big paper look is gone
  const { sale } = await bill(); const html = invoiceHtml(sale);
  assert.ok(html.includes('class="inv"') && !html.includes('w58'));
  assert.deepEqual([...html.matchAll(/<col style="width:(\d+)%">/g)].map((m) => Number(m[1])), [42, 18, 20, 20]);
  S.shop.cfg.receiptWidth = '58'; assert.ok(invoiceHtml(sale).includes('class="inv w58"')); S.shop.cfg.receiptWidth = '80';
});

test('the popup is the compact receipt (preview modal uses the narrow sheet)', async () => {
  const { sale } = await bill();
  openInvoicePreview(sale);
  const modal = dom.sheets.at(-1); assert.ok(modal.includes('class="inv"') && modal.includes('Invoice Preview') && modal.includes('invDownload') && modal.includes('invShare'));
  assert.ok(modal.includes('Print receipt (80 mm)') && !modal.includes('Print A4'));
});

test('receipt drawing for PNG / PDF / thermal: 576 px wide (80 mm), one tall image, table + totals box inside', async () => {
  const { shop, sale } = await bill();
  const calls = []; const mk = (w, h) => ({ width: w, height: h, getContext: () => ({ measureText: (t) => ({ width: t.length * 11 }), fillRect: () => calls.push('rect'), strokeRect() {}, fillText: (t) => calls.push(t), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage() {}, set font(v) {}, get font() { return ''; } }) });
  const r = renderRows(mk, invoiceRows(shop, sale, T, 'en'), { widthPx: 576, base: 22 });
  assert.equal(r.canvas.width, 576); assert.ok(r.height > 200 && r.height < 900, `compact height ${r.height}`);
  for (const w of ['RAMZAN ELECTRIC STORE & HARDWARE', 'Noor E Wali, Rahim Yar Khan', 'Qty', 'Total', 'Grand Total']) assert.ok(calls.includes(w), w);
  const has = (w) => calls.includes(w) || w.split(' ').every((x) => calls.includes(x));                    // a header may wrap onto two lines
  for (const w of ['Item Description', 'Unit Price']) assert.ok(has(w), w);
});

test('PDF page fits the receipt: 80 mm wide, height follows the content, JPEG embedded', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = Buffer.from(makePdfFromJpegs([{ jpeg, w: 576, h: 800 }], { widthMm: 80 })).toString('latin1');
  assert.match(pdf, /\/MediaBox \[0 0 226\.77 314\.9[0-9]\]/);                                           // 80 mm x (80 * 800/576) mm
  assert.match(pdf, /q 226\.77 0 0 314\.9[0-9] 0 0\.00 cm \/Im0 Do Q/);
  const a4 = Buffer.from(makePdfFromJpegs([{ jpeg, w: 1240, h: 1754 }])).toString('latin1'); assert.match(a4, /\/MediaBox \[0 0 595\.28 841\.89\]/);   // old default still works
});

test('Save / Download makes a receipt-size PDF and PNG', async () => {
  const { sale } = await bill();
  const downloads = [], blobs = []; const real = document.createElement; document.createElement = (tag) => { const e = real(tag); if (tag === 'a') e.click = () => downloads.push(e.download); return e; };
  URL.createObjectURL = (b) => { blobs.push(b); return 'blob:x'; }; URL.revokeObjectURL = () => {};
  const sizes = []; outputEnv.createCanvas = (w, h) => { sizes.push([w, h]); return { width: w, height: h, getContext: () => ({ measureText: (t) => ({ width: t.length * 11 }), fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage() {}, set font(v) {}, get font() { return ''; } }),
    toBlob(cb, type) { cb(new Blob([Uint8Array.from([0xff, 0xd8, 1, 0xff, 0xd9])], { type })); } }; };
  await downloadInvoice(sale, 'pdf'); await downloadInvoice(sale, 'png');
  assert.deepEqual(downloads, [`${sale.no}.pdf`, `${sale.no}.png`]);
  assert.ok(sizes.some(([w]) => w === 576));                                                              // drawn at 80 mm width
  assert.match(Buffer.from(await blobs[0].arrayBuffer()).toString('latin1'), /\/MediaBox \[0 0 226\.77 /);
  assert.equal(blobs[1].type, 'image/png');
});

test('browser print uses the 80 mm receipt page (no margins, auto height)', async () => {
  const { sale } = await bill(); let html = '';
  window.open = () => ({ document: { write: (h) => { html += h; }, close() {} } });
  printInvoiceHtml(sale);
  for (const w of ['@page{size:80mm auto;margin:0}', 'class="inv"', sale.no, 'Item Description', 'css/app.css', 'print()']) assert.ok(html.includes(w), w);
  S.shop.cfg.receiptWidth = '58'; html = ''; printInvoiceHtml(sale); assert.ok(html.includes('size:58mm auto')); S.shop.cfg.receiptWidth = '80';
  window.open = () => undefined; assert.doesNotThrow(() => printInvoiceHtml(sale));                       // popup blocked: nothing breaks
  void invoiceButtons;
});
