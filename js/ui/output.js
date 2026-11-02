// Browser-only output: thermal print, PDF + WhatsApp share, A4 print. Failures never affect saved bills.
import { receiptRows, renderRows, renderA4Pages, escposRaster, rawbtUrl, printViaBluetooth, printCanvasInBrowser,
  makePdfFromJpegs, shareFile, canvasToBlob, paperPx } from '../print.js';
import { waLink } from '../core.js';
import { S, t, toast, attempt } from './ctx.js';

const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export const printMethod = () => localStorage.getItem('printMethod') || 'rawbt';

export function thermalPrint(sale) {
  return attempt(async () => {
    const wmm = S.shop.cfg.receiptWidth || '80', px = paperPx(wmm);
    const r = renderRows(mkCanvas, receiptRows(S.shop, sale, t, S.lang), { widthPx: px, lang: S.lang });
    const m = printMethod();
    if (m === 'browser') return printCanvasInBrowser(r.canvas, Number(wmm));
    const img = r.ctx.getImageData(0, 0, r.width, r.height);
    const bytes = escposRaster(img.data, r.width, r.height);
    if (m === 'bluetooth') { await printViaBluetooth(bytes); toast(t('printed')); } else { location.href = rawbtUrl(bytes); }
  });
}
export function a4Print(sale) {
  return attempt(async () => {
    const pages = renderA4Pages(mkCanvas, receiptRows(S.shop, sale, t, S.lang), S.lang);
    const w = window.open('', '_blank');
    w.document.write(`<html><head><style>@page{size:A4;margin:0}body{margin:0}img{width:100%;display:block;page-break-after:always}</style></head><body>${pages.map((p) => `<img src="${p.toDataURL('image/jpeg', 0.92)}">`).join('')}<script>onload=()=>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
  });
}
/** One tap: build a PDF of the bill and open the phone's share sheet (choose WhatsApp). */
export function sharePdf(sale) {
  return attempt(async () => {
    const pages = renderA4Pages(mkCanvas, receiptRows(S.shop, sale, t, S.lang), S.lang);
    const jp = [];
    for (const c of pages) jp.push({ jpeg: new Uint8Array(await (await canvasToBlob(c)).arrayBuffer()), w: c.width, h: c.height });
    const blob = new Blob([makePdfFromJpegs(jp)], { type: 'application/pdf' });
    const cust = sale.customerId ? S.shop.customers.get(sale.customerId) : null;
    const res = await shareFile({ blob, filename: `${sale.no}.pdf`, text: S.shop.invoiceText(sale, S.lang), phone: cust?.phone || '' });
    if (res === 'downloaded') toast(t('pdf_saved_wa'));
  });
}
export const whatsappText = (sale) => {
  const cust = sale.customerId ? S.shop.customers.get(sale.customerId) : null;
  window.open(waLink(cust?.phone || '', S.shop.invoiceText(sale, S.lang)), '_blank');
};
