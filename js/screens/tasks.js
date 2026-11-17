import { state, save, nextId } from "../store.js";
import { ymd, hm, esc, fmtTime, fmtDay, parseYmd, addDays, isoDow, vibrate } from "../util.js";
import { icons, header, bar, gbtn, toast, sheet, confirmBox } from "../ui.js";
import { on, onInput, ui, refresh } from "../core.js";
import { askPermission, permission } from "../notify.js";
import { trash, moveToBin } from "../bin.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PRI = { high: ["High", "#EF4444", 0], normal: ["Normal", "#06B6D4", 1], low: ["Low", "#71717A", 2] };
const draft = { title: "", note: "", time: "", date: "", days: [], priority: "normal" };
const today = () => ymd();
const viewDate = () => ui.taskDate || (ui.taskDate = today());
const isRepeat = (t) => Array.isArray(t.days) && t.days.length > 0;
const pri = (t) => PRI[t.priority] || PRI.normal;

/** does this task show up on date d? */
export function occursOn(t, d) {
  if (isRepeat(t)) return d >= t.date && t.days.includes(isoDow(parseYmd(d)));
  if (t.date === d) return true;
  return d === today() && !t.done && t.date < today(); // unfinished from earlier days carry over to today
}
const strictOn = (t, d) => (isRepeat(t) ? d >= t.date && t.days.includes(isoDow(parseYmd(d))) : t.date === d);
export const isDoneOn = (t, d) => (isRepeat(t) ? !!(t.doneOn && t.doneOn[d]) : !!t.done);
const sorter = (a, b) => pri(a)[2] - pri(b)[2] || (a.time || "99:99").localeCompare(b.time || "99:99") || a.id - b.id;

/** this week + "all tasks done" streak */
function weekStats() {
  let total = 0, done = 0;
  const day = (i) => { const d = ymd(addDays(new Date(), -i)); const ts = state.tasks.filter((t) => strictOn(t, d)); return { n: ts.length, ok: ts.filter((t) => isDoneOn(t, d)).length }; };
  for (let i = 0; i < 7; i++) { const x = day(i); total += x.n; done += x.ok; }
  let i = 0, t0 = day(0); if (!(t0.n > 0 && t0.ok === t0.n)) i = 1;
  let streak = 0; for (; i < 400; i++) { const x = day(i); if (x.n > 0 && x.ok === x.n) streak++; else break; }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0, streak };
}

