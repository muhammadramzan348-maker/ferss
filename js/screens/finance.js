import { state, save, nextId } from "../store.js";
import { ymd, esc, money, pct, fmtDay, vibrate } from "../util.js";
import { icons, header, bar, sheet, toast, confirmBox, alertBox, chip } from "../ui.js";
import { on, ui, refresh } from "../core.js";
import { trash } from "../bin.js";
import { levelFor, levelColor, buildAlerts, checkExpense } from "../finance.js";

export function compute() {
  const month = ymd().slice(0, 7), inM = (d) => d.slice(0, 7) === month;
  const incomes = state.income.filter((i) => inM(i.date)), expenses = state.expenses.filter((e) => inM(e.date));
  const catSpent = {}; let spentNeeds = 0, spentWants = 0;
  for (const e of expenses) {
    const c = state.cats.find((x) => x.id === e.category_id); if (!c) continue;
    catSpent[c.id] = (catSpent[c.id] || 0) + e.amount;
    if (c.bucket === "needs") spentNeeds += e.amount; else spentWants += e.amount;
  }
  const sum = (f) => incomes.reduce((a, i) => a + f(i), 0);
  const needsPool = sum((i) => (i.amount * i.needs_pct) / 100), wantsPool = sum((i) => (i.amount * i.wants_pct) / 100);
  const spentTotal = spentNeeds + spentWants;
  return {
    incomes, expenses, catSpent,
    s: { income: sum((i) => i.amount), savings: sum((i) => (i.amount * i.savings_pct) / 100), needsPool, wantsPool, spentNeeds, spentWants, spentTotal,
      available: needsPool + wantsPool - spentTotal, allTimeSavings: state.income.reduce((a, i) => a + (i.amount * i.savings_pct) / 100, 0) },
  };
}

const bucketBar = (label, spent, pool) => {
  const lv = levelFor(spent, pool, true);
  return `<div class="mb12"><div class="row between sm mb8"><b>${label}</b><span style="color:${levelColor[lv]}">${money(spent)} / ${money(pool)}</span></div>${bar(pool > 0 ? spent / pool : spent > 0 ? 1 : 0, levelColor[lv])}</div>`;
};

