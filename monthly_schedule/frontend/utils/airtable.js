// Cell readers. Nothing here is new logic: these are the readers already proven
// in sales-chart (getCellDateIso and friends) and schedule_grid (the duration
// and link readers), gathered in one place.

import {FieldType} from '@airtable/blocks/interface/models';
import {SECONDS_PER_DAY} from '../constants';

// --- Raw access --------------------------------------------------------------

export function safeCellValue(record, field) {
    if (!field || !record) return null;
    try {
        return record.getCellValue(field);
    } catch {
        return null;
    }
}

export function safeCellString(record, field) {
    if (!field || !record) return '';
    try {
        return record.getCellValueAsString(field);
    } catch {
        return '';
    }
}

// --- Text --------------------------------------------------------------------

// Flatten any cell value into plain strings. Covers the shapes getCellValue
// actually returns: a string; {name}; [{name}]; and MULTIPLE_LOOKUP_VALUES'
// [{linkedRecordId, value}] where `value` may itself be a string, an object or
// an array.
export function flattenCellStrings(value, depth = 0) {
    if (value === null || value === undefined || depth > 4) return [];
    if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
    if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
    if (Array.isArray(value)) return value.flatMap((v) => flattenCellStrings(v, depth + 1));
    if (typeof value === 'object') {
        if ('value' in value) return flattenCellStrings(value.value, depth + 1);
        if ('name' in value) return flattenCellStrings(value.name, depth + 1);
    }
    return [];
}

