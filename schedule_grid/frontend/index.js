import {useMemo, useState} from 'react';
import {
    initializeBlock,
    useBase,
    useRecords,
    useCustomProperties,
    expandRecord,
} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import './style.css';

// === CONSTANTS ===

// Week starts on Sunday to match the existing TSD schedule layout.
const DAY_LABELS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// The "Événements" row is always rendered first; staff categories follow.
const EVENTS_ROW_KEY = '__events__';
const EVENTS_ROW_LABEL = 'Événements';

// Preferred ordering for staff category rows; unknown values fall through alphabetically.
const CATEGORY_PRIORITY_ORDER = ['Placiers', 'Placiers seniors', 'Merch'];

const MS_PER_DAY = 86400000;

// === HELPERS ===

// Parse any Airtable date/datetime/formula cell into a local-midnight Date. Returns null if unparseable.
function parseDate(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
        const d = new Date(value);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    const str = String(value);
    // ISO first (YYYY-MM-DD, optionally with time) — this is what getCellValue returns for date fields.
    const iso = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    // French display format (DD/MM/YYYY or DD-MM-YYYY), in case a string-typed field is used.
    const fr = str.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (fr) return new Date(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]));
    const fallback = new Date(str);
    if (isNaN(fallback.getTime())) return null;
    fallback.setHours(0, 0, 0, 0);
    return fallback;
}

// Convert a UTC datetime ISO string to local time while keeping the "Z" suffix, so the
// extracted calendar day matches what the user sees in Airtable. Date-only strings
// ("YYYY-MM-DD", no "T") and non-strings are returned untouched (no timezone to shift).
function toLocalIso(iso) {
    if (!iso || typeof iso !== 'string' || !iso.includes('T')) return iso;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
}

// Read a date cell as a local-midnight Date. getCellValue returns ISO (in UTC for
// date/time fields) regardless of the field's display format; toLocalIso shifts it back
// to the local calendar day before parsing. Falls back to the formatted string.
function readDate(record, field) {
    const raw = record.getCellValue(field);
    if (raw == null) return parseDate(record.getCellValueAsString(field));
    if (typeof raw === 'string') return parseDate(toLocalIso(raw));
    return parseDate(raw) ?? parseDate(record.getCellValueAsString(field));
}

// Sunday-anchored start of the week containing `date`, normalized to midnight.
function weekStart(date) {
    const x = new Date(date);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());
    return x;
}

function addDays(date, days) {
    const x = new Date(date);
    x.setDate(x.getDate() + days);
    return x;
}