export function render() {
  const { s, catSpent, expenses, incomes } = compute();
  const alerts = buildAlerts(s, state.cats, catSpent).slice(0, 3);
  const budget = s.needsPool + s.wantsPool;
  const lvl = s.available < 0 ? "over" : budget > 0 && s.available < budget * 0.2 ? "warn" : "ok";
  const ac = lvl === "ok" ? "var(--emerald)" : levelColor[lvl];
  return `<div class="banner verse"><div class="u" style="font-family:var(--arabic);font-size:clamp(20px,6.5vw,30px);color:var(--gold);line-height:2">وَأَنْ لَيْسَ لِلْإِنْسَانِ إِلَّا مَا سَعَى</div>
    <div class="emerald">✦</div><div class="u" style="font-size:clamp(15px,4.6vw,21px);line-height:2.3">اور یہ کہ انسان کے لیے وہی کچھ ہے جس کی اس نے کوشش کی۔</div><div class="muted xs mt8" style="letter-spacing:.12em">AN-NAJM 53:39</div></div>
  ${header(icons.wallet({ size: 34 }), "Finance", "حساب کتاب", new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }))}
  ${alerts.map((a) => `<div class="alert ${a.level}"><span>${a.level === "over" ? "⚠️" : "❗"}</span><span>${esc(a.message)}</span></div>`).join("")}
  <div class="card mt8"><div class="muted sm">Available to spend</div><div class="big" style="color:${ac}">${money(s.available)}</div>
    <div class="muted xs mb12" style="margin-top:4px">of ${money(budget)} budget · ${pct(s.spentTotal, budget)}% spent</div>${bar(budget > 0 ? s.spentTotal / budget : 0, ac)}</div>
  <div class="row gap12 mt12">
    <div class="card grow"><div class="muted xs">📈 Income</div><div class="semi mt8" style="font-size:18px">${money(s.income)}</div></div>
    <div class="card grow"><div class="muted xs">🔒 Locked savings</div><div class="semi emerald mt8" style="font-size:18px">${money(s.savings)}</div><div class="muted xs">All time: ${money(s.allTimeSavings)}</div></div></div>
  <div class="row gap12 mt16"><button class="btn primary grow" data-act="fin-income">＋ Income</button><button class="btn grow" data-act="fin-expense">− Expense</button></div>
  <button class="card row mt16 block" style="width:100%;text-align:left" data-act="open" data-id="binance"><span style="width:44px;height:44px;border-radius:12px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;margin-right:12px">${icons.candle({ size: 28 })}</span>
    <span class="grow"><b>Binance / USDT trading</b><br><span class="muted xs">Daily buys, sells and profit tracker</span></span><span class="muted">›</span></button>
  <div class="sec">BUDGETS</div><div class="card">${bucketBar("Needs", s.spentNeeds, s.needsPool)}${bucketBar("Wants", s.spentWants, s.wantsPool)}</div>
  <div class="sec"><span>CATEGORIES</span><span><button class="cyan xs" data-act="fin-auto">Auto-set limits</button> &nbsp; <button class="cyan" style="font-size:18px" data-act="fin-cat" data-id="new">⊕</button></span></div>
  ${state.cats.map((c) => { const sp = catSpent[c.id] || 0, lv = levelFor(sp, c.monthly_limit);
    return `<button class="card block mb8" style="width:100%;text-align:left;padding:14px" data-act="fin-cat" data-id="${c.id}"><div class="row between"><span class="row"><i style="width:8px;height:8px;border-radius:50%;margin-right:8px;background:${c.bucket === "needs" ? "var(--cyan)" : "var(--amber)"}"></i><b>${esc(c.name)}</b></span>
      <span class="sm" style="color:${levelColor[lv]}">${money(sp)}<span class="muted">${c.monthly_limit > 0 ? " / " + money(c.monthly_limit) : " · no limit"}</span></span></div>${c.monthly_limit > 0 ? `<div class="mt12">${bar(sp / c.monthly_limit, levelColor[lv])}</div>` : ""}</button>`; }).join("")}
  <div class="sec">RECENT EXPENSES</div>${!expenses.length ? '<div class="muted sm">No expenses this month.</div>' : ""}
  ${[...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 10).map((e) => { const c = state.cats.find((x) => x.id === e.category_id);
    return `<div class="card row mb8" style="padding:14px"><div class="grow"><b>${esc(c ? c.name : "?")}</b><div class="muted xs">${fmtDay(e.date)}${e.note ? " · " + esc(e.note) : ""}</div></div><b class="crimson" style="margin-right:12px">-${money(e.amount)}</b><button class="icbtn" data-act="fin-del-exp" data-id="${e.id}">🗑</button></div>`; }).join("")}
  <div class="sec">INCOME THIS MONTH</div>${!incomes.length ? '<div class="muted sm">No income added yet.</div>' : ""}
  ${incomes.map((i) => `<div class="card row mb8" style="padding:14px"><div class="grow"><b>${esc(i.source || "Income")}</b><div class="muted xs">${fmtDay(i.date)} · ${i.needs_pct}/${i.wants_pct}/${i.savings_pct}</div></div><b class="emerald" style="margin-right:12px">+${money(i.amount)}</b><button class="icbtn" data-act="fin-del-inc" data-id="${i.id}">🗑</button></div>`).join("")}`;
}

const num = (v) => parseFloat(String(v).replace(/,/g, "")) || 0;
const PRESETS = [["50/30/20", 50, 30, 20], ["60/20/20", 60, 20, 20], ["70/20/10", 70, 20, 10], ["Custom", 0, 0, 0]];

