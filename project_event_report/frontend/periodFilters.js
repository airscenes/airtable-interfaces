// Record filtering shared by the monthly report and the per-event reports: which Revenus /
// Dépenses / Événements belong to a spectacle (canal) and to a month. No UI, runs in Node too
// (scripts can replay it on exported base data).

const pad = (n) => String(n).padStart(2, "0");

export function parseIsoParts(value) {
  let iso = value;
  if (Array.isArray(iso)) iso = iso[0];
  if (iso && typeof iso === "object" && iso.value) iso = iso.value;
  if (!iso || typeof iso !== "string") return null;
  if (iso.includes("/")) {
    const parts = iso.split("/").map((s) => parseInt(s, 10));
    if (parts.length === 3) {
      const [d, m, y] = parts;
      if (y && m && d) return { year: y, month: m, day: d };
    }
    return null;
  }
  const [y, m, d] = iso.slice(0, 10).split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  return { year: y, month: m, day: d };
}

export function isInPeriod(iso, year, month) {
  const p = parseIsoParts(iso);
  if (!p || p.year !== year) return false;
  return p.month === month;
}

// True when the date is strictly before the first day of the selected (year, month).
export function isBeforePeriod(iso, year, month) {
  const p = parseIsoParts(iso);
  if (!p) return false;
  if (p.year !== year) return p.year < year;
  return p.month < month;
}

// UTC timestamps (dateTime fields, e.g. "Date de la représentation") become the local
// YYYY-MM-DD, or an evening show lands on the next day. Date-only strings are left as is
// (parsing them would shift them the other way).
function toLocalDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return v;
  const d = new Date(v);
  return isNaN(d) ? v : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ISO date of the first of `fields` that has one (handles lookups/arrays and dateTime).
export function readDateIso(rec, ...fields) {
  for (const f of fields) {
    if (!f) continue;
    let v = rec.getCellValue(f);
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === "object" && v.value) v = v.value;
    if (v == null || v === "") v = rec.getCellValueAsString(f);
    if (v && typeof v === "string") return toLocalDate(v);
  }
  return null;
}

// True when `field` of `rec` points at the spectacle. Accepts a link field, a lookup of links,
// or a text formula/lookup holding the spectacle's record id or its name (e.g. the Revenus
// "Spectacle" formula returns "9001-S | VIVANT - Lubik | Spectacle", not the id).
export function belongsToSpectacle(rec, field, spectacleId, spectacleName) {
  const ids = [];
  const collect = (x) => {
    if (!x) return;
    if (Array.isArray(x)) x.forEach(collect);
    else if (typeof x === "object") {
      if (typeof x.id === "string") ids.push(x.id);
      if (x.valuesByLinkedRecordId) Object.values(x.valuesByLinkedRecordId).forEach(collect);
      if ("value" in x) collect(x.value);
    }
  };
  collect(rec.getCellValue(field));
  if (ids.includes(spectacleId)) return true;
  const text = rec.getCellValueAsString(field) || "";
  if (text.includes(spectacleId)) return true;
  return !!spectacleName && (text === spectacleName || text.split(", ").includes(spectacleName));
}

/**
 * Records of a spectacle for the monthly report: dated in (year, month), plus earlier ones not yet
 * on an État de compte (rattrapages). Future records and records reconciled on another État
 * (`excludeIds`) are left out. Without `dateFields`, only the spectacle filter applies; a record
 * with no date at all is left out (it can't be placed in a month).
 */
export function filterForPeriod(records, { spectacleField, spectacleId, spectacleName, dateFields = [], year, month, excludeIds }) {
  if (!spectacleId) return [];
  const dated = dateFields.some(Boolean);
  return (records || []).filter((rec) => {
    if (spectacleField && !belongsToSpectacle(rec, spectacleField, spectacleId, spectacleName)) return false;
    if (!dated) return true;
    const d = readDateIso(rec, ...dateFields);
    if (!isInPeriod(d, year, month) && !isBeforePeriod(d, year, month)) return false;
    return !(excludeIds && excludeIds.has(rec.id));
  });
}
