// Period math for the shared week/month navigator.
//
// !! WEEKS RUN MONDAY → SUNDAY HERE. !!
// That matches the `semaines` table (226 pre-created Monday→Sunday weeks) and
// heures_semaine.date_semaine, which is always a Monday. The two other
// extensions in this repo — schedule_grid and availability_matrix — anchor
// their weeks on SUNDAY to match a paper schedule. Do not copy weekStart() from
// either of them into this file.
//
// A week is keyed by its Monday ISO date ("2026-09-07"), a month by "AAAA-MM".
// No ISO week numbers: nothing in the base uses them, they disagree with the
// `mois` formula at year boundaries, and date_semaine already gives a Monday.

import {
    DAY_LABELS_SHORT_FR,
    MONTH_LABELS_FR,
    MONTH_LABELS_SHORT_FR,
    GRAIN_WEEK,
    GRAIN_MONTH,
} from '../constants';
import {parseIsoDate} from './format';

// --- Primitives ---------------------------------------------------------------

export function toIso(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function todayIso() {
    return toIso(new Date());
}

export function addDays(date, days) {
    const x = new Date(date);
    x.setDate(x.getDate() + days);
    return x;
}

export function addIsoDays(iso, days) {
    const d = parseIsoDate(iso);
    return d ? toIso(addDays(d, days)) : iso;
}

// 0 = Monday … 6 = Sunday.
export function mondayIndex(date) {
    return (date.getDay() + 6) % 7;
}

export function isWeekendIso(iso) {
    const d = parseIsoDate(iso);
    return d ? mondayIndex(d) >= 5 : false;
}

// --- Week ----------------------------------------------------------------------

// The Monday of the week containing `date`, at local midnight.
export function weekStart(date) {
    const x = new Date(date);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - mondayIndex(x));
    return x;
}

// "2026-09-10" -> "2026-09-07". This is the week key used everywhere.
export function weekKeyOf(iso) {
    const d = parseIsoDate(iso);
    return d ? toIso(weekStart(d)) : null;
}

export function weekDays(weekKey) {
    const start = parseIsoDate(weekKey);
    if (!start) return [];
    return Array.from({length: 7}, (_, i) => toIso(addDays(start, i)));
}

// --- Month ----------------------------------------------------------------------

// "2026-09-10" -> "2026-09".
export function monthKeyOf(iso) {
    return iso ? String(iso).slice(0, 7) : null;
}

export function monthDays(monthKey) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? ''));
    if (!m) return [];
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const out = [];
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
        out.push(toIso(d));
        d.setDate(d.getDate() + 1);
    }
    return out;
}

export function addMonths(monthKey, delta) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? ''));
    if (!m) return monthKey;
    const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// --- Period -----------------------------------------------------------------------

// Resolve an anchor date + a grain into everything the UI and the model need.
// `weekKeys` is the ordered list of Mondays the period touches — in month grain
// it includes the Mondays of weeks that spill outside the month, because a
// heures_semaine row belongs to a whole week, not to a calendar month.
export function buildPeriod(anchorIso, grain) {
    if (grain === GRAIN_WEEK) {
        const key = weekKeyOf(anchorIso);
        const days = weekDays(key);
        return {
            grain: GRAIN_WEEK,
            key,
            days,
            startIso: days[0],
            endIso: days[days.length - 1],
            weekKeys: [key],
            title: weekTitle(days[0], days[days.length - 1]),
            shortTitle: `semaine du ${shortDate(days[0])}`,
        };
    }

    const key = monthKeyOf(anchorIso);
    const days = monthDays(key);
    const weekKeySet = [];
    for (const iso of days) {
        const wk = weekKeyOf(iso);
        if (wk && !weekKeySet.includes(wk)) weekKeySet.push(wk);
    }
    return {
        grain: GRAIN_MONTH,
        key,
        days,
        startIso: days[0],
        endIso: days[days.length - 1],
        weekKeys: weekKeySet,
        title: monthTitle(key),
        shortTitle: monthTitle(key),
    };
}

// Step the anchor by one period, keeping the day-of-month where possible so
// repeated clicks do not drift (31 January + 1 month lands in February, and the
// next click still lands in March).
export function shiftAnchor(anchorIso, grain, delta) {
    if (grain === GRAIN_WEEK) return addIsoDays(anchorIso, delta * 7);
    const d = parseIsoDate(anchorIso);
    if (!d) return anchorIso;
    const target = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d.getDate(), lastDay));
    return toIso(target);
}

// --- Labels ------------------------------------------------------------------------

// "lun. 7"
export function dayLabel(iso) {
    const d = parseIsoDate(iso);
    if (!d) return iso;
    return `${DAY_LABELS_SHORT_FR[mondayIndex(d)]} ${d.getDate()}`;
}

// "jeudi 10 septembre 2026"
export function longDate(iso) {
    const d = parseIsoDate(iso);
    if (!d) return iso;
    return new Intl.DateTimeFormat('fr-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(d);
}

// "10 sept. 2026"
export function shortDate(iso) {
    const d = parseIsoDate(iso);
    if (!d) return iso;
    return `${d.getDate()} ${MONTH_LABELS_SHORT_FR[d.getMonth()]} ${d.getFullYear()}`;
}

// "Septembre 2026"
export function monthTitle(monthKey) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? ''));
    if (!m) return String(monthKey ?? '');
    const label = MONTH_LABELS_FR[Number(m[2]) - 1];
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${m[1]}`;
}

// Collapse the month when the week sits inside one — "7 – 13 septembre 2026" —
// and span it when it does not — "28 sept. – 4 oct. 2026".
export function weekTitle(startIso, endIso) {
    const a = parseIsoDate(startIso);
    const b = parseIsoDate(endIso);
    if (!a || !b) return `${startIso} – ${endIso}`;
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
        return `${a.getDate()} – ${b.getDate()} ${MONTH_LABELS_FR[a.getMonth()]} ${a.getFullYear()}`;
    }
    if (a.getFullYear() === b.getFullYear()) {
        return `${a.getDate()} ${MONTH_LABELS_SHORT_FR[a.getMonth()]} – ` +
            `${b.getDate()} ${MONTH_LABELS_SHORT_FR[b.getMonth()]} ${b.getFullYear()}`;
    }
    return `${shortDate(startIso)} – ${shortDate(endIso)}`;
}
