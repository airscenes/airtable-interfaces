import { formatDate } from "./format";

// --- Sales data aggregation & derived series ---

// Aggregate raw sales_report rows into one point per calendar day.
// `sold`/`total` are genuinely cumulative so we clamp them monotonic (Math.max)
// to absorb transient dips. `free` (faveurs) is NOT monotonic — it gets corrected
// downward and occasionally has bad spikes (e.g. a one-off 5908 between two 7s),
// so we carry the LAST reported value, never the max, to avoid locking a glitch.
// Each record carries its last known value forward to fill gap days. String-based
// date math avoids UTC shift.
export function aggregateSalesByDate(rows) {
  const byRecord = {};
  const allDatesSet = new Set();
  rows.forEach((row) => {
    const rid = row.record_id;
    const day = row.date ? row.date.split("T")[0] : row.date;
    allDatesSet.add(day);
    if (!byRecord[rid]) byRecord[rid] = {};
    byRecord[rid][day] = {
      sold: row.sold || 0,
      free: row.free || 0,
      total: parseFloat(row.total) || 0,
    };
  });
  const sortedDates = [...allDatesSet].sort();
  if (sortedDates.length === 0) return [];
  const recordIds = Object.keys(byRecord);
  const nextDay = (dateStr) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  const lastKnown = {};
  const formatted = [];
  for (
    let day = sortedDates[0];
    day <= sortedDates[sortedDates.length - 1];
    day = nextDay(day)
  ) {
    let sumSold = 0,
      sumFree = 0,
      sumTotal = 0;
    for (const rid of recordIds) {
      if (byRecord[rid] && byRecord[rid][day]) {
        const entry = byRecord[rid][day];
        if (!lastKnown[rid]) lastKnown[rid] = { sold: 0, free: 0, total: 0 };
        lastKnown[rid].sold = Math.max(lastKnown[rid].sold, entry.sold);
        lastKnown[rid].free = entry.free; // last reported, not max (see note above)
        lastKnown[rid].total = Math.max(lastKnown[rid].total, entry.total);
      }
      if (lastKnown[rid]) {
        sumSold += lastKnown[rid].sold;
        sumFree += lastKnown[rid].free;
        sumTotal += lastKnown[rid].total;
      }
    }
    formatted.push({
      date: day,
      dateLabel: formatDate(day),
      ventes: sumSold,
      gratuits: sumFree,
      total_dollars: sumTotal,
    });
  }
  return formatted;
}

// Bounds of the last *complete* Monday→Monday week relative to `ref`:
// end = most recent Monday on/before `ref`, start = the Monday before that.
export function lastCompleteWeekBounds(ref = new Date()) {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  const end = new Date(d);
  end.setDate(d.getDate() - dow);
  const start = new Date(end);
  start.setDate(end.getDate() - 7);
  return { start: iso(start), end: iso(end) };
}

// Per-representation weekly deltas. rows: [{ record_id, date, sold, total }].
// - sold delta = cumulative `sold` at endISO minus at startISO (running max; sold
//   is maintained live).
// - revenue = sold delta × net unit price, where net price = avg(total/sold) over
//   rows that have both filled. We DON'T use the `total` delta: `total` is filled
//   by a manual batch script (calculate-totals.mjs) so recent rows are 0/NULL and
//   would crush the weekly revenue to ~0. Pricing the sold delta mirrors that
//   same backfill logic (total = sold × prix_effectif) and stays reliable.
// Returns { recordId: { sold, revenue } } (revenue null when no price is known).
export function computeWeekDeltas(rows, startISO, endISO) {
  const byRec = {};
  for (const r of rows) {
    const day = r.date ? r.date.split("T")[0] : r.date;
    (byRec[r.record_id] = byRec[r.record_id] || []).push({
      day,
      sold: Number(r.sold) || 0,
      total: parseFloat(r.total) || 0,
    });
  }
  const out = {};
  for (const rid in byRec) {
    const list = byRec[rid].sort((a, b) => a.day.localeCompare(b.day));
    // Cumulative sold at a bound = running max over rows on/before it.
    const soldAt = (target) => {
      let sold = 0;
      for (const e of list) {
        if (e.day > target) break;
        if (e.sold > sold) sold = e.sold;
      }
      return sold;
    };
    const soldDelta = soldAt(endISO) - soldAt(startISO);
    // Net unit price = avg(total/sold) over rows where both are positive.
    let ratioSum = 0;
    let ratioCount = 0;
    for (const e of list) {
      if (e.total > 0 && e.sold > 0) {
        ratioSum += e.total / e.sold;
        ratioCount += 1;
      }
    }
    const prixNet = ratioCount > 0 ? ratioSum / ratioCount : null;
    out[rid] = {
      sold: soldDelta,
      revenue: prixNet != null ? soldDelta * prixNet : null,
    };
  }
  return out;
}

// The last `n` weeks as Monday boundaries, oldest→newest, ending with the
// current week's Monday (most recent Monday on/before `ref`). Each entry:
// { mondayIso, endIso } where endIso = mondayIso + 6 days (the Sunday).
export function lastNMondays(n, ref = new Date()) {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  const thisMonday = new Date(d);
  thisMonday.setDate(d.getDate() - dow);
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const mon = new Date(thisMonday);
    mon.setDate(thisMonday.getDate() - i * 7);
    const end = new Date(mon);
    end.setDate(mon.getDate() + 6);
    weeks.push({ mondayIso: iso(mon), endIso: iso(end) });
  }
  return weeks;
}

// Per-record cumulative `sold` (running max) as of each target ISO date.
// rows: [{ record_id, date, sold }]; `targets`: ISO strings sorted ascending.
// Returns { record_id: [soldAtTarget0, soldAtTarget1, ...] }. Single pass per
// record since both the rows and the targets are processed in date order.
export function cumulativeSoldByWeek(rows, targets) {
  const byRec = {};
  for (const r of rows) {
    const day = r.date ? r.date.split("T")[0] : r.date;
    (byRec[r.record_id] = byRec[r.record_id] || []).push({ day, sold: Number(r.sold) || 0 });
  }
  const out = {};
  for (const rid in byRec) {
    const list = byRec[rid].sort((a, b) => a.day.localeCompare(b.day));
    const series = [];
    let idx = 0;
    let run = 0;
    for (const target of targets) {
      while (idx < list.length && list[idx].day <= target) {
        if (list[idx].sold > run) run = list[idx].sold;
        idx++;
      }
      series.push(run);
    }
    out[rid] = series;
  }
  return out;
}

// Synthesize a cumulative budget-target curve over the given sorted ISO dates:
// a single convex (accelerating) ramp from 0 at the first date to totalObjective
// at the last date (right edge / today). Returns { isoDate: value }.
const OBJECTIVE_ACCEL = 2.2; // >1 = slow start, accelerating toward the right edge
export function buildObjectiveSeries(dates, totalObjective) {
  const out = {};
  if (!dates.length || !totalObjective) return out;
  const dayMs = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const startMs = dayMs(dates[0]);
  const span = dayMs(dates[dates.length - 1]) - startMs;
  for (const iso of dates) {
    const frac = span > 0 ? (dayMs(iso) - startMs) / span : 1;
    const eased = frac <= 0 ? 0 : frac >= 1 ? 1 : Math.pow(frac, OBJECTIVE_ACCEL);
    out[iso] = totalObjective * eased;
  }
  return out;
}
