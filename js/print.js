// Receipts & invoices. One layout engine renders to <canvas>, so English AND Urdu print the same
// everywhere: as an image for thermal printers (ESC/POS raster), a JPEG inside a PDF, or via browser print.
import { fmtRs, fmtQty, fmtDateTime, waLink, esc } from './core.js';

// ---------- document rows (language-independent structure) ----------
/** L(key) -> label. Returns rows consumed by layoutRows(). */
export function receiptRows(shop, sale, L, lang = 'en', { logo = null, logoFrac = 0.3 } = {}) {
  const cfg = shop.cfg, ur = lang === 'ur';
  const cust = sale.customerId ? shop.customers.get(sale.customerId) : null;
  const rows = [];
  if (logo) rows.push({ t: 'image', img: logo, frac: logoFrac });
  rows.push({ t: 'center', text: cfg.shopName, size: 1.5, bold: true });
  if (cfg.shopAddress) rows.push({ t: 'center', text: cfg.shopAddress, size: 0.85 });
  if (cfg.shopPhone) rows.push({ t: 'center', text: `${L('phone')}: ${cfg.shopPhone}`, size: 0.85 });
  rows.push({ t: 'line' });
  rows.push({ t: 'lr', l: sale.type === 'estimate' ? L('estimate') : L('invoice'), r: sale.no, bold: true });
  rows.push({ t: 'lr', l: L('date'), r: fmtDateTime(sale.at) });
  if (cust) rows.push({ t: 'lr', l: L('customer'), r: cust.name });
  if (sale.status === 'cancelled') rows.push({ t: 'center', text: '*** CANCELLED ***', bold: true });
  rows.push({ t: 'line' });
  for (const l of sale.lines) {
    rows.push({ t: 'text', text: `${ur && l.nameUr ? l.nameUr : l.name}${l.size ? ' ' + l.size : ''}`, bold: true });
    const unit = L(`unit_${l.unit}`);
    if (l.note) rows.push({ t: 'text', text: `» ${l.note}`, size: 0.85 });
    rows.push({ t: 'lr', l: `${fmtQty(l.qty)} ${unit} × ${fmtRs(l.price, { sym: false })}/${L(`unit_${l.priceUnit || l.unit}`)}`, r: fmtRs(l.gross, { sym: false }), size: 0.9 });
    if (l.discount) rows.push({ t: 'lr', l: L('discount'), r: `-${fmtRs(l.discount, { sym: false })}`, size: 0.9 });
  }
  rows.push({ t: 'line' });
  if (sale.discount) rows.push({ t: 'lr', l: L('bill_discount'), r: `-${fmtRs(sale.discount, { sym: false })}` });
  rows.push({ t: 'lr', l: L('total'), r: fmtRs(sale.total), bold: true, size: 1.2 });
  if (sale.type !== 'estimate') {
    rows.push({ t: 'lr', l: L('paid'), r: fmtRs(sale.paid) });
    if (sale.credit) rows.push({ t: 'lr', l: L('balance_due'), r: fmtRs(sale.credit), bold: true });
    if (cust) rows.push({ t: 'lr', l: L('khata_balance'), r: fmtRs(shop.balance('customer', cust.id)) });
  }
  rows.push({ t: 'line' });
  rows.push({ t: 'center', text: cfg.footer || '', size: 0.85 });
  rows.push({ t: 'space', h: 24 });
  return rows;
}

