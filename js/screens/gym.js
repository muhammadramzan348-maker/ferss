import { state, save, nextId } from "../store.js";
import { MUSCLE_GROUPS, WEEKDAYS, groupColor } from "../data.js";
import { EXERCISE_DICT } from "../dictionary.js";
import { detectMuscle } from "../detector.js";
import { ymd, addDays, isoDow, esc, titleCase, vibrate } from "../util.js";
import { icons, header, bar, gbtn, sheet, toast, confirmBox } from "../ui.js";
import { muscleFigure } from "../icons.js";
import { on, ui, refresh } from "../core.js";
import { trash } from "../bin.js";

const L1 = "تیرے میں کیا ہنر ہے یہ بتانا ضروری ہے،", L2 = "اگر تو زندہ ہے تو زندہ نظر آنا ضروری ہے";
const monday = () => { const d = new Date(); return addDays(d, -(isoDow(d) - 1)); };
const dateFor = (wd) => ymd(addDays(monday(), wd - 1));
const info = (name) => { const d = EXERCISE_DICT.find((x) => x.name === name); if (d) return { group: d.group, target: d.target }; const c = state.custom.find((x) => x.name === name); return c ? { group: c.group, target: c.target } : { group: "Other", target: "" }; };
const library = () => [...EXERCISE_DICT.map((d) => ({ name: d.name, group: d.group, target: d.target })), ...state.custom.map((c) => ({ name: c.name, group: c.group, target: c.target }))];
const badge = (g, t) => { const c = groupColor(g); return `<span class="badge" style="--c:${c}"><i></i>${esc(t)}</span>`; };
const groups = (wd) => (state.gymDays[wd] ||= { groups: [] }).groups;

export function render() {
  const wd = ui.gymWd || (ui.gymWd = isoDow()), todayWd = isoDow(), date = dateFor(wd), gs = groups(wd);
  const rows = state.gymEx.filter((e) => e.wd === wd).map((e) => ({ ...e, ...info(e.name), done: !!state.gymLogs[`${e.id}@${date}`] }));
  const done = rows.filter((r) => r.done).length, known = new Set(MUSCLE_GROUPS);
  const sections = [...MUSCLE_GROUPS, "Other"].map((g) => ({ g, items: rows.filter((r) => (known.has(r.group) ? r.group === g : g === "Other")) })).filter((s) => s.items.length);
  return `<div class="banner gym"><div class="u" style="font-size:clamp(16px,4.9vw,25px);color:#FAFAFA">${L1}</div><div style="height:1px;background:rgba(245,158,11,.27);margin:2px 48px"></div><div class="u" style="font-size:clamp(16px,4.9vw,25px);color:#FAFAFA">${L2}</div></div>
  ${header(icons.dumbbell({ size: 34 }), "Gym", "", `${WEEKDAYS[wd - 1]} · ${gs.length ? gs.join(" + ") : "Rest / not planned"}`)}
  <div class="row gap8 mb12">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => `<button class="wd ${wd === i + 1 ? "on" : ""}" data-act="gym-day" data-id="${i + 1}">${d}<i style="background:${i + 1 === todayWd ? "var(--emerald)" : "transparent"}"></i></button>`).join("")}</div>
  <div class="muted xs mt16 mb8" style="letter-spacing:.14em">MUSCLE GROUPS FOR THIS DAY</div>
  <div class="mscroll">${MUSCLE_GROUPS.map((g) => { const n = rows.filter((r) => r.group === g).length, on_ = gs.includes(g);
    return `<button class="mcard ${on_ ? "on" : ""}" style="--c:${groupColor(g)}" data-act="gym-group" data-id="${g}">${muscleFigure(g, 58, !on_)}<b>${g}</b>${n ? `<span class="cnt">${n}</span>` : ""}</button>`; }).join("")}</div>
  ${rows.length ? `<div class="mt16"><div class="row between sm mb8"><span class="muted">Workout progress</span><span>${done}/${rows.length} done</span></div>${bar(done / rows.length, done === rows.length ? "var(--emerald)" : "var(--amber)")}</div>` : `<div class="muted" style="text-align:center;margin:40px 0">No exercises for this day yet.</div>`}
  ${sections.map((sec) => { const c = groupColor(sec.g);
    return `<div class="row" style="margin:24px 0 12px"><span style="width:40px;text-align:center">${muscleFigure(sec.g, 30)}</span><b class="sm" style="color:${c};letter-spacing:.14em;margin-left:8px">${sec.g.toUpperCase()}</b><span class="muted xs" style="margin-left:8px">${sec.items.length}</span></div>
    ${sec.items.map((r) => `<div class="card mb12 fade" style="${r.done ? "border-color:rgba(16,185,129,.6)" : ""}"><div class="row" style="align-items:flex-start"><div class="grow" style="padding-right:12px"><div class="semi" style="font-size:16px;${r.done ? "color:var(--muted);text-decoration:line-through" : ""}">${esc(r.name)}</div><div class="muted xs" style="margin:2px 0 8px">${r.sets ?? 3} × ${esc(r.reps ?? "10")}</div>${badge(r.group, r.target)}</div><button class="icbtn" data-act="gym-del" data-id="${r.id}">🗑</button></div>
      <div class="mt16">${gbtn("gym-done", r.id, { color: c, done: r.done, doneLabel: "Completed ✓" })}</div></div>`).join("")}`; }).join("")}
  <button class="btn primary block mt16" data-act="gym-add">＋ Add exercise</button>`;
}

