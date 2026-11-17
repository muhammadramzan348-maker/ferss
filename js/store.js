// Storage adapters. MemoryStore is used by tests; IdbStore (IndexedDB) by the browser.
export const COLS = ['settings', 'products', 'categories', 'customers', 'suppliers', 'sales', 'purchases',
  'movements', 'ledger', 'cashTx', 'expenses', 'rentalItems', 'rentals', 'meta'];
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export class MemoryStore {
  constructor() { this.d = Object.fromEntries(COLS.map((c) => [c, new Map()])); }
  async get(c, id) { return clone(this.d[c].get(id)); }
  async all(c) { return [...this.d[c].values()].map(clone); }
  /** ops: [{col, obj}] or [{col, del: id}] applied atomically */
  async batch(ops) {
    for (const o of ops) { if (!this.d[o.col]) throw new Error(`Unknown collection ${o.col}`); }
    for (const o of ops) { if (o.del) this.d[o.col].delete(o.del); else this.d[o.col].set(o.obj.id, clone(o.obj)); }
  }
  async clearAll() { for (const c of COLS) this.d[c].clear(); }
}

export class IdbStore {
  constructor(name = 'ramzan-electric-store') { this.name = name; this.db = null; }
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => { for (const c of COLS) if (!r.result.objectStoreNames.contains(c)) r.result.createObjectStore(c, { keyPath: 'id' }); };
      r.onsuccess = () => { this.db = r.result; res(this); };
      r.onerror = () => rej(r.error);
    });
  }
  _req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async get(c, id) { return this._req(this.db.transaction(c).objectStore(c).get(id)); }
  async all(c) { return this._req(this.db.transaction(c).objectStore(c).getAll()); }
  batch(ops) {
    return new Promise((res, rej) => {
      const names = [...new Set(ops.map((o) => o.col))];
      if (!names.length) return res();
      let tx;
      try { tx = this.db.transaction(names, 'readwrite', { durability: 'strict' }); }   // flushed to disk before 'complete'
      catch { tx = this.db.transaction(names, 'readwrite'); }
      for (const o of ops) { const s = tx.objectStore(o.col); if (o.del) s.delete(o.del); else s.put(o.obj); }
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Transaction aborted'));
    });
  }
  async clearAll() {
    const tx = this.db.transaction(COLS, 'readwrite');
    for (const c of COLS) tx.objectStore(c).clear();
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
}
