export const PRAYERS = [
  { key: "fajr", label: "Fajr", urdu: "فجر", time: "05:00", accent: "#818CF8", grad: ["#141417", "#181745", "#2B2A6E"], win: "#C7D2FE" },
  { key: "dhuhr", label: "Dhuhr", urdu: "ظہر", time: "13:00", accent: "#2DD4BF", grad: ["#141417", "#0E2F33", "#14575B"], win: "#99F6E4" },
  { key: "asr", label: "Asr", urdu: "عصر", time: "16:30", accent: "#F59E0B", grad: ["#141417", "#2C1F0B", "#573710"], win: "#FDE68A" },
  { key: "maghrib", label: "Maghrib", urdu: "مغرب", time: "18:30", accent: "#F43F5E", grad: ["#141417", "#3A0F1B", "#7A1A2E"], win: "#FDA4AF" },
  { key: "isha", label: "Isha", urdu: "عشاء", time: "20:00", accent: "#A5B4FC", grad: ["#0B0B0D", "#08081A", "#0E0E2E"], win: "#FDE68A" },
];
export const PRAYER = Object.fromEntries(PRAYERS.map((p) => [p.key, p]));

export const JUMUAH_ITEMS = [
  { key: "ghusl", urdu: "غسل کرنا اور صاف لباس پہننا", en: "Ghusl & clean clothes" },
  { key: "attar", urdu: "عطر لگانا", en: "Applying attar" },
  { key: "kahf", urdu: "سورۃ الكہف پڑھنا", en: "Reading Surah Al-Kahf" },
  { key: "darood", urdu: "درود شریف کی کثرت", en: "Reciting Darood Sharif" },
  { key: "early", urdu: "مسجد جلدی جانا", en: "Early arrival at the mosque" },
];

export const MUSCLE_GROUPS = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Legs", "Abs"];
export const GROUP_COLORS = {
  Chest: "#06B6D4", Back: "#818CF8", Shoulders: "#A78BFA", Biceps: "#F59E0B",
  Triceps: "#F97316", Legs: "#10B981", Abs: "#EF4444",
};
export const groupColor = (g) => GROUP_COLORS[g] || "#71717A";

export const DEFAULT_CATEGORIES = [
  ["Rent & Bills", "needs"], ["Groceries", "needs"], ["Transport", "needs"], ["Health", "needs"],
  ["Dining Out", "wants"], ["Shopping", "wants"], ["Entertainment", "wants"], ["Other Wants", "wants"],
];
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/* Jummah (Friday) prayer: takes the place of Dhuhr on Fridays */
export const JUMMAH = { key: "jumuah", label: "Jummah", urdu: "جمعہ", time: "13:00", accent: "#FBBF24", grad: ["#141417", "#0E2A1F", "#2A2209"], win: "#FDE68A" };
PRAYER.jumuah = JUMMAH;

/* Rakat per prayer (common Hanafi order). [kind, count] */
export const RAKAT = {
  fajr: [["sunnah", 2], ["fard", 2]],
  dhuhr: [["sunnah", 4], ["fard", 4], ["sunnah", 2], ["nafl", 2]],
  asr: [["sunnah", 4], ["fard", 4]],
  maghrib: [["fard", 3], ["sunnah", 2], ["nafl", 2]],
  isha: [["sunnah", 4], ["fard", 4], ["sunnah", 2], ["nafl", 2], ["witr", 3], ["nafl", 2]],
  jumuah: [["sunnah", 4], ["fard", 2], ["sunnah", 4], ["sunnah", 2], ["nafl", 2]],
};
export const KIND = { sunnah: "سنت", fard: "فرض", nafl: "نفل", witr: "وتر" };
