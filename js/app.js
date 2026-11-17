import { $, vibrate } from "./util.js";
import { load, meta, state } from "./store.js";
import { icons, pinPad, toast, masterForm, confirmBox } from "./ui.js";
import { ui, actions, inputs, setRenderer, refresh, lockGuard, withoutLock } from "./core.js";
import { hasPin, verifyPin, setPin, hasMaster, setMaster, verifyMaster, bioEnabled, bioSupported, bioEnroll, bioAuth, wipeAll } from "./auth.js";
import { startReminders } from "./notify.js";
import * as tasks from "./screens/tasks.js";
import * as namaz from "./screens/namaz.js";
import * as finance from "./screens/finance.js";
import * as gym from "./screens/gym.js";
import * as binance from "./screens/binance.js";
import * as settings from "./screens/settings.js";
import { promptMaster } from "./screens/settings.js";

const TABS = [
  ["tasks", "Tasks", icons.tasks, tasks],
  ["namaz", "Namaz", icons.mosque, namaz],
  ["finance", "Finance", icons.wallet, finance],
  ["gym", "Gym", icons.dumbbell, gym],
  ["settings", "More", (o = {}) => `<svg width="${o.size || 26}" height="${o.size || 26}" viewBox="0 0 32 32" fill="none" stroke="${o.active === false ? "#71717A" : "#FAFAFA"}" stroke-width="1.8" stroke-linecap="round"><path d="M5 9h22M5 16h22M5 23h22"/><circle cx="11" cy="9" r="2.6" fill="#09090B"/><circle cx="21" cy="16" r="2.6" fill="#09090B"/><circle cx="13" cy="23" r="2.6" fill="#09090B"/></svg>`, settings],
];

let locked = true, remindersOn = false;

function renderNav() {
  $("#nav").innerHTML = TABS.map(([k, label, ic]) => `<button data-act="tab" data-id="${k}" class="${ui.tab === k && !ui.view ? "on" : ""}" aria-label="${label}">${ic({ size: 26, active: ui.tab === k && !ui.view })}<span>${label}</span></button>`).join("");
}

function render() {
  if (locked) return;
  const scr = $("#screen"), top = scr.scrollTop;
  const mod = ui.view === "binance" ? binance : ui.tab === "settings" || ui.view === "backup" || ui.view === "bin" ? settings : TABS.find((t) => t[0] === ui.tab)[3];
  scr.innerHTML = mod.render();
  renderNav();
  scr.scrollTop = top;
}
setRenderer(render);

/* ---------- global event delegation ---------- */
Object.assign(actions, {
  tab: (el) => { ui.view = null; ui.tab = el.dataset.id; $("#screen").scrollTop = 0; render(); },
  open: (el) => { ui.view = el.dataset.id; $("#screen").scrollTop = 0; render(); },
  back: () => { ui.view = null; $("#screen").scrollTop = 0; render(); },
});
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const f = actions[el.dataset.act];
  if (f) { vibrate(8); f(el, e); }
});
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-in]");
  if (el && inputs[el.dataset.in]) inputs[el.dataset.in](el, e);
});

/* ---------- lock screen: fingerprint first, PIN as fallback, Master PIN to recover ---------- */
const FP = `<svg width="84" height="84" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" stroke-width="1.4" stroke-linecap="round" style="filter:drop-shadow(0 0 8px #06B6D4)"><path d="M3.5 10C4.5 6 8 3.5 12 3.5s7.5 2.5 8.5 6.5"/><path d="M5.5 12.5C5.5 9 8.4 6.5 12 6.5s6.5 2.5 6.5 6c0 2-.2 3.7-.8 5.5"/><path d="M8.5 14.5c0-2 1.5-3.5 3.5-3.5s3.5 1.5 3.5 3.5c0 2-.3 3.6-1 5"/><path d="M12 11v3.5c0 2-.5 3.5-1.5 5"/></svg>`;
const BRAND = `<div style="text-align:center;margin-bottom:32px"><div class="glow-ic" style="--g:#06B6D4;font-size:38px;color:#06B6D4">☾</div><div class="bold" style="letter-spacing:.5em;margin-top:8px;margin-right:-.5em">NOCTIS</div></div>`;
const box = () => $("#lock");
const mount = (html) => { box().innerHTML = BRAND + `<div id="pp" style="width:100%;max-width:360px">${html || ""}</div>`; return box().querySelector("#pp"); };
const fresh = () => { const old = box().querySelector("#pp"); const n = old.cloneNode(false); old.replaceWith(n); return n; };
const link = (id, label, cls = "muted") => `<button class="icbtn ${cls}" id="${id}" style="font-size:14px;padding:10px">${label}</button>`;