// Format a Date as YYYY-MM-DD (local).
function fmtDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Whole-day offset between two midnight-normalized dates.
function dayDiff(from, to) {
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

// Extract the first HH:MM in a string and turn it into minutes, for intra-cell sorting.
function timeSortKey(str) {
    const m = str.match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 99999;
}

// Read a Duration field as a number of seconds (time-of-day since midnight). Null if empty.
function readDurationSeconds(record, field) {
    const v = record.getCellValue(field);
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return isNaN(n) ? null : n;
}

// Format a number of seconds as H:MM (e.g. 45000 -> "12:30").
function fmtDuration(seconds) {
    const totalMin = Math.round(seconds / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
}

function compareCategories(a, b) {
    const ai = CATEGORY_PRIORITY_ORDER.indexOf(a);
    const bi = CATEGORY_PRIORITY_ORDER.indexOf(b);
    const an = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bn = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (an !== bn) return an - bn;
    return a.localeCompare(b, 'fr');
}

// === COLORS ===

// Airtable single-select option color names → {bg, text}.
const AIRTABLE_COLORS = {
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

const DEFAULT_COLOR = {bg: '#ffffff', text: '#333'};

// Fallback palette for fields with no Airtable option colors (plain text / lookup):
// salle name → deterministic distinct color.
const PALETTE = [
    'blueBright', 'greenBright', 'orangeBright', 'purpleBright', 'tealBright',
    'pinkBright', 'redBright', 'cyanBright', 'yellowBright', 'grayBright',
];

function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// Resolve the single-select option colors of a SINGLE_SELECT field or a
// MULTIPLE_LOOKUP_VALUES field pointing at one (traversing record links).
function getFieldChoices(field, base) {
    if (!field) return null;
    try {
        const {type, options} = field.config;
        if (type === FieldType.SINGLE_SELECT || type === FieldType.MULTIPLE_SELECTS) {
            return options?.choices || null;
        }
        if (type === FieldType.MULTIPLE_LOOKUP_VALUES) {
            const direct = options?.result?.options?.choices;
            if (direct) return direct;
            if (base && options?.recordLinkFieldId && options?.fieldIdInLinkedTable) {
                for (const table of base.tables) {
                    const linkField = table.fields?.find((f) => f.id === options.recordLinkFieldId);
                    const linkedTableId = linkField?.config?.options?.linkedTableId;
                    if (!linkedTableId) continue;
                    const linkedTable = base.tables.find((t) => t.id === linkedTableId);
                    const sourceField = linkedTable?.fields?.find((f) => f.id === options.fieldIdInLinkedTable);
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

// Color for an event based on its "salle" field. Uses the field's own Airtable option
// color when available; otherwise derives a stable color from the salle name.
function getSalleColor(record, field, base) {
    if (!field) return DEFAULT_COLOR;
    const raw = record.getCellValue(field);

    // Direct single select: {name, color}
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.color) {
        return AIRTABLE_COLORS[raw.color] || DEFAULT_COLOR;
    }
    // Lookup / multi-select array: [{name, color}]
    if (Array.isArray(raw) && raw[0]?.color) {
        return AIRTABLE_COLORS[raw[0].color] || DEFAULT_COLOR;
    }

    const text = record.getCellValueAsString(field).trim();
    if (!text) return DEFAULT_COLOR;

    // Resolve via the field's choices (lookup without inline color object).
    const choices = getFieldChoices(field, base);
    const match = choices?.find((c) => c.name === text);
    if (match?.color) return AIRTABLE_COLORS[match.color] || DEFAULT_COLOR;

    // No Airtable color → deterministic palette by salle name.
    return AIRTABLE_COLORS[PALETTE[hashString(text) % PALETTE.length]];
}

// === CUSTOM PROPERTIES ===

function getCustomProperties(base) {
    const eventsTable =
        base.tables.find((t) => t.name.toLowerCase().includes('événement')) ||
        base.tables.find((t) => t.name.toLowerCase().includes('evenement')) ||
        base.tables[0];

    const staffTable =
        base.tables.find((t) => t.name.toLowerCase().includes('equipe_accueil')) ||
        base.tables.find((t) => t.name.toLowerCase().includes('accueil')) ||
        base.tables.find((t) => t.name.toLowerCase().includes('équipe')) ||
        base.tables[1] ||
        base.tables[0];

    const isTextLike = (field) =>
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.MULTILINE_TEXT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
        field.config.type === FieldType.ROLLUP;

    const isDateLike = (field) =>
        field.config.type === FieldType.DATE ||
        field.config.type === FieldType.DATE_TIME ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
        field.config.type === FieldType.SINGLE_LINE_TEXT;

    const isCategoryLike = (field) =>
        field.config.type === FieldType.SINGLE_SELECT ||
        field.config.type === FieldType.MULTIPLE_SELECTS ||
        field.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

    const isTimeLike = (field) =>
        field.config.type === FieldType.DATE_TIME ||
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.DURATION ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

    const byName = (table, predicate, ...needles) =>
        table.fields.find(
            (f) => predicate(f) && needles.some((n) => f.name.toLowerCase().includes(n)),
        );

    // Match a field whose name contains ALL of `needles` and NONE of `excludes`.
    const findAll = (table, predicate, needles, excludes = []) =>
        table.fields.find((f) => {
            const n = f.name.toLowerCase();
            return (
                predicate(f) &&
                needles.every((x) => n.includes(x)) &&
                !excludes.some((x) => n.includes(x))
            );
        });

    return [
        {
            key: 'eventsTable',
            label: 'Table Événements',
            type: 'table',
            defaultValue: eventsTable,
        },
        {
            key: 'staffTable',
            label: 'Table Équipe accueil (quarts)',
            type: 'table',
            defaultValue: staffTable,
        },
        {
            key: 'eventLabelField',
            label: 'Libellé événement (ex. identifiant_court)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                eventsTable.fields.find((f) => f.name.toLowerCase() === 'identifiant_court') ||
                byName(eventsTable, isTextLike, 'identifiant', 'titre', 'nom'),
        },
        {
            key: 'eventDateField',
            label: 'Date événement',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue:
                byName(eventsTable, isDateLike, 'événement', 'evenement') ||
                byName(eventsTable, isDateLike, 'date'),
        },
        {
            key: 'salleField',
            label: 'Salle (couleur des événements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(
                eventsTable, isCategoryLike, 'salle', 'lieu', 'venue', 'théâtre', 'theatre', 'room',
            ),
        },
        {
            key: 'contactField',
            label: 'Nom du contact (ex. nom_contact)',
            type: 'field',
            table: staffTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                staffTable.fields.find((f) => f.name.toLowerCase() === 'nom_contact') ||
                byName(staffTable, isTextLike, 'contact', 'nom', 'equipier', 'équipier'),
        },
        {
            key: 'categoryField',
            label: 'Catégorie (Placiers / seniors / Merch)',
            type: 'field',
            table: staffTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(staffTable, isCategoryLike, 'rôle', 'role', 'categor', 'catégor', 'type', 'poste'),
        },
        {
            key: 'staffDateField',
            label: 'Date du quart',
            type: 'field',
            table: staffTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue:
                byName(staffTable, isDateLike, 'date_courte') ||
                byName(staffTable, isDateLike, 'date'),
        },
        // Three work shifts (Montage / Show call / Démontage), each an In + Out duration.
        // The cell shows the smallest In to the largest Out across the filled shifts.
        {
            key: 'montageInField',
            label: 'Montage — In',
            type: 'field',
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue: findAll(staffTable, isTimeLike, ['montage', 'in'], ['démontage', 'demontage']),
        },
        {
            key: 'montageOutField',
            label: 'Montage — Out',
            type: 'field',
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue: findAll(staffTable, isTimeLike, ['montage', 'out'], ['démontage', 'demontage']),
        },
        {
            key: 'showcallInField',
            label: 'Show call — In',
            type: 'field',
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue:
                findAll(staffTable, isTimeLike, ['show call', 'in']) ||
                findAll(staffTable, isTimeLike, ['appel', 'in']),
        },
        {
            key: 'showcallOutField',
            label: 'Show call — Out',
            type: 'field',
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue:
                findAll(staffTable, isTimeLike, ['show call', 'out']) ||
                findAll(staffTable, isTimeLike, ['appel', 'out']),
        },
        {
            key: 'demontageInField',
            label: 'Démontage — In',
            type: 'field',
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue:
                findAll(staffTable, isTimeLike, ['démontage', 'in']) ||
                findAll(staffTable, isTimeLike, ['demontage', 'in']),
        },
        {
            key: 'demontageOutField',
            label: 'Démontage — Out',
            type: 'field',
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue:
                findAll(staffTable, isTimeLike, ['démontage', 'out']) ||
                findAll(staffTable, isTimeLike, ['demontage', 'out']),
        },
    ];
}

// === MAIN APP ===

function ScheduleGridApp() {
    const base = useBase();
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const eventsTable = customPropertyValueByKey.eventsTable;
    const staffTable = customPropertyValueByKey.staffTable;
    const eventLabelField = customPropertyValueByKey.eventLabelField;
    const eventDateField = customPropertyValueByKey.eventDateField;
    const salleField = customPropertyValueByKey.salleField;
    const contactField = customPropertyValueByKey.contactField;
    const categoryField = customPropertyValueByKey.categoryField;
    const staffDateField = customPropertyValueByKey.staffDateField;
    const montageInField = customPropertyValueByKey.montageInField;
    const showcallInField = customPropertyValueByKey.showcallInField;
    const demontageInField = customPropertyValueByKey.demontageInField;
    const montageOutField = customPropertyValueByKey.montageOutField;
    const showcallOutField = customPropertyValueByKey.showcallOutField;
    const demontageOutField = customPropertyValueByKey.demontageOutField;

    const inFields = useMemo(
        () => [montageInField, showcallInField, demontageInField].filter(Boolean),
        [montageInField, showcallInField, demontageInField],
    );
    const outFields = useMemo(
        () => [montageOutField, showcallOutField, demontageOutField].filter(Boolean),
        [montageOutField, showcallOutField, demontageOutField],
    );

    const eventRecords = useRecords(eventsTable);
    const staffRecords = useRecords(staffTable);

    const [selectedWeekMs, setSelectedWeekMs] = useState(null);
    const [numWeeks, setNumWeeks] = useState(1);

    const configured =
        eventsTable && staffTable && eventLabelField && eventDateField &&
        contactField && categoryField && staffDateField;

    // Distinct week starts present in the data, plus the current week, sorted ascending.
    const weeks = useMemo(() => {
        const set = new Set();
        if (configured) {
            for (const r of eventRecords) {
                const d = readDate(r, eventDateField);
                if (d) set.add(weekStart(d).getTime());
            }
            for (const r of staffRecords) {
                const d = readDate(r, staffDateField);
                if (d) set.add(weekStart(d).getTime());
            }
        }
        const today = new Date();
        set.add(weekStart(today).getTime());
        return Array.from(set).sort((a, b) => a - b);
    }, [configured, eventRecords, staffRecords, eventDateField, staffDateField]);

    // The selected week always wins (so ◀ ▶ can reach weeks with no data); otherwise default to
    // the week containing today, then the most recent week with data.
    const effectiveWeekMs = useMemo(() => {
        if (selectedWeekMs !== null) return selectedWeekMs;
        const todayWeek = weekStart(new Date()).getTime();
        if (weeks.includes(todayWeek)) return todayWeek;
        return weeks.length ? weeks[weeks.length - 1] : todayWeek;
    }, [selectedWeekMs, weeks]);

    // Dropdown options: weeks with data plus the currently shown week (so navigation stays visible).
    const weekOptions = useMemo(() => {
        const set = new Set(weeks);
        set.add(effectiveWeekMs);
        return Array.from(set).sort((a, b) => a - b);
    }, [weeks, effectiveWeekMs]);

    const goToWeek = (ms) => setSelectedWeekMs(ms);
    const shiftWeek = (deltaWeeks) =>
        setSelectedWeekMs(addDays(new Date(effectiveWeekMs), deltaWeeks * 7).getTime());

    const weekDays = useMemo(() => {
        const start = new Date(effectiveWeekMs);
        return Array.from({length: 7 * numWeeks}, (_, i) => addDays(start, i));
    }, [effectiveWeekMs, numWeeks]);

    // Build: rowKey -> dayIndex -> CellEntry[], the ordered category rows, and per-day totals.
    const {grid, categoryRows, dayTotals} = useMemo(() => {
        const map = new Map();
        const categories = new Set();
        const start = new Date(effectiveWeekMs);
        const numDays = 7 * numWeeks;
        // Per day: staff shift count, open (unassigned) shift count, total hours.
        const dayTotals = Array.from({length: numDays}, () => ({shifts: 0, open: 0, hours: 0}));

        const ensureRow = (key) => {
            if (!map.has(key)) map.set(key, Array.from({length: numDays}, () => []));
            return map.get(key);
        };

        if (configured) {
            // Événements row
            for (const r of eventRecords) {
                const date = readDate(r, eventDateField);
                if (!date) continue;
                const idx = dayDiff(start, date);
                if (idx < 0 || idx >= numDays) continue;
                const text = r.getCellValueAsString(eventLabelField).trim();
                if (!text) continue;
                ensureRow(EVENTS_ROW_KEY)[idx].push({
                    text,
                    sortKey: timeSortKey(text),
                    highlight: false,
                    color: salleField ? getSalleColor(r, salleField, base) : null,
                    record: r,
                });
                dayTotals[idx].events++;
            }

            // Staff category rows
            for (const r of staffRecords) {
                const date = readDate(r, staffDateField);
                if (!date) continue;
                const idx = dayDiff(start, date);
                if (idx < 0 || idx >= numDays) continue;

                const category = r.getCellValueAsString(categoryField).trim() || 'Autres';
                categories.add(category);

                const contact = r.getCellValueAsString(contactField).trim();

                // Smallest In to largest Out across the filled Montage/Show call/Démontage shifts.
                const ins = inFields
                    .map((f) => readDurationSeconds(r, f))
                    .filter((v) => v !== null);
                const outs = outFields
                    .map((f) => readDurationSeconds(r, f))
                    .filter((v) => v !== null);
                const minIn = ins.length ? Math.min(...ins) : null;
                const maxOut = outs.length ? Math.max(...outs) : null;

                let range = '';
                if (minIn !== null && maxOut !== null) range = `${fmtDuration(minIn)} - ${fmtDuration(maxOut)}`;
                else if (minIn !== null) range = fmtDuration(minIn);

                let text;
                if (contact && range) text = `${contact} : ${range}`;
                else if (contact) text = contact;
                else text = range; // unassigned shift: time only (highlighted yellow)

                ensureRow(category)[idx].push({
                    text,
                    sortKey: minIn !== null ? minIn : timeSortKey(text),
                    highlight: !contact, // yellow when no contact assigned
                    record: r,
                });

                dayTotals[idx].shifts++;
                if (!contact) dayTotals[idx].open++;
                if (minIn !== null && maxOut !== null) dayTotals[idx].hours += (maxOut - minIn) / 3600;
            }
        }

        for (const cells of map.values()) {
            for (const day of cells) day.sort((a, b) => a.sortKey - b.sortKey);
        }

        return {
            grid: map,
            categoryRows: Array.from(categories).sort(compareCategories),
            dayTotals,
        };
    }, [
        configured, effectiveWeekMs, numWeeks, eventRecords, staffRecords,
        eventDateField, eventLabelField, staffDateField, categoryField,
        contactField, inFields, outFields, salleField, base,
    ]);

    if (errorState) {
        return (
            <div className="p-4 text-sm text-red-red">
                {errorState.error?.message ?? 'Erreur de configuration'}
            </div>
        );
    }

    if (!configured) {
        return (
            <div className="p-4 text-sm text-gray-gray700 dark:text-gray-gray300">
                Configurez les tables et champs de l’extension (Événements, Équipe accueil, dates,
                contact, catégorie) dans le panneau de réglages.
            </div>
        );
    }

    const weekEnd = addDays(new Date(effectiveWeekMs), 7 * numWeeks - 1);
    const rowKeys = [EVENTS_ROW_KEY, ...categoryRows];
    const rowLabel = (key) =>
        key === EVENTS_ROW_KEY ? EVENTS_ROW_LABEL : key;
    const canExpand = (table) => table && table.hasPermissionToExpandRecords();

    return (
        <div className="p-4 text-gray-gray900 dark:text-gray-gray100" style={{zoom: 1.25}}>
            <div className="mb-3 flex items-center gap-2">
                <label className="text-sm text-gray-gray700 dark:text-gray-gray300">
                    Semaine à afficher :
                </label>
                <button
                    type="button"
                    onClick={() => shiftWeek(-1)}
                    aria-label="Semaine précédente"
                    className="inline-flex items-center justify-center rounded border border-gray-gray300 bg-white p-1.5 text-gray-gray700 hover:bg-gray-gray50 dark:border-gray-gray600 dark:bg-gray-gray800 dark:text-gray-gray200 dark:hover:bg-gray-gray700"
                >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>
                <select
                    className="rounded border border-gray-gray300 bg-white px-2 py-1 text-sm dark:border-gray-gray600 dark:bg-gray-gray800"
                    value={effectiveWeekMs}
                    onChange={(e) => goToWeek(Number(e.target.value))}
                >
                    {weekOptions.map((ms) => {
                        const s = new Date(ms);
                        return (
                            <option key={ms} value={ms}>
                                {fmtDate(s)} au {fmtDate(addDays(s, 6))}
                            </option>
                        );
                    })}
                </select>
                <button
                    type="button"
                    onClick={() => shiftWeek(1)}
                    aria-label="Semaine suivante"
                    className="inline-flex items-center justify-center rounded border border-gray-gray300 bg-white p-1.5 text-gray-gray700 hover:bg-gray-gray50 dark:border-gray-gray600 dark:bg-gray-gray800 dark:text-gray-gray200 dark:hover:bg-gray-gray700"
                >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18l6-6-6-6" />
                    </svg>
                </button>
                <button
                    type="button"
                    onClick={() => goToWeek(weekStart(new Date()).getTime())}
                    className="rounded border border-gray-gray300 bg-white px-2 py-1 text-sm dark:border-gray-gray600 dark:bg-gray-gray800 dark:text-gray-gray100"
                >
                    Aujourd’hui
                </button>
                <div className="ml-2 flex items-center gap-1">
                    {[1, 2].map((n) => (
                        <button
                            key={n}
                            type="button"
                            onClick={() => setNumWeeks(n)}
                            className={
                                'rounded border px-2 py-1 text-sm ' +
                                (numWeeks === n
                                    ? 'border-blue-blue bg-blue-blue text-white'
                                    : 'border-gray-gray300 bg-white text-gray-gray900 dark:border-gray-gray600 dark:bg-gray-gray800 dark:text-gray-gray100')
                            }
                        >
                            {n} semaine{n > 1 ? 's' : ''}
                        </button>
                    ))}
                </div>
            </div>

            <h1 className="mb-3 text-center font-display text-base font-semibold">
                Horaire du {fmtDate(new Date(effectiveWeekMs))} au {fmtDate(weekEnd)}
            </h1>

            <div className="overflow-x-auto">
                <table
                    className="w-full table-fixed border-collapse text-xs"
                    style={numWeeks > 1 ? {minWidth: `${112 + weekDays.length * 96}px`} : undefined}
                >
                    <thead>
                        <tr>
                            <th className="w-28 border border-gray-gray200 bg-gray-gray50 p-2 dark:border-gray-gray700 dark:bg-gray-gray800" />
                            {weekDays.map((d, i) => (
                                <th
                                    key={i}
                                    className="border border-gray-gray200 bg-gray-gray50 p-2 text-center font-semibold dark:border-gray-gray700 dark:bg-gray-gray800"
                                >
                                    <div>{DAY_LABELS_FR[i % 7]}</div>
                                    <div className="font-normal text-gray-gray600 dark:text-gray-gray400">
                                        {fmtDate(d)}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rowKeys.map((key) => {
                            const cells = grid.get(key) ?? Array.from({length: weekDays.length}, () => []);
                            const table = key === EVENTS_ROW_KEY ? eventsTable : staffTable;
                            return (
                                <tr key={key}>
                                    <th className="border border-gray-gray200 bg-gray-gray50 p-2 text-center align-middle font-semibold dark:border-gray-gray700 dark:bg-gray-gray800">
                                        {rowLabel(key)}
                                    </th>
                                    {cells.map((entries, i) => (
                                        <td
                                            key={i}
                                            className="border border-gray-gray200 p-1 align-top dark:border-gray-gray700"
                                        >
                                            <div className="flex flex-col gap-1">
                                                {entries.map((entry, j) => (
                                                    <div
                                                        key={j}
                                                        onClick={() =>
                                                            canExpand(table) && expandRecord(entry.record)
                                                        }
                                                        className={
                                                            'rounded border px-1.5 py-1 leading-tight ' +
                                                            (canExpand(table) ? 'cursor-pointer ' : '') +
                                                            (entry.color
                                                                ? 'border-transparent '
                                                                : entry.highlight
                                                                    ? 'border-yellow-yellow bg-yellow-yellowLight1 text-gray-gray900 min-h-[1.5rem] '
                                                                    : 'border-gray-gray200 bg-white dark:border-gray-gray600 dark:bg-gray-gray800')
                                                        }
                                                        style={
                                                            entry.color
                                                                ? {backgroundColor: entry.color.bg, color: entry.color.text}
                                                                : undefined
                                                        }
                                                    >
                                                        {entry.text}
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr>
                            <th className="border border-gray-gray200 bg-gray-gray50 p-2 text-center align-middle font-semibold dark:border-gray-gray700 dark:bg-gray-gray800">
                                Totaux
                            </th>
                            {dayTotals.map((t, i) => (
                                <td
                                    key={i}
                                    className="border border-gray-gray200 bg-gray-gray50 p-2 text-center align-top text-[11px] dark:border-gray-gray700 dark:bg-gray-gray800"
                                >
                                    {t.shifts === 0 ? (
                                        <span className="text-gray-gray400">—</span>
                                    ) : (
                                        <div className="flex flex-col leading-tight">
                                            <span className="font-semibold">
                                                {t.shifts} quart{t.shifts > 1 ? 's' : ''}
                                            </span>
                                            <span className="text-gray-gray600 dark:text-gray-gray400">
                                                {(Math.round(t.hours * 10) / 10).toLocaleString('fr-FR')} h
                                            </span>
                                            {t.open > 0 && (
                                                <span className="font-medium text-orange-orange">
                                                    {t.open} ouvert{t.open > 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}

initializeBlock({interface: () => <ScheduleGridApp />});
