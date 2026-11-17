import { state, save, nextId } from "../store.js";
import { ymd, addDays, esc, money, usdt, rate, signedMoney, pkrExact, fmtDay, vibrate } from "../util.js";
import { icons, header, sheet, toast, confirmBox } from "../ui.js";
import { on, ui, refresh } from "../core.js";
import { trash } from "../bin.js";
import { aggregate, estimatePnl, toPkr } from "../cryptocalc.js";
import { emptyConv, recompute, toNum } from "../convert.js";

const LABEL = { today: "Today", week: "Last 7 days", month: "This month" };
const startFor = (p) => (p === "today" ? ymd() : p === "week" ? ymd(addDays(new Date(), -6)) : ymd().slice(0, 8) + "01");
const lastRate = () => { const l = [...state.crypto].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).find((c) => c.sell_rate > 0 || c.buy_rate > 0); return l ? (l.sell_rate > 0 ? l.sell_rate : l.buy_rate) : 0; };

export function render() {
  const entries = state.crypto.filter((c) => c.date >= startFor(ui.period)).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const a = aggregate(entries), up = a.pnl >= 0, tone = a.pnl === 0 ? "var(--muted)" : up ? "var(--emerald)" : "var(--crimson)", lr = lastRate(), bal = state.cryptoBalance || 0;
  return `<button class="icbtn" data-act="back" style="margin-bottom:8px">‹ Back</button>
  ${header(icons.candle({ size: 34 }), "Binance", "", "USDT trading tracker")}
  <div class="card"><div class="row between"><span class="row gap12"><span style="width:36px;height:36px;border-radius:12px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center">${icons.candle({ size: 22 })}</span><span class="muted sm">Total Binance Balance</span></span><button class="icbtn cyan" data-act="bn-bal">✎</button></div>
    <div class="big mt16">${usdt(bal)}</div>${lr > 0 ? `<div class="muted sm" style="margin-top:4px">≈ ${money(bal * lr)} @ ${rate(lr)}</div>` : ""}</div>
  <div class="row wrap mt16">${Object.keys(LABEL).map((p) => `<button class="chip ${ui.period === p ? "on" : ""}" data-act="bn-period" data-id="${p}">${LABEL[p]}</button>`).join("")}</div>
  <div class="card"><div class="muted xs" style="letter-spacing:.14em">NET PERFORMANCE · ${LABEL[ui.period].toUpperCase()}</div>
    <div class="row mt12"><span style="font-size:30px;color:${tone}">${a.pnl === 0 ? "◌" : up ? "📈" : "📉"}</span><span class="big" style="color:${tone};margin-left:12px;font-size:30px">${signedMoney(a.pnl)}</span></div>
    <div class="xs" style="color:${tone};margin-top:4px">${a.pnl === 0 ? "Break-even" : up ? "Profit" : "Loss"}${a.trades ? ` · ${signedMoney(a.pnl / a.trades)} per trade` : ""}</div><hr>
    <div class="row"><div class="grow"><div class="muted xs">Bought</div><div class="semi mt8">${usdt(a.bought)}</div><div class="muted xs">avg ${rate(a.avgBuy)} · ${money(a.buyPkr)}</div></div>
    <div class="grow"><div class="muted xs">Sold</div><div class="semi mt8">${usdt(a.sold)}</div><div class="muted xs">avg ${rate(a.avgSell)} · ${money(a.sellPkr)}</div></div></div>
    <div class="row mt16"><div class="grow"><div class="muted xs">Trades</div><div class="semi mt8">${a.trades}</div></div>
    <div class="grow"><div class="muted xs">Spread</div><div class="semi mt8" style="color:${a.avgBuy && a.avgSell ? (a.avgSell >= a.avgBuy ? "var(--emerald)" : "var(--crimson)") : "var(--muted)"}">${a.avgBuy && a.avgSell ? (a.avgSell - a.avgBuy).toFixed(2) + " PKR" : "–"}</div></div></div></div>
  <button class="btn primary block mt16" data-act="bn-log">＋ Log activity</button>
  <div class="sec">ENTRIES</div>${!entries.length ? '<div class="muted sm">Nothing logged for this period.</div>' : ""}
  ${entries.map((e) => { const c = e.pnl_pkr > 0 ? "var(--emerald)" : e.pnl_pkr < 0 ? "var(--crimson)" : "var(--muted)";
    return `<div class="card mb12"><div class="row between"><span class="muted xs">${fmtDay(e.date, { weekday: "short", day: "numeric", month: "short" })}</span><button class="icbtn" data-act="bn-del" data-id="${e.id}">🗑</button></div>
    <div class="bold" style="font-size:20px;color:${c}">${signedMoney(e.pnl_pkr)}</div>${e.pnl_currency === "USDT" ? `<div class="muted xs">entered as ${e.pnl > 0 ? "+" : ""}${e.pnl.toFixed(2)} USDT</div>` : ""}
    <div class="row muted xs mt8" style="align-items:flex-start;gap:8px"><div class="grow">Bought ${e.usdt_bought} @ ${rate(e.buy_rate)}<br>= ${money(e.usdt_bought * e.buy_rate)}</div><div class="grow">Sold ${e.usdt_sold} @ ${rate(e.sell_rate)}<br>= ${money(e.usdt_sold * e.sell_rate)}</div><div>${e.trades} trades</div></div>
    ${e.note ? `<div class="muted xs mt8" style="font-style:italic">${esc(e.note)}</div>` : ""}</div>`; }).join("")}`;
}

