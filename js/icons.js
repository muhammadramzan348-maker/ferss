import { PRAYER, groupColor } from "./data.js";

let n = 0;
const nid = () => `i${++n}`;

function glowIcon(inner, from, to, { size = 28, active = true, extra = "" } = {}) {
  if (!active)
    return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke="#71717A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const id = nid();
  return `<svg class="glow-ic" style="--g:${from}" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke="url(#${id})" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="2" y1="30" x2="30" y2="2"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>${inner}${extra.replace(/__F__/g, `url(#${id})`)}</svg>`;
}

export const icons = {
  tasks: (o) => glowIcon('<circle cx="16" cy="16" r="11.5"/><path d="M10.5 16.5 L14.5 20.5 L21.5 12"/>', "#06B6D4", "#10B981", o),
  mosque: (o) => glowIcon(
    '<path d="M3 28 H29"/><path d="M9 28 V19 Q9 10 16 10 Q23 10 23 19 V28"/><path d="M16 10 V6.5"/><path d="M4 28 V14 L5.5 10.5 L7 14 V28"/><path d="M25 28 V14 L26.5 10.5 L28 14 V28"/><path d="M14 28 V24.5 Q16 21 18 24.5 V28"/>',
    "#2DD4BF", "#818CF8", { ...o, extra: '<circle cx="16" cy="4.6" r="1.5" fill="__F__" stroke="none"/>' }),
  dumbbell: (o) => glowIcon(
    '<path d="M10 16 H22"/><path d="M7 10.5 V21.5"/><path d="M10.5 8 V24"/><path d="M25 10.5 V21.5"/><path d="M21.5 8 V24"/><path d="M3.5 13.5 V18.5"/><path d="M28.5 13.5 V18.5"/>',
    "#F59E0B", "#EF4444", o),
  wallet: (o) => glowIcon(
    '<path d="M7 9 H25 A3 3 0 0 1 28 12 V23 A3 3 0 0 1 25 26 H7 A3 3 0 0 1 4 23 V12 A3 3 0 0 1 7 9 Z"/><path d="M8 9 L21 5 L23 9"/><path d="M28 15 H22.5 A3 3 0 0 0 22.5 21 H28"/>',
    "#10B981", "#FBBF24", { ...o, extra: '<circle cx="22.6" cy="18" r="1.2" fill="__F__" stroke="none"/>' }),
  candle: (o) => glowIcon(
    '<path d="M7 5 V27"/><rect x="4.8" y="10" width="4.4" height="9" rx="1"/><path d="M16 3 V23"/><rect x="13.8" y="7" width="4.4" height="10" rx="1"/><path d="M25 9 V29"/><rect x="22.8" y="14" width="4.4" height="10" rx="1"/>',
    "#06B6D4", "#FBBF24", o),
};

/* ---------------- Muscle figure ---------------- */
const BODY =
  "M46 23 L33 26 Q26 27 25 34 L21 54 L18 74 L23 76 L28 56 L31 42 L34 60 L34 72 L35 94 L36 114 L45 114 L47 94 L49 76 " +
  "L51 76 L53 94 L55 114 L64 114 L65 94 L66 72 L66 60 L69 42 L72 56 L77 76 L82 74 L79 54 L75 34 Q74 27 67 26 L54 23 Z";
const rr = (x, y, w, h, r) =>
  `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
const ARM_L = "M27 40 Q31 41 31 43 Q30 50 27.5 54 L22.5 54 Q24 47 27 40 Z";
const ARM_R = "M73 40 Q69 41 69 43 Q70 50 72.5 54 L77.5 54 Q76 47 73 40 Z";
const SHAPES = {
  Chest: ["M49 30 Q40 28 34 33 Q32 40 36 45 Q44 47 49 43 Z", "M51 30 Q60 28 66 33 Q68 40 64 45 Q56 47 51 43 Z"],
  Shoulders: ["M33 26 Q26 27 25 34 L27 40 Q31 40 34 36 Q35 30 33 26 Z", "M67 26 Q74 27 75 34 L73 40 Q69 40 66 36 Q65 30 67 26 Z"],
  Biceps: [ARM_L, ARM_R],
  Triceps: [ARM_L, ARM_R],
  Abs: [rr(44.2, 47, 5, 5.5, 1.6), rr(50.8, 47, 5, 5.5, 1.6), rr(44.2, 54, 5, 5.5, 1.6), rr(50.8, 54, 5, 5.5, 1.6), rr(44.2, 61, 5, 5.5, 1.6), rr(50.8, 61, 5, 5.5, 1.6)],
  Legs: ["M36 74 Q34 86 36 96 L44 96 Q47 86 48 77 Z", "M64 74 Q66 86 64 96 L56 96 Q53 86 52 77 Z", "M36 98 Q35 106 37 112 L43 112 Q45 105 44 98 Z", "M64 98 Q65 106 63 112 L57 112 Q55 105 56 98 Z"],
  Back: ["M50 24 L38 27 L33 31 Q31 44 38 56 Q44 62 50 62 Q56 62 62 56 Q69 44 67 31 L62 27 Z"],
};
export function muscleFigure(group, size = 64, dim = false) {
  const id = nid(), c = groupColor(group), sh = SHAPES[group] || [];
  const back = group === "Back" || group === "Triceps";
  const layers = dim ? "" : sh.map((d) => `<path d="${d}" fill="none" stroke="${c}" stroke-opacity=".28" stroke-width="3.6" stroke-linejoin="round"/>`).join("");
  return `<svg class="${dim ? "" : "fig-glow"}" style="--g:${c}" width="${size}" height="${size * 1.2}" viewBox="0 0 100 120"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".55"/></linearGradient></defs>
<path d="${BODY}" fill="#1B1B20" stroke="#34343C" stroke-width="1.2" stroke-linejoin="round"/><circle cx="50" cy="11" r="7" fill="#1B1B20" stroke="#34343C" stroke-width="1.2"/>
${back ? '<path d="M50 24 V72" stroke="#34343C" stroke-width="1" stroke-dasharray="2 2"/>' : ""}${layers}
${sh.map((d) => `<path d="${d}" fill="url(#${id})" fill-opacity="${dim ? 0.45 : 0.92}" stroke="${c}" stroke-opacity="${dim ? 0.6 : 1}" stroke-width="1" stroke-linejoin="round"/>`).join("")}</svg>`;
}

/* ---------------- Prayer art: mosque + janamaz over a time-of-day sky ---------------- */
const STARS = [[20, 18, 1.2, 0.9], [44, 40, 0.9, 0.6], [70, 14, 1.4, 0.9], [96, 34, 0.9, 0.7], [128, 16, 1.2, 0.8], [152, 36, 1, 0.6], [32, 62, 0.8, 0.5], [84, 56, 0.9, 0.6], [140, 56, 0.8, 0.5], [112, 8, 0.9, 0.7], [58, 30, 0.8, 0.5], [160, 14, 1, 0.8]];
const crescent = (cx, cy, s) => `M${cx} ${cy - 12 * s} A${12 * s} ${12 * s} 0 1 0 ${cx + 11 * s} ${cy + 9 * s} A${9.5 * s} ${9.5 * s} 0 1 1 ${cx} ${cy - 12 * s} Z`;

export function prayerArt(key) {
  const t = PRAYER[key], a = t.accent, G = 112, u = `pa${key}`;
  const star = (x, y, r, o, f = "#fff") => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" opacity="${o}"/>`;
  let sky = "";
  if (key === "fajr")
    sky = `<circle cx="118" cy="${G}" r="78" fill="url(#${u}g)" opacity=".6"/>${STARS.slice(0, 5).map(([x, y, r, o]) => star(x, y, r, o * 0.7, "#E0E7FF")).join("")}<path d="${crescent(40, 34, 0.7)}" fill="#C7D2FE" opacity=".6"/>`;
  if (key === "dhuhr" || key === "jumuah")
    sky = `<circle cx="76" cy="26" r="25" fill="url(#${u}g)" opacity=".8"/><circle cx="76" cy="26" r="14" fill="none" stroke="#FDE68A" stroke-opacity=".3"/><circle cx="76" cy="26" r="8.5" fill="#FDE68A"/>`;
  if (key === "asr")
    sky = `<circle cx="46" cy="52" r="42" fill="url(#${u}g)" opacity=".75"/><circle cx="44" cy="52" r="9" fill="#FBBF24"/><path d="M10 66 H80" stroke="#F59E0B" stroke-opacity=".35"/><path d="M20 74 H70" stroke="#F59E0B" stroke-opacity=".2"/>`;
  if (key === "maghrib")
    sky = `<circle cx="118" cy="104" r="70" fill="url(#${u}g)" opacity=".85"/><circle cx="118" cy="100" r="22" fill="#FB7185" opacity=".95"/><path d="M10 40 Q34 33 60 40" stroke="#FB7185" stroke-opacity=".4" stroke-width="1.2" fill="none"/><path d="M28 54 Q56 46 88 54" stroke="#FB7185" stroke-opacity=".28" stroke-width="1.2" fill="none"/>`;
  if (key === "isha")
    sky = `<circle cx="60" cy="34" r="34" fill="url(#${u}g)" opacity=".45"/>${STARS.map(([x, y, r, o]) => star(x, y, r, o)).join("")}<path d="${crescent(60, 34, 1)}" fill="#FDE68A"/>`;
  return `<svg viewBox="0 0 170 128" width="170" height="128" aria-hidden="true"><defs>
<radialGradient id="${u}g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${a}" stop-opacity=".75"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
<linearGradient id="${u}f" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#08080B" stop-opacity="0"/><stop offset=".25" stop-color="#08080B" stop-opacity=".9"/></linearGradient>
<radialGradient id="${u}m" cx="50%" cy="60%" r="70%"><stop offset="0" stop-color="${a}" stop-opacity=".55"/><stop offset="1" stop-color="${a}" stop-opacity=".18"/></radialGradient></defs>
${sky}
<g fill="#08080B" stroke="${a}" stroke-opacity=".55" stroke-width=".8" stroke-linejoin="round">
<path d="M92 ${G} V92 Q92 70 118 70 Q144 70 144 92 V${G} Z"/><path d="M80 ${G} V76 L83 66 L86 76 V${G} Z"/><path d="M150 ${G} V76 L153 66 L156 76 V${G} Z"/><rect x="76" y="106" width="86" height="6"/></g>
<path d="M118 70 V60" stroke="${a}" stroke-opacity=".8"/><path d="M118 53.5 A4 4 0 1 0 121.4 59.6 A3.2 3.2 0 1 1 118 53.5 Z" fill="${t.win}"/>
<g fill="${t.win}" opacity=".95"><path d="M113 112 V102 Q113 96 118 96 Q123 96 123 102 V112 Z"/><path d="M100 104 V96 Q100 92 103 92 Q106 92 106 96 V104 Z"/><path d="M130 104 V96 Q130 92 133 92 Q136 92 136 96 V104 Z"/><rect x="81.8" y="88" width="2.4" height="7" rx="1"/><rect x="151.8" y="88" width="2.4" height="7" rx="1"/></g>
<rect x="0" y="${G}" width="170" height="16" fill="url(#${u}f)"/>
<path d="M12 126 L68 126 L60 102 L20 102 Z" fill="url(#${u}m)" stroke="${a}" stroke-opacity=".9"/><path d="M18 122 L62 122 L56 106 L24 106 Z" fill="none" stroke="${a}" stroke-opacity=".45" stroke-width=".8"/>
<path d="M33 121 V113 Q40 104 47 113 V121" fill="${a}" fill-opacity=".18" stroke="${a}" stroke-width="1.2"/>
<g stroke="${a}" stroke-opacity=".6" stroke-width=".8">${[16, 24, 32, 40, 48, 56, 64].map((x) => `<path d="M${x} 126 V128"/>`).join("")}${[22, 29, 36, 43, 50, 57].map((x) => `<path d="M${x} 102 V100"/>`).join("")}</g></svg>`;
}
