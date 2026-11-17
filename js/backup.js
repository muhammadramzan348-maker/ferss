import { state, blank, setState } from "./store.js";
import { isDate, ymd } from "./util.js";
import { PRAYERS, JUMUAH_ITEMS } from "./data.js";

const FORMAT = 1, ITER = 250000;
export class BackupError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const aad = (createdAt, f) => enc.encode(`NOCTIS|${f}|${createdAt}`);

async function key(password, salt, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptBackup(payload, password) {
  const createdAt = new Date().toISOString();
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await key(password, salt, ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(createdAt, FORMAT) }, k, enc.encode(JSON.stringify(payload))));
  return JSON.stringify({ app: "NOCTIS", platform: "pwa", format: FORMAT, kdf: "pbkdf2-sha256", cipher: "aes-256-gcm", iter: ITER, createdAt, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}

export function peekEnvelope(text) {
  let env;
  try { env = JSON.parse(text); } catch { throw new BackupError("not_backup", "This file is not a NOCTIS backup."); }
  if (!env || env.app !== "NOCTIS" || typeof env.data !== "string") throw new BackupError("not_backup", "This file is not a NOCTIS backup.");
  if (env.cipher !== "aes-256-gcm")
    throw new BackupError("platform", "This backup was made by the Android app (different encryption). Restore it in the Android app, or export from there first.");
  if (env.format > FORMAT) throw new BackupError("newer", "This backup was made by a newer version of NOCTIS.");
  if (!(env.iter >= 10000 && env.iter <= 3000000)) throw new BackupError("corrupt", "Backup header is damaged.");
  return env;
}

export async function decryptBackup(text, password) {
  const env = peekEnvelope(text);
  let plain;
  try {
    const k = await key(password, unb64(env.salt), env.iter);
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv), additionalData: aad(env.createdAt, env.format) }, k, unb64(env.data));
  } catch { throw new BackupError("bad_password", "Wrong password, or the file is damaged."); }
  try { return { data: JSON.parse(dec.decode(plain)), createdAt: env.createdAt }; }
  catch { throw new BackupError("corrupt", "Backup content is damaged."); }
}

/* ------------------------------------------------------------------ */
const S = (v) => (v == null ? null : String(v));
const N = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const B = (v) => !!N(v);

/** Validates + coerces untrusted backup JSON into a clean state object. */
export function normalize(raw) {
  if (!raw || typeof raw !== "object" || raw.app !== "NOCTIS" || typeof raw.state !== "object" || !raw.state)
    throw new BackupError("corrupt", "Backup content is invalid.");
  if (N(raw.schema, 1) > 1) throw new BackupError("newer", "This backup was made by a newer version of NOCTIS.");
  const r = raw.state, o = blank();
  o.cats = [];
  const arr = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === "object") : []);
  const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

  o.tasks = arr(r.tasks).map((t) => {
    const days = Array.isArray(t.days) ? [...new Set(t.days.map(Number).filter((n) => n >= 1 && n <= 7))].sort() : [];
    const doneOn = {};
    if (t.doneOn && typeof t.doneOn === "object") for (const [d, v] of Object.entries(t.doneOn)) if (isDate(d)) doneOn[d] = S(v) || "1";
    return { id: N(t.id), title: S(t.title) || "", time: /^\d{2}:\d{2}$/.test(S(t.time) || "") ? t.time : null, date: S(t.date) || "", done: B(t.done), doneAt: S(t.doneAt), days: days.length ? days : null, doneOn, priority: ["low", "normal", "high"].includes(t.priority) ? t.priority : "normal", note: S(t.note) || "" };
  }).filter((t) => t.title && isDate(t.date));
  const okP = new Set([...PRAYERS.map((p) => p.key), "jumuah"]), okJ = new Set(JUMUAH_ITEMS.map((j) => j.key));
  for (const [k, c] of Object.entries(obj(r.prayerCfg)))
    if (okP.has(k) && c) o.prayerCfg[k] = { time: /^\d{2}:\d{2}$/.test(S(c.time) || "") ? c.time : "05:00", on: B(c.on) };
  for (const [d, m] of Object.entries(obj(r.prayerLogs))) if (isDate(d)) for (const [k, v] of Object.entries(obj(m))) if (okP.has(k) && B(v)) (o.prayerLogs[d] ||= {})[k] = true;
  for (const [d, m] of Object.entries(obj(r.jumuah))) if (isDate(d)) for (const [k, v] of Object.entries(obj(m))) if (okJ.has(k) && B(v)) (o.jumuah[d] ||= {})[k] = true;
  o.income = arr(r.income).map((i) => ({ id: N(i.id), amount: N(i.amount), source: S(i.source), date: S(i.date) || "", needs_pct: N(i.needs_pct, 50), wants_pct: N(i.wants_pct, 30), savings_pct: N(i.savings_pct, 20) })).filter((i) => i.amount > 0 && isDate(i.date));
  o.cats = arr(r.cats).map((c) => ({ id: N(c.id), name: (S(c.name) || "").trim(), bucket: c.bucket === "wants" ? "wants" : "needs", monthly_limit: Math.max(0, N(c.monthly_limit)) })).filter((c) => c.name);
  o.expenses = arr(r.expenses).map((e) => ({ id: N(e.id), amount: N(e.amount), category_id: N(e.category_id), note: S(e.note), date: S(e.date) || "" })).filter((e) => e.amount > 0 && isDate(e.date));
  o.crypto = arr(r.crypto).map((c) => ({ id: N(c.id), date: S(c.date) || "", usdt_bought: N(c.usdt_bought), buy_rate: N(c.buy_rate), usdt_sold: N(c.usdt_sold), sell_rate: N(c.sell_rate), trades: Math.round(N(c.trades)), pnl: N(c.pnl), pnl_currency: c.pnl_currency === "USDT" ? "USDT" : "PKR", pnl_pkr: N(c.pnl_pkr), note: S(c.note) })).filter((c) => isDate(c.date));
  o.cryptoBalance = N(r.cryptoBalance);
  o.custom = arr(r.custom).map((c) => ({ name: (S(c.name) || "").trim(), group: S(c.group) || "Other", target: S(c.target) || "" })).filter((c) => c.name);
  for (const [wd, d] of Object.entries(obj(r.gymDays))) if (+wd >= 1 && +wd <= 7) o.gymDays[wd] = { groups: Array.isArray(d?.groups) ? d.groups.filter((g) => typeof g === "string") : [] };
  o.gymEx = arr(r.gymEx).map((e) => ({ id: N(e.id), wd: N(e.wd), name: (S(e.name) || "").trim(), sets: e.sets == null ? null : Math.round(N(e.sets)), reps: S(e.reps) })).filter((e) => e.wd >= 1 && e.wd <= 7 && e.name);
  for (const [k, v] of Object.entries(obj(r.gymLogs))) if (B(v)) o.gymLogs[k] = true;
  const KINDS = new Set(["task", "gymEx", "expense", "income", "crypto", "cat"]);
  o.bin = arr(r.bin).filter((b) => KINDS.has(b.kind) && b.data && typeof b.data === "object")
    .map((b) => ({ id: N(b.id), kind: b.kind, data: b.data, label: S(b.label) || "", deletedAt: S(b.deletedAt) || new Date().toISOString() }));
  return o;
}

