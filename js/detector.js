import { EXERCISE_DICT } from "./dictionary.js";
const SYN = {
    db: "dumbbell", dumbell: "dumbbell", bb: "barbell",
    pullup: "pull up", pushup: "push up", situp: "sit up", chinup: "chin up",
    pulldown: "pull down", pushdown: "push down", pressdown: "push down",
    skullcrusher: "skull crusher", flye: "fly", ohp: "overhead press",
    rdl: "romanian deadlift", tbar: "t bar", ezbar: "ez bar", cgbp: "close grip bench press",
    bicep: "biceps", tricep: "triceps",
};
const STOP = new Set(["the", "a", "an", "with", "on", "using", "of", "and"]);
const singular = (t) => t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
function tokens(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .filter((t) => t && !STOP.has(t))
        .map(singular)
        .flatMap((t) => (SYN[t] ?? t).split(" "))
        .map((t) => (t === "biceps" || t === "triceps" ? t : singular(t)));
}
let INDEX = null;
const build = () => {
    if (INDEX)
        return INDEX;
    INDEX = [];
    for (const entry of EXERCISE_DICT)
        for (const n of [entry.name, ...entry.aliases]) {
            const t = tokens(n);
            INDEX.push({ entry, set: new Set(t), key: [...t].sort().join(" "), seq: t });
        }
    return INDEX;
};
// Generic fallbacks, first match wins (specific rules before general ones).
const RULES = [
    [/incline.*(press|fly)/, "Chest", "Upper Chest (Clavicular Head)"],
    [/decline.*(press|fly)/, "Chest", "Lower Chest (Sternal Head)"],
    [/chest dip/, "Chest", "Lower Chest & Triceps"],
    [/(bench|chest) press|push up|pec|fly|crossover/, "Chest", "Mid Chest (Sternal Pec Major)"],
    [/hammer.*curl/, "Biceps", "Brachialis & Long Head of Biceps"],
    [/preacher|spider/, "Biceps", "Biceps Short Head"],
    [/incline.*curl/, "Biceps", "Biceps Long Head (Stretch)"],
    [/leg curl|hamstring curl/, "Legs", "Hamstrings (Biceps Femoris)"],
    [/wrist|forearm/, "Biceps", "Forearm Flexors & Extensors"],
    [/curl/, "Biceps", "Biceps Brachii (Long & Short Head)"],
    [/skull|push down|kickback|triceps|french press|close grip bench|jm press/, "Triceps", "Triceps (Long, Lateral & Medial Head)"],
    [/dip/, "Triceps", "Triceps (All Heads)"],
    [/pull down|pull up|chin up|lat /, "Back", "Lats & Upper Back"],
    [/romanian|stiff leg|good morning/, "Legs", "Hamstrings & Glutes"],
    [/deadlift/, "Back", "Erector Spinae, Glutes & Hamstrings"],
    [/shrug/, "Back", "Upper Trapezius"],
    [/face pull|rear delt|reverse fly/, "Shoulders", "Rear Delt (Posterior Head)"],
    [/row/, "Back", "Mid-Back & Rhomboids"],
    [/lateral raise|side raise/, "Shoulders", "Side Delt (Medial Head)"],
    [/front raise/, "Shoulders", "Front Delt (Anterior Head)"],
    [/shoulder press|overhead press|military|arnold|upright/, "Shoulders", "Front & Side Delts"],
    [/calf/, "Legs", "Calves (Gastrocnemius & Soleus)"],
    [/hip thrust|glute|bridge/, "Legs", "Glutes (Gluteus Maximus)"],
    [/leg extension/, "Legs", "Quadriceps"],
    [/squat|leg press|lunge|step up|hack/, "Legs", "Quads, Glutes & Hamstrings"],
    [/adduct/, "Legs", "Inner Thigh (Adductors)"],
    [/abduct/, "Legs", "Glute Medius & Outer Thigh"],
    [/twist|woodchop|oblique|side plank/, "Abs", "Obliques"],
    [/leg raise|knee raise|reverse crunch/, "Abs", "Lower Abs & Hip Flexors"],
    [/crunch|sit up|plank|ab |abs|core|rollout/, "Abs", "Rectus Abdominis & Core"],
];
export function detectMuscle(input) {
    const raw = input.trim();
    if (raw.length < 3)
        return null;
    const t = tokens(raw);
    if (!t.length)
        return null;
    const index = build();
    // 1) exact (word order ignored, plural/alias aware)
    const key = [...t].sort().join(" ");
    // Word order is ignored, but if several entries share the same words
    // ("Low-to-High" vs "High-to-Low" Cable Fly) the one with matching word order wins.
    const bigrams = (a) => a.slice(1).map((x, i) => `${a[i]}>${x}`);
    const qb = new Set(bigrams(t));
    let hit;
    let hitScore = -1;
    for (const i of index) {
        if (i.key !== key)
            continue;
        const sc = bigrams(i.seq).filter((b) => qb.has(b)).length;
        if (sc > hitScore) {
            hit = i;
            hitScore = sc;
        }
    }
    if (hit)
        return { group: hit.entry.group, target: hit.entry.target, name: hit.entry.name, match: "exact" };
    // 2) similar (token overlap)
    const q = new Set(t);
    let best = null;
    let bestScore = 0;
    for (const i of index) {
        let inter = 0;
        q.forEach((x) => i.set.has(x) && inter++);
        const score = inter / (q.size + i.set.size - inter);
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    }
    if (best && bestScore >= 0.6)
        return { group: best.entry.group, target: best.entry.target, name: best.entry.name, match: "similar" };
    // 3) keyword rules
    const text = t.join(" ");
    for (const [re, group, target] of RULES)
        if (re.test(text))
            return { group, target, match: "keyword" };
    return null;
}
export const titleCase = (s) => s.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
