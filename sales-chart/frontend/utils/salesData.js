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

// Bounds of the last *complete* day relative to `ref` (today is still in
// progress): end = yesterday, start = the day before. computeWeekDeltas then
// yields the sales accrued during yesterday — the 24h analog of
// lastCompleteWeekBounds.
export function lastCompleteDayBounds(ref = new Date()) {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const end = new Date(d);
  end.setDate(d.getDate() - 1);
  const start = new Date(d);
  start.setDate(d.getDate() - 2);
  return { start: iso(start), end: iso(end) };
}

// Per-representation weekly deltas. rows: [{ record_id, date, sold, total }].
// - sold delta = cumulative `sold` at endISO minus at startISO (running max; sold
//   is maintained live). A rep with no report on/before startISO takes its
//   first report in the window as the baseline instead of 0 — otherwise its
//   whole cumulative (sold before tracking began) lands in this window.
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
    const baseline = list[0].day <= startISO ? soldAt(startISO) : list[0].sold;
    const soldDelta = Math.max(0, soldAt(endISO) - baseline);
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

// Daily (non-cumulative) sales across every representation, one point per
// calendar day: [{ date, dateLabel, ventes, revenus }]. rows: [{ record_id,
// date, sold, total }].
// - ventes = sum over reps of the day's increase of the cumulative `sold`
//   (running max, so transient dips never count as negative sales).
// - revenus = each rep's increase × its net unit price, avg(total/sold), the
//   same pricing as computeWeekDeltas (`total` lags `sold`, so its own delta
//   is unreliable on recent days). null when no rep sold with a known price.
// - A rep's first report is its baseline, not a day of sales: it holds
//   everything sold before tracking began (on-sale date, or the day the
//   Airtable record was created — e.g. a season imported in bulk shows up
//   with months of cumulative sales). Only increases after it count. The
//   price: a rep whose very first report is its on-sale day loses that day.
// - An increase is spread evenly over the days since the rep's previous
//   report: weekly reports (Monday only) otherwise stack 7 days of sales on
//   Monday. The split is an estimate — the real per-day sales of those reps
//   are unknown — but each day's total and the period's total stay exact.
//   Integer split, remainder on the most recent days.
// - The first day of the data set is dropped (every rep is at its baseline).
// - Days without any report get 0, so the axis stays continuous.
export function dailySalesSeries(rows) {
  const byRec = {};
  const days = new Set();
  for (const r of rows) {
    const day = r.date ? r.date.split("T")[0] : r.date;
    if (!day) continue;
    days.add(day);
    const rec = (byRec[r.record_id] = byRec[r.record_id] || { soldByDay: {}, ratioSum: 0, ratioCount: 0 });
    const sold = Number(r.sold) || 0;
    const total = parseFloat(r.total) || 0;
    if (sold > (rec.soldByDay[day] || 0)) rec.soldByDay[day] = sold;
    else if (!(day in rec.soldByDay)) rec.soldByDay[day] = sold;
    if (total > 0 && sold > 0) {
      rec.ratioSum += total / sold;
      rec.ratioCount += 1;
    }
  }
  const sorted = [...days].sort();
  if (sorted.length < 2) return [];
  const recs = Object.values(byRec).map((rec) => ({
    soldByDay: rec.soldByDay,
    prixNet: rec.ratioCount > 0 ? rec.ratioSum / rec.ratioCount : null,
    last: null, // running max of cumulative sold so far
    lastIdx: null, // index (in `allDays`) of the previous report
  }));
  const nextDay = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  const allDays = [];
  for (let day = sorted[0]; day <= sorted[sorted.length - 1]; day = nextDay(day)) allDays.push(day);
  const ventes = allDays.map(() => 0);
  const revenus = allDays.map(() => 0);
  const hasRevenue = allDays.map(() => false);
  allDays.forEach((day, idx) => {
    for (const rec of recs) {
      if (!(day in rec.soldByDay)) continue;
      const prev = rec.last;
      const prevIdx = rec.lastIdx;
      const cur = Math.max(prev ?? 0, rec.soldByDay[day]);
      rec.last = cur;
      rec.lastIdx = idx;
      if (prev === null) continue; // baseline (see note above)
      const delta = cur - prev;
      if (delta <= 0) continue;
      // Spread over (prevIdx, idx]: span days, remainder on the latest ones.
      const span = idx - prevIdx;
      const base = Math.floor(delta / span);
      const extra = delta - base * span;
      for (let k = 1; k <= span; k++) {
        const share = base + (k > span - extra ? 1 : 0);
        const i = prevIdx + k;
        ventes[i] += share;
        if (rec.prixNet != null) {
          revenus[i] += share * rec.prixNet;
          hasRevenue[i] = true;
        }
      }
    }
  });
  // Day 0 is dropped: every rep is at its baseline there.
  return allDays.slice(1).map((day, j) => ({
    date: day,
    dateLabel: formatDate(day),
    ventes: ventes[j + 1],
    revenus: hasRevenue[j + 1] ? revenus[j + 1] : null,
  }));
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
