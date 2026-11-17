import { meta, setState, blank, flush } from "./store.js";
import { sha256Hex, randHex } from "./util.js";

const enc = new TextEncoder();
const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
};

/* ---------- PIN (4 digits, unlocks the app) ---------- */
export const hasPin = () => !!meta.get("pin");
export async function setPin(pin) { const salt = randHex(16); meta.set("pin", { salt, hash: await sha256Hex(salt + pin) }); }
export async function verifyPin(pin) { const p = meta.get("pin"); return !!p && (await sha256Hex(p.salt + pin)) === p.hash; }

/* ---------- Master PIN (6-12 digits, only used to set a NEW pin if you forget it; never erases data) ---------- */
const MASTER_ITER = 150000;
async function slow(secret, saltHex, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(saltHex), iterations: iter, hash: "SHA-256" }, base, 256);
  return b64u.enc(bits);
}
export const hasMaster = () => !!meta.get("master");
export async function setMaster(m) { const salt = randHex(16); meta.set("master", { salt, iter: MASTER_ITER, hash: await slow(m, salt, MASTER_ITER) }); }
export async function verifyMaster(m) { const p = meta.get("master"); return !!p && (await slow(m, p.salt, p.iter)) === p.hash; }

/* ---------- Fingerprint / face / screen-lock via WebAuthn (platform authenticator) ---------- */
export async function bioSupported() {
  try { return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch { return false; }
}
export const bioEnabled = () => !!meta.get("bio");
export const bioDisable = () => meta.del("bio");
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function bioEnroll() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rnd(32),
      rp: { name: "NOCTIS" },
      user: { id: rnd(16), name: "noctis", displayName: "NOCTIS" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      attestation: "none", timeout: 60000,
    },
  });
  if (!cred) throw new Error("No credential created");
  meta.set("bio", { id: b64u.enc(cred.rawId) });
}

/** Shows the phone's fingerprint prompt. Resolves true only if the OS verified the user. */
export async function bioAuth() {
  const saved = meta.get("bio");
  if (!saved) return false;
  const challenge = rnd(32);
  const a = await navigator.credentials.get({
    publicKey: { challenge, allowCredentials: [{ type: "public-key", id: b64u.dec(saved.id), transports: ["internal"] }], userVerification: "required", timeout: 60000 },
  });
  if (!a) return false;
  const cd = JSON.parse(new TextDecoder().decode(a.response.clientDataJSON));
  const flags = new Uint8Array(a.response.authenticatorData)[32];
  return cd.type === "webauthn.get" && cd.challenge === b64u.enc(challenge) && b64u.enc(a.rawId) === saved.id && !!(flags & 0x01) && !!(flags & 0x04); // user present + user VERIFIED
}

/* ---------- last resort when no Master PIN exists: wipe this device ---------- */
export async function wipeAll() {
  setState(blank());
  await flush();
  for (const k of ["pin", "master", "bio", "lastBackup"]) meta.del(k);
  try { localStorage.removeItem("noctis_state"); localStorage.removeItem("noctis_fired"); } catch {}
}
