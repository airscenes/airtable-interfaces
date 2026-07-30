// --- Date & number formatting helpers (fr-FR locale) ---

const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "avr",
  "mai",
  "jun",
  "jul",
  "aou",
  "sep",
  "oct",
  "nov",
  "dec",
];

// Default visible window: last 7 days (matches the "7j" preset). Used as the
// initial date filter so charts open zoomed on recent weekly variation.
export function defaultDateRange() {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  return { from: iso(from), to: iso(now) };
}

export function formatDate(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length < 3) return isoDate;
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${day} ${MONTHS_SHORT[month]}`;
}

export const fmtNumber = (v) =>
  v == null || (typeof v === "number" && isNaN(v)) ? "—" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });

export const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v)) ? "—" : `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $`;
