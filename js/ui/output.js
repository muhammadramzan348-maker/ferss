// Browser-only output: thermal print, PDF + WhatsApp share, A4 print. Failures never affect saved bills.
import { receiptRows, invoiceRows, renderRows, escposRaster, rawbtUrl, printViaBluetooth, printCanvasInBrowser,
  makePdfFromJpegs, shareFile, canvasToBlob, paperPx } from '../print.js';
import { waLink } from '../core.js';
import { S, t, toast, attempt } from './ctx.js';

const defaultCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
/** replaceable in tests (there is no real canvas in Node) */
export const outputEnv = { createCanvas: defaultCanvas, toBlob: (...a) => canvasToBlob(...a) };
const mkCanvas = (w, h) => outputEnv.createCanvas(w, h);
export const printMethod = () => localStorage.getItem('printMethod') || 'rawbt';
let logoImg = null;
/** The shop logo as an <img> for the canvas receipts (null if it cannot be loaded - printing still works). */
export function loadLogo() {
  if (logoImg) return Promise.resolve(logoImg);
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((res) => { const i = new Image(); i.onload = () => { logoImg = i; res(i); }; i.onerror = () => res(null); i.src = 'img/logo-512.png'; });
}
/** Share the contact banner (shop card) through the phone's share sheet, e.g. WhatsApp. */
export function shareShopCard() {
  return attempt(async () => {
    const blob = await (await fetch('img/banner.jpg')).blob(), file = new File([blob], 'Ramzan-Electric-Store.jpg', { type: 'image/jpeg' });
    const text = `${S.shop.cfg.shopName}\n${S.shop.cfg.shopPhone}\n${S.shop.cfg.shopAddress}`;
    if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], text, title: S.shop.cfg.shopName });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  });
}

export function thermalPrint(sale) {
  return attempt(async () => {
    const wmm = S.shop.cfg.receiptWidth || '80', px = paperPx(wmm);
    const logo = S.shop.cfg.logoOnThermal ? await loadLogo() : null;
    const rows = wmm === '58' ? receiptRows(S.shop, sale, t, S.lang, { logo, logoFrac: 0.4 }) : invoiceRows(S.shop, sale, t, S.lang, { logo, logoFrac: 0.3 });   // 80 mm: the same table receipt as on screen
    const r = renderRows(mkCanvas, rows, { widthPx: px, lang: S.lang });
    const m = printMethod();
    if (m === 'browser') return printCanvasInBrowser(r.canvas, Number(wmm));
    const img = r.ctx.getImageData(0, 0, r.width, r.height);
    const bytes = escposRaster(img.data, r.width, r.height);
    if (m === 'bluetooth') { await printViaBluetooth(bytes); toast(t('printed')); } else { location.href = rawbtUrl(bytes); }
  });
}
/** One tap: build a PDF of the bill (80 mm receipt page) and open the phone's share sheet (choose WhatsApp). */
export function sharePdf(sale) {
  return attempt(async () => {
    const c = await invoiceCanvas(sale);
    const jpeg = new Uint8Array(await (await outputEnv.toBlob(c)).arrayBuffer());
    const blob = new Blob([makePdfFromJpegs([{ jpeg, w: c.width, h: c.height }], { widthMm: 80 })], { type: 'application/pdf' });
    const cust = sale.customerId ? S.shop.customers.get(sale.customerId) : null;
    const res = await shareFile({ blob, filename: `${sale.no}.pdf`, text: S.shop.invoiceText(sale, S.lang), phone: cust?.phone || '' });
    if (res === 'downloaded') toast(t('pdf_saved_wa'));
  });
}
export const whatsappText = (sale) => {
  const cust = sale.customerId ? S.shop.customers.get(sale.customerId) : null;
  window.open(waLink(cust?.phone || '', S.shop.invoiceText(sale, S.lang)), '_blank');
};

/** the bill as ONE compact 80 mm receipt image (576 px wide) */
export async function invoiceCanvas(sale) {
  return renderRows(mkCanvas, invoiceRows(S.shop, sale, t, S.lang, { logo: await loadLogo(), logoFrac: 0.2 }), { widthPx: 576, lang: S.lang, base: 22 }).canvas;
}
export function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/** "Save / Download": a PDF (80 mm receipt page) or a PNG image of the bill. */
export function downloadInvoice(sale, fmt = 'pdf') {
  return attempt(async () => {
    const c = await invoiceCanvas(sale);
    if (fmt === 'png') saveBlob(await outputEnv.toBlob(c, 'image/png'), `${sale.no}.png`);
    else {
      const jpeg = new Uint8Array(await (await outputEnv.toBlob(c)).arrayBuffer());
      saveBlob(new Blob([makePdfFromJpegs([{ jpeg, w: c.width, h: c.height }], { widthMm: 80 })], { type: 'application/pdf' }), `${sale.no}.pdf`);
    }
    toast(t('saved'));
    return fmt;
  });
}