function showLock() {
  locked = true;
  $("#layer").innerHTML = ""; $("#screen").innerHTML = "";
  $("#app").classList.add("hidden");
  box().classList.remove("hidden");
  if (hasPin()) unlockScreen(); else setupWizard();
}

/* ----- first run: PIN -> Master PIN -> (optional) fingerprint ----- */
function setupWizard() {
  let first = "";
  const stepPin = (n) => {
    const root = n === 0 ? mount() : fresh();
    pinPad(root, n === 0
      ? { title: "Create your PIN", subtitle: "4 digits to protect NOCTIS", onSubmit: async (p) => { first = p; stepPin(1); return true; } }
      : { title: "Confirm your PIN", subtitle: "Enter it once more", onSubmit: async (p) => { if (p !== first) return false; await setPin(p); stepMaster(); return true; } });
  };
  const stepMaster = () => masterForm(fresh(), {
    title: "Set a Master PIN", sub: "If you forget your PIN, the Master PIN lets you choose a new one. Nothing is ever erased. Write it down somewhere safe.",
    onSave: async (m) => { await setMaster(m); await stepBio(); },
  });
  const stepBio = async () => {
    if (!(await bioSupported())) return unlock();
    const root = fresh();
    root.innerHTML = `<div style="text-align:center">${FP}<div class="bold" style="font-size:22px;margin-top:12px">Unlock with fingerprint?</div><p class="muted sm">Open NOCTIS with your phone's fingerprint instead of typing the PIN. You can turn this off anytime in More.</p>
      <div class="crimson xs mb8" id="berr" style="min-height:16px"></div><button class="btn primary block" id="bon">👆 Enable fingerprint</button><button class="btn block mt12" id="bskip">Skip for now</button></div>`;
    root.querySelector("#bskip").onclick = unlock;
    root.querySelector("#bon").onclick = async () => {
      try { await withoutLock(() => bioEnroll()); toast("Fingerprint unlock is on"); unlock(); }
      catch (e) { root.querySelector("#berr").textContent = e && e.name === "NotAllowedError" ? "Cancelled. Try again or skip." : "Could not enable it on this phone."; }
    };
  };
  stepPin(0);
}