function incomeSheet() {
  let p = 0;
  const s = sheet("Add income", `<div class="field"><label class="lbl">Amount</label><input class="inp" id="i-amt" inputmode="decimal" placeholder="e.g. 80000"></div>
    <div class="field"><label class="lbl">Source (optional)</label><input class="inp" id="i-src" placeholder="Salary, freelance…"></div>
    <div class="lbl">Smart allocation rule</div><div class="row wrap" id="i-pre"></div>
    <div class="row gap12 hidden" id="i-cus"><div class="field grow"><label class="lbl">Needs %</label><input class="inp" id="i-n" inputmode="numeric" value="50"></div><div class="field grow"><label class="lbl">Wants %</label><input class="inp" id="i-w" inputmode="numeric" value="30"></div></div>
    <div class="card" style="background:var(--bg);padding:12px" id="i-prev"></div><button class="btn primary block mt16" id="i-save">✓ Save income</button>`);
  const q = (i) => s.el.querySelector(i);
  const vals = () => { const c = p === 3, n = c ? num(q("#i-n").value) : PRESETS[p][1], w = c ? num(q("#i-w").value) : PRESETS[p][2]; return { n, w, sv: 100 - n - w, amt: num(q("#i-amt").value) }; };
  const paint = () => {
    q("#i-pre").innerHTML = PRESETS.map((x, i) => `<button class="chip ${p === i ? "on" : ""}" data-p="${i}">${x[0]}</button>`).join("");
    q("#i-cus").classList.toggle("hidden", p !== 3);
    const { n, w, sv, amt } = vals();
    q("#i-prev").innerHTML = [["Needs", n, ""], ["Wants", w, ""], ["Savings (locked)", sv, "emerald"]].map(([l, x, c]) => `<div class="row between sm" style="padding:3px 0"><span class="muted">${l} (${x}%)</span><b class="${c}">${money((amt * x) / 100)}</b></div>`).join("") + (sv < 0 ? '<div class="crimson xs">Needs + Wants cannot exceed 100%.</div>' : "");
    q("#i-save").disabled = !(amt > 0 && n >= 0 && w >= 0 && sv >= 0);
  };
  s.el.addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) { p = +b.dataset.p; paint(); } });
  s.el.addEventListener("input", paint);
  q("#i-save").onclick = () => { const { n, w, sv, amt } = vals(); state.income.push({ id: nextId(), amount: amt, source: q("#i-src").value.trim() || "Income", date: ymd(), needs_pct: n, wants_pct: w, savings_pct: sv }); save(); vibrate([15, 30, 15]); s.close(); refresh(); };
  paint();
}

function expenseSheet() {
  let catId = null;
  const cat = () => state.cats.find((c) => c.id === catId);
  const s = sheet("Log expense", `<div class="field"><label class="lbl">Amount</label><input class="inp" id="e-amt" inputmode="decimal" placeholder="e.g. 1500"></div><div id="e-cats"></div><div id="e-prev"></div>
    <div class="field"><label class="lbl">Note (optional)</label><input class="inp" id="e-note" placeholder="What was it for?"></div><button class="btn primary block" id="e-save">✓ Save expense</button>`);
  const q = (i) => s.el.querySelector(i);
  const paint = () => {
    q("#e-cats").innerHTML = ["needs", "wants"].map((b) => `<div class="lbl">${b.toUpperCase()}</div><div class="row wrap">${state.cats.filter((c) => c.bucket === b).map((c) => `<button class="chip ${catId === c.id ? "on " + (b === "wants" ? "amber" : "") : ""}" data-c="${c.id}">${esc(c.name)}</button>`).join("")}</div>`).join("");
    const c = cat(), amt = num(q("#e-amt").value), { s: sm, catSpent } = compute();
    if (c && c.monthly_limit > 0) { const after = (catSpent[c.id] || 0) + amt, lv = levelFor(after, c.monthly_limit);
      q("#e-prev").innerHTML = `<div class="card mb12" style="background:var(--bg);padding:12px"><div class="row between xs mb8"><span class="muted">${esc(c.name)} this month</span><b style="color:${levelColor[lv]}">${money(after)} / ${money(c.monthly_limit)} (${pct(after, c.monthly_limit)}%)</b></div>${bar(after / c.monthly_limit, levelColor[lv])}</div>`;
    } else q("#e-prev").innerHTML = "";
    q("#e-save").disabled = !(c && amt > 0);
  };
  s.el.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) { catId = +b.dataset.c; paint(); } });
  s.el.addEventListener("input", paint);
  q("#e-save").onclick = async () => {
    const c = cat(), amt = num(q("#e-amt").value); if (!c || amt <= 0) return;
    const { s: sm, catSpent } = compute(), r = checkExpense(amt, c, sm, catSpent);
    const commit = () => { state.expenses.push({ id: nextId(), amount: amt, category_id: c.id, note: q("#e-note").value.trim() || null, date: ymd() }); save(); s.close(); refresh(); };
    if (r.level === "over") {
      vibrate([80, 40, 80]);
      if (await confirmBox("Overspending Alert", `${r.message}\n\nFazol kharchi se bachein. Phir bhi kharch karna hai?`, { ok: "Spend anyway", danger: true })) commit();
    } else { commit(); if (r.level === "warn") { vibrate([60, 40, 60]); alertBox("Heads up", r.message); } }
  };
  paint();
}

