import { $, esc, vibrate } from "./util.js";
import { icons } from "./icons.js";

const layer = () => $("#layer");

export function toast(msg, ms = 2400) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

/** Bottom sheet. Returns { el, close }. onClose runs once when dismissed. */
export function sheet(title, html, { onClose } = {}) {
  const ov = document.createElement("div");
  ov.className = "ov";
  ov.innerHTML = `<div class="sheet"><h3><span>${esc(title)}</span><button class="icbtn" data-close aria-label="Close" style="font-size:22px">✕</button></h3><div data-body>${html}</div></div>`;
  let closed = false;
  const close = () => { if (closed) return; closed = true; ov.remove(); onClose && onClose(); };
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) close(); });
  layer().appendChild(ov);
  return { el: ov.querySelector("[data-body]"), root: ov, close };
}

function dialog(html) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "ov mid";
    ov.innerHTML = `<div class="dlg">${html}</div>`;
    const done = (v) => { ov.remove(); resolve(v); };
    ov.addEventListener("click", (e) => {
      const b = e.target.closest("[data-r]");
      if (b) done(b.dataset.r === "1");
      else if (e.target === ov) done(false);
    });
    layer().appendChild(ov);
  });
}
export const confirmBox = (title, msg, { ok = "OK", danger = false, cancel = "Cancel" } = {}) =>
  dialog(`<div class="bold" style="font-size:18px">${esc(title)}</div><p class="muted sm" style="white-space:pre-line">${esc(msg)}</p>
  <div class="row gap8 mt16"><button class="btn grow" data-r="0">${esc(cancel)}</button><button class="btn grow ${danger ? "danger" : "primary"}" data-r="1">${esc(ok)}</button></div>`);
export const alertBox = (title, msg) =>
  dialog(`<div class="bold" style="font-size:18px">${esc(title)}</div><p class="muted sm" style="white-space:pre-line">${esc(msg)}</p>
  <div class="mt16"><button class="btn primary block" data-r="1">OK</button></div>`);

/* ---------- reusable HTML snippets ---------- */
export const header = (iconHtml, title, urdu, sub) =>
  `<div class="hdr"><div class="ico">${iconHtml}</div><div class="grow"><div class="row"><span class="h1">${esc(title)}</span>${urdu ? `<span class="ur">${urdu}</span>` : ""}</div>${sub ? `<div class="muted sm">${esc(sub)}</div>` : ""}</div></div>`;

export const bar = (v, color = "var(--emerald)") =>
  `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v * 100))}%;background:${color}"></i></div>`;

/** glowing Done button */
export const gbtn = (act, id, { color = "var(--cyan)", done = false, label = "Done", doneLabel = "Done ✓", compact = false } = {}) =>
  `<span class="gwrap"><button class="gbtn ${compact ? "compact" : ""} ${done ? "done" : ""}" style="--c:${color}" data-act="${act}" data-id="${esc(id)}">${done ? doneLabel : "✓ " + esc(label)}</button></span>`;

export const chip = (label, act, id, on, tone = "") =>
  `<button class="chip ${on ? "on" : ""} ${tone}" data-act="${act}" data-id="${esc(id)}">${esc(label)}</button>`;

export const field = (label, id, { type = "text", ph = "", value = "", inputmode = "" } = {}) =>
  `<div class="field"><label class="lbl" for="${id}">${esc(label)}</label><input class="inp" id="${id}" type="${type}" placeholder="${esc(ph)}" value="${esc(value)}" ${inputmode ? `inputmode="${inputmode}"` : ""} autocomplete="off"></div>`;

export const sectionTitle = (t, right = "") => `<div class="sec row between"><span>${t}</span>${right}</div>`;

/** PIN pad. Calls onSubmit(pin) -> Promise<boolean>; false = shake and clear. */
export function pinPad(root, { title, subtitle = "", onSubmit, disabled = () => false }) {
  let pin = "";
  root.innerHTML = `<div style="text-align:center;width:100%"><div class="bold" style="font-size:24px">${esc(title)}</div>
  <div class="muted sm" style="height:20px;margin-top:8px" data-sub>${esc(subtitle)}</div>
  <div class="dots" data-dots style="justify-content:center"><i></i><i></i><i></i><i></i></div>
  <div class="pad" style="justify-content:center">${["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k) => k === "" ? '<button class="ghost" disabled></button>' : `<button data-k="${k}">${k}</button>`).join("")}</div></div>`;
  const dots = () => root.querySelectorAll("[data-dots] i").forEach((d, i) => d.classList.toggle("f", i < pin.length));
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-k]");
    if (!b || disabled()) return;
    vibrate(10);
    const k = b.dataset.k;
    if (k === "⌫") { pin = pin.slice(0, -1); return dots(); }
    if (pin.length >= 4) return;
    pin += k; dots();
    if (pin.length === 4) {
      await new Promise((r) => setTimeout(r, 120));
      const ok = await onSubmit(pin);
      if (!ok) {
        vibrate([60, 40, 60]);
        const d = root.querySelector("[data-dots]");
        d.classList.remove("shake"); void d.offsetWidth; d.classList.add("shake");
      }
      pin = ""; dots();
    }
  });
  return { setSubtitle: (t) => (root.querySelector("[data-sub]").textContent = t) };
}
export { icons };

/** Master PIN entry form (6-12 digits + confirm). onSave(master) is awaited. */
export function masterForm(root, { title = "Set a Master PIN", sub = "", btn = "Save Master PIN", onSave }) {
  root.innerHTML = `<div class="bold" style="font-size:22px;text-align:center">${esc(title)}</div><p class="muted sm" style="text-align:center;margin:8px 0 16px">${esc(sub)}</p>
  <div class="field"><label class="lbl">Master PIN (6 to 12 digits)</label><input class="inp" id="m1" type="password" inputmode="numeric" maxlength="12" autocomplete="off"></div>
  <div class="field"><label class="lbl">Confirm Master PIN</label><input class="inp" id="m2" type="password" inputmode="numeric" maxlength="12" autocomplete="off"></div>
  <div class="crimson xs mb8" id="merr" style="min-height:16px"></div><button class="btn primary block" id="msave">${esc(btn)}</button>`;
  const q = (i) => root.querySelector(i);
  q("#msave").onclick = async () => {
    const a = q("#m1").value, b = q("#m2").value;
    if (!/^\d{6,12}$/.test(a)) return (q("#merr").textContent = "Use 6 to 12 digits.");
    if (a !== b) return (q("#merr").textContent = "The two Master PINs do not match.");
    q("#msave").disabled = true;
    try { await onSave(a); } finally { q("#msave").disabled = false; }
  };
}
