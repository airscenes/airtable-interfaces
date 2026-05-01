export const MONTHS_FR = [
  "Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre",
];

export const DAYS_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

// Single source of truth for reading a DATE / DATE_TIME cell.
// Always returns an ISO string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss.SSSZ") or null.
// Convert a UTC ISO string to local time while keeping the "Z" suffix.
// Hour/minute/second become the local clock values, so downstream parsers
// (parseIsoTime) read what the user actually sees in Airtable.
// Dynamic offset → DST handled automatically (EDT in summer, EST in winter).
// DATE-only strings ("YYYY-MM-DD") are returned untouched to avoid an off-by-one day.
export function toLocalIso(iso) {
  if (!iso || !iso.includes("T")) return iso;
  const d = new Date(iso);
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return shifted.toISOString();
}

export function readDateCell(record, field) {
  if (!record || !field) return null;
  const raw = record.getCellValue(field);
  console.log("record name: ", record.name);
  console.log("raw:", raw);
  if (raw == null) return null;

  let iso;
  if (typeof raw === "string") iso = raw;
  else if (raw instanceof Date) iso = raw.toISOString();
  else if (typeof raw === "number") iso = new Date(raw).toISOString();
  else return null;

  return toLocalIso(iso);
}

export function parseIsoDate(iso) {
  if (!iso) return null;
  const str = typeof iso === "string" ? iso : String(iso);
  const parts = str.split("T")[0].split("-");
  if (parts.length < 3) return null;
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
    day: parseInt(parts[2], 10),
  };
}

/*Retourne Iso Heure*/
export function parseIsoTime(iso) {
  if (!iso) return null;
  const str = typeof iso === "string" ? iso : String(iso);
  const tPart = str.split("T")[1];
  if (!tPart) return null;
  const timeParts = tPart.replace("Z", "").split(":");
  if (timeParts.length < 2) return null;
  return {
    hour: parseInt(timeParts[0], 10),
    minute: parseInt(timeParts[1], 10),
  };
}

export function fmtTime(h, m) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function toDateKey(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function buildCalendarGrid(year, month) {
  const now = new Date();
  const todayKey = toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

  // First day of month: convert JS Sunday=0 to Monday=0
  const jsDay = new Date(year, month - 1, 1).getDay();
  const offset = (jsDay + 6) % 7;

  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < offset; i++) {
    cells.push({ day: null, dateKey: null, isToday: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = toDateKey(year, month, d);
    cells.push({ day: d, dateKey, isToday: dateKey === todayKey });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: null, dateKey: null, isToday: false });
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function buildDaysGrid(startDate, numDays) {
  const now = new Date();
  const todayKey = toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const cells = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const dateKey = toDateKey(y, m, day);
    cells.push({ day, dateKey, isToday: dateKey === todayKey, month: m, year: y });
  }
  return cells;
}

export function build2WeeksGrid(refDate) {
  const monday = getMonday(refDate);
  const cells = buildDaysGrid(monday, 14);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export function build3DaysGrid(refDate) {
  return buildDaysGrid(refDate, 3);
}

export function groupEventsByDate(records, dateField) {
  const map = new Map();
  if (!dateField || !records) return map;
  for (const record of records) {
    const iso = readDateCell(record, dateField);
    if (!iso) continue;
    const parsed = parseIsoDate(iso);
    if (!parsed) continue;
    const key = toDateKey(parsed.year, parsed.month, parsed.day);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  return map;
}