// Read a cell as a list of strings, falling back to the formatted string for
// exotic field types.
export function readTextValues(record, field) {
    if (!record || !field) return [];
    const values = flattenCellStrings(safeCellValue(record, field));
    if (values.length) return values;
    return safeCellString(record, field)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

// The single text value of a cell, or ''. Use for a name or a label.
export function readText(record, field) {
    const values = readTextValues(record, field);
    return values.length ? values[0] : '';
}

// --- Numbers -----------------------------------------------------------------

// A numeric cell as a plain number, or null. Rollups and lookups wrap their
// value — sometimes in an array, sometimes in {value} — so unwrap before
// coercing; Number(undefined) is NaN and Number(null) is 0, and the difference
// between "no hours" and "zero hours" matters on a payroll screen.
export function readNumber(record, field) {
    if (!field || !record) return null;
    let raw = safeCellValue(record, field);
    if (Array.isArray(raw)) raw = raw.find((v) => v !== null && v !== undefined);
    if (raw && typeof raw === 'object' && 'value' in raw) raw = raw.value;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isNaN(n) ? null : n;
}

// Sum of numbers, ignoring nulls. Returns null when nothing summed, so an
// absent value stays distinguishable from a real 0.
export function sumOrNull(values) {
    let total = 0;
    let seen = false;
    for (const v of values) {
        if (v === null || v === undefined || Number.isNaN(v)) continue;
        total += v;
        seen = true;
    }
    return seen ? total : null;
}

// --- Checkboxes ---------------------------------------------------------------

// An unchecked checkbox reads back as null and a lookup/rollup wraps its value
// in an array, so only an explicit true — bare or wrapped — counts as checked.
export function readCheckbox(record, field) {
    if (!field || !record) return false;
    const raw = safeCellValue(record, field);
    if (typeof raw === 'boolean') return raw;
    if (Array.isArray(raw) && raw.length > 0) {
        const first = raw[0]?.value !== undefined ? raw[0].value : raw[0];
        return first === true;
    }
    return false;
}

// --- Durations ----------------------------------------------------------------

// A Duration field stores seconds since midnight, and a rollup of durations
// returns seconds too.
export function readDurationSeconds(record, field) {
    return readNumber(record, field);
}

// A quantity of hours, whatever the field's type says it is.
//
// `repos_precedent` and the like are written by scripts and may be configured
// either as a Duration (seconds) or as a plain Number (hours). Guessing from
// the magnitude would be wrong — a week off is legitimately 150 hours — so ask
// the field instead. Getting this wrong is silent: a seconds value read as
// hours simply never crosses the 8-hour threshold, and the 8.02 warning would
// never fire.
export function readHours(record, field) {
    const n = readNumber(record, field);
    if (n === null) return null;
    return field?.config?.type === FieldType.DURATION ? n / 3600 : n;
}

// Zero-padded HH:MM. An overnight Out stored as 90000 s (25:00) comes back as
// "01:00"; saving it re-wraps it to 90000. Keep the modulo — it is what makes
// the editable time cell round-trip.
export function fmtHHMM(seconds) {
    if (seconds === null || seconds === undefined) return '';
    const totalMin = Math.round(seconds / 60) % (24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "17:00" -> 61200 seconds. Null when the string is not a valid HH:MM.
export function parseHHMM(str) {
    const m = /^(\d{1,2})\s*[:h]\s*(\d{2})$/.exec(String(str ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 3600 + min * 60;
}

// A block ending at or before it starts runs past midnight: 23:00 -> 01:00
// becomes 25:00 (90000 s).
export function endSecondsWithWrap(startSeconds, endSeconds) {
    return endSeconds <= startSeconds ? endSeconds + SECONDS_PER_DAY : endSeconds;
}

// --- Linked records ------------------------------------------------------------

// Linked record ids of a MULTIPLE_RECORD_LINKS cell: [{id, name}] -> ["recX"].
export function readLinkedIds(record, field) {
    if (!record || !field) return [];
    const raw = safeCellValue(record, field);
    return Array.isArray(raw) ? raw.map((link) => link?.id).filter(Boolean) : [];
}

// Normalize a MULTIPLE_RECORD_LINKS or MULTIPLE_LOOKUP_VALUES (of a link) cell
// into a flat [{id, name}] array. Used to name a contact when the Contacts
// table itself is not configured.
export function extractLinkedRecords(cellValue) {
    if (!Array.isArray(cellValue)) return [];
    const out = [];
    for (const item of cellValue) {
        if (!item) continue;
        if (item.id) {
            out.push({id: item.id, name: item.name});
            continue;
        }
        if (item.value) {
            if (Array.isArray(item.value)) {
                for (const v of item.value) {
                    if (v && v.id) out.push({id: v.id, name: v.name});
                }
            } else if (item.value.id) {
                out.push({id: item.value.id, name: item.value.name});
            }
        }
    }
    return out;
}

export function readLinked(record, field) {
    return extractLinkedRecords(safeCellValue(record, field));
}

// --- Dates ---------------------------------------------------------------------

// Resolve a date / date-time cell to the calendar date Airtable itself shows
// (YYYY-MM-DD). getCellValue returns a UTC instant, so slicing that string
// pushes an evening event to the next day in UTC-N timezones (a 20:00 EDT show
// call on Sept 10 is stored as 2026-09-11T00:00:00.000Z). Format the instant in
// the field's configured timezone instead, falling back to the browser's.
export function getCellDateIso(record, field) {
    if (!field || !record) return null;
    let raw = safeCellValue(record, field);
    if (Array.isArray(raw)) raw = raw.find((v) => v !== null && v !== undefined);
    if (raw && typeof raw === 'object' && raw.value != null) raw = raw.value;
    if (!raw) {
        // A formula or rollup may only expose its date as a formatted string.
        const asString = safeCellString(record, field);
        const m = /(\d{4})-(\d{2})-(\d{2})/.exec(asString);
        return m ? m[0] : null;
    }

    // Date-only field: the string is already the displayed calendar date.
    if (typeof raw === 'string' && !raw.includes('T')) {
        const m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
        return m ? m[0] : null;
    }

    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;

    let timeZone;
    try {
        // Formula / rollup / lookup fields nest their formatting under `result`.
        const opts = field.config?.options;
        const tz = opts?.timeZone || opts?.result?.options?.timeZone;
        if (tz && tz !== 'client') timeZone = tz;
    } catch {
        /* field config unavailable */
    }

    try {
        // en-CA formats as YYYY-MM-DD.
        return new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(d);
    } catch {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
}

// --- Select choices -------------------------------------------------------------

export function getFieldChoices(field, base) {
    if (!field) return null;
    try {
        const {type, options} = field.config;
        if (type === FieldType.SINGLE_SELECT || type === FieldType.MULTIPLE_SELECTS) {
            return options?.choices || null;
        }
        if (type === FieldType.MULTIPLE_LOOKUP_VALUES) {
            const direct = options?.result?.options?.choices;
            if (direct) return direct;
            // Walk to the linked table to find the source field's choices.
            if (base && options?.recordLinkFieldId && options?.fieldIdInLinkedTable) {
                for (const table of base.tables) {
                    const linkField = table.fields?.find((f) => f.id === options.recordLinkFieldId);
                    const linkedTableId = linkField?.config?.options?.linkedTableId;
                    if (!linkedTableId) continue;
                    const linkedTable = base.tables.find((t) => t.id === linkedTableId);
                    const sourceField = linkedTable?.fields?.find(
                        (f) => f.id === options.fieldIdInLinkedTable,
                    );
                    const choices = sourceField?.config?.options?.choices;
                    if (choices) return choices;
                }
            }
        }
    } catch {
        /* field config unavailable */
    }
    return null;
}

// {text, color} for a select-like cell, resolving the Airtable option colour
// even when the value arrives as a plain string through a lookup.
export function getColSelect(record, field, base) {
    if (!field || !record) return {text: '', color: null};
    const raw = safeCellValue(record, field);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.name) {
        return {text: raw.name, color: raw.color || null};
    }
    if (Array.isArray(raw) && raw.length > 0 && raw[0]?.name) {
        return {text: raw[0].name, color: raw[0].color || null};
    }
    const text = safeCellString(record, field);
    if (text) {
        const choices = getFieldChoices(field, base);
        const match = choices?.find((c) => c.name === text);
        if (match?.color) return {text, color: match.color};
    }
    return {text, color: null};
}

// --- Misc -------------------------------------------------------------------------

export function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// Airtable's option colour names → {bg, text}, for badges rendered with inline
// styles (Tailwind cannot express a colour chosen at runtime).
export const AIRTABLE_COLORS = {
    blueBright: {bg: '#2d7ff9', text: '#fff'},
    blueLight1: {bg: '#9cc7ff', text: '#333'},
    blueLight2: {bg: '#cfdfff', text: '#333'},
    cyanBright: {bg: '#18bfff', text: '#fff'},
    cyanLight1: {bg: '#77d1f3', text: '#333'},
    cyanLight2: {bg: '#d0f0fd', text: '#333'},
    tealBright: {bg: '#20d9d2', text: '#fff'},
    tealLight1: {bg: '#72ddc3', text: '#333'},
    tealLight2: {bg: '#c2f5e9', text: '#333'},
    greenBright: {bg: '#20c933', text: '#fff'},
    greenLight1: {bg: '#93e088', text: '#333'},
    greenLight2: {bg: '#d1f7c4', text: '#333'},
    yellowBright: {bg: '#fcb400', text: '#333'},
    yellowLight1: {bg: '#ffd66e', text: '#333'},
    yellowLight2: {bg: '#ffeab6', text: '#333'},
    orangeBright: {bg: '#ff6f2c', text: '#fff'},
    orangeLight1: {bg: '#ffaa57', text: '#333'},
    orangeLight2: {bg: '#fee2d5', text: '#333'},
    redBright: {bg: '#f82b60', text: '#fff'},
    redLight1: {bg: '#ff9eb7', text: '#333'},
    redLight2: {bg: '#ffdce5', text: '#333'},
    pinkBright: {bg: '#ff08c2', text: '#fff'},
    pinkLight1: {bg: '#f99de2', text: '#333'},
    pinkLight2: {bg: '#ffdaf6', text: '#333'},
    purpleBright: {bg: '#8b46ff', text: '#fff'},
    purpleLight1: {bg: '#cdb0ff', text: '#333'},
    purpleLight2: {bg: '#ede2fe', text: '#333'},
    grayBright: {bg: '#666666', text: '#fff'},
    gray: {bg: '#aaaaaa', text: '#fff'},
};

export const DEFAULT_BADGE_COLOR = {bg: '#e5e9f0', text: '#333'};

const FALLBACK_PALETTE = [
    'blueBright', 'greenBright', 'orangeBright', 'purpleBright', 'tealBright',
    'pinkBright', 'redBright', 'cyanBright', 'yellowBright', 'grayBright',
];

function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// A stable {bg, text} for a label: the field's own Airtable colour when there is
// one, otherwise a deterministic colour derived from the text so the same salle
// always reads the same.
export function badgeColor(colorName, text) {
    if (colorName && AIRTABLE_COLORS[colorName]) return AIRTABLE_COLORS[colorName];
    const label = String(text ?? '').trim();
    if (!label) return DEFAULT_BADGE_COLOR;
    return AIRTABLE_COLORS[FALLBACK_PALETTE[hashString(label) % FALLBACK_PALETTE.length]];
}