/* ----- normal unlock ----- */
let fails = 0, coolUntil = 0;
function unlockScreen() {
  const useBio = bioEnabled();
  const root = mount(`<div id="bio" class="${useBio ? "" : "hidden"}" style="text-align:center"><button id="fp" aria-label="Unlock with fingerprint" style="padding:8px">${FP}</button><div class="muted sm mt12" id="bio-st">Touch the fingerprint sensor</div></div><div id="pin" class="${useBio ? "hidden" : ""}"></div>
    <div class="row" style="justify-content:center;gap:8px;margin-top:20px" id="links">${useBio ? link("usepin", "Use PIN instead") : ""}${link("forgot", "Forgot PIN?")}</div>`);
  const pinBox = root.querySelector("#pin");
  const pad = pinPad(pinBox, {
    title: "Welcome back", subtitle: "Enter your PIN",
    disabled: () => Date.now() < coolUntil,
    onSubmit: async (p) => {
      if (Date.now() < coolUntil) return false;
      if (await verifyPin(p)) { fails = 0; unlock(); return true; }
      if (++fails >= 5) { fails = 0; coolUntil = Date.now() + 30000; const t = setInterval(() => { const sec = Math.ceil((coolUntil - Date.now()) / 1000); if (sec <= 0) { clearInterval(t); pad.setSubtitle("Enter your PIN"); } else pad.setSubtitle(`Too many attempts. Wait ${sec}s`); }, 500); }
      return false;
    },
  });
  const showPin = () => { root.querySelector("#bio").classList.add("hidden"); pinBox.classList.remove("hidden"); const u = root.querySelector("#usepin"); u && u.remove(); };
  root.querySelector("#forgot").onclick = forgotScreen;
  if (!useBio) return;
  root.querySelector("#usepin").onclick = showPin;
  const st = root.querySelector("#bio-st");
  let busy = false;
  const tryBio = async () => {
    if (busy) return; busy = true; st.textContent = "Touch the fingerprint sensor";
    try { const ok = await withoutLock(() => bioAuth()); if (ok) return unlock(); st.textContent = "Fingerprint not recognised. Tap the icon to retry or use your PIN."; }
    catch { st.textContent = "Fingerprint cancelled. Tap the icon to retry or use your PIN."; }
    finally { busy = false; }
  };
  root.querySelector("#fp").onclick = tryBio;
  // prompt right away, but only while the page is actually visible
  if (document.hidden) { const h = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", h); if (locked) tryBio(); } }; document.addEventListener("visibilitychange", h); }
  else tryBio();
}

/* ----- forgot PIN: Master PIN sets a NEW pin, data is never touched ----- */
let mFails = 0, mCool = 0, mLevel = 0;
function forgotScreen() {
  if (!hasMaster()) return noMasterScreen();
  const root = mount(`<div class="bold" style="font-size:22px;text-align:center">Reset your PIN</div><p class="muted sm" style="text-align:center;margin:8px 0 16px">Enter your Master PIN to choose a new PIN. Your data stays exactly as it is.</p>
    <div class="field"><label class="lbl">Master PIN</label><input class="inp" id="mp" type="password" inputmode="numeric" maxlength="12" autocomplete="off"></div>
    <div class="crimson xs mb8" id="merr" style="min-height:16px"></div><button class="btn primary block" id="mgo">Verify</button><div style="text-align:center;margin-top:8px">${link("mback", "‹ Back")}</div>`);
  root.querySelector("#mback").onclick = unlockScreen;
  const err = root.querySelector("#merr"), go = root.querySelector("#mgo");
  go.onclick = async () => {
    const wait = Math.ceil((mCool - Date.now()) / 1000);
    if (wait > 0) return (err.textContent = `Too many attempts. Wait ${wait}s.`);
    go.disabled = true; err.textContent = "";
    const ok = await verifyMaster(root.querySelector("#mp").value);
    go.disabled = false;
    if (ok) { mFails = 0; mLevel = 0; return newPinFlow(); }
    vibrate([60, 40, 60]); root.querySelector("#mp").value = "";
    if (++mFails >= 5) { mFails = 0; mCool = Date.now() + 60000 * 2 ** mLevel++; err.textContent = "Too many wrong attempts. Try again later."; }
    else err.textContent = `Wrong Master PIN. ${5 - mFails} attempt${5 - mFails === 1 ? "" : "s"} left.`;
  };
}
function newPinFlow() {
  let first = "";
  const step = (n) => pinPad(fresh(), n === 0
    ? { title: "Choose a new PIN", subtitle: "4 digits", onSubmit: async (p) => { first = p; step(1); return true; } }
    : { title: "Confirm new PIN", subtitle: "Enter it once more", onSubmit: async (p) => { if (p !== first) return false; await setPin(p); fails = 0; coolUntil = 0; toast("New PIN set. Your data is untouched."); unlock(); return true; } });
  step(0);
}
/* old installs that never set a Master PIN: the only way back in is wiping this device */
function noMasterScreen() {
  const root = mount(`<div class="bold" style="font-size:22px;text-align:center">No Master PIN was set</div>
    <p class="muted sm" style="text-align:center;margin:8px 0 16px">Without a Master PIN, a forgotten PIN cannot be reset. As a last resort you can erase NOCTIS on this device and restore your data from a backup file. Try your fingerprint or remember the PIN first.</p>
    <button class="btn block" id="nback">‹ Back</button><button class="btn danger block mt12" id="nwipe">Erase this device and start over</button>`);
  root.querySelector("#nback").onclick = unlockScreen;
  root.querySelector("#nwipe").onclick = async () => {
    if (!(await confirmBox("Erase everything?", "All NOCTIS data on this device will be permanently deleted. You can restore later only if you have a backup file.", { ok: "Erase", danger: true }))) return;
    await wipeAll(); toast("Erased. Create a new PIN."); showLock();
  };
}

function unlock() {
  locked = false;
  $("#lock").classList.add("hidden");
  $("#lock").innerHTML = "";
  $("#app").classList.remove("hidden");
  render();
  if (!remindersOn) { remindersOn = true; startReminders(); }
  if (!hasMaster()) setTimeout(() => !locked && promptMaster(), 500); // older installs: ask once for a Master PIN
}
window.addEventListener("noctis-lock", () => { if (hasPin()) showLock(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && !locked && !lockGuard.suspended && hasPin()) showLock(); });

/* ---------- boot ---------- */
(async function boot() {
  await load();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  showLock();
  window.__noctis = { get state() { return state; }, ui, render, unlock: () => unlock() }; // handy for debugging / tests
})();
