import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceModel } from '../js/invoice_model.js';
import { invoiceRows, layoutRows, paint, renderA4Pages } from '../js/print.js';
import { dict } from '../js/i18n.js';
import { S, acts, sheetHooks } from '../js/ui/ctx.js';
import * as M from '../js/ui/main_screens.js';
import * as K from '../js/ui/stock_screens.js';
import { invoiceHtml, openInvoicePreview } from '../js/ui/invoice_view.js';
import { downloadInvoice, sharePdf, outputEnv } from '../js/ui/output.js';
import { Auth } from '../js/auth.js';
import { mkShop, seed } from './helpers.js';
import { installFakeDom, form } from './fake-dom.js';

const dom = installFakeDom();
const T = (lang) => (k) => dict[lang]?.[k] ?? dict.en[k] ?? k;
async function bill(lang = 'en') {
  const shop = await mkShop(); const ids = await seed(shop);
  const sale = await shop.postSale({ customerId: ids.ali.id, priceMode: 'retail', discount: 500,
    lines: [{ productId: ids.paris.id, unit: 'g', qty: 250000, note: 'fine, 2 bags' }, { productId: ids.bulb.id, qty: 2000, discount: 1000 }], payments: [{ account: 'cash', amount: 20000 }] });
  S.shop = shop; S.lang = lang; S.cart = null; S.khata = null; S.user = { username: 'Ramzan', role: 'admin' }; S.auth = new Auth(shop.store, { iterations: 1000 }); dom.reset();
  return { shop, sale, ...ids };
}

test('invoice content: table headers, items, totals (subtotal, discount, GRAND TOTAL, paid, balance), thank-you and return policy', async () => {
  const { shop, sale } = await bill();
  const m = invoiceModel(shop, sale, T('en'));
  assert.deepEqual(m.heads, ['Item Description', 'Qty', 'Unit Price', 'Total']);
  assert.deepEqual(m.lines.map((l) => [l.desc, l.qty, l.price, l.total, l.note]), [['Paris (Gypsum)', '250 Gram', '60/Kg', '15', 'fine, 2 bags'], ['LED Bulb 12W', '2 Piece', '250/Piece', '490', '']]);
  assert.deepEqual(m.totals.map((x) => [x.label, x.value, !!x.hl]), [['Subtotal', 'Rs. 515', false], ['Discount', '-Rs. 15', false], ['Grand Total', 'Rs. 500', true], ['Paid', 'Rs. 200', false], ['Balance due', 'Rs. 300', false], ['Khata balance', 'Rs. 300', false]]);
  assert.equal(m.totals[2].big, true); assert.equal(m.totals[2].bold, true);
  assert.equal(m.thanks, 'Thank you for your business!'); assert.match(m.policy, /returned or exchanged within 7 days/);
  assert.equal(m.shop.phone, '03006703028'); assert.equal(m.customer.name, 'Ali');
  shop.cfg.returnPolicy = 'No return on cut wire.'; shop.cfg.footer = 'Shukriya, phir tashreef layein!';
  const c = invoiceModel(shop, sale, T('en')); assert.equal(c.policy, 'No return on cut wire.'); assert.equal(c.thanks, 'Shukriya, phir tashreef layein!');
  const ur = invoiceModel(shop, sale, T('ur')); assert.deepEqual(ur.heads, ['Item ki Tafseel', 'Miqdaar', 'Fi Qeemat', 'Total']); assert.equal(ur.totals[2].label, 'Kul Raqam');
});

