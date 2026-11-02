import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/core.js';

const paris = { name: 'Paris', baseUnit: 'kg', sellUnit: 'kg', retailPrice: 6000, wholesalePrice: 5500, units: [{ unit: 'g', num: 1, den: 1000 }] };

test('money and qty parse/format are exact', () => {
  assert.equal(C.parseRs('1,250.5'), 125050);
  assert.equal(C.fmtRs(125075), 'Rs. 1,250.75');
  assert.equal(C.fmtRs(5000, { sym: false }), '50');
  assert.equal(C.parseQty('0.1') + C.parseQty('0.2'), C.parseQty('0.3'));
  assert.equal(C.fmtQty(2500), '2.5');
  assert.throws(() => C.parseQty('1.2345'));
  assert.throws(() => C.parseRs('12.345'));
});

test('REVERSE CALCULATOR: Rs 15 of Paris at Rs 60/kg = 250 grams', () => {
  const qty = C.qtyForAmount(1500, C.priceFor(paris, 'kg'));
  assert.equal(qty, 250);                       // 0.250 kg
  assert.equal(C.weightText(paris, C.toBase(paris, qty, 'kg')), '250 g');
  assert.equal(C.priceFor(paris, 'g'), 6);      // 6 paise per gram
  assert.equal(C.qtyForAmount(1500, 6), 250000); // 250.000 g
  assert.equal(C.toBase(paris, 250000, 'g'), 250);
});

test('reverse calc other amounts', () => {
  assert.equal(C.qtyForAmount(2000, 6000), 333);
  assert.equal(C.qtyForAmount(6000, 6000), 1000);
  assert.throws(() => C.qtyForAmount(100, 0));
});

test('unit conversion: dozen, feet/meter, rejects unknown units', () => {
  const nail = { name: 'N', baseUnit: 'pc', sellUnit: 'pc', retailPrice: 100, units: [{ unit: 'dozen', num: 12, den: 1 }] };
  assert.equal(C.toBase(nail, 2000, 'dozen'), 24000);
  const wire = { name: 'W', baseUnit: 'm', sellUnit: 'm', retailPrice: 5000, units: C.presetUnits('m') };
  assert.equal(C.toBase(wire, C.parseQty('328.084'), 'ft'), 100000);   // 328.084 ft = 100 m
  assert.equal(C.toBase(wire, 10000, 'ft'), 3048);                      // 10 ft = 3.048 m
  assert.throws(() => C.toBase(wire, 1000, 'kg'));
  assert.throws(() => C.toBase(wire, 0, 'm'));
});

test('line amount and invoice discount allocation stay exact', () => {
  assert.equal(C.lineAmount(C.parseQty('2.5'), 9000), 22500);
  const r = C.calcInvoice([9999, 5000], [0, 500], 1000);
  assert.equal(r.total, 9999 + 5000 - 500 - 1000);
  assert.equal(r.lines.reduce((a, l) => a + l.share, 0), 1000);
  assert.equal(r.lines.reduce((a, l) => a + l.net, 0), r.total);
  assert.throws(() => C.calcInvoice([100], [200], 0));
  assert.throws(() => C.calcInvoice([100], [0], 101));
});

test('rental units: hourly/daily, minimum 1, grace', () => {
  const H = 3600000, D = 24 * H, t0 = 1_000_000_000_000;
  assert.equal(C.rentalUnits(t0, t0 + 20 * 60000, 'hour'), 1);
  assert.equal(C.rentalUnits(t0, t0 + 2 * H + 10 * 60000, 'hour'), 2);
  assert.equal(C.rentalUnits(t0, t0 + 3 * H + 40 * 60000, 'hour'), 4);
  assert.equal(C.rentalUnits(t0, t0 + D, 'day'), 1);
  assert.equal(C.rentalUnits(t0, t0 + D + 31 * 60000, 'day'), 2);
  assert.equal(C.rentalUnits(t0, t0 + 3 * D, 'day', 0), 3);
  assert.throws(() => C.rentalUnits(t0, t0 - 1, 'day'));
});

test('PKT day boundary and date format', () => {
  const t = Date.UTC(2026, 9, 31, 20, 0); // 01:00 PKT on 1 Nov
  assert.equal(C.pktDayStart(t), Date.UTC(2026, 9, 31, 19, 0));
  assert.equal(C.fmtDate(t), '01-11-2026');
  assert.equal(C.fmtDateTime(t), '01-11-2026 01:00');
  assert.equal(C.periodKey(t, 'month'), '2026-11');
  assert.equal(C.periodKey(Date.UTC(2026, 10, 1, 12), 'week'), 'Wk 2026-10-26'); // Sunday 1 Nov -> Monday 26 Oct
});

test('WhatsApp number normalisation and link', () => {
  assert.equal(C.normalizePk('0300-1234567'), '923001234567');
  assert.equal(C.normalizePk('+92 300 1234567'), '923001234567');
  assert.equal(C.normalizePk('3001234567'), '923001234567');
  assert.match(C.waLink('03001234567', 'Salam Rs 15'), /^https:\/\/wa\.me\/923001234567\?text=Salam%20Rs%2015$/);
});
