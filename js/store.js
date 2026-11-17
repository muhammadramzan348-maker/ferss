import { DEFAULT_CATEGORIES } from "./data.js";

const DB = "noctis", STORE = "kv", KEY = "state", LS = "noctis_state";

export function blank() {
  const s = {
    v: 1, seq: 1,
    tasks: [], prayerCfg: {}, prayerLogs: {}, jumuah: {},
    income: [], cats: [], expenses: [],
    crypto: [], cryptoBalance: 0,
    custom: [], gymDays: {}, gymEx: [], gymLogs: {}, bin: [],
  };
  DEFAULT_CATEGORIES.forEach(([name, bucket]) => s.cats.push({ id: s.seq++, name, bucket, monthly_limit: 0 }));
  return s;
}

export let state = blank();
export const nextId = () => state.seq++;
export function setState(s) { state = s; save(); }

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const idbGet = async () => {
  const db = await openDb();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE).objectStore(STORE).get(KEY);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
};
const idbPut = async (v) => {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(v, KEY);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
};

export async function load() {
  let v = null;
  try { v = await idbGet(); } catch {}
  if (!v) { try { v = JSON.parse(localStorage.getItem(LS) || "null"); } catch {} }
  if (v) state = { ...blank(), ...v };
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
  return state;
}

let pending = false;
export function save() {
  if (pending) return;
  pending = true;
  queueMicrotask(async () => {
    pending = false;
    const snap = JSON.parse(JSON.stringify(state));
    try { await idbPut(snap); }
    catch { try { localStorage.setItem(LS, JSON.stringify(snap)); } catch {} }
  });
}
export const flush = () => idbPut(JSON.parse(JSON.stringify(state))).catch(() => {});

/* small meta store (PIN, last backup) - kept OUT of the data state and out of backups */
export const meta = {
  get(k, d = null) { try { const v = JSON.parse(localStorage.getItem("noctis_meta_" + k)); return v ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem("noctis_meta_" + k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem("noctis_meta_" + k); },
};