test('invoice drawing: centred bold header with bottom border, shaded table header, shaded totals box with a big bold grand total, footer', async () => {
  const { shop, sale } = await bill();
  const rows = invoiceRows(shop, sale, T('en'), 'en', { logo: { width: 512, height: 512 } });
  assert.equal(rows[0].t, 'image');
  const head = rows.filter((r) => r.t === 'center').slice(0, 3); assert.equal(head[0].text, 'RAMZAN ELECTRIC STORE & HARDWARE'); assert.equal(head[0].bold, true); assert.ok(head[0].size >= 1.8);
  assert.match(head[1].text, /Rahim Yar Khan/); assert.match(head[2].text, /03006703028/);
  assert.ok(rows.findIndex((r) => r.t === 'rule') > rows.findIndex((r) => r.text === head[2].text));        // subtle border UNDER the header block
  const th = rows.find((r) => r.t === 'thead'); assert.deepEqual(th.cells, ['Item Description', 'Qty', 'Unit Price', 'Total']);
  assert.deepEqual(th.cols.map((c) => Math.round(c * 100)), [46, 16, 19, 19]);
  assert.equal(rows.filter((r) => r.t === 'trow').length, 2); assert.ok(rows.find((r) => r.t === 'trow').cells[0].includes('» fine, 2 bags'));
  const box = rows.find((r) => r.t === 'box'), grand = box.rows.find((r) => r.l === 'Grand Total'); assert.ok(grand.big && grand.bold && grand.hl);
  assert.ok(box.rows.findIndex((r) => r.l === 'Grand Total') > box.rows.findIndex((r) => r.l === 'Subtotal'));
  const tail = rows.filter((r) => r.t === 'center').slice(-2); assert.equal(tail[0].text, 'Thank you for your business!'); assert.match(tail[1].text, /7 days/);
  const lay = layoutRows((f, t) => t.length * 11, rows, 1240, { base: 30, pad: 70 });
  const rects = lay.ops.filter((o) => o.k === 'rect'), lines = lay.ops.filter((o) => o.k === 'line');
  assert.ok(rects.length >= 3);                                                                           // header shading + totals box + grand-total band
  assert.ok(lines.some((o) => o.w === 2 && o.color === '#8fa0b4'));                                       // header bottom border
  const grandText = lay.ops.find((o) => o.k === 'text' && o.text === 'Grand Total'), subText = lay.ops.find((o) => o.k === 'text' && o.text === 'Subtotal');
  assert.ok(/bold/.test(grandText.f) && !/bold/.test(subText.f)); const px = (f) => Number(/(\d+)px/.exec(f)[1]); assert.ok(px(grandText.f) > px(subText.f));          // grand total is bigger
  // paints with a fake canvas, including pagination
  const calls = []; const mk = (w, h) => ({ width: w, height: h, getContext: () => ({ measureText: (t) => ({ width: t.length * 11 }), fillRect: (...a) => calls.push(['fillRect', ...a]), strokeRect: () => calls.push(['strokeRect']), fillText: (...a) => calls.push(['text', a[0]]),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage: () => calls.push(['img']), set font(v) {}, get font() { return ''; } }) });
  const pages = renderA4Pages(mk, rows, 'en'); assert.ok(pages.length >= 1);
  assert.ok(calls.some((c) => c[0] === 'strokeRect') && calls.some((c) => c[0] === 'img') && calls.some((c) => c[0] === 'text' && c[1] === 'Grand Total'));
  void paint;
});

test('on-screen invoice shows the same design (English and Roman Urdu)', async () => {
  const { sale } = await bill('en');
  const h = invoiceHtml(sale);
  for (const w of ['class="inv-head"', '<h1>RAMZAN ELECTRIC STORE &amp; HARDWARE</h1>', '<th class="">Item Description</th>', '<th class="r">Qty</th>', '<th class="r">Unit Price</th>', '<th class="r">Total</th>',
    'class="inv-totals"', 'class="grand', 'Grand Total', 'Rs. 500', 'class="thanks">Thank you for your business!', 'class="policy"', '» fine, 2 bags', 'Noor-e-Wali']) assert.ok(h.includes(w), w);
  S.lang = 'ur'; const r = invoiceHtml(sale); for (const w of ['Item ki Tafseel', 'Kul Raqam', 'Aap ke karobar ka bohat shukriya', '7 din ke andar']) assert.ok(r.includes(w), w);
  const css = (await import('node:fs')).readFileSync('css/app.css', 'utf8');
  for (const sel of ['.inv-head{', '.inv-table th{background', '.inv-totals{', '.inv-totals .grand{', '.inv-foot']) assert.ok(css.includes(sel), sel);
});

