// Display formatting. fr-CA throughout: it is the locale of the venue, and it
// gives "10 septembre 2026" with comma decimals and a narrow no-break space as
// the thousands separator.

const LOCALE = 'fr-CA';

// An absent value is an em dash, never "0" — on a payroll screen the difference
// between "no hours recorded" and "zero hours" is the whole point.
const EMPTY = '—';

function isEmpty(v) {
    return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

// 7.5 -> "7,5" (one decimal, always shown so a column of hours aligns).
export function fmtHours(v) {
    if (isEmpty(v)) return EMPTY;
    return Number(v).toLocaleString(LOCALE, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });
}

// Same, with the unit. Use in prose and headers, not in table cells.
export function fmtHoursUnit(v) {
    if (isEmpty(v)) return EMPTY;
    return `${fmtHours(v)} h`;
}

// A signed hours delta: "+2,5" / "−1,0" / "—" when zero or absent.
export function fmtDelta(v) {
    if (isEmpty(v) || v === 0) return EMPTY;
    const sign = v > 0 ? '+' : '−';
    return `${sign}${fmtHours(Math.abs(v))}`;
}

// 1234.5 -> "1 234,50 $"
export function fmtMoney(v) {
    if (isEmpty(v)) return EMPTY;
    return `${Number(v).toLocaleString(LOCALE, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} $`;
}

// Rounded money for totals bars and KPIs, where cents are noise.
export function fmtMoneyShort(v) {
    if (isEmpty(v)) return EMPTY;
    return `${Number(v).toLocaleString(LOCALE, {maximumFractionDigits: 0})} $`;
}

export function fmtNumber(v) {
    if (isEmpty(v)) return EMPTY;
    return Number(v).toLocaleString(LOCALE, {maximumFractionDigits: 0});
}

// 0.7 -> "70 %". Airtable percent fields already store a fraction.
export function fmtPercentFromFraction(v, digits = 0) {
    if (isEmpty(v)) return EMPTY;
    return `${(Number(v) * 100).toLocaleString(LOCALE, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    })} %`;
}

// A value that is already a percentage number (42 -> "42 %").
export function fmtPercent(v, digits = 0) {
    if (isEmpty(v)) return EMPTY;
    return `${Number(v).toLocaleString(LOCALE, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    })} %`;
}

// `pourcentage` and `quota_requis` on dispo_mois may be stored either as a
// fraction (0,7) or as a number of points (70) depending on how the field was
// set up — the display format in Airtable is still being corrected. Accept both
// rather than showing "1 %" for a 70 % quota.
export function asPercentPoints(v) {
    if (isEmpty(v)) return null;
    const n = Number(v);
    return n > 0 && n <= 1.5 ? n * 100 : n;
}

// "2026-09-10" -> a local-midnight Date. Never `new Date(iso)`, which parses a
// bare date as UTC and lands on the previous day west of Greenwich.
export function parseIsoDate(iso) {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function pluralize(n, singular, plural) {
    return n > 1 ? (plural ?? `${singular}s`) : singular;
}