function addSheet() {
  const wd = ui.gymWd, gs = groups(wd);
  let custom = false, filter = gs.length === 1 ? gs[0] : "All", q = "", added = new Set(), targetEdited = false;
  const have = () => new Set([...state.gymEx.filter((e) => e.wd === wd).map((e) => e.name)]);
  const s = sheet("Add exercise", `<div class="row mb12"><button class="chip" data-tab="lib">Library</button><button class="chip" data-tab="cus">＋ Custom</button></div><div id="body"></div>`);
  const body = s.el.querySelector("#body");
  const add = (name) => { state.gymEx.push({ id: nextId(), wd, name, sets: parseInt(body.querySelector("#sets")?.value, 10) || 3, reps: (body.querySelector("#reps")?.value || "10").trim() || "10" }); added.add(name); save(); vibrate([12, 20, 12]); refresh(); };
  const setsReps = `<div class="row gap12"><div style="width:90px" class="field"><label class="lbl">Sets</label><input class="inp" id="sets" inputmode="numeric" value="3"></div><div style="width:110px" class="field"><label class="lbl">Reps</label><input class="inp" id="reps" placeholder="8-12" value="10"></div></div>`;
  const tabs = () => s.el.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", (b.dataset.tab === "cus") === custom));

  function lib() {
    const h = have(), lq = q.toLowerCase();
    const list = library().filter((i) => (filter === "All" || i.group === filter) && `${i.name} ${i.target}`.toLowerCase().includes(lq)).slice(0, 60);
    const det = detectMuscle(q), exact = list.some((i) => i.name.toLowerCase() === q.trim().toLowerCase());
    body.innerHTML = `${setsReps}<input class="inp mb12" id="q" placeholder="Type any exercise, e.g. Hammer Curl" value="${esc(q)}">
      ${det && !exact ? `<div class="card mb12" style="background:var(--bg);padding:12px"><div class="muted xs mb8">AUTO-DETECTED</div><div class="semi mb8">${esc(det.name || titleCase(q))}</div>${badge(det.group, det.target)}<button class="btn primary block mt12" id="adddet">＋ Add ${esc(det.name || '"' + titleCase(q) + '"')}</button></div>` : ""}
      <div class="row wrap">${["All", ...MUSCLE_GROUPS].map((g) => `<button class="chip ${filter === g ? "on" : ""}" data-f="${g}">${g}</button>`).join("")}</div>
      ${list.map((i) => `<button class="row block" style="width:100%;text-align:left;padding:12px 0;border-bottom:1px solid var(--line)" data-ex="${esc(i.name)}"><span style="width:4px;align-self:stretch;border-radius:2px;background:${groupColor(i.group)};margin-right:10px"></span><span class="grow"><b class="sm">${esc(i.name)}</b><br><span class="xs" style="color:${groupColor(i.group)}">→ ${esc(i.target)}</span></span><span style="font-size:22px;color:${h.has(i.name) || added.has(i.name) ? "var(--emerald)" : "var(--cyan)"}">${h.has(i.name) || added.has(i.name) ? "✔" : "⊕"}</span></button>`).join("")}
      ${!list.length && !det ? '<div class="muted sm mt16">No match. Use "＋ Custom" to create it.</div>' : ""}`;
    const qi = body.querySelector("#q"); qi.focus(); qi.setSelectionRange(q.length, q.length);
  }
  function cus() {
    body.innerHTML = `<div class="field"><label class="lbl">Exercise name</label><input class="inp" id="cn" placeholder="e.g. Landmine Press"></div><div id="cdet" class="mb12"></div>
      <div class="lbl">Muscle group</div><div class="row wrap" id="cg"></div><div class="field"><label class="lbl">Target muscle part</label><input class="inp" id="ct" placeholder="e.g. Upper Chest & Front Delts"></div>${setsReps}<button class="btn primary block" id="csave">✓ Save & add to this day</button>`;
    let grp = MUSCLE_GROUPS[0];
    const cg = () => (body.querySelector("#cg").innerHTML = MUSCLE_GROUPS.map((g) => `<button class="chip ${grp === g ? "on" : ""}" data-g="${g}">${g}</button>`).join(""));
    const upd = () => { const name = body.querySelector("#cn").value, d = detectMuscle(name); body.querySelector("#cdet").innerHTML = d ? `<div class="muted xs mb8">${d.match === "exact" ? "AUTO-DETECTED" : "BEST MATCH"}</div>${badge(d.group, d.target)}` : "";
      if (d && !targetEdited) { grp = d.group; body.querySelector("#ct").value = d.target; cg(); }
      body.querySelector("#csave").disabled = !(name.trim() && body.querySelector("#ct").value.trim()); };
    body.querySelector("#cn").addEventListener("input", (e) => { if (!e.target.value) targetEdited = false; upd(); });
    body.querySelector("#ct").addEventListener("input", () => { targetEdited = true; upd(); });
    body.querySelector("#cg").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (b) { grp = b.dataset.g; targetEdited = true; cg(); } });
    body.querySelector("#csave").onclick = () => { const name = titleCase(body.querySelector("#cn").value); if (!state.custom.some((c) => c.name === name) && !EXERCISE_DICT.some((d) => d.name === name)) state.custom.push({ name, group: grp, target: body.querySelector("#ct").value.trim() }); add(name); custom = false; tabs(); lib(); };
    cg(); upd();
  }
  s.el.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]"); if (t) { custom = t.dataset.tab === "cus"; tabs(); custom ? cus() : lib(); return; }
    const f = e.target.closest("[data-f]"); if (f) { filter = f.dataset.f; lib(); return; }
    const x = e.target.closest("[data-ex]"); if (x) { const n = x.dataset.ex; if (!have().has(n) && !added.has(n)) { add(n); lib(); } return; }
    if (e.target.closest("#adddet")) { const d = detectMuscle(q); const name = d.name || titleCase(q); if (!d.name && !state.custom.some((c) => c.name === name)) state.custom.push({ name, group: d.group, target: d.target }); add(name); lib(); }
  });
  s.el.addEventListener("input", (e) => { if (e.target.id === "q") { q = e.target.value; lib(); } });
  tabs(); lib();
}

on({
  "gym-day": (el) => { ui.gymWd = +el.dataset.id; refresh(); },
  "gym-group": (el) => { const g = el.dataset.id, a = groups(ui.gymWd), i = a.indexOf(g); if (i >= 0) a.splice(i, 1); else a.push(g); save(); refresh(); },
  "gym-done": (el) => { const k = `${el.dataset.id}@${dateFor(ui.gymWd)}`; if (state.gymLogs[k]) delete state.gymLogs[k]; else state.gymLogs[k] = true; vibrate(10); save(); refresh(); },
  "gym-del": async (el) => { if (await trash("gymEx", +el.dataset.id)) refresh(); },
  "gym-add": addSheet,
});