export function collect() { return { app: "NOCTIS", schema: 1, platform: "pwa", createdAt: new Date().toISOString(), state: JSON.parse(JSON.stringify(state)) }; }

export const SUMMARY = [["tasks", "Tasks"], ["prayerLogs", "Prayer days"], ["jumuah", "Jummah days"], ["income", "Income entries"], ["expenses", "Expenses"], ["cats", "Finance categories"], ["crypto", "Binance entries"], ["gymEx", "Gym exercises"], ["bin", "Recycle Bin items"]];
export const summarize = (st) => SUMMARY.map(([k, label]) => ({ label, count: Array.isArray(st[k]) ? st[k].length : Object.keys(st[k] || {}).length }));

/**
 * Duplicate-safe merge. Rows are matched by CONTENT and counted as a multiset, so restoring
 * the same file twice adds nothing, but two genuinely identical entries are both kept.
 * Pure: returns { next, added, skipped } and never mutates `local`.
 */
export function mergeStates(local, inc) {
  const next = JSON.parse(JSON.stringify(local));
  const added = {}, skipped = {};
  const bump = (m, k) => (m[k] = (m[k] || 0) + 1);
  let seq = Math.max(next.seq || 1, 1);
  const id = () => seq++;
  const multiset = (name, rows, localRows, keyOf, insert) => {
    const have = new Map(), seen = new Map();
    localRows.forEach((r) => have.set(keyOf(r), (have.get(keyOf(r)) || 0) + 1));
    for (const r of rows) {
      const k = keyOf(r), c = (seen.get(k) || 0) + 1;
      seen.set(k, c);
      if (c > (have.get(k) || 0)) { insert(r); bump(added, name); } else bump(skipped, name);
    }
  };

  const tkey = (t) => `${t.title}|${t.time || ""}|${t.date}|${(t.days || []).join(",")}`;
  multiset("tasks", inc.tasks, next.tasks, tkey, (t) => next.tasks.push({ ...t, id: id() }));
  for (const t of inc.tasks) if (t.days) { // repeating task already here: union the days you ticked off
    const loc = next.tasks.find((x) => tkey(x) === tkey(t));
    if (loc) { loc.doneOn ||= {}; for (const d of Object.keys(t.doneOn || {})) loc.doneOn[d] ||= t.doneOn[d]; }
  }

  for (const [k, c] of Object.entries(inc.prayerCfg)) { if (next.prayerCfg[k]) bump(skipped, "prayerCfg"); else { next.prayerCfg[k] = { ...c }; bump(added, "prayerCfg"); } }
  const orMerge = (name, from, to) => {
    for (const [d, m] of Object.entries(from)) for (const k of Object.keys(m)) {
      if ((to[d] || {})[k]) bump(skipped, name); else { (to[d] ||= {})[k] = true; bump(added, name); }
    }
  };
  orMerge("prayerLogs", inc.prayerLogs, next.prayerLogs);
  orMerge("jumuah", inc.jumuah, next.jumuah);

  // categories first (expenses refer to them): match by name + bucket
  const catMap = new Map();
  for (const c of inc.cats) {
    let ex = next.cats.find((x) => x.name === c.name && x.bucket === c.bucket);
    if (ex) { if (!ex.monthly_limit && c.monthly_limit) ex.monthly_limit = c.monthly_limit; bump(skipped, "cats"); }
    else { ex = { id: id(), name: c.name, bucket: c.bucket, monthly_limit: c.monthly_limit }; next.cats.push(ex); bump(added, "cats"); }
    catMap.set(c.id, ex);
  }
  multiset("income", inc.income, next.income, (i) => [i.amount, i.source || "", i.date, i.needs_pct, i.wants_pct, i.savings_pct].join("|"), (i) => next.income.push({ ...i, id: id() }));

  const catOf = (cid) => next.cats.find((c) => c.id === cid);
  const incExp = inc.expenses.filter((e) => catMap.has(e.category_id));
  if (inc.expenses.length - incExp.length) skipped.expenses = (skipped.expenses || 0) + inc.expenses.length - incExp.length;
  multiset("expenses", incExp.map((e) => ({ ...e, _c: catMap.get(e.category_id) })),
    next.expenses.map((e) => ({ ...e, _c: catOf(e.category_id) || {} })),
    (e) => [e.amount, e.note || "", e.date, e._c.name, e._c.bucket].join("|"),
    (e) => next.expenses.push({ id: id(), amount: e.amount, category_id: e._c.id, note: e.note, date: e.date }));

  multiset("crypto", inc.crypto, next.crypto, (c) => [c.date, c.usdt_bought, c.buy_rate, c.usdt_sold, c.sell_rate, c.trades, c.pnl, c.pnl_currency, c.note || ""].join("|"), (c) => next.crypto.push({ ...c, id: id() }));
  if (!next.cryptoBalance && inc.cryptoBalance) { next.cryptoBalance = inc.cryptoBalance; bump(added, "crypto"); }

  for (const c of inc.custom) { if (next.custom.some((x) => x.name === c.name)) bump(skipped, "custom"); else { next.custom.push(c); bump(added, "custom"); } }
  for (const [wd, d] of Object.entries(inc.gymDays)) {
    const cur = (next.gymDays[wd] ||= { groups: [] });
    for (const g of d.groups) if (!cur.groups.includes(g)) { cur.groups.push(g); bump(added, "gymDays"); }
  }
  // exercises: k-th identical row maps onto the k-th identical local row (gives an id map for the logs)
  const exMap = new Map(), seenEx = new Map();
  for (const e of inc.gymEx) {
    const k = `${e.wd}|${e.name}|${e.sets ?? ""}|${e.reps ?? ""}`, c = (seenEx.get(k) || 0) + 1;
    seenEx.set(k, c);
    const hit = next.gymEx.filter((x) => `${x.wd}|${x.name}|${x.sets ?? ""}|${x.reps ?? ""}` === k);
    if (hit.length >= c) { exMap.set(e.id, hit[c - 1].id); bump(skipped, "gymEx"); }
    else { const row = { id: id(), wd: e.wd, name: e.name, sets: e.sets, reps: e.reps }; next.gymEx.push(row); exMap.set(e.id, row.id); bump(added, "gymEx"); }
  }
  for (const k of Object.keys(inc.gymLogs)) {
    const [eid, date] = k.split("@"), local = exMap.get(Number(eid));
    if (!local) continue;
    const nk = `${local}@${date}`;
    if (next.gymLogs[nk]) bump(skipped, "gymLogs"); else { next.gymLogs[nk] = true; bump(added, "gymLogs"); }
  }
  next.bin ||= [];
  multiset("bin", inc.bin || [], next.bin, (b) => `${b.kind}|${b.deletedAt}|${JSON.stringify(b.data)}`, (b) => next.bin.push({ ...b, id: id() }));
  next.seq = seq;
  return { next, added, skipped };
}

/** Replace mode: swap in the backup's data wholesale (ids kept; seq moved past them). */
export function replaceState(inc) {
  const o = JSON.parse(JSON.stringify(inc));
  const ids = [...o.tasks, ...o.income, ...o.cats, ...o.expenses, ...o.crypto, ...o.gymEx, ...o.bin].map((x) => x.id || 0);
  o.seq = Math.max(1, ...ids) + 1;
  if (!o.cats.length) { const b = blank(); o.cats = b.cats; o.seq = Math.max(o.seq, b.seq); }
  return o;
}

export function restore(raw, mode) {
  const inc = normalize(raw);
  if (mode === "replace") { setState(replaceState(inc)); return { added: { all: 1 }, skipped: {} }; }
  const { next, added, skipped } = mergeStates(state, inc);
  setState(next);
  return { added, skipped };
}
