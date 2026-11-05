// Shop: all business rules. Every posting is built in memory, then written in ONE atomic
// storage batch. Stock, khata and cash balances are derived from append-only rows
// (movements / ledger / cashTx), so they can always be rebuilt and audited.
import { mulDiv, lineAmount, lineGross, listPrice, qtyForAmount, toBase, calcInvoice, allocate, rentalUnits, rentalDayList,
  pktDayStart, fmtDate, periodKey, fmtRs, normalizePk, waLink } from './core.js';

export const ACCOUNTS = ['cash', 'bank', 'jazzcash', 'easypaisa'];
export const DATA_COLS = new Set(['settings', 'products', 'categories', 'customers', 'suppliers', 'sales', 'purchases',
  'movements', 'ledger', 'cashTx', 'expenses', 'rentalItems', 'rentals']);
export const IMMUTABLE = new Set(['movements', 'ledger', 'cashTx']);
const SALESMAN = new Set(['sell', 'estimate', 'customers', 'receive', 'rentals', 'view_items']);

export class ShopError extends Error {
  constructor(message, code = 'error', data) { super(message); this.code = code; this.data = data; }
}

const DEFAULTS = {
  shopName: 'RAMZAN ELECTRIC STORE & HARDWARE', shopAddress: 'Noor-e-Wali, Rahim Yar Khan', shopPhone: '03006703028', logoOnThermal: false, showBanner: true, footer: 'Thank you for your business',
  receiptWidth: '80', allowNegative: false, rentalGraceMin: 30, invoicePrefix: 'RES',
  opening_cash: 0, opening_bank: 0, opening_jazzcash: 0, opening_easypaisa: 0,
};
export const DEFAULT_CATEGORIES = [   // [id, English, Roman Urdu]
  ['cat-hardware', 'Hardware & Tools', 'Hardware aur Auzaar'], ['cat-electric', 'Electric & Wiring', 'Electric aur Wiring'],
  ['cat-electronics', 'Electronics', 'Electronics'], ['cat-sanitary', 'Sanitary & Plumbing', 'Sanitary aur Plumbing'],
  ['cat-building', 'Building Material', 'Tameeraati Saman'], ['cat-rental', 'Rental Equipment', 'Kiraye ka Saman'],
];

export class Shop {
  constructor({ store, now = () => Date.now(), uid = () => globalThis.crypto.randomUUID() }) {
    this.store = store; this.now = now; this.uid = uid;
    this.role = 'admin'; this.cfg = { ...DEFAULTS };
    this.products = new Map(); this.customers = new Map(); this.suppliers = new Map();
    this.categories = new Map(); this.rentalItems = new Map(); this.rentals = new Map();
    this.stock = new Map(); this.bal = new Map(); this.acct = new Map();
    this._q = Promise.resolve();
  }

  // ---------- plumbing ----------
  can(p) { return this.role === 'admin' || SALESMAN.has(p); }
  need(p) { if (!this.can(p)) throw new ShopError('Permission denied', 'forbidden'); }
  run(fn) { const p = this._q.then(fn); this._q = p.catch(() => {}); return p; }

  async init() {
    let dev = await this.store.get('meta', 'device');
    if (!dev) { dev = { id: 'device', code: 'A', deviceId: this.uid() }; await this.store.batch([{ col: 'meta', obj: dev }]); }
    this.deviceCode = dev.code; this.deviceId = dev.deviceId;
    await this.rebuild();
    if (!this.categories.size) {
      await this.commit(DEFAULT_CATEGORIES.map(([id, nameEn, nameUr]) => ({ col: 'categories', obj: { id, nameEn, nameUr } })));
    }
    // older versions stored Urdu-script category names: switch the built-in ones to Roman Urdu
    const fix = [];
    for (const [id, , nameUr] of DEFAULT_CATEGORIES) { const c = this.categories.get(id); if (c && c.nameUr !== nameUr && /[\u0600-\u06FF]/.test(c.nameUr || '')) fix.push({ col: 'categories', obj: { ...c, nameUr } }); }
    if (fix.length) await this.commit(fix);
    return this;
  }
  async setDeviceCode(code) {
    code = String(code || 'A').toUpperCase().slice(0, 2);
    this.deviceCode = code;
    await this.store.batch([{ col: 'meta', obj: { id: 'device', code, deviceId: this.deviceId } }]);
  }

  /** Re-read everything into the in-memory caches (after restore / sync). */
  async rebuild() {
    this.cfg = { ...DEFAULTS };
    for (const s of await this.store.all('settings')) this.cfg[s.id] = s.value;
    for (const [name, col] of [['products', 'products'], ['customers', 'customers'], ['suppliers', 'suppliers'],
      ['categories', 'categories'], ['rentalItems', 'rentalItems'], ['rentals', 'rentals']]) {
      this[name] = new Map((await this.store.all(col)).map((o) => [o.id, o]));
    }
    this.stock = new Map(); this.bal = new Map(); this.acct = new Map();
    for (const m of await this.store.all('movements')) this._addMove(m);
    for (const l of await this.store.all('ledger')) this._addLedger(l);
    for (const c of await this.store.all('cashTx')) this._addCash(c);
  }
  _addMove(m) { const s = this.stock.get(m.productId) || { qty: 0, value: 0 }; s.qty += m.qty; s.value += m.value; this.stock.set(m.productId, s); }
  _addLedger(l) { const k = `${l.party}:${l.partyId}`; this.bal.set(k, (this.bal.get(k) || 0) + l.amount); }
  _addCash(c) { this.acct.set(c.account, (this.acct.get(c.account) || 0) + c.amount); }
  _cache(col, o) {
    if (col === 'settings') this.cfg[o.id] = o.value;
    else if (col === 'movements') this._addMove(o);
    else if (col === 'ledger') this._addLedger(o);
    else if (col === 'cashTx') this._addCash(o);
    else if (this[col] instanceof Map) this[col].set(o.id, o);
  }

