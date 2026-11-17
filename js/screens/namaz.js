import { state, save } from "../store.js";
import { PRAYERS, PRAYER, JUMMAH, JUMUAH_ITEMS, RAKAT, KIND } from "../data.js";
import { ymd, addDays, parseYmd, isoDow, fmtTime, fmtDay, vibrate } from "../util.js";
import { icons, header, gbtn, sheet, toast, chip } from "../ui.js";
import { prayerArt } from "../icons.js";
import { on, ui, refresh } from "../core.js";
import { askPermission, permission } from "../notify.js";
import { requireAuth } from "../guard.js";

const isFri = (d) => parseYmd(d).getDay() === 5;
const logs = (d) => state.prayerLogs[d] || {};
/** On Fridays the Dhuhr slot is satisfied by Jummah (or Dhuhr, if you prayed it instead). */
const done = (d, k) => { const L = logs(d); return k === "dhuhr" && isFri(d) ? !!(L.dhuhr || L.jumuah) : !!L[k]; };
const count = (d) => PRAYERS.filter((p) => done(d, p.key)).length;
const cfg = (k) => state.prayerCfg[k] || { time: PRAYER[k].time, on: false };

/* streaks have NO upper limit: they run for as long as every day is complete */
function streaks() {
  let d = new Date(); if (count(ymd(d)) < 5) d = addDays(d, -1);
  let cur = 0; while (count(ymd(d)) >= 5) { cur++; d = addDays(d, -1); }
  const full = Object.keys(state.prayerLogs).filter((k) => count(k) >= 5).sort();
  let best = 0, run = 0, prev = null;
  for (const k of full) { const dt = parseYmd(k); run = prev && Math.round((dt - prev) / 864e5) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = dt; }
  return { cur, best };
}

const RANGES = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"]];
/** Consistency over a window. Today only counts once it is complete (so a day in progress never
 *  drags the percentage down), and days before your first log are never counted. */
function stats(range) {
  const keys = Object.keys(state.prayerLogs).sort();
  const none = { pct: 0, days: 0, prayers: 0, fullDays: 0, since: keys[0] || null };
  if (!keys.length) return none;
  const first = parseYmd(keys[0]), today = parseYmd(ymd());
  const end = count(ymd(today)) >= 5 ? today : addDays(today, -1);
  let start = range === "all" ? first : addDays(end, -(+range - 1));
  if (start < first) start = first;
  const days = Math.round((end - start) / 864e5) + 1;
  if (days <= 0) return none;
  let prayers = 0, fullDays = 0;
  for (let i = 0; i < days; i++) { const c = count(ymd(addDays(start, i))); prayers += c; if (c >= 5) fullDays++; }
  return { pct: Math.round((prayers / (days * 5)) * 100), days, prayers, fullDays, since: keys[0] };
}

const rakat = (k, accent, extra = "") => {
  const parts = RAKAT[k], total = parts.reduce((a, [, n]) => a + n, 0);
  return `<div class="rak" style="--c:${accent}">${parts.map(([t, n]) => `<span class="rk ${t}" aria-label="${t} ${n}">${KIND[t]} ${n}</span>`).join("")}<span class="rk-total">کل ${total} رکعات</span>${extra ? `<div style="width:100%">${extra}</div>` : ""}</div>`;
};

function prayerCard(p, i) {
  const c = cfg(p.key), isDone = !!logs(ymd())[p.key], jm = p.key === "jumuah";
  return `<div class="pcard fade ${isDone ? "isdone" : ""}" style="--bc:${isDone ? "#10B98199" : p.accent + "55"};background:linear-gradient(115deg,${p.grad[0]} 0%,${p.grad[1]} 50%,${p.grad[2]} 100%);animation-delay:${i * 60}ms" data-card="${p.key}">
    <div class="in">
      <div class="art">${prayerArt(p.key)}</div>
      <div class="ur">${p.urdu}</div>
      <div class="bold xs" style="color:${p.accent};letter-spacing:.15em">${p.label.toUpperCase()}${jm ? ' <span class="muted" style="letter-spacing:0">· replaces Dhuhr</span>' : ""}</div>
      <div class="mt16">${gbtn("pr-toggle", p.key, { color: p.accent, done: isDone, label: "Done", doneLabel: "Prayed ✓" })}${isDone ? '<div class="muted xs" style="margin-top:8px">🔒 Undo needs PIN / fingerprint</div>' : ""}</div>
      <div class="row mt16 gap12 wrap">
        <button class="pchip" style="color:${p.accent};border-color:${p.accent}66" data-act="pr-time" data-id="${p.key}">⏰ ${fmtTime(c.time)}</button>
        <button class="icbtn" style="color:${c.on ? p.accent : "var(--muted)"};font-size:18px" data-act="pr-bell" data-id="${p.key}" aria-label="Reminder">${c.on ? "🔔" : "🔕"}</button>
      </div></div>
    ${rakat(p.key, p.accent, jm ? `<button class="pchip" style="color:var(--muted);border-color:#3F3F46" data-act="pr-toggle" data-id="dhuhr">${logs(ymd()).dhuhr ? "✓ " : ""}Prayed Dhuhr instead</button>` : "")}</div>`;
}

