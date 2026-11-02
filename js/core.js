// Pure helpers: money (integer paise), quantity (integer thousandths), units, pricing, time.
// No floating point is used for any money or stock arithmetic.

/** round-half-away-from-zero of a*b/c, exact (BigInt). */
export function mulDiv(a, b, c) {
  const A = BigInt(a), B = BigInt(b), C = BigInt(c);
  if (C === 0n) throw new Error('Division by zero');
  let n = A * B;
  const neg = (n < 0n) !== (C < 0n);
  if (n < 0n) n = -n;
  const d = C < 0n ? -C : C;
  const q = (2n * n + d) / (2n * d);
  return Number(neg ? -q : q);
}

// ---------- money ----------
export function parseRs(input) {
  const s = String(input ?? '').replace(/[,\s]/g, '').replace(/^Rs\.?/i, '');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Invalid amount: "${input}"`);
  const v = Number(m[2]) * 100 + Number((m[3] || '0').padEnd(2, '0'));
  return m[1] ? -v : v;
}
export function fmtRs(paise, { sym = true } = {}) {
  const neg = paise < 0, a = Math.abs(paise);
  const r = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const p = a % 100;
  return `${neg ? '-' : ''}${sym ? 'Rs. ' : ''}${r}${p ? '.' + String(p).padStart(2, '0') : ''}`;
}

// ---------- quantity: integer thousandths of a unit ----------
export function parseQty(input) {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(String(input ?? '').trim());
  if (!m) throw new Error(`Invalid quantity: "${input}"`);
  const v = Number(m[2]) * 1000 + Number((m[3] || '0').padEnd(3, '0'));
  return m[1] ? -v : v;
}
export function fmtQty(milli) {
  const neg = milli < 0, a = Math.abs(milli);
  const f = String(a % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${Math.floor(a / 1000)}${f ? '.' + f : ''}`;
}

// ---------- units ----------
export const UNITS = {
  kg: { en: 'Kg', ur: 'کلو' }, g: { en: 'Gram', ur: 'گرام' }, m: { en: 'Meter', ur: 'میٹر' },
  ft: { en: 'Foot', ur: 'فٹ' }, pc: { en: 'Piece', ur: 'عدد' }, coil: { en: 'Coil', ur: 'کوائل' },
  bag: { en: 'Bag', ur: 'بوری' }, bundle: { en: 'Bundle', ur: 'بنڈل' }, box: { en: 'Box', ur: 'ڈبہ' },
  ltr: { en: 'Liter', ur: 'لیٹر' }, set: { en: 'Set', ur: 'سیٹ' }, dozen: { en: 'Dozen', ur: 'درجن' },
};
/** Suggested extra units: 1 unit = num/den base units (exact). */
export function presetUnits(base) {
  return ({
    kg: [{ unit: 'g', num: 1, den: 1000 }],
    g: [{ unit: 'kg', num: 1000, den: 1 }],
    m: [{ unit: 'ft', num: 381, den: 1250 }], // 1 ft = 0.3048 m
    ft: [{ unit: 'm', num: 1250, den: 381 }],
    pc: [{ unit: 'dozen', num: 12, den: 1 }],
  })[base] || [];
}
export function unitFactor(p, unit) {
  if (unit === p.baseUnit) return { num: 1, den: 1 };
  const u = (p.units || []).find((x) => x.unit === unit);
  if (!u) throw new Error(`Unit "${unit}" is not configured for ${p.name}`);
  return u;
}
/** quantity in [unit] -> quantity in the product's base unit */
export function toBase(p, qty, unit) {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be greater than zero');
  const f = unitFactor(p, unit);
  const b = mulDiv(qty, f.num, f.den);
  if (b <= 0) throw new Error('Quantity is too small');
  return b;
}
/** price per [unit] derived from the price list (given per sellUnit). */
export function priceFor(p, unit, mode = 'retail') {
  const list = mode === 'wholesale' && p.wholesalePrice > 0 ? p.wholesalePrice : p.retailPrice;
  const fs = unitFactor(p, p.sellUnit), fu = unitFactor(p, unit);
  return mulDiv(list, fu.num * fs.den, fu.den * fs.num);
}