function card(t, d) {
  const dn = isDoneOn(t, d), carried = !isRepeat(t) && !t.done && t.date < d, [pl, pc] = pri(t);
  return `<div class="card task fade ${dn ? "done" : ""}" style="border-left:3px solid ${pc};display:block">
    <div class="row"><div class="grow"><div class="t semi" style="font-size:16px">${esc(t.title)}</div>
      ${t.note ? `<div class="muted xs" style="margin-top:4px;white-space:pre-line;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(t.note)}</div>` : ""}
      <div class="row gap12 xs mt8 wrap">${t.priority === "high" ? '<span style="color:#EF4444">● High</span>' : t.priority === "low" ? '<span class="muted">● Low</span>' : ""}${t.time ? `<span class="cyan">⏰ ${fmtTime(t.time)}</span>` : ""}${isRepeat(t) ? `<span class="amber">🔁 ${t.days.map((x) => DAYS[x - 1]).join(", ")}</span>` : ""}${carried ? '<span class="amber">Carried over</span>' : ""}</div></div>
      ${gbtn("task-toggle", t.id, { color: "var(--cyan)", done: dn, doneLabel: "Undo", compact: true })}</div>
    <div class="tact"><button data-act="task-edit" data-id="${t.id}">✎ Edit</button>${!isRepeat(t) && !dn ? `<button data-act="task-tmrw" data-id="${t.id}">⏭ Tomorrow</button>` : ""}<button data-act="task-del" data-id="${t.id}" aria-label="Delete">🗑 Delete</button></div></div>`;
}

export function render() {
  const d = viewDate(), isToday = d === today();
  const all = state.tasks.filter((t) => occursOn(t, d));
  const pending = all.filter((t) => !isDoneOn(t, d)).sort(sorter), done = all.filter((t) => isDoneOn(t, d)).sort(sorter);
  const dd = draft.date || d, ws = weekStats(), q = (ui.taskQ || "").trim().toLowerCase();
  const hits = q ? state.tasks.filter((t) => `${t.title} ${t.note || ""}`.toLowerCase().includes(q)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20) : [];
  const upcoming = [1, 2, 3, 4, 5, 6, 7].map((i) => ymd(addDays(parseYmd(today()), i))).map((x) => [x, state.tasks.filter((t) => occursOn(t, x)).length]).filter(([, n]) => n);
  const clearable = done.filter((t) => !isRepeat(t));
  return `${header(icons.tasks({ size: 34 }), "Tasks", "", fmtDay(d, { weekday: "long", day: "numeric", month: "long" }) + (isToday ? " · Today" : ""))}
  <div class="dnav"><button class="arr" data-act="task-prev" aria-label="Previous day">‹</button>
    <div class="lab"><input class="inp" type="date" id="t-view" data-in="t-view" value="${d}" style="text-align:center" aria-label="View date"></div>
    <button class="arr" data-act="task-next" aria-label="Next day">›</button>${isToday ? "" : '<button class="btn" data-act="task-today">Today</button>'}</div>
  <div class="card mb12">
    <input class="inp" id="t-title" data-in="t-title" placeholder="Add a task, e.g. Go to bank" value="${esc(draft.title)}" enterkeyhint="done" autocomplete="off">
    <input class="inp mt8" id="t-note" data-in="t-note" placeholder="Note (optional)" value="${esc(draft.note)}" autocomplete="off">
    <div class="row gap8 mt12"><div class="grow"><label class="lbl">Date</label><input class="inp" type="date" id="t-date" data-in="t-date" value="${dd}"></div>
      <div class="grow"><label class="lbl">Time (optional)</label><input class="inp" type="time" id="t-time" data-in="t-time" value="${draft.time}"></div></div>
    <div class="row wrap mt12"><button class="chip ${dd === today() ? "on" : ""}" data-act="task-quick" data-id="0">Today</button><button class="chip ${dd === ymd(addDays(parseYmd(today()), 1)) ? "on" : ""}" data-act="task-quick" data-id="1">Tomorrow</button>${draft.time ? '<button class="chip" data-act="task-cleartime">✕ Clear time</button>' : ""}</div>
    <div class="lbl" style="margin-top:4px">Priority</div>
    <div class="row wrap">${Object.entries(PRI).map(([k, [l, c]]) => `<button class="chip ${draft.priority === k ? "on" : ""}" style="${draft.priority === k ? `color:${c};border-color:${c};background:${c}22` : ""}" data-act="task-pri" data-id="${k}">● ${l}</button>`).join("")}</div>
    <div class="lbl">Repeat every (optional, starts from the date above)</div>
    <div class="wdays">${DAYS.map((n, i) => `<button class="${draft.days.includes(i + 1) ? "on" : ""}" data-act="task-day" data-id="${i + 1}">${n}</button>`).join("")}</div>
    <button class="btn primary block mt8" data-act="task-add">＋ Add task</button>
    <div class="muted xs mt8">One date = one-time task. Pick weekdays to repeat weekly. A time sets a reminder.</div>
  </div>
  <input class="inp mb12" id="t-search" data-in="t-search" placeholder="🔎 Search all tasks" value="${esc(ui.taskQ || "")}" autocomplete="off">
  ${q ? `<div class="card mb12"><div class="muted xs mb8">${hits.length} result${hits.length === 1 ? "" : "s"}</div>${hits.map((t) => `<button class="row between" style="width:100%;text-align:left;padding:8px 0;border-bottom:1px solid var(--line)" data-act="task-goto" data-id="${t.date}"><span class="grow semi sm">${esc(t.title)}</span><span class="muted xs">${isRepeat(t) ? "🔁 " : ""}${fmtDay(t.date, { weekday: "short", day: "numeric", month: "short" })}</span></button>`).join("") || '<div class="muted sm">No task matches.</div>'}</div>` : ""}
  ${all.length ? `<div class="row between xs muted mb8"><span>${isToday ? "Today" : fmtDay(d)}</span><span style="color:var(--ink)">${done.length}/${all.length} done</span></div>${bar(done.length / all.length)}<div class="mb12"></div>` : ""}
  ${pending.map((t) => card(t, d)).join("")}
  ${!all.length ? `<div class="muted" style="text-align:center;margin-top:36px">No tasks for ${isToday ? "today" : "this day"}.</div>` : ""}
  ${all.length && !pending.length ? '<div class="emerald bold" style="text-align:center;margin:24px 0">✓ All done for this day</div>' : ""}
  ${done.length ? `<div class="sec"><span>COMPLETED (${done.length})</span>${clearable.length ? '<button class="cyan xs" data-act="task-clear">Clear completed</button>' : ""}</div>${done.map((t) => card(t, d)).join("")}` : ""}
  <div class="sec">THIS WEEK</div>
  <div class="card"><div class="row between"><div><div class="h1">${ws.done}<span class="muted sm" style="font-weight:400"> / ${ws.total} done</span></div><div class="muted xs">last 7 days · ${ws.pct}%</div></div>
    <div style="text-align:right"><div class="h1">🔥 ${ws.streak}</div><div class="muted xs">day${ws.streak === 1 ? "" : "s"} with every task done</div></div></div><div class="mt12">${bar(ws.total ? ws.done / ws.total : 0, "var(--emerald)")}</div></div>
  ${upcoming.length ? `<div class="sec">NEXT 7 DAYS</div><div class="row wrap">${upcoming.map(([x, n]) => `<button class="chip" data-act="task-goto" data-id="${x}">${fmtDay(x, { weekday: "short", day: "numeric", month: "short" })} · ${n}</button>`).join("")}</div>` : ""}`;
}

const go = (d) => { ui.taskDate = d; draft.date = ""; ui.taskQ = ""; refresh(); };

onInput({
  "t-title": (el) => (draft.title = el.value),
  "t-note": (el) => (draft.note = el.value),
  "t-time": (el) => { draft.time = el.value; if (draft.time) refresh(); },
  "t-date": (el) => { if (el.value) { draft.date = el.value; refresh(); } },
  "t-view": (el) => { if (el.value) go(el.value); },
  "t-search": (el) => { ui.taskQ = el.value; refresh(); const i = document.getElementById("t-search"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
});

function editSheet(t) {
  let p = t.priority || "normal", days = isRepeat(t) ? [...t.days] : [];
  const s = sheet("Edit task", `<div class="field"><label class="lbl">Title</label><input class="inp" id="e-title" value="${esc(t.title)}"></div>
    <div class="field"><label class="lbl">Note</label><textarea class="inp" id="e-note" rows="3">${esc(t.note || "")}</textarea></div>
    <div class="row gap8"><div class="grow field"><label class="lbl">Date</label><input class="inp" type="date" id="e-date" value="${t.date}"></div><div class="grow field"><label class="lbl">Time</label><input class="inp" type="time" id="e-time" value="${t.time || ""}"></div></div>
    <div class="lbl">Priority</div><div class="row wrap" id="e-pri"></div><div class="lbl">Repeat every</div><div class="wdays" id="e-days"></div>
    <button class="btn primary block mt8" id="e-save">✓ Save changes</button>`);
  const q = (i) => s.el.querySelector(i);
  const paint = () => {
    q("#e-pri").innerHTML = Object.entries(PRI).map(([k, [l, c]]) => `<button class="chip ${p === k ? "on" : ""}" style="${p === k ? `color:${c};border-color:${c};background:${c}22` : ""}" data-p="${k}">● ${l}</button>`).join("");
    q("#e-days").innerHTML = DAYS.map((n, i) => `<button class="${days.includes(i + 1) ? "on" : ""}" data-d="${i + 1}">${n}</button>`).join("");
  };
  s.el.addEventListener("click", (e) => {
    const a = e.target.closest("[data-p]"); if (a) { p = a.dataset.p; paint(); }
    const b = e.target.closest("[data-d]"); if (b) { const n = +b.dataset.d, i = days.indexOf(n); if (i >= 0) days.splice(i, 1); else days.push(n); paint(); }
  });
  q("#e-save").onclick = () => {
    const title = q("#e-title").value.trim(); if (!title) return toast("Title cannot be empty");
    t.title = title; t.note = q("#e-note").value.trim(); t.priority = p; t.time = q("#e-time").value || null;
    t.date = q("#e-date").value || t.date; t.days = days.length ? [...days].sort((a, b) => a - b) : null; t.doneOn ||= {};
    save(); s.close(); refresh(); toast("Task updated");
  };
  paint();
}

on({
  "task-prev": () => go(ymd(addDays(parseYmd(viewDate()), -1))),
  "task-next": () => go(ymd(addDays(parseYmd(viewDate()), 1))),
  "task-today": () => go(today()),
  "task-goto": (el) => go(el.dataset.id),
  "task-quick": (el) => { draft.date = ymd(addDays(parseYmd(today()), +el.dataset.id)); refresh(); },
  "task-cleartime": () => { draft.time = ""; refresh(); },
  "task-pri": (el) => { draft.priority = el.dataset.id; refresh(); },
  "task-day": (el) => { const n = +el.dataset.id, i = draft.days.indexOf(n); if (i >= 0) draft.days.splice(i, 1); else draft.days.push(n); refresh(); },
  "task-add": async () => {
    const title = draft.title.trim();
    if (!title) return toast("Write a task first");
    const date = draft.date || viewDate(), time = draft.time || null, days = [...draft.days].sort((a, b) => a - b);
    if (time && permission() === "default") await askPermission();
    state.tasks.push({ id: nextId(), title, note: draft.note.trim(), time, date, days: days.length ? days : null, priority: draft.priority, done: false, doneAt: null, doneOn: {} });
    save();
    const onToday = date === today();
    Object.assign(draft, { title: "", note: "", time: "", date: "", days: [], priority: "normal" });
    if (!days.length) ui.taskDate = date;
    if (time && onToday && time <= hm()) toast("That time has passed today, saved without a reminder.");
    else if (time && permission() !== "granted") toast("Saved. Notifications are off, so the reminder shows only while NOCTIS is open.", 4500);
    else toast(days.length ? `Repeats every ${days.map((x) => DAYS[x - 1]).join(", ")}` : `Added for ${fmtDay(date, { weekday: "short", day: "numeric", month: "short" })}`);
    refresh();
  },
  "task-edit": (el) => { const t = state.tasks.find((x) => x.id === +el.dataset.id); if (t) editSheet(t); },
  "task-tmrw": (el) => {
    const t = state.tasks.find((x) => x.id === +el.dataset.id); if (!t || isRepeat(t)) return;
    t.date = ymd(addDays(parseYmd(viewDate()), 1)); save(); refresh(); toast(`Moved to ${fmtDay(t.date, { weekday: "short", day: "numeric", month: "short" })}`);
  },
  "task-toggle": (el) => {
    const t = state.tasks.find((x) => x.id === +el.dataset.id), d = viewDate();
    if (!t) return;
    if (isRepeat(t)) { t.doneOn ||= {}; if (t.doneOn[d]) delete t.doneOn[d]; else t.doneOn[d] = new Date().toISOString(); }
    else { t.done = !t.done; t.doneAt = t.done ? new Date().toISOString() : null; if (t.done && t.date < today() && d === today()) t.date = today(); }
    vibrate(8); save(); refresh();
  },
  "task-del": async (el) => { if (await trash("task", +el.dataset.id)) refresh(); },
  "task-clear": async () => {
    const d = viewDate(), ids = state.tasks.filter((t) => occursOn(t, d) && isDoneOn(t, d) && !isRepeat(t)).map((t) => t.id);
    if (!ids.length) return;
    if (!(await confirmBox("Clear completed tasks?", `${ids.length} task${ids.length === 1 ? "" : "s"} will move to the Recycle Bin.`, { ok: "Move to bin", danger: true }))) return;
    ids.forEach((id) => moveToBin("task", id)); toast("Moved to Recycle Bin"); refresh();
  },
});