function jumuahCard() {
  const d = ymd(), L = state.jumuah[d] || {}, n = JUMUAH_ITEMS.filter((j) => L[j.key]).length, all = n === JUMUAH_ITEMS.length;
  return `<div class="pcard fade" style="--bc:${all ? "#10B981AA" : "#FBBF2455"};background:linear-gradient(135deg,#141417,#0E2A1F,#2A2209);margin-top:6px"><div style="position:absolute;top:0;left:0;right:0;height:2px;background:var(--gold)"></div>
  <div class="in">
    <div class="row between"><div><div class="ur gold" style="font-size:34px;line-height:1.9;margin:-6px 0 -12px">جمعۃ المبارک</div><div class="muted xs" style="letter-spacing:.15em">FRIDAY SUNNAH CHECKLIST</div></div>
      <div style="text-align:center"><div style="font-size:22px">${all ? "✅" : "✨"}</div><div class="bold" style="color:${all ? "var(--emerald)" : "var(--ink)"}">${n}/${JUMUAH_ITEMS.length}</div></div></div>
    <div class="bar mt12 mb8"><i style="width:${(n / JUMUAH_ITEMS.length) * 100}%;background:${all ? "var(--emerald)" : "var(--gold)"}"></i></div>
    ${JUMUAH_ITEMS.map((j, i) => `<div class="row" style="padding:8px 0;${i ? "border-top:1px solid var(--line)" : ""}">
      <div class="grow" style="padding-right:10px"><div class="urdu" style="font-size:19px;line-height:2.1;color:${L[j.key] ? "#71717A" : "#FAFAFA"};${L[j.key] ? "text-decoration:line-through" : ""}">${j.urdu}</div><div class="xs" style="color:#71717A">${j.en}</div></div>
      ${gbtn("jm-toggle", j.key, { color: "var(--gold)", done: !!L[j.key], compact: true })}</div>`).join("")}
    ${all ? '<div class="emerald sm" style="text-align:center;margin-top:10px">✦ Masha\'Allah, all Friday sunnahs completed</div>' : ""}
  </div></div>`;
}

