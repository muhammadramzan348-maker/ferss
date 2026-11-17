export const emptyConv = { rate: "", usdt: "", pkr: "", source: "usdt" };
export const toNum = (s) => {
    const n = parseFloat(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
};
/** "50.27", "14000" (no trailing zeros); "" when empty/invalid. */
export const fmt = (n, dp) => Number.isFinite(n) && n > 0 ? String(Number(n.toFixed(dp))) : "";
export const usdtToPkr = (usdt, rate) => (rate > 0 ? usdt * rate : 0);
export const pkrToUsdt = (pkr, rate) => (rate > 0 ? pkr / rate : 0);
/** Recalculates whichever field is NOT the source, using the current rate. */
export function recompute(s) {
    const r = toNum(s.rate);
    if (s.source === "usdt") {
        const u = toNum(s.usdt);
        return { ...s, pkr: u > 0 && r > 0 ? fmt(usdtToPkr(u, r), 2) : "" };
    }
    const p = toNum(s.pkr);
    return { ...s, usdt: p > 0 && r > 0 ? fmt(pkrToUsdt(p, r), 2) : "" };
}
