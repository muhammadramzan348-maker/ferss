export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const p2 = (n) => String(n).padStart(2, "0");
export const ymd = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const isoDow = (d = new Date()) => d.getDay() || 7; // 1=Mon .. 7=Sun
export const hm = (d = new Date()) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const fmtTime = (t) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${p2(m)} ${h >= 12 ? "PM" : "AM"}`;
};
export const fmtDay = (s, o = { day: "numeric", month: "short" }) => parseYmd(s).toLocaleDateString("en-GB", o);

const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const money = (n) => `${n < 0 ? "-" : ""}Rs ${group(String(Math.round(Math.abs(n))))}`;
export const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
export const usdt = (n) => {
  const [i, d] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}${group(i)}.${d} USDT`;
};
export const signedMoney = (n) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${money(Math.abs(n))}`;
export const rate = (n) => (n > 0 ? n.toFixed(2) : "–");
export const pkrExact = (n) => {
  const [i, d] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}Rs ${group(i)}${d === "00" ? "" : "." + d}`;
};

export const vibrate = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

export async function sha256Hex(str) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const randHex = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, "0")).join("");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const titleCase = (s) => s.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