function calendar() {
  const m = ui.calMonth || (ui.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const lead = (m.getDay() + 6) % 7, total = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate(), today = ymd();
  const sel = ui.selDay || today, cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="e"></div>');
  for (let day = 1; day <= total; day++) {
    const ds = ymd(new Date(m.getFullYear(), m.getMonth(), day)), c = count(ds);
    const cls = [c >= 5 ? "full" : c > 0 ? "part" : "", ds === today ? "today" : "", ds === sel ? "sel" : "", ds > today ? "fut" : ""].join(" ");
    cells.push(`<div class="${cls}" data-act="cal-pick" data-id="${ds}" style="cursor:pointer">${day}</div>`);
  }
  const canNext = !(m.getFullYear() === new Date().getFullYear() && m.getMonth() === new Date().getMonth());
  const L = logs(sel), fri = isFri(sel);
  const keys = fri ? ["fajr", "jumuah", "asr", "maghrib", "isha", "dhuhr"] : PRAYERS.map((p) => p.key);
  return `<div class="card"><div class="row between mb12"><button class="icbtn" style="font-size:20px" data-act="cal-prev">‹</button><b>${m.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b><button class="icbtn" style="font-size:20px;${canNext ? "" : "opacity:.25;pointer-events:none"}" data-act="cal-next">›</button></div>
    <div class="cal">${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="h">${d}</div>`).join("")}${cells.join("")}</div>
    <div class="row xs muted mt12 gap12"><span><b class="emerald">■</b> All 5</span><span><b class="amber">■</b> Partial</span><span><b class="cyan">□</b> Today</span></div></div>
  <div class="card mt12"><div class="semi">${fmtDay(sel, { weekday: "long", day: "numeric", month: "short", year: "numeric" })}</div><div class="muted xs mb12">Tap to mark or fix a day you forgot to log.${fri ? " On Friday, Jummah counts in place of Dhuhr." : ""}</div>
    <div class="row wrap">${keys.map((k) => chip(`${PRAYER[k].urdu}  ${k === "dhuhr" && fri ? "Dhuhr (instead)" : PRAYER[k].label}`, "cal-toggle", k, !!L[k], "emerald")).join("")}</div></div>`;
}

export function render() {
  const t = ymd(), st = streaks(), n = count(t), range = ui.nzRange || "all", sx = stats(range);
  const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(new Date(), i - 6)));
  const fri = isoDow() === 5;
  return `${header(icons.mosque({ size: 34 }), "Namaz", "نماز", `${n} of 5 prayed today`)}
  <div class="card"><div class="row"><div style="width:56px;height:56px;border-radius:16px;background:rgba(245,158,11,.15);display:flex;align-items:center;justify-content:center;font-size:28px">🔥</div>
    <div class="grow" style="margin-left:14px"><div class="h1">${st.cur} <span class="muted sm" style="font-weight:400">day streak</span></div><div class="muted sm">Best: ${st.best} days · no limit</div></div>
    <div style="text-align:right"><div class="emerald h1">${sx.pct}%</div><div class="muted xs">consistency</div></div></div>
    <div class="row wrap mt16">${RANGES.map(([k, l]) => chip(l, "nz-range", k, range === k, "emerald")).join("")}</div>
    <div class="row between xs muted" style="margin-top:-2px"><span>${sx.prayers} prayers · ${sx.fullDays} full days</span><span>${sx.since ? "since " + fmtDay(sx.since, { day: "numeric", month: "short", year: "numeric" }) : "no data yet"}</span></div>
    <div class="row between mt16" style="align-items:flex-end;height:70px">${days.map((d) => { const c = count(d), col = c >= 5 ? "var(--emerald)" : c > 0 ? "var(--amber)" : "var(--line)"; return `<div style="flex:1;text-align:center"><div style="width:14px;margin:0 auto;height:${Math.max(5, (c / 5) * 46)}px;border-radius:7px;background:${col};${c ? `box-shadow:0 0 8px ${col}` : ""}"></div><div class="muted xs" style="margin-top:6px">${parseYmd(d).toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 2)}</div></div>`; }).join("")}</div></div>
  <div class="sec">TODAY</div>${PRAYERS.map((p, i) => (fri && p.key === "dhuhr" ? prayerCard(JUMMAH, i) : prayerCard(p, i))).join("")}
  ${fri ? jumuahCard() : ""}
  <div class="sec">HISTORY</div>${calendar()}`;
}

function setPrayer(date, key, v) {
  const m = (state.prayerLogs[date] ||= {});
  if (v) m[key] = true; else delete m[key];
  if (!Object.keys(m).length) delete state.prayerLogs[date];
}

on({
  "pr-toggle": async (el) => {
    const t = ymd(), k = el.dataset.id, v = !logs(t)[k];
    if (!v && !(await requireAuth(`Undo ${PRAYER[k].label}?`))) return; // un-marking a finished prayer needs PIN / fingerprint
    setPrayer(t, k, v); vibrate(v ? [15, 30, 15] : 8); save(); refresh();
    const card = document.querySelector(`[data-card="${k}"]`); card && card.classList.add("pop");
  },
  "nz-range": (el) => { ui.nzRange = el.dataset.id; refresh(); },
  "cal-toggle": async (el) => {
    const d = ui.selDay || ymd(), k = el.dataset.id, v = !logs(d)[k];
    if (!v && !(await requireAuth(`Remove ${PRAYER[k].label} for this day?`))) return;
    setPrayer(d, k, v); save(); refresh();
  },
  "cal-pick": (el) => { ui.selDay = el.dataset.id; refresh(); },
  "cal-prev": () => { ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() - 1, 1); refresh(); },
  "cal-next": () => { ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + 1, 1); refresh(); },
  "jm-toggle": async (el) => {
    const d = ymd(), k = el.dataset.id, m = (state.jumuah[d] ||= {});
    if (m[k]) { if (!(await requireAuth("Undo this Friday sunnah?"))) return; delete m[k]; } else m[k] = true;
    if (!Object.keys(m).length) delete state.jumuah[d];
    vibrate(10); save(); refresh();
  },
  "pr-time": (el) => {
    const k = el.dataset.id, c = cfg(k);
    const s = sheet(`${PRAYER[k].label} reminder time`, `<div class="field"><label class="lbl">Time</label><input class="inp" type="time" id="pt" value="${c.time}"></div><button class="btn primary block" id="pt-save">Save</button>`);
    s.el.querySelector("#pt-save").onclick = () => {
      const v = s.el.querySelector("#pt").value; if (!v) return;
      state.prayerCfg[k] = { ...cfg(k), time: v }; save(); s.close(); refresh();
    };
  },
  "pr-bell": async (el) => {
    const k = el.dataset.id, c = cfg(k), turnOn = !c.on;
    if (turnOn && permission() === "default") await askPermission();
    state.prayerCfg[k] = { ...c, on: turnOn }; save(); refresh();
    if (turnOn && permission() !== "granted") toast("Notifications are blocked, so this reminder shows only while NOCTIS is open.", 4500);
  },
});