function categorySheet(id) {
  const c = id === "new" ? null : state.cats.find((x) => x.id === +id); let bucket = c ? c.bucket : "needs";
  const s = sheet(c ? "Edit category" : "New category", `<div class="field"><label class="lbl">Name</label><input class="inp" id="c-name" placeholder="e.g. Fuel" value="${esc(c ? c.name : "")}"></div>
    ${c ? "" : '<div class="row" id="c-b"></div>'}<div class="field"><label class="lbl">Monthly limit (0 = use bucket budget only)</label><input class="inp" id="c-lim" inputmode="decimal" placeholder="e.g. 10000" value="${c && c.monthly_limit ? Math.round(c.monthly_limit) : ""}"></div>
    <button class="btn primary block" id="c-save">✓ Save</button>${c ? '<button class="btn danger block mt12" id="c-del">🗑 Delete category</button>' : ""}`);
  const q = (i) => s.el.querySelector(i);
  const paintB = () => { const e = q("#c-b"); if (e) e.innerHTML = `<button class="chip ${bucket === "needs" ? "on" : ""}" data-b="needs">Needs</button><button class="chip ${bucket === "wants" ? "on amber" : ""}" data-b="wants">Wants</button>`; };
  s.el.addEventListener("click", (e) => { const b = e.target.closest("[data-b]"); if (b) { bucket = b.dataset.b; paintB(); } });
  q("#c-save").onclick = () => {
    const name = q("#c-name").value.trim(); if (!name) return;
    const limit = Math.max(0, num(q("#c-lim").value));
    if (c) { c.name = name; c.monthly_limit = limit; } else state.cats.push({ id: nextId(), name, bucket, monthly_limit: limit });
    save(); s.close(); refresh();
  };
  const del = q("#c-del");
  if (del) del.onclick = async () => { if (await trash("cat", c.id)) { s.close(); refresh(); } };
  paintB();
}

on({
  "fin-income": incomeSheet,
  "fin-expense": expenseSheet,
  "fin-cat": (el) => categorySheet(el.dataset.id),
  "fin-auto": () => {
    const { s } = compute();
    for (const b of ["needs", "wants"]) { const cs = state.cats.filter((c) => c.bucket === b); if (!cs.length) continue; const each = Math.round((b === "needs" ? s.needsPool : s.wantsPool) / cs.length); cs.forEach((c) => (c.monthly_limit = each)); }
    save(); refresh(); toast("Limits set from your Needs / Wants budgets");
  },
  "fin-del-exp": async (el) => { if (await trash("expense", +el.dataset.id)) refresh(); },
  "fin-del-inc": async (el) => { if (await trash("income", +el.dataset.id)) refresh(); },
});