// ---------- pricing ----------
export const lineAmount = (qty, price) => mulDiv(qty, price, 1000);
/** Reverse calculator: "Rs 15 of Paris at Rs 60/kg" -> 0.250 kg */
export function qtyForAmount(amountPaise, pricePerUnit) {
  if (!(pricePerUnit > 0)) throw new Error('Price per unit must be set');
  return mulDiv(amountPaise, 1000, pricePerUnit);
}
/** Friendly text for a base quantity, e.g. 250 milli-kg -> "250 g" */
export function weightText(p, baseQty) {
  if (p.baseUnit === 'kg' && Math.abs(baseQty) < 1000) return `${baseQty} g`;
  if (p.baseUnit === 'm' && Math.abs(baseQty) < 1000) return `${fmtQty(mulDiv(baseQty, 100, 1))} cm`;
  return `${fmtQty(baseQty)} ${p.baseUnit}`;
}
/** Spread [total] over [basis] pro-rata; last item absorbs the rounding remainder. */
export function allocate(total, basis) {
  const sum = basis.reduce((a, b) => a + b, 0);
  const out = [];
  let used = 0;
  basis.forEach((b, i) => {
    if (i === basis.length - 1) out.push(total - used);
    else { const s = sum === 0 ? 0 : mulDiv(total, b, sum); out.push(s); used += s; }
  });
  return out;
}
/** grosses[i] = qty*price (or fixed amount), discounts[i] = item discount. */
export function calcInvoice(grosses, discounts, invoiceDiscount = 0) {
  if (!grosses.length) throw new Error('Add at least one item');
  const after = grosses.map((g, i) => {
    const d = discounts[i] || 0;
    if (d < 0 || d > g) throw new Error('Item discount cannot exceed the line amount');
    return g - d;
  });
  const sumAfter = after.reduce((a, b) => a + b, 0);
  if (invoiceDiscount < 0 || invoiceDiscount > sumAfter) throw new Error('Discount cannot exceed the bill amount');
  const shares = allocate(invoiceDiscount, after);
  return {
    lines: after.map((a, i) => ({ gross: grosses[i], itemDisc: discounts[i] || 0, share: shares[i], net: a - shares[i] })),
    subtotal: grosses.reduce((a, b) => a + b, 0),
    itemDiscTotal: (discounts || []).reduce((a, b) => a + (b || 0), 0),
    invoiceDiscount,
    total: sumAfter - invoiceDiscount,
  };
}

// ---------- rental charge ----------
/** units charged: hourly -> hours, daily -> days; minimum 1 unit; grace minutes forgiven. */
export function rentalUnits(outMs, retMs, rateType, graceMin = 30) {
  if (retMs < outMs) throw new Error('Return time is before the rental time');
  const mins = Math.ceil((retMs - outMs) / 60000);
  const per = rateType === 'hour' ? 60 : 1440;
  return Math.max(1, Math.ceil(Math.max(0, mins - graceMin) / per));
}

// ---------- time (Pakistan = UTC+5, no DST) ----------
const PKT = 5 * 3600 * 1000, DAY = 86400000;
export const pktDayStart = (ms) => Math.floor((ms + PKT) / DAY) * DAY - PKT;
export function pktParts(ms) {
  const d = new Date(ms + PKT);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() };
}
const p2 = (n) => String(n).padStart(2, '0');
export const fmtDate = (ms) => { const t = pktParts(ms); return `${p2(t.d)}-${p2(t.m)}-${t.y}`; };
export const fmtDateTime = (ms) => { const t = pktParts(ms); return `${p2(t.d)}-${p2(t.m)}-${t.y} ${p2(t.h)}:${p2(t.mi)}`; };
/** period key for report grouping (sortable) */
export function periodKey(ms, period) {
  const t = pktParts(ms);
  if (period === 'month') return `${t.y}-${p2(t.m)}`;
  if (period === 'week') { const w = pktParts(pktDayStart(ms) - ((t.dow + 6) % 7) * DAY); return `Wk ${w.y}-${p2(w.m)}-${p2(w.d)}`; }
  return `${t.y}-${p2(t.m)}-${p2(t.d)}`;
}

// ---------- WhatsApp ----------
export function normalizePk(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '92' + d.slice(1);
  else if (d.length === 10 && d.startsWith('3')) d = '92' + d;
  return d;
}
export const waLink = (phone, text) => `https://wa.me/${normalizePk(phone)}?text=${encodeURIComponent(text)}`;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