  /** Atomically persist docs [{col,obj}] and update caches. */
  async commit(docs) {
    const t = this.now(), ops = [], out = [];
    for (const d of docs) {
      const o = d.col === 'meta' ? { ...d.obj } : { ...d.obj, updatedAt: t, device: this.deviceCode };
      out.push({ col: d.col, obj: o });
      ops.push({ col: d.col, obj: o });
    }
    await this.store.batch(ops);
    for (const d of out) if (d.col !== 'meta') this._cache(d.col, d.obj);
    return out.map((d) => d.obj);
  }

  async nextNo(prefix) {
    const year = new Date(this.now() + 5 * 3600000).getUTCFullYear();
    const id = `seq:${prefix}:${year}`;
    const cur = await this.store.get('meta', id);
    const n = (cur?.n || 0) + 1;
    return { no: `${prefix}-${year}-${this.deviceCode}${String(n).padStart(6, '0')}`, doc: { col: 'meta', obj: { id, n } } };
  }

  // ---------- row builders ----------
  _mov(productId, type, qty, value, refId, note, at) {
    return { col: 'movements', obj: { id: this.uid(), productId, type, qty, value, refId, note, at } };
  }
  _led(party, partyId, kind, amount, refId, note, at, no) {
    return { col: 'ledger', obj: { id: this.uid(), party, partyId, kind, amount, refId, note, at, no } };
  }
  _cash(account, amount, kind, refId, note, at) {
    if (!ACCOUNTS.includes(account)) throw new ShopError(`Unknown account ${account}`);
    return { col: 'cashTx', obj: { id: this.uid(), account, amount, kind, refId, note, at } };
  }

  // ---------- settings ----------
  async setCfg(key, value) { this.need('settings'); return this.commit([{ col: 'settings', obj: { id: key, value } }]); }

  // ---------- products & stock ----------
  stockOf(pid) { return this.stock.get(pid) || { qty: 0, value: 0 }; }
  avgCost(pid) { const s = this.stockOf(pid); return s.qty > 0 ? mulDiv(s.value, 1000, s.qty) : 0; }

  async saveProduct(input, { openingQty = 0, openingValue = 0 } = {}) {
    this.need('manage_items');
    const old = input.id ? this.products.get(input.id) : null;
    const p = {
      id: old?.id || this.uid(), sku: (input.sku || '').trim(), name: (input.name || '').trim(), nameUr: input.nameUr || '',
      category: input.category || '', brand: input.brand || '', size: input.size || '', barcode: input.barcode || '',
      location: input.location || '', baseUnit: input.baseUnit || 'pc', sellUnit: input.sellUnit || input.baseUnit || 'pc',
      units: (input.units || []).map((u) => ({ unit: u.unit, num: Number(u.num), den: Number(u.den) })),
      retailPrice: input.retailPrice | 0, wholesalePrice: input.wholesalePrice | 0, minStock: input.minStock | 0,
      active: input.active !== false, createdAt: old?.createdAt || this.now(), lastCost: old?.lastCost || 0,
    };
    if (!p.name) throw new ShopError('Item name is required');
    for (const u of p.units) if (!(Number.isInteger(u.num) && u.num > 0 && Number.isInteger(u.den) && u.den > 0)) throw new ShopError('Invalid unit conversion');
    if (p.sellUnit !== p.baseUnit && !p.units.some((u) => u.unit === p.sellUnit)) throw new ShopError('Selling unit must be the base unit or a configured unit');
    if (p.retailPrice < 0 || p.wholesalePrice < 0) throw new ShopError('Price cannot be negative');
    if (!p.sku) p.sku = `P${String(this.products.size + 1).padStart(4, '0')}-${this.deviceCode}`;
    if ([...this.products.values()].some((x) => x.id !== p.id && x.sku === p.sku)) throw new ShopError(`SKU ${p.sku} already exists`);
    if (old && old.baseUnit !== p.baseUnit && (this.stock.has(p.id))) throw new ShopError('Base unit cannot change after stock movements exist');
    const docs = [{ col: 'products', obj: p }];
    if (!old && openingQty > 0) docs.push(this._mov(p.id, 'opening', openingQty, openingValue, null, 'Opening stock', this.now()));
    await this.commit(docs);
    return p;
  }
  setProductActive(id, active) { this.need('manage_items'); return this.commit([{ col: 'products', obj: { ...this.products.get(id), active } }]); }