test('FINALIZE BILL opens the Invoice Preview with two prominent buttons: Save / Download and Share', async () => {
  const { shop, paris } = await bill();
  M.openLineSheet(shop.products.get(paris.id), null, (S.cart = { customerId: '', priceMode: 'retail', lines: [], discount: '', pay: {}, note: '' }), () => {});
  dom.reg.set('#lineForm', form({ pid: paris.id, idx: '', mode: 'qty' }, { qty: '500', unit: 'g', price: '15.00', discount: '', note: 'loose', amount: '' }));
  await acts.lineSave(); S.cart.pay = { cash: '7.50' };
  dom.reset(); await acts.finalize(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(dom.toasts.filter((x) => x.error).length, 0, JSON.stringify(dom.toasts));
  const [sale] = (await shop.sales()).slice(-1); assert.equal(sale.total, 750);
  const modal = dom.sheets.at(-1);
  for (const w of ['Invoice Preview', 'class="inv"', sale.no, 'Rs. 7.50', 'Item Description', 'Grand Total', 'data-act="invDownload"', 'data-fmt="pdf"', '💾 Save / Download', 'data-act="invShare"', '📤 Share', 'class="inv-actions"', 'Thank you for your business!']) assert.ok(modal.includes(w), w);
  assert.ok(modal.indexOf('invDownload') < modal.indexOf('invShare'));
  assert.ok(!modal.includes('Insufficient') && !/stock/i.test(modal));
  // saving an estimate shows the same preview
  S.cart = { customerId: '', priceMode: 'retail', lines: [{ productId: paris.id, unit: 'kg', qty: 1000, price: 6000, discount: 0, note: '' }], discount: '', pay: {}, note: '' };
  await acts.saveEstimate(); await new Promise((r) => setTimeout(r, 5));
  assert.ok(dom.sheets.at(-1).includes('Invoice Preview') && dom.sheets.at(-1).includes('Estimate #EST-'));
});

function pdfEnv() {
  const downloads = [], blobs = [], opened = [];
  const real = document.createElement; document.createElement = (tag) => { const e = real(tag); if (tag === 'a') e.click = () => downloads.push({ name: e.download, href: e.href }); return e; };
  URL.createObjectURL = (b) => { blobs.push(b); return `blob:${blobs.length}`; }; URL.revokeObjectURL = () => {}; window.open = (u) => opened.push(u);
  const canvas = (w, h) => ({ width: w, height: h, getContext: () => ({ measureText: (t) => ({ width: t.length * 11 }), fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage() {}, set font(v) {}, get font() { return ''; } }),
    toBlob(cb, type) { cb(new Blob([Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])], { type })); } });
  outputEnv.createCanvas = canvas;
  return { downloads, blobs, opened };
}
test('SAVE / DOWNLOAD gives a real PDF (or PNG image) named after the invoice', async () => {
  const { sale } = await bill(); const env = pdfEnv();
  await downloadInvoice(sale, 'pdf');
  assert.equal(env.downloads.length, 1); assert.equal(env.downloads[0].name, `${sale.no}.pdf`);
  assert.equal(env.blobs[0].type, 'application/pdf');
  const bytes = Buffer.from(await env.blobs[0].arrayBuffer()).toString('latin1'); assert.ok(bytes.startsWith('%PDF-1.4') && bytes.trimEnd().endsWith('%%EOF') && /\/Count [1-9]/.test(bytes));
  await downloadInvoice(sale, 'png'); const png = env.downloads.at(-1); assert.match(png.name, new RegExp(`^${sale.no}(-1)?\\.png$`)); assert.equal(env.blobs.at(-1).type, 'image/png');
  assert.ok(dom.toasts.some((x) => /Saved/.test(x.text)));
});
test('SHARE sends the PDF through the phone share sheet, or downloads it and opens WhatsApp for that customer', async () => {
  const { sale } = await bill(); const env = pdfEnv();
  await sharePdf(sale);                                                                                // no Web Share in this browser -> fallback
  assert.equal(env.downloads.at(-1).name, `${sale.no}.pdf`); assert.match(env.opened.at(-1), /^https:\/\/wa\.me\/923001234567\?text=/);
  let shared = null; Object.defineProperty(globalThis, 'navigator', { value: { canShare: () => true, share: async (d) => { shared = d; } }, configurable: true });
  await sharePdf(sale);
  assert.equal(shared.files[0].name, `${sale.no}.pdf`); assert.equal(shared.files[0].type, 'application/pdf'); assert.match(shared.text, /Total: Rs\. 500/);
  delete globalThis.navigator; void sheetHooks;
});

test('bill page = the invoice + Save/Download + Share + Delete (PIN)', async () => {
  const { sale } = await bill();
  const page = await M.saleDetail(sale.id);
  for (const w of ['class="inv"', 'Item Description', 'data-act="invDownload"', 'data-act="invShare"', 'data-act="deleteBill"', 'Profit']) assert.ok(page.includes(w), w);
  assert.ok(!page.includes('Insufficient') && !/>Stock</.test(page));
});

test('CUSTOMER PROFILE: name, phone, address, balance and the full Debit / Credit / Balance ledger update in real time', async () => {
  const { shop, ali, bulb } = await bill();
  await shop.postSale({ customerId: ali.id, lines: [{ productId: bulb.id, qty: 4000 }], payments: [] });                      // Rs 1000 udhaar
  let h = await K.partyDetail('customer', ali.id);
  for (const w of ['class="avatar">A<', '<h2>Ali</h2>', '0300-1234567', 'tel:0300-1234567', 'Account Balance', 'Total Debit', 'Total Credit', '<th class="r">Debit</th>', '<th class="r">Credit</th>', '<th class="r">Balance</th>', 'Receive payment', 'Delete khata']) assert.ok(h.includes(w), w);
  const before = shop.balance('customer', ali.id);                                                                             // Rs 300 + Rs 1000
  assert.equal(before, 130000); assert.ok(h.includes('Rs. 1,300'));
  await shop.saveCustomer({ ...shop.customers.get(ali.id), address: 'House 5, Model Town, Lahore' });
  await shop.receivePayment({ customerId: ali.id, account: 'cash', amount: 30000, note: 'part payment' });
  h = await K.partyDetail('customer', ali.id);
  assert.ok(h.includes('House 5, Model Town, Lahore')); assert.ok(h.includes('Rs. 1,000'));                                   // new balance, instantly
  assert.ok(h.includes('<span class="good">Rs. 300</span>') && h.includes('part payment'));                                    // credit entry
  assert.ok(h.includes('<span class="warn">Rs. 1,000</span>'));                                                                // debit entry
  await shop.receivePayment({ customerId: ali.id, account: 'bank', amount: 100000 });
  h = await K.partyDetail('customer', ali.id); assert.ok(h.includes('<div class="v ">Rs. 0</div>') || h.includes('Rs. 0')); assert.equal(shop.balance('customer', ali.id), 0);
  assert.match(h, /href="#\/sale\/[^"]+">Bikri|href="#\/sale\/[^"]+">Sale/);                                                   // bills open from the ledger
  const list = await K.partyList('customer'); assert.ok(list.includes('Model Town'));
});