// ---------- layout (pure; measure(font,text) injected so it is testable) ----------
export const FONT = '"Segoe UI",Roboto,Arial,sans-serif';
export function layoutRows(measure, rows, W, { base = 22, pad = 10, lang = 'en' } = {}) {
  const ur = false, ops = [];                 // Roman Urdu is left-to-right, same layout as English
  let y = pad;
  const font = (r) => `${r.bold ? 'bold ' : ''}${Math.round(base * (r.size || 1))}px ${FONT}`;
  const wrap = (f, text, maxW) => {
    const words = String(text).split(/\s+/), out = []; let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (measure(f, t) > maxW && cur) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  for (const r of rows) {
    const f = font(r), lh = Math.round(base * (r.size || 1) * 1.35), inner = W - 2 * pad;
    if (r.t === 'line') { ops.push({ k: 'line', y: y + 6, x1: pad, x2: W - pad }); y += 14; }
    else if (r.t === 'space') y += r.h;
    else if (r.t === 'image') { const w = Math.round(W * r.frac), h = Math.round((w * r.img.height) / r.img.width); ops.push({ k: 'img', img: r.img, x: Math.round((W - w) / 2), y, w, h }); y += h + 8; }
    else if (r.t === 'center') for (const ln of wrap(f, r.text, inner)) { ops.push({ k: 'text', f, text: ln, x: W / 2, y: y + lh * 0.8, align: 'center' }); y += lh; }
    else if (r.t === 'text') for (const ln of wrap(f, r.text, inner)) { ops.push({ k: 'text', f, text: ln, x: ur ? W - pad : pad, y: y + lh * 0.8, align: ur ? 'right' : 'left' }); y += lh; }
    else if (r.t === 'lr') {
      const rw = measure(f, r.r), lines = wrap(f, r.l, inner - rw - 12);
      lines.forEach((ln, i) => {
        ops.push({ k: 'text', f, text: ln, x: ur ? W - pad : pad, y: y + lh * 0.8, align: ur ? 'right' : 'left' });
        if (i === lines.length - 1) ops.push({ k: 'text', f, text: r.r, x: ur ? pad : W - pad, y: y + lh * 0.8, align: ur ? 'left' : 'right' });
        y += lh;
      });
    }
  }
  return { ops, height: y + pad };
}
export function paint(ctx, layout, W, rtl = false) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, layout.height);
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.textBaseline = 'alphabetic';
  for (const o of layout.ops) {
    if (o.k === 'line') { ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(o.x1, o.y); ctx.lineTo(o.x2, o.y); ctx.stroke(); }
    else if (o.k === 'img') ctx.drawImage(o.img, o.x, o.y, o.w, o.h);
    else { ctx.font = o.f; ctx.textAlign = o.align; ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.fillText(o.text, o.x, o.y); }
  }
}
/** createCanvas(w,h) -> canvas with getContext('2d'). Returns {canvas, ctx, width, height}. */
export function renderRows(createCanvas, rows, { widthPx = 576, lang = 'en', base = 22 } = {}) {
  const m = createCanvas(10, 10).getContext('2d');
  const measure = (f, t) => { m.font = f; return m.measureText(t).width; };
  const layout = layoutRows(measure, rows, widthPx, { base, lang });
  const canvas = createCanvas(widthPx, layout.height), ctx = canvas.getContext('2d');
  paint(ctx, layout, widthPx, false);
  return { canvas, ctx, width: widthPx, height: layout.height };
}
export const paperPx = (mm) => (String(mm) === '58' ? 384 : 576);

// ---------- ESC/POS raster ----------
/** RGBA pixels -> ESC/POS bytes (GS v 0 in 128-row bands). */
export function escposRaster(rgba, width, height, { cut = true, feed = 4 } = {}) {
  const wb = Math.ceil(width / 8), out = [0x1b, 0x40];
  for (let y0 = 0; y0 < height; y0 += 128) {
    const h = Math.min(128, height - y0);
    out.push(0x1d, 0x76, 0x30, 0, wb & 255, wb >> 8, h & 255, h >> 8);
    for (let y = y0; y < y0 + h; y++) for (let xb = 0; xb < wb; xb++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xb * 8 + bit;
        if (x < width) { const i = (y * width + x) * 4; const lum = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000; if (rgba[i + 3] > 128 && lum < 140) b |= 0x80 >> bit; }
      }
      out.push(b);
    }
  }
  out.push(0x1b, 0x64, feed);
  if (cut) out.push(0x1d, 0x56, 0x42, 0);
  return Uint8Array.from(out);
}
export const toBase64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
/** Android: opens the RawBT app which prints ESC/POS to a paired Bluetooth printer. */
export const rawbtUrl = (bytes) => `rawbt:base64,${toBase64(bytes)}`;