  searchProducts(q = '', { category = '', includeInactive = false, limit = 60 } = {}) {
    const s = q.trim().toLowerCase();
    const out = [];
    for (const p of this.products.values()) {
      if (!includeInactive && !p.active) continue;
      if (category && p.category !== category) continue;
      if (s && ![p.name, p.nameUr, p.sku, p.barcode, p.brand, p.size].some((x) => (x || '').toLowerCase().includes(s))) continue;
      out.push(p);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out.slice(0, limit);
  }
  /** List price per SELL unit (paise). */
  defaultPrice(pid, mode = 'retail') { return listPrice(this.products.get(pid), mode); }

  /** Manual stock correction (admin). deltaBase is signed, in base milli-units. */
  async adjustStock(pid, deltaBase, reason) {
    this.need('stock_admin');
    return this.run(async () => {
      if (!deltaBase) throw new ShopError('Adjustment cannot be zero');
      if (!String(reason || '').trim()) throw new ShopError('Reason is required');
      const s = this.stockOf(pid), at = this.now();
      let value;
      if (deltaBase > 0) value = mulDiv(this.avgCost(pid), deltaBase, 1000);
      else { const d = -deltaBase; value = -(s.qty > 0 && d <= s.qty ? mulDiv(s.value, d, s.qty) : mulDiv(this.avgCost(pid), d, 1000)); }
      if (!this.cfg.allowNegative && s.qty + deltaBase < 0) throw new ShopError('Adjustment would make stock negative');
      await this.commit([this._mov(pid, 'adjust', deltaBase, value, null, reason, at)]);
    });
  }
  /** Admin: zero the stock of one item (or all) through auditable adjustment rows. */
  async resetStock(pid, reason) {
    this.need('stock_admin');
    return this.run(async () => {
      if (!String(reason || '').trim()) throw new ShopError('Reason is required');
      const at = this.now(), docs = [];
      for (const [id, s] of this.stock) {
        if (pid && id !== pid) continue;
        if (s.qty || s.value) docs.push(this._mov(id, 'adjust', -s.qty, -s.value, null, `RESET: ${reason}`, at));
      }
      if (docs.length) await this.commit(docs);
      return docs.length;
    });
  }

  // ---------- customers / suppliers / khata ----------
  balance(party, id) { return this.bal.get(`${party}:${id}`) || 0; }

  async saveCustomer(input) { return this._saveParty('customers', 'customer', input); }
  async saveSupplier(input) { this.need('suppliers'); return this._saveParty('suppliers', 'supplier', input); }
  async _saveParty(col, party, input) {
    if (party === 'customer') this.need('customers');
    const old = input.id ? this[col].get(input.id) : null;
    const o = { id: old?.id || this.uid(), name: (input.name || '').trim(), phone: input.phone || '', address: input.address || '',
      creditLimit: input.creditLimit | 0, active: input.active !== false, createdAt: old?.createdAt || this.now() };
    if (!o.name) throw new ShopError('Name is required');
    const docs = [{ col, obj: o }];
    if (!old && input.openingBalance) docs.push(this._led(party, o.id, 'opening', input.openingBalance | 0, null, 'Opening balance', this.now()));
    await this.commit(docs);
    return o;
  }

  /** Find an existing customer by phone number (preferred) or exact name. */
  findCustomer({ phone = '', name = '' } = {}) {
    const n = normalizePk(phone), nm = name.trim().toLowerCase();
    for (const c of this.customers.values()) {
      if (!c.active) continue;
      if (n && normalizePk(c.phone) === n) return c;
      if (!n && nm && c.name.trim().toLowerCase() === nm) return c;
    }
    return null;
  }

  async receivePayment({ customerId, account = 'cash', amount, note = '' }) {
    this.need('receive');
    return this.run(async () => {
      if (!(amount > 0)) throw new ShopError('Amount must be greater than zero');
      if (!this.customers.has(customerId)) throw new ShopError('Customer not found');
      const at = this.now(), { no, doc } = await this.nextNo('RCT');
      await this.commit([doc, this._led('customer', customerId, 'payment', -amount, null, note, at, no),
        this._cash(account, amount, 'customer_payment', no, note, at)]);
      return no;
    });
  }
  async paySupplier({ supplierId, account = 'cash', amount, note = '' }) {
    this.need('suppliers');
    return this.run(async () => {
      if (!(amount > 0)) throw new ShopError('Amount must be greater than zero');
      const at = this.now(), { no, doc } = await this.nextNo('PAY');
      await this.commit([doc, this._led('supplier', supplierId, 'payment', -amount, null, note, at, no),
        this._cash(account, -amount, 'supplier_payment', no, note, at)]);
      return no;
    });
  }
  async adjustParty(party, id, amount, note) {
    this.need('stock_admin');
    if (!String(note || '').trim()) throw new ShopError('A note is required for adjustments');
    await this.commit([this._led(party, id, 'adjustment', amount, null, note, this.now())]);
  }
  async statement(party, id, from = 0, to = Infinity) {
    const rows = (await this.store.all('ledger')).filter((l) => l.party === party && l.partyId === id).sort((a, b) => a.at - b.at);
    let run = 0; const out = [];
    for (const l of rows) { run += l.amount; if (l.at >= from && l.at < to) out.push({ ...l, running: run }); }
    return out;
  }
  reminderText(customerId, lang = 'en') {
    const c = this.customers.get(customerId), b = this.balance('customer', customerId);
    const amt = fmtRs(b);
    return lang === 'ur'
      ? `Assalam o Alaikum ${c.name},
${this.cfg.shopName} ki taraf se yaad-dehani: aap ke zimme ${amt} baqi hain. Meherbani kar ke jald ada kar dein. Shukriya.`
      : `Assalam o Alaikum ${c.name},\nReminder from ${this.cfg.shopName}: your pending balance is ${amt}. Please pay at your earliest convenience. Thank you.`;
  }
  reminderLink(customerId, lang) { return waLink(this.customers.get(customerId).phone, this.reminderText(customerId, lang)); }

  // ---------- sales / estimates ----------
  _prepLines(input, { checkStock }) {
    if (!input.lines?.length) throw new ShopError('Add at least one item');
    const running = new Map(), lines = [];
    for (const l of input.lines) {
      const p = this.products.get(l.productId);
      if (!p) throw new ShopError('Item not found');
      if (!p.active) throw new ShopError(`${p.name} is archived`);
      let unit = l.unit || p.sellUnit;
      // `price` is always the price per SELL unit (e.g. Rs 15 per kg), whatever unit the quantity is typed in.
      const lp = listPrice(p, input.priceMode), price = l.price ?? lp;
      if (price !== lp && !input.trustPrices && !this.can('edit_price')) throw new ShopError('You are not allowed to change prices', 'forbidden');
      let qty = l.qty, gross;
      if (l.amount != null) {                       // "Rs 15 of Paris" mode: quantity is worked out from the amount
        if (!(l.amount > 0)) throw new ShopError('Amount must be greater than zero');
        unit = p.sellUnit;
        try { qty = qtyForAmount(l.amount, price); } catch (e) { throw new ShopError(`${p.name}: ${e.message}`); }
        gross = l.amount;
      } else {
        if (!Number.isInteger(qty) || qty <= 0) throw new ShopError('Quantity must be greater than zero');
        try { gross = l.fixedGross ?? lineGross(p, qty, unit, price); } catch (e) { throw new ShopError(e.message); }
      }
      let baseQty;
      try { baseQty = toBase(p, qty, unit); } catch (e) { throw new ShopError(e.message); }
      const st = running.get(p.id) || { ...this.stockOf(p.id) };
      let cogs = 0;
      if (checkStock) {
        if (!this.cfg.allowNegative && st.qty < baseQty) throw new ShopError(`Insufficient stock for ${p.name}: available ${st.qty / 1000}, needed ${baseQty / 1000}`, 'stock');
        cogs = st.qty > 0 && baseQty <= st.qty ? mulDiv(st.value, baseQty, st.qty) : mulDiv(st.qty > 0 ? mulDiv(st.value, 1000, st.qty) : this.avgCost(p.id), baseQty, 1000);
        st.qty -= baseQty; st.value -= cogs; running.set(p.id, st);
      }
      lines.push({ productId: p.id, name: p.name, nameUr: p.nameUr, size: p.size, unit, qty, price, priceUnit: p.sellUnit, gross,
        discount: l.discount | 0, baseQty, cogs, byAmount: l.amount != null, amountInput: l.amount ?? null, note: String(l.note || '').trim().slice(0, 120) });
    }
    const calc = calcInvoice(lines.map((l) => l.gross), lines.map((l) => l.discount), input.discount | 0);
    lines.forEach((l, i) => { l.share = calc.lines[i].share; l.net = calc.lines[i].net; });
    return { lines, calc };
  }

  /** Cart totals without writing anything (stock is not checked). Returns {lines, calc} or {error}. */
  preview(input) {
    try { return this._prepLines(input, { checkStock: false }); } catch (e) { return { error: e.message }; }
  }

  async saveEstimate(input) {
    this.need('estimate');
    return this.run(async () => {
      const { lines, calc } = this._prepLines(input, { checkStock: false });
      const at = this.now(), { no, doc } = await this.nextNo('EST');
      const est = { id: this.uid(), no, type: 'estimate', status: 'open', at, customerId: input.customerId || null,
        priceMode: input.priceMode || 'retail', lines, subtotal: calc.subtotal, discount: calc.invoiceDiscount, total: calc.total,
        paid: 0, cogs: 0, note: input.note || '' };
      await this.commit([doc, { col: 'sales', obj: est }]);
      return est;
    });
  }

  postSale(input) { this.need('sell'); return this.run(() => this._postSale(input)); }

  async _postSale(input, extraFn = null) {
    const { lines, calc } = this._prepLines(input, { checkStock: true });
    const total = calc.total, payments = (input.payments || []).filter((p) => p.amount > 0);
    const paid = payments.reduce((a, p) => a + p.amount, 0);
    if (paid > total) throw new ShopError('Amount received cannot exceed the bill total');
    const credit = total - paid, custId = input.customerId || null;
    if (credit > 0 && !custId) throw new ShopError('Walk-in sales must be paid in full. Select a customer for udhaar.', 'walkin_credit');
    if (custId && !this.customers.has(custId)) throw new ShopError('Customer not found');
    if (credit > 0) {
      const c = this.customers.get(custId), bal = this.balance('customer', custId);
      if (c.creditLimit > 0 && bal + credit > c.creditLimit && !input.overrideLimit) {
        throw new ShopError(`Credit limit exceeded: balance would be ${fmtRs(bal + credit)} (limit ${fmtRs(c.creditLimit)})`, 'credit_limit', { balance: bal + credit, limit: c.creditLimit });
      }
    }
    const at = this.now(), { no, doc: seq } = await this.nextNo(this.cfg.invoicePrefix || 'RES');
    const sale = { id: this.uid(), no, type: 'sale', status: 'posted', at, customerId: custId, priceMode: input.priceMode || 'retail',
      lines, subtotal: calc.subtotal, discount: calc.invoiceDiscount, total, paid, credit,
      cogs: lines.reduce((a, l) => a + l.cogs, 0), payments, note: input.note || '', cashier: this.role,
      method: credit === total ? 'credit' : (credit > 0 || payments.length > 1) ? 'split' : payments[0].account };
    const docs = [seq, { col: 'sales', obj: sale }, ...(extraFn ? extraFn(sale) : [])];
    for (const l of lines) docs.push(this._mov(l.productId, 'sale', -l.baseQty, -l.cogs, sale.id, no, at));
    for (const p of payments) docs.push(this._cash(p.account, p.amount, 'sale', sale.id, no, at));
    if (custId) {
      docs.push(this._led('customer', custId, 'sale', total, sale.id, no, at, no));
      if (paid) docs.push(this._led('customer', custId, 'payment', -paid, sale.id, `Paid at sale ${no}`, at, no));
    }
    await this.commit(docs);
    return sale;
  }

  /** Estimate -> real bill with one click (prices/quantities kept as quoted). */
  async convertEstimate(id, { payments = [], customerId, overrideLimit = false } = {}) {
    this.need('sell');
    return this.run(async () => {
      const est = await this.store.get('sales', id);
      if (!est || est.type !== 'estimate' || est.status !== 'open') throw new ShopError('Estimate is not open');
      const input = { customerId: customerId ?? est.customerId, priceMode: est.priceMode, discount: est.discount, note: est.note,
        payments, overrideLimit, trustPrices: true,
        lines: est.lines.map((l) => ({ productId: l.productId, unit: l.unit, price: l.price, discount: l.discount, note: l.note,
          ...(l.byAmount ? { amount: l.amountInput } : { qty: l.qty, fixedGross: l.gross }) })) };
      // the new bill and the estimate's 'converted' status are committed together
      const sale = await this._postSale(input, (sl) => [{ col: 'sales', obj: { ...est, status: 'converted', convertedTo: sl.id } }]);
      return sale;
    });
  }

  async cancelSale(id, reason = '') {
    this.need('cancel');
    return this.run(async () => {
      const sale = await this.store.get('sales', id);
      if (!sale || sale.type !== 'sale' || sale.status !== 'posted') throw new ShopError('Only posted bills can be cancelled');
      const docs = await this._reversalDocs(id, `Cancelled ${sale.no}`);
      docs.push({ col: 'sales', obj: { ...sale, status: 'cancelled', cancelReason: reason, cancelledAt: this.now() } });
      await this.commit(docs);
    });
  }
  async _reversalDocs(refId, note) {
    const at = this.now(), docs = [];
    const was = (o) => !o.reversalOf && o.refId === refId;
    const done = new Set();
    for (const col of ['movements', 'ledger', 'cashTx']) for (const o of await this.store.all(col)) if (o.reversalOf) done.add(o.reversalOf);
    for (const m of await this.store.all('movements')) if (was(m) && !done.has(m.id)) docs.push({ col: 'movements', obj: { ...m, id: this.uid(), type: 'reversal', qty: -m.qty, value: -m.value, reversalOf: m.id, note, at } });
    for (const l of await this.store.all('ledger')) if (was(l) && !done.has(l.id)) docs.push({ col: 'ledger', obj: { ...l, id: this.uid(), kind: 'reversal', amount: -l.amount, reversalOf: l.id, note, at } });
    for (const c of await this.store.all('cashTx')) if (was(c) && !done.has(c.id)) docs.push({ col: 'cashTx', obj: { ...c, id: this.uid(), kind: 'reversal', amount: -c.amount, reversalOf: c.id, note, at } });
    return docs;
  }

  // ---------- purchases (admin) ----------
  async postPurchase({ supplierId, lines, extra = 0, discount = 0, payments = [], ref = '', note = '' }) {
    this.need('purchase');
    return this.run(async () => {
      if (!this.suppliers.has(supplierId)) throw new ShopError('Select a supplier');
      if (!lines?.length) throw new ShopError('Add at least one item');
      const items = lines.map((l) => {
        const p = this.products.get(l.productId); if (!p) throw new ShopError('Item not found');
        let baseQty; try { baseQty = toBase(p, l.qty, l.unit || p.baseUnit); } catch (e) { throw new ShopError(e.message); }
        const gross = lineAmount(l.qty, l.cost);
        if ((l.discount | 0) > gross) throw new ShopError('Item discount exceeds line amount');
        return { productId: p.id, name: p.name, unit: l.unit || p.baseUnit, qty: l.qty, cost: l.cost, discount: l.discount | 0, gross, net: gross - (l.discount | 0), baseQty };
      });
      const nets = items.map((i) => i.net), billDisc = discount | 0;
      if (billDisc > nets.reduce((a, b) => a + b, 0)) throw new ShopError('Discount exceeds bill amount');
      const shareDisc = allocate(billDisc, nets), shareExtra = allocate(extra | 0, nets);
      items.forEach((it, i) => { it.landed = it.net - shareDisc[i] + shareExtra[i]; });
      const total = items.reduce((a, i) => a + i.landed, 0);
      const pays = payments.filter((p) => p.amount > 0), paid = pays.reduce((a, p) => a + p.amount, 0);
      if (paid > total) throw new ShopError('Payment exceeds the purchase total');
      const at = this.now(), { no, doc } = await this.nextNo('PUR');
      const pur = { id: this.uid(), no, status: 'posted', at, supplierId, ref, note, items, extra: extra | 0, discount: billDisc, total, paid, payments: pays };
      const docs = [doc, { col: 'purchases', obj: pur }];
      for (const it of items) {
        docs.push(this._mov(it.productId, 'purchase', it.baseQty, it.landed, pur.id, no, at));
        docs.push({ col: 'products', obj: { ...this.products.get(it.productId), lastCost: mulDiv(it.landed, 1000, it.baseQty) } });
      }
      docs.push(this._led('supplier', supplierId, 'purchase', total, pur.id, no, at, no));
      if (paid) docs.push(this._led('supplier', supplierId, 'payment', -paid, pur.id, `Paid at purchase ${no}`, at, no));
      for (const p of pays) docs.push(this._cash(p.account, -p.amount, 'purchase_payment', pur.id, no, at));
      await this.commit(docs);
      return pur;
    });
  }
  async cancelPurchase(id, reason = '') {
    this.need('purchase');
    return this.run(async () => {
      const pur = await this.store.get('purchases', id);
      if (!pur || pur.status !== 'posted') throw new ShopError('Only posted purchases can be cancelled');
      if (!this.cfg.allowNegative) for (const it of pur.items) if (this.stockOf(it.productId).qty < it.baseQty) throw new ShopError(`Cannot cancel: ${it.name} was already sold`);
      const docs = await this._reversalDocs(id, `Cancelled ${pur.no}`);
      docs.push({ col: 'purchases', obj: { ...pur, status: 'cancelled', cancelReason: reason } });
      await this.commit(docs);
    });
  }

  // ---------- expenses, cash, transfers ----------
  async addExpense({ category, amount, account = 'cash', note = '', at }) {
    this.need('expense');
    return this.run(async () => {
      if (!(amount > 0)) throw new ShopError('Amount must be greater than zero');
      const when = at || this.now(), { no, doc } = await this.nextNo('EXP');
      const e = { id: this.uid(), no, status: 'posted', at: when, category: category || 'Other', amount, account, note };
      await this.commit([doc, { col: 'expenses', obj: e }, this._cash(account, -amount, 'expense', e.id, category, when)]);
      return e;
    });
  }
  async cancelExpense(id) {
    this.need('expense');
    return this.run(async () => {
      const e = await this.store.get('expenses', id);
      if (!e || e.status !== 'posted') throw new ShopError('Expense is not active');
      const docs = await this._reversalDocs(id, `Cancelled ${e.no}`);
      docs.push({ col: 'expenses', obj: { ...e, status: 'cancelled' } });
      await this.commit(docs);
    });
  }
  async transfer({ from, to, amount, note = '' }) {
    this.need('expense');
    return this.run(async () => {
      if (from === to) throw new ShopError('Choose two different accounts');
      if (!(amount > 0)) throw new ShopError('Amount must be greater than zero');
      const at = this.now(), id = this.uid();
      await this.commit([this._cash(from, -amount, 'transfer', id, note, at), this._cash(to, amount, 'transfer', id, note, at)]);
    });
  }
  async ownerTx({ account, amount, contribution, note = '' }) {
    this.need('expense');
    return this.run(async () => {
      if (!(amount > 0)) throw new ShopError('Amount must be greater than zero');
      await this.commit([this._cash(account, contribution ? amount : -amount, contribution ? 'owner_in' : 'owner_out', this.uid(), note, this.now())]);
    });
  }
  accountBalance(account) { return (this.cfg[`opening_${account}`] | 0) + (this.acct.get(account) || 0); }

  // ---------- rentals ----------
  async saveRentalItem(input) {
    this.need('rental_admin');
    const old = input.id ? this.rentalItems.get(input.id) : null;
    const o = { id: old?.id || this.uid(), name: (input.name || '').trim(), nameUr: input.nameUr || '', total: input.total | 0,
      rateType: input.rateType === 'hour' ? 'hour' : 'day', rate: input.rate | 0, deposit: input.deposit | 0, active: input.active !== false };
    if (!o.name || o.total < 0) throw new ShopError('Name and total quantity are required');
    await this.commit([{ col: 'rentalItems', obj: o }]);
    return o;
  }
  rentedOut(itemId) {
    let n = 0;
    for (const r of this.rentals.values()) if (r.status !== 'returned') for (const i of r.items) if (i.itemId === itemId) n += i.qty - i.returned;
    return n;
  }
  availability(itemId) { return (this.rentalItems.get(itemId)?.total || 0) - this.rentedOut(itemId); }

  async checkoutRental({ customerId = null, customerName, phone = '', address = '', items, deposit = 0, account = 'cash', idNote = '', note = '', dueAt = null, at: givenAt = null }) {
    this.need('rentals');
    return this.run(async () => {
      if (!(customerName || '').trim()) throw new ShopError('Customer name is required');
      if (!items?.length) throw new ShopError('Add at least one rental item');
      const lines = items.map((i) => {
        const it = this.rentalItems.get(i.itemId);
        if (!it || !it.active) throw new ShopError('Rental item not found');
        if (!Number.isInteger(i.qty) || i.qty <= 0) throw new ShopError('Quantity must be a whole number');
        if (this.availability(it.id) < i.qty) throw new ShopError(`Only ${this.availability(it.id)} ${it.name} available`, 'rental_stock');
        return { itemId: it.id, name: it.name, qty: i.qty, returned: 0, rateType: i.rateType || it.rateType, rate: i.rate ?? it.rate };
      });
      const now = this.now(), at = givenAt ?? now;
      if (at > now + 5 * 60000) throw new ShopError('The date it was given cannot be in the future');
      const { no, doc } = await this.nextNo('RNT');
      const r = { id: this.uid(), no, status: 'out', customerId, customerName: customerName.trim(), phone, address, idNote, note, outAt: at, dueAt,
        items: lines, deposit: deposit | 0, depositHeld: deposit | 0, charges: 0, returns: [] };
      const docs = [doc, { col: 'rentals', obj: r }];
      if (deposit > 0) docs.push(this._cash(account, deposit, 'rental_deposit', r.id, no, at));
      await this.commit(docs);
      return r;
    });
  }
  /**
   * What the rental costs if the given items come back at `at`. Daily items are charged DATE-WISE: every calendar day from
   * the day it was given to the return day (both included). `dayRows` lists the rent for each date.
   */
  rentalPreview(rental, items, at = this.now()) {
    const lines = (items || rental.items.map((i) => ({ itemId: i.itemId, qty: i.qty - i.returned }))).filter((i) => i.qty > 0);
    let charge = 0; const byDay = new Map(), detail = [];
    for (const x of lines) {
      const it = rental.items.find((i) => i.itemId === x.itemId);
      if (it.rateType === 'hour') {
        const units = rentalUnits(rental.outAt, at, 'hour', this.cfg.rentalGraceMin | 0), c = units * it.rate * x.qty;
        charge += c; detail.push({ itemId: x.itemId, name: it.name, qty: x.qty, rate: it.rate, units, rateType: 'hour', charge: c });
      } else {
        const days = rentalDayList(rental.outAt, at), c = days.length * it.rate * x.qty;
        charge += c; detail.push({ itemId: x.itemId, name: it.name, qty: x.qty, rate: it.rate, units: days.length, rateType: 'day', charge: c, from: days[0], to: days[days.length - 1] });
        for (const d of days) byDay.set(d, (byDay.get(d) || 0) + it.rate * x.qty);
      }
    }
    const dayRows = [...byDay].sort((a, b) => a[0] - b[0]).map(([day, amount]) => ({ day, amount }));
    return { charge, detail, dayRows };
  }
  async returnRental(id, { items, at, payments = [], refundAccount = 'cash', note = '' } = {}) {
    this.need('rentals');
    return this.run(async () => {
      const cur = await this.store.get('rentals', id);
      if (!cur || cur.status === 'returned') throw new ShopError('Rental is already closed');
      const r = JSON.parse(JSON.stringify(cur)), now = this.now(), when = at || now;
      if (when > now + 5 * 60000) throw new ShopError('The return date cannot be in the future');
      const ret = (items || r.items.map((i) => ({ itemId: i.itemId, qty: i.qty - i.returned }))).filter((i) => i.qty > 0);
      if (!ret.length) throw new ShopError('Nothing to return');
      for (const x of ret) {
        const it = r.items.find((i) => i.itemId === x.itemId);
        if (!it || x.qty > it.qty - it.returned) throw new ShopError('Return quantity is more than rented');
      }
      let prev; try { prev = this.rentalPreview(r, ret, when); } catch (e) { throw new ShopError(e.message); }
      const C = prev.charge;
      for (const x of ret) r.items.find((i) => i.itemId === x.itemId).returned += x.qty;
      r.charges += C;
      const applied = Math.min(r.depositHeld, C); r.depositHeld -= applied;
      const due = C - applied, pays = payments.filter((p) => p.amount > 0), P = pays.reduce((a, p) => a + p.amount, 0);
      if (P > due) throw new ShopError('Payment is more than the amount due');
      const credit = due - P;
      if (credit > 0 && !r.customerId) throw new ShopError('Collect the full amount or link a customer (udhaar)', 'walkin_credit');
      const docs = [];
      if (r.customerId && C > 0) {
        docs.push(this._led('customer', r.customerId, 'rental', C, r.id, r.no, when, r.no));
        if (applied + P > 0) docs.push(this._led('customer', r.customerId, 'payment', -(applied + P), r.id, `Rental ${r.no} settled`, when, r.no));
      }
      for (const p of pays) docs.push(this._cash(p.account, p.amount, 'rental_payment', r.id, r.no, when));
      const allBack = r.items.every((i) => i.returned === i.qty);
      let refund = 0;
      if (allBack) { r.status = 'returned'; r.closedAt = when; refund = r.depositHeld; r.depositHeld = 0; if (refund > 0) docs.push(this._cash(refundAccount, -refund, 'rental_refund', r.id, r.no, when)); }
      else r.status = 'partial';
      r.returns.push({ at: when, items: ret, charge: C, applied, paid: P, credit, refund, note, detail: prev.detail, dayRows: prev.dayRows });
      docs.push({ col: 'rentals', obj: r });
      await this.commit(docs);
      return { rental: r, charge: C, applied, paid: P, credit, refund };
    });
  }
  /** Plain-text rental bill (date-wise) for WhatsApp. */
  rentalBillText(r, lang = 'en') {
    const ro = lang === 'ur';
    const L = ro ? { bill: 'Kiraye ka bill', cust: 'Gahak', given: 'Diya', back: 'Wapsi', days: 'din', bydate: 'Tareekh ke hisab se kiraya', total: 'Kul kiraya', dep: 'Zamanat jama', paid: 'Ada kiya', due: 'Baqi (udhaar)', refund: 'Zamanat wapas', pending: 'Abhi wapas nahi hua' }
      : { bill: 'Rental bill', cust: 'Customer', given: 'Given', back: 'Returned', days: 'days', bydate: 'Rent date-wise', total: 'Total rent', dep: 'Deposit taken', paid: 'Paid', due: 'Balance (udhaar)', refund: 'Deposit refunded', pending: 'Not returned yet' };
    const out = [this.cfg.shopName, `${L.bill} ${r.no}`, `${L.cust}: ${r.customerName}${r.phone ? ' ' + r.phone : ''}`, `${L.given}: ${fmtDate(r.outAt)}`];
    for (const x of r.returns) {
      out.push('', `${L.back}: ${fmtDate(x.at)}`);
      for (const d of x.detail || []) out.push(`• ${d.qty} x ${d.name}: ${d.units} ${d.rateType === 'hour' ? 'hr' : L.days} × ${fmtRs(d.rate)} = ${fmtRs(d.charge)}`);
      if (x.dayRows?.length) { out.push(`${L.bydate}:`); for (const d of x.dayRows) out.push(`  ${fmtDate(d.day)}: ${fmtRs(d.amount)}`); }
    }
    const open = r.items.filter((i) => i.qty > i.returned).map((i) => `${i.qty - i.returned} x ${i.name}`);
    if (open.length) out.push('', `${L.pending}: ${open.join(', ')}`);
    const paid = r.returns.reduce((a, x) => a + x.paid, 0), credit = r.returns.reduce((a, x) => a + x.credit, 0), refund = r.returns.reduce((a, x) => a + x.refund, 0);
    out.push('', `${L.total}: ${fmtRs(r.charges)}`);
    if (r.deposit) out.push(`${L.dep}: ${fmtRs(r.deposit)}`);
    if (paid) out.push(`${L.paid}: ${fmtRs(paid)}`);
    if (credit) out.push(`${L.due}: ${fmtRs(credit)}`);
    if (refund) out.push(`${L.refund}: ${fmtRs(refund)}`);
    return out.join('\n');
  }
  rentalBillLink(r, lang) { return waLink(r.phone, this.rentalBillText(r, lang)); }

  /** Data safety check: do bills add up, do the cached balances match the saved rows, is anything negative? */
  async selfCheck() {
    const issues = [], [sales, mv, lg, cx] = await Promise.all(['sales', 'movements', 'ledger', 'cashTx'].map((c) => this.store.all(c)));
    for (const s of sales.filter((x) => x.type === 'sale' && x.status === 'posted')) {
      if (s.lines.reduce((a, l) => a + l.gross - l.discount, 0) - s.discount !== s.total) issues.push(`Bill ${s.no}: total does not match its items`);
      if (s.paid + s.credit !== s.total) issues.push(`Bill ${s.no}: paid + udhaar is not equal to the total`);
    }
    const sum = (rows, key, val) => { const m = new Map(); for (const r of rows) m.set(key(r), (m.get(key(r)) || 0) + val(r)); return m; };
    const stockQ = sum(mv, (m) => m.productId, (m) => m.qty), stockV = sum(mv, (m) => m.productId, (m) => m.value);
    for (const p of this.products.values()) {
      const c = this.stockOf(p.id);
      if (c.qty !== (stockQ.get(p.id) || 0) || c.value !== (stockV.get(p.id) || 0)) issues.push(`Stock of ${p.name} does not match its movements`);
      if (c.qty < 0) issues.push(`${p.name} has negative stock`);
    }
    const bal = sum(lg, (l) => `${l.party}:${l.partyId}`, (l) => l.amount);
    for (const [k, v] of bal) if (v !== (this.bal.get(k) || 0)) issues.push(`Khata balance mismatch (${k})`);
    const acc = sum(cx, (c) => c.account, (c) => c.amount);
    for (const [k, v] of acc) if (v !== (this.acct.get(k) || 0)) issues.push(`Cash/bank balance mismatch (${k})`);
    for (const r of this.rentals.values()) {
      if (r.depositHeld < 0) issues.push(`Rental ${r.no}: negative deposit`);
      for (const i of r.items) if (i.returned > i.qty) issues.push(`Rental ${r.no}: more returned than rented`);
    }
    return { ok: issues.length === 0, issues, counts: { products: this.products.size, customers: this.customers.size, bills: sales.filter((s) => s.type === 'sale').length, rentals: this.rentals.size, entries: mv.length + lg.length + cx.length } };
  }

  activeRentals() { return [...this.rentals.values()].filter((r) => r.status !== 'returned').sort((a, b) => a.outAt - b.outAt); }
  rentalReminderText(r, lang = 'en') {
    const items = r.items.filter((i) => i.qty > i.returned).map((i) => `${i.qty - i.returned} x ${i.name}`).join(', ');
    return lang === 'ur'
      ? `Assalam o Alaikum ${r.customerName},
${this.cfg.shopName}: aap ke paas kiraye ka saman (${items}) hai. Meherbani kar ke wapas kar dein. Shukriya.`
      : `Assalam o Alaikum ${r.customerName},\n${this.cfg.shopName}: you still have rented items (${items}). Please return them. Thank you.`;
  }

  // ---------- invoices text ----------
  invoiceText(sale, lang = 'en') {
    const rows = sale.lines.map((l) => `• ${lang === 'ur' && l.nameUr ? l.nameUr : l.name}${l.size ? ' ' + l.size : ''}: ${l.qty / 1000} ${l.unit} = ${fmtRs(l.net, { sym: false })}`).join('\n');
    return `${this.cfg.shopName}\n${sale.no}\n${rows}\nTotal: ${fmtRs(sale.total)}\nPaid: ${fmtRs(sale.paid)}\nBalance: ${fmtRs(sale.credit)}`;
  }

  // ---------- reports ----------
  async sales({ from = 0, to = Infinity, status = 'posted', type = 'sale' } = {}) {
    return (await this.store.all('sales')).filter((s) => s.type === type && s.status === status && s.at >= from && s.at < to).sort((a, b) => a.at - b.at);
  }
  async salesReport({ from, to, period = 'day' }) {
    const m = new Map();
    for (const s of await this.sales({ from, to })) {
      const k = periodKey(s.at, period), r = m.get(k) || { key: k, count: 0, total: 0, paid: 0, credit: 0, discount: 0 };
      r.count++; r.total += s.total; r.paid += s.paid; r.credit += s.credit;
      r.discount += s.discount + s.lines.reduce((a, l) => a + l.discount, 0); m.set(k, r);
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
  async itemReport({ from, to }) {
    this.need('profit');
    const m = new Map();
    for (const s of await this.sales({ from, to })) for (const l of s.lines) {
      const r = m.get(l.productId) || { productId: l.productId, name: l.name, baseQty: 0, revenue: 0, cogs: 0, profit: 0, marginBp: 0 };
      r.baseQty += l.baseQty; r.revenue += l.net; r.cogs += l.cogs; m.set(l.productId, r);
    }
    return [...m.values()].map((r) => ({ ...r, profit: r.revenue - r.cogs, marginBp: r.revenue ? mulDiv(r.revenue - r.cogs, 10000, r.revenue) : 0 })).sort((a, b) => b.profit - a.profit);
  }
  async profitReport({ from, to }) {
    this.need('profit');
    const sales = await this.sales({ from, to });
    const revenue = sales.reduce((a, s) => a + s.total, 0), cogs = sales.reduce((a, s) => a + s.cogs, 0);
    const discounts = sales.reduce((a, s) => a + s.discount + s.lines.reduce((x, l) => x + l.discount, 0), 0);
    let rentalIncome = 0;
    for (const r of this.rentals.values()) for (const x of r.returns) if (x.at >= from && x.at < to) rentalIncome += x.charge;
    const expenses = (await this.store.all('expenses')).filter((e) => e.status === 'posted' && e.at >= from && e.at < to).reduce((a, e) => a + e.amount, 0);
    const gross = revenue - cogs;
    return { revenue, cogs, discounts, grossProfit: gross, rentalIncome, expenses, netProfit: gross + rentalIncome - expenses };
  }
  async expensesReport({ from, to }) {
    const m = new Map();
    for (const e of (await this.store.all('expenses')).filter((x) => x.status === 'posted' && x.at >= from && x.at < to)) m.set(e.category, (m.get(e.category) || 0) + e.amount);
    return [...m].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }
  async cashBook(account, from, to) {
    const all = (await this.store.all('cashTx')).filter((c) => c.account === account).sort((a, b) => a.at - b.at);
    let run = this.cfg[`opening_${account}`] | 0; const rows = [];
    for (const c of all) { run += c.amount; if (c.at >= from && c.at < to) rows.push({ ...c, running: run }); }
    return rows;
  }
  lowStock() { return [...this.products.values()].filter((p) => p.active && p.minStock > 0 && this.stockOf(p.id).qty <= p.minStock); }
  balances(party) {
    const src = party === 'customer' ? this.customers : this.suppliers;
    return [...src.values()].map((x) => ({ ...x, balance: this.balance(party, x.id) })).filter((x) => x.balance !== 0).sort((a, b) => b.balance - a.balance);
  }
  stockValue() { this.need('profit'); let v = 0; for (const s of this.stock.values()) v += s.value; return v; }

  async dashboard() {
    const from = pktDayStart(this.now()), to = from + 86400000;
    const today = await this.sales({ from, to });
    const d = { todaySales: today.reduce((a, s) => a + s.total, 0), todayCount: today.length,
      receivable: this.balances('customer').filter((b) => b.balance > 0).reduce((a, b) => a + b.balance, 0),
      lowStock: this.lowStock().length, rentalsOut: this.activeRentals().length,
      openEstimates: (await this.store.all('sales')).filter((s) => s.type === 'estimate' && s.status === 'open').length,
      accounts: Object.fromEntries(ACCOUNTS.map((a) => [a, this.accountBalance(a)])) };
    if (this.can('profit')) {
      d.payable = this.balances('supplier').filter((b) => b.balance > 0).reduce((a, b) => a + b.balance, 0);
      d.todayProfit = today.reduce((a, s) => a + s.total - s.cogs, 0);
    }
    return d;
  }

  // ---------- backup ----------
  async exportAll() {
    this.need('backup');
    const out = { app: 'ramzan-shop', version: 1, at: this.now(), data: {} };
    for (const c of [...DATA_COLS]) out.data[c] = await this.store.all(c);
    return out;
  }
  async importAll(json, { replace = true } = {}) {
    this.need('backup');
    if (json?.app !== 'ramzan-shop' || !json.data) throw new ShopError('This is not a valid backup file');
    if (replace) { const dev = await this.store.get('meta', 'device'); await this.store.clearAll(); await this.store.batch([{ col: 'meta', obj: dev }]); }
    const ops = [];
    for (const [col, rows] of Object.entries(json.data)) {
      if (!DATA_COLS.has(col)) continue;
      for (const o of rows) ops.push({ col, obj: o });
    }
    await this.store.batch(ops);
    await this.rebuild();
    return ops.length;
  }
}
