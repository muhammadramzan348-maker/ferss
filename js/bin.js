import { state, save, nextId, meta } from "./store.js";
import { WEEKDAYS } from "./data.js";
import { money, signedMoney, isDate, fmtDay } from "./util.js";
import { confirmBox, alertBox, toast } from "./ui.js";
import { requireAuth } from "./guard.js";
import { normalize } from "./backup.js";

export const KINDS = {
  task: ["✅", "Task"], gymEx: ["🏋️", "Gym exercise"], expense: ["💸", "Expense"],
  income: ["💰", "Income"], crypto: ["📈", "Binance entry"], cat: ["🗂️", "Category"],
};
export const secureDelete = () => !!meta.get("secureDelete");
export const binCount = () => (state.bin || []).length;

/** removes the item from live data and returns what the bin needs to keep, or null */
function take(kind, id) {
  const pull = (key) => { const o = state[key].find((x) => x.id === id); if (o) state[key] = state[key].filter((x) => x !== o); return o; };
  switch (kind) {
    case "task": { const t = pull("tasks"); return t && { data: t, label: t.title }; }
    case "gymEx": {
      const e = state.gymEx.find((x) => x.id === id); if (!e) return null;
      const logs = {};
      for (const k of Object.keys(state.gymLogs)) if (k.startsWith(id + "@")) { logs[k] = true; delete state.gymLogs[k]; }
      state.gymEx = state.gymEx.filter((x) => x !== e);
      return { data: { ex: e, logs }, label: `${e.name} (${WEEKDAYS[e.wd - 1]})` };
    }
    case "expense": { const e = pull("expenses"); const c = e && state.cats.find((x) => x.id === e.category_id); return e && { data: e, label: `${money(e.amount)} · ${c ? c.name : "expense"}` }; }
    case "income": { const i = pull("income"); return i && { data: i, label: `${money(i.amount)} · ${i.source || "Income"}` }; }
    case "crypto": { const c = pull("crypto"); return c && { data: c, label: `${fmtDay(c.date)} · ${signedMoney(c.pnl_pkr)}` }; }
    case "cat": { const c = pull("cats"); return c && { data: c, label: c.name }; }
  }
  return null;
}

export function moveToBin(kind, id) {
  const r = take(kind, id);
  if (!r) return false;
  (state.bin ||= []).unshift({ id: nextId(), kind, data: r.data, label: r.label, deletedAt: new Date().toISOString() });
  save();
  return true;
}

/** Delete = ask first (never a single tap) -> optional PIN/fingerprint -> into the Recycle Bin. */
export async function trash(kind, id) {
  if (kind === "cat" && state.expenses.some((e) => e.category_id === id)) {
    await alertBox("Cannot delete", "Is category me expenses hain. Pehle wo expenses hataein.");
    return false;
  }
  const name = (({ task: () => state.tasks, gymEx: () => state.gymEx, expense: () => state.expenses, income: () => state.income, crypto: () => state.crypto, cat: () => state.cats }[kind])() || []).find((x) => x.id === id);
  if (!name) return false;
  const ok = await confirmBox("Move to Recycle Bin?", `${KINDS[kind][1]} will go to More → Recycle Bin. You can restore it from there.`, { ok: "Move to bin", danger: true });
  if (!ok) return false;
  if (secureDelete() && !(await requireAuth("Confirm delete"))) return false;
  if (!moveToBin(kind, id)) return false;
  toast("Moved to Recycle Bin");
  return true;
}

const free = (arr, id) => { if (id >= state.seq) state.seq = id + 1; return arr.some((r) => r.id === id) ? nextId() : id; };
const clean = (coll, row) => normalize({ app: "NOCTIS", schema: 1, state: { [coll]: [row] } })[coll][0];

export function restoreItem(binId) {
  const b = (state.bin || []).find((x) => x.id === binId);
  if (!b) return { ok: false, msg: "Not found" };
  try {
    switch (b.kind) {
      case "task": { const t = clean("tasks", b.data); if (!t) throw 0; t.id = free(state.tasks, t.id); state.tasks.push(t); break; }
      case "gymEx": {
        const e = clean("gymEx", b.data.ex); if (!e) throw 0;
        e.id = free(state.gymEx, e.id); state.gymEx.push(e);
        for (const k of Object.keys((b.data && b.data.logs) || {})) { const date = k.split("@")[1]; if (isDate(date)) state.gymLogs[`${e.id}@${date}`] = true; }
        break;
      }
      case "expense": {
        const x = clean("expenses", b.data); if (!x) throw 0;
        if (!state.cats.some((c) => c.id === x.category_id)) return { ok: false, msg: "Its category is in the bin. Restore the category first." };
        x.id = free(state.expenses, x.id); state.expenses.push(x); break;
      }
      case "income": { const i = clean("income", b.data); if (!i) throw 0; i.id = free(state.income, i.id); state.income.push(i); break; }
      case "crypto": { const c = clean("crypto", b.data); if (!c) throw 0; c.id = free(state.crypto, c.id); state.crypto.push(c); break; }
      case "cat": { const c = clean("cats", b.data); if (!c) throw 0; c.id = free(state.cats, c.id); state.cats.push(c); break; }
    }
  } catch { return { ok: false, msg: "This item is damaged and cannot be restored." }; }
  state.bin = state.bin.filter((x) => x !== b);
  save();
  return { ok: true };
}

/** Permanent delete: asks, then needs PIN / fingerprint. */
export async function purge(binId) {
  const b = (state.bin || []).find((x) => x.id === binId);
  if (!b) return false;
  if (!(await confirmBox("Delete forever?", `"${b.label}" will be permanently deleted. This cannot be undone.`, { ok: "Delete forever", danger: true }))) return false;
  if (!(await requireAuth("Delete forever"))) return false;
  state.bin = state.bin.filter((x) => x !== b); save();
  return true;
}
export async function emptyBin() {
  const n = binCount(); if (!n) return false;
  if (!(await confirmBox("Empty Recycle Bin?", `${n} item${n === 1 ? "" : "s"} will be permanently deleted. This cannot be undone.`, { ok: "Delete all", danger: true }))) return false;
  if (!(await requireAuth("Empty Recycle Bin"))) return false;
  state.bin = []; save();
  return true;
}
