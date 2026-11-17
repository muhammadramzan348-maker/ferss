const colors = { emerald: "#10B981", amber: "#F59E0B", crimson: "#EF4444" };
import { money, pct } from "./util.js";
export const emptySummary = {
    income: 0, savings: 0, needsPool: 0, wantsPool: 0,
    spentNeeds: 0, spentWants: 0, spentTotal: 0, available: 0, allTimeSavings: 0,
};
/** strict: a zero budget with any spending counts as overspent. */
export const levelFor = (spent, limit, strict = false) => {
    if (limit <= 0)
        return strict && spent > 0 ? "over" : "ok";
    if (spent > limit)
        return "over";
    if (spent >= limit * 0.8)
        return "warn";
    return "ok";
};
export const levelColor = {
    ok: colors.emerald,
    warn: colors.amber,
    over: colors.crimson,
};
export function buildAlerts(s, cats, catSpent) {
    const out = [];
    if (s.available < 0)
        out.push({
            level: "over",
            message: `Overspending Alert: you have spent ${money(-s.available)} more than your budget this month.`,
        });
    ["needs", "wants"].forEach((b) => {
        const pool = b === "needs" ? s.needsPool : s.wantsPool;
        const spent = b === "needs" ? s.spentNeeds : s.spentWants;
        const label = b === "needs" ? "Needs" : "Wants";
        const lv = levelFor(spent, pool, true);
        if (lv === "over")
            out.push({ level: "over", message: `${label} budget exceeded by ${money(spent - pool)}.` });
        else if (lv === "warn")
            out.push({ level: "warn", message: `${label} budget is ${pct(spent, pool)}% used. Slow down.` });
    });
    cats.forEach((c) => {
        const sp = catSpent[c.id] || 0;
        const lv = levelFor(sp, c.monthly_limit);
        if (lv === "over")
            out.push({
                level: "over",
                message: `${c.name} is ${money(sp - c.monthly_limit)} over its ${money(c.monthly_limit)} limit.`,
            });
        else if (lv === "warn")
            out.push({
                level: "warn",
                message: `${c.name} is at ${pct(sp, c.monthly_limit)}% of its limit.`,
            });
    });
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "over" ? -1 : 1));
}
/** What would happen if this expense were logged? */
export function checkExpense(amount, cat, s, catSpent) {
    const catAfter = (catSpent[cat.id] || 0) + amount;
    const pool = cat.bucket === "needs" ? s.needsPool : s.wantsPool;
    const bucketAfter = (cat.bucket === "needs" ? s.spentNeeds : s.spentWants) + amount;
    const label = cat.bucket === "needs" ? "Needs" : "Wants";
    if (cat.monthly_limit > 0 && catAfter > cat.monthly_limit)
        return {
            level: "over",
            message: `${cat.name} will go ${money(catAfter - cat.monthly_limit)} over its ${money(cat.monthly_limit)} limit.`,
        };
    if (levelFor(bucketAfter, pool, true) === "over")
        return {
            level: "over",
            message: `This pushes your ${label} budget ${money(bucketAfter - pool)} over (budget: ${money(pool)}).`,
        };
    if (s.available - amount < 0)
        return { level: "over", message: "This is more than your available spending budget." };
    if (cat.monthly_limit > 0 && catAfter >= cat.monthly_limit * 0.8)
        return {
            level: "warn",
            message: `${cat.name} will reach ${pct(catAfter, cat.monthly_limit)}% of its limit.`,
        };
    if (levelFor(bucketAfter, pool, true) === "warn")
        return { level: "warn", message: `${label} budget will be ${pct(bucketAfter, pool)}% used.` };
    return { level: "ok", message: "" };
}