/** Direct Bluetooth Low Energy printing (only BLE printers; many cheap printers are classic BT -> use RawBT). */
export async function printViaBluetooth(bytes, nav = globalThis.navigator) {
  if (!nav?.bluetooth) throw new Error('This browser has no Web Bluetooth. Use the RawBT app or browser print.');
  const services = ['000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 0xffe0];
  const dev = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: services });
  const server = await dev.gatt.connect();
  let ch = null;
  for (const s of await server.getPrimaryServices()) for (const c of await s.getCharacteristics()) if (!ch && (c.properties.write || c.properties.writeWithoutResponse)) ch = c;
  if (!ch) throw new Error('No writable printer channel found');
  for (let i = 0; i < bytes.length; i += 100) { await ch.writeValueWithoutResponse(bytes.slice(i, i + 100)); await new Promise((r) => setTimeout(r, 15)); }
  server.disconnect();
}

// ---------- PDF (JPEG pages) ----------
/** pages: [{jpeg: Uint8Array, w, h}] -> PDF bytes (A4, image scaled to page width). */
export function makePdfFromJpegs(pages) {
  const A4W = 595.28, A4H = 841.89, parts = [], offs = [];
  let len = 0;
  const push = (x) => { const u = typeof x === 'string' ? Uint8Array.from(x, (c) => c.charCodeAt(0) & 255) : x; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); push(body); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
    const sc = A4W / p.w, dh = Math.min(p.h * sc, A4H), dw = p.w * (dh / p.h);
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} 0 ${(A4H - dh).toFixed(2)} cm /Im0 Do Q`;
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W} ${A4H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    obj(ct, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offs[im] = len; push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg); push('\nendstream\nendobj\n');
  });
  const n = 3 + pages.length * 3, xref = len;
  push(`xref\n0 ${n}\n0000000000 65535 f \n`);
  for (let i = 1; i < n; i++) push(`${String(offs[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let o = 0; for (const u of parts) { out.set(u, o); o += u.length; }
  return out;
}

/** A4 invoice: paginates receipt rows onto 1240px-wide pages (150 dpi). Returns canvases. */
export function renderA4Pages(createCanvas, rows, lang = 'en') {
  const W = 1240, PH = 1754, m = createCanvas(10, 10).getContext('2d');
  const measure = (f, t) => { m.font = f; return m.measureText(t).width; };
  const layout = layoutRows(measure, rows, W, { base: 30, pad: 70, lang });
  const pages = [], pageCount = Math.max(1, Math.ceil(layout.height / (PH - 140)));
  const slice = PH - 140;
  for (let p = 0; p < pageCount; p++) {
    const c = createCanvas(W, PH), ctx = c.getContext('2d'), top = p * slice, ops = [];
    for (const o of layout.ops) {
      const y = o.k === 'line' ? o.y : o.y;
      if (y >= top && y < top + slice) ops.push({ ...o, y: o.k === 'line' ? o.y - top + 40 : o.y - top + 40 });
    }
    paint(ctx, { ops, height: PH }, W, false);
    pages.push(c);
  }
  return pages;
}

// ---------- sharing (browser only) ----------
export async function shareFile({ blob, filename, text, phone }, nav = globalThis.navigator) {
  const file = new File([blob], filename, { type: blob.type });
  if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], text, title: filename }); return 'shared'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  window.open(waLink(phone, text), '_blank');
  return 'downloaded';
}
export const canvasToBlob = (canvas, type = 'image/jpeg', q = 0.92) => new Promise((res) => canvas.toBlob(res, type, q));
export function printCanvasInBrowser(canvas, widthMm = 80) {
  const w = window.open('', '_blank');
  w.document.write(`<html><head><style>@page{size:${widthMm}mm auto;margin:0}body{margin:0}img{width:${widthMm}mm}</style></head><body><img src="${canvas.toDataURL('image/png')}" onload="print();setTimeout(close,500)"></body></html>`);
  w.document.close();
}
export const htmlEscape = esc;
