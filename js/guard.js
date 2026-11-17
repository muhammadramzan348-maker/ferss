import { sheet, pinPad } from "./ui.js";
import { hasPin, verifyPin, bioEnabled, bioAuth } from "./auth.js";
import { withoutLock } from "./core.js";

let fails = 0, coolUntil = 0;
const FP = `<svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" stroke-width="1.4" stroke-linecap="round" style="filter:drop-shadow(0 0 8px #06B6D4)"><path d="M3.5 10C4.5 6 8 3.5 12 3.5s7.5 2.5 8.5 6.5"/><path d="M5.5 12.5C5.5 9 8.4 6.5 12 6.5s6.5 2.5 6.5 6c0 2-.2 3.7-.8 5.5"/><path d="M8.5 14.5c0-2 1.5-3.5 3.5-3.5s3.5 1.5 3.5 3.5c0 2-.3 3.6-1 5"/><path d="M12 11v3.5c0 2-.5 3.5-1.5 5"/></svg>`;

/**
 * Asks for the fingerprint (if enabled) or the PIN. Resolves true only after the user is verified;
 * false if they close the sheet. Used before undoing a prayer and before deleting anything for good.
 */
export function requireAuth(reason = "Confirm it's you") {
  if (!hasPin()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); s.close(); };
    const s = sheet("🔒 " + reason, `<div id="ga"></div>`, { onClose: () => { if (!settled) { settled = true; resolve(false); } } });
    const root = s.el.querySelector("#ga");

    const showPin = () => {
      root.innerHTML = '<div id="gp"></div>';
      const pad = pinPad(root.firstElementChild, {
        title: "Enter your PIN", subtitle: "to continue",
        disabled: () => Date.now() < coolUntil,
        onSubmit: async (p) => {
          if (Date.now() < coolUntil) return false;
          if (await verifyPin(p)) { fails = 0; finish(true); return true; }
          if (++fails >= 5) {
            fails = 0; coolUntil = Date.now() + 30000;
            const t = setInterval(() => { const sec = Math.ceil((coolUntil - Date.now()) / 1000); if (sec <= 0) { clearInterval(t); pad.setSubtitle("to continue"); } else pad.setSubtitle(`Too many attempts. Wait ${sec}s`); }, 500);
          }
          return false;
        },
      });
    };
    if (!bioEnabled()) return showPin();

    root.innerHTML = `<div style="text-align:center"><button id="gfp" aria-label="Use fingerprint" style="padding:6px">${FP}</button><div class="muted sm mt12" id="gst">Touch the fingerprint sensor</div><button class="icbtn muted" id="gpin" style="margin-top:12px;font-size:14px">Use PIN instead</button></div>`;
    root.querySelector("#gpin").onclick = showPin;
    let busy = false;
    const tryBio = async () => {
      if (busy || settled) return; busy = true;
      const st = root.querySelector("#gst"); if (st) st.textContent = "Touch the fingerprint sensor";
      try { const ok = await withoutLock(() => bioAuth()); if (ok) return finish(true); if (st) st.textContent = "Not recognised. Tap the icon to retry or use your PIN."; }
      catch { const st2 = root.querySelector("#gst"); if (st2) st2.textContent = "Cancelled. Tap the icon to retry or use your PIN."; }
      finally { busy = false; }
    };
    root.querySelector("#gfp").onclick = tryBio;
    tryBio();
  });
}