/* ---------- two-way converter block ---------- */
const block = (pre, title, chips) => `<div class="mb8" data-blk="${pre}"><div class="muted xs" style="letter-spacing:.14em;margin-bottom:8px">${title}</div>
  <div class="field"><label class="lbl">Rate (PKR per 1 USDT)</label><input class="inp" id="${pre}-rate" inputmode="decimal" placeholder="e.g. 278.50"></div>
  <div class="row wrap" id="${pre}-chips">${chips}</div>
  <div class="row" style="align-items:flex-end;gap:8px"><div class="grow"><label class="lbl">USDT quantity <span class="cyan hidden" id="${pre}-au">⚡ auto</span></label><input class="inp" id="${pre}-usdt" inputmode="decimal" placeholder="0"></div>
    <div style="padding-bottom:14px" class="muted">⇄</div>
    <div class="grow"><label class="lbl">Total (PKR) <span class="cyan hidden" id="${pre}-ap">⚡ auto</span></label><input class="inp" id="${pre}-pkr" inputmode="decimal" placeholder="0"></div></div>
  <div class="amber xs mt8 hidden" id="${pre}-warn">Enter the rate to calculate the other value.</div><div class="emerald xs mt8" id="${pre}-res"></div></div>`;

function logSheet() {
  const conv = { b: { ...emptyConv }, s: { ...emptyConv } }, last = lastRate();
  const chip = (pre, label, v) => `<button class="chip" style="color:var(--cyan)" data-fill="${pre}:${v}">${label}</button>`;
  let loss = false, cur = "PKR";
  const sh = sheet("Log trading activity", `${block("b", "USDT PURCHASED", last > 0 ? chip("b", `Last rate ${last}`, last) : "")}<hr>
    ${block("s", "USDT SOLD", (last > 0 ? chip("s", `Last rate ${last}`, last) : "") + '<span id="s-buychip"></span>')}<hr>
    <div class="field"><label class="lbl">Number of trades</label><input class="inp" id="tr" inputmode="numeric" placeholder="0"></div>
    <div class="lbl">TOTAL PROFIT / LOSS</div><div class="row wrap" id="pl"></div>
    <div class="field"><label class="lbl" id="pl-l">Amount (PKR)</label><input class="inp" id="pnl" inputmode="decimal" placeholder="0"></div>
    <button class="btn block mb12" id="auto">🧮 Auto-calc from buy/sell rates</button><div class="amber xs mb8 hidden" id="pl-warn">Enter a buy or sell rate so the USDT result can be converted to PKR.</div>
    <div class="field"><label class="lbl">Note (optional)</label><input class="inp" id="note" placeholder="P2P, spot, merchant…"></div><button class="btn primary block" id="save">✓ Save entry</button>`);
  const q = (i) => sh.el.querySelector(i);
  const N = (pre) => ({ rate: toNum(conv[pre].rate), usdt: toNum(conv[pre].usdt), pkr: toNum(conv[pre].pkr) });
  const refRate = () => N("s").rate || N("b").rate || last;
  const paintConv = (pre) => {
    const c = conv[pre], n = N(pre);
    const u = q(`#${pre}-usdt`), p = q(`#${pre}-pkr`);
    if (c.source === "usdt") { p.value = c.pkr; } else { u.value = c.usdt; }
    u.classList.toggle("auto", c.source === "pkr" && !!c.usdt); p.classList.toggle("auto", c.source === "usdt" && !!c.pkr);
    q(`#${pre}-au`).classList.toggle("hidden", !(c.source === "pkr" && c.usdt)); q(`#${pre}-ap`).classList.toggle("hidden", !(c.source === "usdt" && c.pkr));
    q(`#${pre}-warn`).classList.toggle("hidden", !(n.rate <= 0 && (n.usdt > 0 || n.pkr > 0)));
    q(`#${pre}-res`).textContent = n.usdt > 0 && n.pkr > 0 && n.rate > 0 ? `${usdt(n.usdt)} × ${n.rate} = ${pkrExact(n.pkr)}` : "";
  };
  const paintPl = () => {
    q("#pl").innerHTML = `<button class="chip ${!loss ? "on emerald" : ""}" data-pl="profit">Profit</button><button class="chip ${loss ? "on crimson" : ""}" data-pl="loss">Loss</button><span style="width:16px"></span><button class="chip ${cur === "PKR" ? "on" : ""}" data-cur="PKR">PKR</button><button class="chip ${cur === "USDT" ? "on" : ""}" data-cur="USDT">USDT</button>`;
    q("#pl-l").textContent = `Amount (${cur})`;
  };
  const validate = () => {
    const b = N("b"), s = N("s"), pnl = (loss ? -1 : 1) * toNum(q("#pnl").value);
    const needsRate = cur === "USDT" && pnl !== 0 && refRate() <= 0, missing = (b.usdt > 0 && b.rate <= 0) || (s.usdt > 0 && s.rate <= 0);
    const empty = !b.usdt && !s.usdt && !toNum(q("#tr").value) && !pnl;
    q("#pl-warn").classList.toggle("hidden", !needsRate);
    q("#save").disabled = empty || needsRate || missing;
    q("#auto").disabled = estimatePnl(b.usdt, b.rate, s.usdt, s.rate) === 0;
    q("#s-buychip").innerHTML = b.rate > 0 ? chip("s", `Buy rate ${b.rate}`, b.rate) : "";
  };
  sh.el.addEventListener("input", (e) => {
    const m = /^([bs])-(rate|usdt|pkr)$/.exec(e.target.id);
    if (m) { const [, pre, f] = m, c = conv[pre]; conv[pre] = recompute({ ...c, [f]: e.target.value, ...(f === "usdt" ? { source: "usdt" } : f === "pkr" ? { source: "pkr" } : {}) }); paintConv(pre); }
    validate();
  });
  sh.el.addEventListener("click", (e) => {
    const f = e.target.closest("[data-fill]");
    if (f) { const [pre, v] = f.dataset.fill.split(":"); q(`#${pre}-rate`).value = v; conv[pre] = recompute({ ...conv[pre], rate: v }); paintConv(pre); validate(); }
    const pl = e.target.closest("[data-pl]"); if (pl) { loss = pl.dataset.pl === "loss"; paintPl(); validate(); }
    const cu = e.target.closest("[data-cur]"); if (cu) { cur = cu.dataset.cur; paintPl(); validate(); }
  });
  q("#auto").onclick = () => {
    const b = N("b"), s = N("s"), est = estimatePnl(b.usdt, b.rate, s.usdt, s.rate), rr = refRate();
    const v = cur === "PKR" ? est : rr > 0 ? est / rr : 0;
    loss = v < 0; q("#pnl").value = String(Math.round(Math.abs(v) * 100) / 100); paintPl(); validate();
  };
  q("#save").onclick = () => {
    const b = N("b"), s = N("s"), pnl = (loss ? -1 : 1) * toNum(q("#pnl").value);
    state.crypto.push({ id: nextId(), date: ymd(), usdt_bought: b.usdt, buy_rate: b.rate, usdt_sold: s.usdt, sell_rate: s.rate, trades: Math.round(toNum(q("#tr").value)), pnl, pnl_currency: cur, pnl_pkr: toPkr(pnl, cur, refRate()), note: q("#note").value.trim() || null });
    save(); vibrate([15, 30, 15]); sh.close(); refresh();
  };
  paintPl(); validate();
}

on({
  "bn-period": (el) => { ui.period = el.dataset.id; refresh(); },
  "bn-log": logSheet,
  "bn-del": async (el) => { if (await trash("crypto", +el.dataset.id)) refresh(); },
  "bn-bal": () => {
    const s = sheet("Binance balance", `<div class="field"><label class="lbl">Total balance (USDT)</label><input class="inp" id="bal" inputmode="decimal" placeholder="0.00" value="${state.cryptoBalance || ""}"></div><button class="btn primary block" id="bs">✓ Save</button>`);
    s.el.querySelector("#bs").onclick = () => { state.cryptoBalance = toNum(s.el.querySelector("#bal").value); save(); s.close(); refresh(); };
  },
});
