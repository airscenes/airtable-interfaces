import {useMemo, useState} from 'react';
import {
    initializeBlock,
    useRecords,
    useCustomProperties,
} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import './style.css';

// === CONSTANTS ===

const MS_PER_DAY = 86400000;

// Blocks open on the Monday nearest the 1st of their opening month, and the fiscal year runs
// April → March, so block 5 spills into the next calendar year. Deriving the boundaries from
// this rule rather than hardcoding dates means no yearly maintenance.
const BLOC_OPENING_MONTHS = [4, 6, 9, 11, 1];
const FISCAL_YEAR_OPENING_MONTH = 4;

const CONTENT_TABLE_NEEDLE = 'contenu';

// Row dimensions. The ceiling only colours the grid on markets: that is where pressure is capped.
const DIMENSIONS = [
    {key: 'market', label: 'Marché', propertyKey: 'marketField'},
    {key: 'campaign', label: 'Campagne', propertyKey: 'campaignField'},
    {key: 'adset', label: 'Ensemble de publicités', propertyKey: 'adsetField'},
];

const UNASSIGNED_LABEL = '(non assigné)';

// A busy cell can hold dozens of ads; past this the tooltip stops being readable and reports a
// remainder instead.
const TOOLTIP_MAX_ITEMS = 12;
const ALL_BLOCS = 'all';
const ALL_VALUES = '';

// === DATE HELPERS ===

// Parse any Airtable date/datetime/formula cell into a local-midnight Date. Null if unparseable.
function parseDate(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
        const d = new Date(value);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    const str = String(value);
    const iso = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const fallback = new Date(str);
    if (isNaN(fallback.getTime())) return null;
    fallback.setHours(0, 0, 0, 0);
    return fallback;
}

// Convert a UTC datetime ISO string to local time while keeping the "Z" suffix, so the extracted
// calendar day matches what the user sees in Airtable. Date-only strings have no time to shift.
function toLocalIso(iso) {
    if (!iso || typeof iso !== 'string' || !iso.includes('T')) return iso;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
}

// Read a date cell as a local-midnight Date. getCellValue returns ISO (UTC for date/time fields)
// regardless of the display format; toLocalIso shifts it back to the local calendar day first —
// without it, a flight lands in the wrong week column in a UTC-N timezone.
function readDate(record, field) {
    if (!field) return null;
    const raw = record.getCellValue(field);
    if (raw == null) return parseDate(record.getCellValueAsString(field));
    if (typeof raw === 'string') return parseDate(toLocalIso(raw));
    return parseDate(raw) ?? parseDate(record.getCellValueAsString(field));
}

function addDays(date, days) {
    const x = new Date(date);
    x.setDate(x.getDate() + days);
    return x;
}

// Monday-anchored start of the week containing `date`. Blocks are Monday-aligned, so the columns
// must be too — otherwise a block boundary would fall inside a column instead of between two.
function weekStart(date) {
    const x = new Date(date);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
}

// Monday nearest the given date: backwards from Mon–Thu, forwards from Fri–Sun.
function nearestMonday(date) {
    const day = (date.getDay() + 6) % 7; // 0 = Monday
    return addDays(date, day <= 3 ? -day : 7 - day);
}

function dayDiff(from, to) {
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

// Index of the column holding `date`. Negative when the date sits before the window, which the
// caller clamps — a flight starting earlier still occupies the first visible weeks.
function weekIndexOf(periodStart, date) {
    return Math.floor(dayDiff(periodStart, date) / 7);
}

function fmtDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function fmtShort(date) {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${d}/${m}`;
}

// The five blocks of one fiscal year, contiguous from the first Monday to the last Sunday.
function blocsForFiscalYear(startYear) {
    const opens = BLOC_OPENING_MONTHS.map((month) =>
        nearestMonday(
            new Date(month >= FISCAL_YEAR_OPENING_MONTH ? startYear : startYear + 1, month - 1, 1),
        ),
    );
    const nextYearOpen = nearestMonday(
        new Date(startYear + 1, FISCAL_YEAR_OPENING_MONTH - 1, 1),
    );

    return opens.map((start, i) => ({
        name: `Bloc ${i + 1}`,
        start,
        end: addDays(i + 1 < opens.length ? opens[i + 1] : nextYearOpen, -1),
    }));
}

// Fiscal year containing `date`. Derived from the Monday-aligned opening, not from the month, so
// a date in the last days of March can already belong to the year that starts that week.
function fiscalYearOf(date) {
    const year = date.getFullYear();
    const opening = nearestMonday(new Date(year, FISCAL_YEAR_OPENING_MONTH - 1, 1));
    return date >= opening ? year : year - 1;
}

function fiscalYearLabel(startYear) {
    return `${startYear}-${startYear + 1}`;
}

// === CELL HELPERS ===

// Flatten any cell value into plain strings, covering the shapes getCellValue returns for
// select / link / lookup / rollup fields.
function flattenCellStrings(value, depth = 0) {
    if (value === null || value === undefined || depth > 3) return [];
    if (typeof value === 'string') return [value];
    if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
    if (Array.isArray(value)) return value.flatMap((v) => flattenCellStrings(v, depth + 1));
    if (typeof value === 'object') {
        if (typeof value.name === 'string') return [value.name];
        if ('value' in value) return flattenCellStrings(value.value, depth + 1);
    }
    return [];
}

function readTextValues(record, field) {
    if (!field) return [];
    const values = flattenCellStrings(record.getCellValue(field));
    if (values.length) return values;
    const str = record.getCellValueAsString(field);
    return str ? [str] : [];
}

// === CUSTOM PROPERTIES ===

function getCustomProperties(base) {
    const contentTable =
        base.tables.find((t) => t.name.toLowerCase().includes(CONTENT_TABLE_NEEDLE)) ||
        base.tables[0];

    const isDateLike = (field) =>
        field.config.type === FieldType.DATE ||
        field.config.type === FieldType.DATE_TIME ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

    const isCategoryLike = (field) =>
        field.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
        field.config.type === FieldType.SINGLE_SELECT ||
        field.config.type === FieldType.MULTIPLE_SELECTS ||
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

    const byName = (table, predicate, ...needles) =>
        table.fields.find(
            (f) => predicate(f) && needles.some((n) => f.name.toLowerCase().includes(n)),
        );

    return [
        {
            key: 'contentTable',
            label: 'Table Contenus',
            type: 'table',
            defaultValue: contentTable,
        },
        {
            key: 'startField',
            label: 'Date de début de diffusion',
            type: 'field',
            table: contentTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue: byName(contentTable, isDateLike, 'date de début', 'date de debut'),
        },
        {
            key: 'endField',
            label: 'Date de fin de diffusion',
            type: 'field',
            table: contentTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue: byName(contentTable, isDateLike, 'date de fin'),
        },
        // Organic content carries no flight, only a publication date. Without this fallback the
        // grid would silently drop it — roughly half the table.
        {
            key: 'fallbackDateField',
            label: 'Date de repli (si aucune date de début)',
            type: 'field',
            table: contentTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue: byName(contentTable, isDateLike, 'date de publication'),
        },
        {
            key: 'marketField',
            label: 'Marché',
            type: 'field',
            table: contentTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(contentTable, isCategoryLike, 'marché', 'marche'),
        },
        {
            key: 'campaignField',
            label: 'Campagne',
            type: 'field',
            table: contentTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(contentTable, isCategoryLike, 'campagnes_meta', 'campagne'),
        },
        {
            key: 'adsetField',
            label: 'Ensemble de publicités',
            type: 'field',
            table: contentTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(contentTable, isCategoryLike, 'ensemble de publicités', 'adset'),
        },
        {
            key: 'filterField',
            label: 'Champ de filtre (ex. Paid / Organique)',
            type: 'field',
            table: contentTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(contentTable, isCategoryLike, 'paid'),
        },
        // Names the ads listed when a cell is hovered. Falls back to the primary field, which is
        // only readable when it is exposed to the extension.
        {
            key: 'labelField',
            label: 'Titre affiché au survol d’une case',
            type: 'field',
            table: contentTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(contentTable, isCategoryLike, 'titre du contenu', 'identifiant'),
        },
        // Left empty on purpose until the client sets its ceiling: an invented number would look
        // authoritative on screen.
        {
            key: 'threshold',
            label: 'Plafond de messages par marché (laisser vide si non défini)',
            type: 'string',
            defaultValue: '',
        },
    ];
}

// === MAIN APP ===

function AdPressureApp() {
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const contentTable = customPropertyValueByKey.contentTable;
    const startField = customPropertyValueByKey.startField;
    const endField = customPropertyValueByKey.endField;
    const fallbackDateField = customPropertyValueByKey.fallbackDateField;
    const filterField = customPropertyValueByKey.filterField;
    const labelField = customPropertyValueByKey.labelField;
    const thresholdRaw = customPropertyValueByKey.threshold;

    const contentRecords = useRecords(contentTable);

    const [dimensionKey, setDimensionKey] = useState(DIMENSIONS[0].key);
    const [yearOverride, setYearOverride] = useState(null);
    const [blocKey, setBlocKey] = useState(ALL_BLOCS);
    const [filterValue, setFilterValue] = useState(ALL_VALUES);
    const [hideEmpty, setHideEmpty] = useState(false);
    const [hover, setHover] = useState(null);

    const dimension = DIMENSIONS.find((d) => d.key === dimensionKey) ?? DIMENSIONS[0];
    const dimensionField = customPropertyValueByKey[dimension.propertyKey];

    const configured = Boolean(contentTable && startField);

    const threshold = useMemo(() => {
        const n = Number(thresholdRaw);
        return Number.isFinite(n) && n > 0 ? n : null;
    }, [thresholdRaw]);

    // One pass over the records, independent of the selected dimension: resolve each flight to a
    // start and an end, and set aside what cannot be placed on a timeline.
    const {items, skippedNoDate, skippedInverted} = useMemo(() => {
        if (!configured) return {items: [], skippedNoDate: 0, skippedInverted: 0};

        const out = [];
        let noDate = 0;
        let inverted = 0;

        for (const record of contentRecords) {
            const start = readDate(record, startField) ?? readDate(record, fallbackDateField);
            if (!start) {
                noDate++;
                continue;
            }

            const end = readDate(record, endField) ?? start;
            // An end before its start is a data-entry error. Counting it would either inflate or
            // hide pressure, so it is set aside and reported under the grid instead.
            if (end < start) {
                inverted++;
                continue;
            }

            // record.name is the primary field, which an interface extension can only read when
            // that field is exposed — hence the configurable label field and the final fallback.
            const label =
                (labelField ? readTextValues(record, labelField)[0] : null) ||
                record.name ||
                '(sans titre)';

            out.push({record, start, end, label});
        }

        return {items: out, skippedNoDate: noDate, skippedInverted: inverted};
    }, [configured, contentRecords, startField, endField, fallbackDateField, labelField]);

    // Offered years come from the data, so the selector never lands on an empty grid.
    const fiscalYears = useMemo(() => {
        const years = new Set();
        for (const {start, end} of items) {
            years.add(fiscalYearOf(start));
            years.add(fiscalYearOf(end));
        }
        return [...years].sort((a, b) => a - b);
    }, [items]);

    const activeYear = useMemo(() => {
        if (yearOverride !== null) return yearOverride;
        const current = fiscalYearOf(new Date());
        if (fiscalYears.includes(current)) return current;
        return fiscalYears.length ? fiscalYears[fiscalYears.length - 1] : current;
    }, [yearOverride, fiscalYears]);

    const blocs = useMemo(() => blocsForFiscalYear(activeYear), [activeYear]);

    const {periodStart, numWeeks} = useMemo(() => {
        const selected = blocKey === ALL_BLOCS ? null : blocs.find((b) => b.name === blocKey);
        const from = weekStart(selected ? selected.start : blocs[0].start);
        const to = selected ? selected.end : blocs[blocs.length - 1].end;
        const weeks = Math.floor(dayDiff(from, weekStart(to)) / 7) + 1;
        return {periodStart: from, numWeeks: Math.max(1, weeks)};
    }, [blocs, blocKey]);

    const weeks = useMemo(
        () => Array.from({length: numWeeks}, (_, i) => addDays(periodStart, i * 7)),
        [periodStart, numWeeks],
    );

    // Block band above the week headers: consecutive weeks of the same block merge into one cell,
    // so the year reads as five stretches instead of fifty-two anonymous columns.
    const blocHeader = useMemo(() => {
        const out = [];
        for (const monday of weeks) {
            const bloc = blocs.find((b) => monday >= b.start && monday <= b.end);
            const label = bloc ? bloc.name : '—';
            const last = out[out.length - 1];
            if (last && last.label === label) last.span += 1;
            else out.push({label, span: 1});
        }
        return out;
    }, [weeks, blocs]);

    const filterOptions = useMemo(() => {
        if (!filterField) return [];
        const values = new Set();
        for (const {record} of items) {
            for (const v of readTextValues(record, filterField)) values.add(v);
        }
        return [...values].sort((a, b) => a.localeCompare(b, 'fr'));
    }, [items, filterField]);

    const rows = useMemo(() => {
        const byLabel = new Map();
        const lastIndex = numWeeks - 1;

        for (const item of items) {
            const {record, start, end} = item;
            if (filterValue && !readTextValues(record, filterField).includes(filterValue)) continue;

            const from = Math.max(0, weekIndexOf(periodStart, start));
            const to = Math.min(lastIndex, weekIndexOf(periodStart, end));
            if (to < 0 || from > lastIndex) continue;

            const labels = readTextValues(record, dimensionField);
            const keys = labels.length ? labels : [UNASSIGNED_LABEL];

            for (const key of keys) {
                let cells = byLabel.get(key);
                if (!cells) {
                    cells = Array.from({length: numWeeks}, () => []);
                    byLabel.set(key, cells);
                }
                // A flight occupies every week it overlaps, not only the one it starts in. This
                // loop is the whole point of the extension: it is what a date bucket cannot do.
                // Cells hold the ads themselves so a hovered count can be broken down.
                for (let i = from; i <= to; i++) cells[i].push(item);
            }
        }

        const all = [...byLabel.entries()]
            .map(([label, cells]) => ({
                label,
                cells,
                peak: cells.reduce((max, c) => (c.length > max ? c.length : max), 0),
            }))
            .sort((a, b) => b.peak - a.peak || a.label.localeCompare(b.label, 'fr'));

        return hideEmpty ? all.filter((r) => r.peak > 0) : all;
    }, [
        items, dimensionField, filterField, filterValue,
        periodStart, numWeeks, hideEmpty,
    ]);

    const weekTotals = useMemo(() => {
        const totals = new Array(numWeeks).fill(0);
        for (const row of rows) row.cells.forEach((c, i) => (totals[i] += c.length));
        return totals;
    }, [rows, numWeeks]);

    const showCeiling = threshold !== null && dimension.key === 'market';

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
                Configurez la table Contenus et la date de début de diffusion dans le panneau de
                réglages de l’extension.
            </div>
        );
    }

    const periodEnd = addDays(weeks[weeks.length - 1], 6);
    const skippedTotal = skippedNoDate + skippedInverted;

    return (
        <div className="p-3 text-xs text-gray-gray900 dark:text-gray-gray100">
            <h1 className="mb-1 font-display text-lg font-semibold">
                Pression publicitaire — {fiscalYearLabel(activeYear)}
            </h1>
            {/* Naming the source field is what tells a reader the rows are the ones they expect:
                a mispointed property otherwise renders a plausible but wrong dimension. */}
            <p className="mb-3 text-gray-gray600 dark:text-gray-gray400">
                Nombre de publicités actives par semaine, du {fmtDate(periodStart)} au{' '}
                {fmtDate(periodEnd)}. {rows.length} ligne{rows.length > 1 ? 's' : ''} issue
                {rows.length > 1 ? 's' : ''} du champ{' '}
                {dimensionField ? (
                    <span className="font-semibold">{dimensionField.name}</span>
                ) : (
                    <span className="font-semibold text-orange-orange">non configuré</span>
                )}
                .
            </p>

            {!dimensionField && (
                <p className="mb-3 rounded border border-orange-orangeLight1 bg-orange-orangeLight3 p-2 text-orange-orangeDark1">
                    Aucun champ n’est associé à « {dimension.label} » dans les réglages de
                    l’extension : toutes les lignes se retrouvent sous « {UNASSIGNED_LABEL} ».
                    Vérifiez aussi que le champ est exposé à l’extension dans l’interface.
                </p>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2">
                <select
                    value={dimensionKey}
                    onChange={(e) => setDimensionKey(e.target.value)}
                    className="cursor-pointer rounded border border-gray-gray300 px-2 py-1 dark:border-gray-gray600 dark:bg-gray-gray800"
                >
                    {DIMENSIONS.map((d) => (
                        <option key={d.key} value={d.key}>
                            Par {d.label.toLowerCase()}
                        </option>
                    ))}
                </select>

                <select
                    value={activeYear}
                    onChange={(e) => setYearOverride(Number(e.target.value))}
                    className="cursor-pointer rounded border border-gray-gray300 px-2 py-1 dark:border-gray-gray600 dark:bg-gray-gray800"
                >
                    {(fiscalYears.length ? fiscalYears : [activeYear]).map((y) => (
                        <option key={y} value={y}>
                            {fiscalYearLabel(y)}
                        </option>
                    ))}
                </select>

                <select
                    value={blocKey}
                    onChange={(e) => setBlocKey(e.target.value)}
                    className="cursor-pointer rounded border border-gray-gray300 px-2 py-1 dark:border-gray-gray600 dark:bg-gray-gray800"
                >
                    <option value={ALL_BLOCS}>Toute l’année</option>
                    {blocs.map((b) => (
                        <option key={b.name} value={b.name}>
                            {b.name}
                        </option>
                    ))}
                </select>

                {filterField && filterOptions.length > 0 && (
                    <select
                        value={filterValue}
                        onChange={(e) => setFilterValue(e.target.value)}
                        className="cursor-pointer rounded border border-gray-gray300 px-2 py-1 dark:border-gray-gray600 dark:bg-gray-gray800"
                    >
                        <option value={ALL_VALUES}>Tous les contenus</option>
                        {filterOptions.map((v) => (
                            <option key={v} value={v}>
                                {v}
                            </option>
                        ))}
                    </select>
                )}

                <label className="flex cursor-pointer items-center gap-1">
                    <input
                        type="checkbox"
                        checked={hideEmpty}
                        onChange={(e) => setHideEmpty(e.target.checked)}
                        className="cursor-pointer"
                    />
                    Masquer les lignes vides
                </label>
            </div>

            <div className="overflow-x-auto">
                <table
                    className="w-full table-fixed border-collapse text-xs"
                    style={{minWidth: `${200 + numWeeks * 46}px`}}
                >
                    <thead>
                        <tr>
                            <th className="sticky left-0 z-10 w-48 border border-gray-gray200 bg-gray-gray50 p-2 text-left dark:border-gray-gray700 dark:bg-gray-gray800">
                                {dimension.label}
                            </th>
                            {blocHeader.map((b, i) => (
                                <th
                                    key={`${b.label}-${i}`}
                                    colSpan={b.span}
                                    className="border border-gray-gray200 bg-gray-gray75 p-1 text-center font-semibold dark:border-gray-gray700 dark:bg-gray-gray700"
                                >
                                    {b.label}
                                </th>
                            ))}
                        </tr>
                        <tr>
                            <th className="sticky left-0 z-10 border border-gray-gray200 bg-gray-gray50 p-2 text-left font-normal text-gray-gray600 dark:border-gray-gray700 dark:bg-gray-gray800 dark:text-gray-gray400">
                                Semaine du
                            </th>
                            {weeks.map((w) => (
                                <th
                                    key={fmtDate(w)}
                                    className="border border-gray-gray200 bg-gray-gray50 p-1 text-center font-normal text-gray-gray600 dark:border-gray-gray700 dark:bg-gray-gray800 dark:text-gray-gray400"
                                >
                                    {fmtShort(w)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.label}>
                                <th className="sticky left-0 z-10 border border-gray-gray200 bg-gray-gray50 p-2 text-left font-semibold dark:border-gray-gray700 dark:bg-gray-gray800">
                                    {row.label}
                                </th>
                                {row.cells.map((cell, i) => {
                                    const count = cell.length;
                                    return (
                                        <td
                                            key={i}
                                            onMouseEnter={(e) =>
                                                count > 0 &&
                                                setHover({
                                                    rowLabel: row.label,
                                                    week: weeks[i],
                                                    items: cell,
                                                    rect: e.currentTarget.getBoundingClientRect(),
                                                })
                                            }
                                            onMouseLeave={() => setHover(null)}
                                            className={
                                                'border border-gray-gray200 p-1 text-center dark:border-gray-gray700 ' +
                                                (count === 0
                                                    ? 'text-gray-gray300 dark:text-gray-gray600'
                                                    : 'cursor-help ' +
                                                      (showCeiling && count > threshold
                                                          ? 'bg-red-redLight2 font-semibold text-red-redDark1'
                                                          : 'bg-blue-blueLight3 dark:bg-gray-gray700'))
                                            }
                                        >
                                            {count === 0 ? '·' : count}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td
                                    colSpan={numWeeks + 1}
                                    className="border border-gray-gray200 p-4 text-center text-gray-gray600 dark:border-gray-gray700 dark:text-gray-gray400"
                                >
                                    Aucune publicité active sur cette période.
                                </td>
                            </tr>
                        )}
                    </tbody>
                    <tfoot>
                        <tr>
                            <th className="sticky left-0 z-10 border border-gray-gray200 bg-gray-gray50 p-2 text-left font-semibold dark:border-gray-gray700 dark:bg-gray-gray800">
                                Total
                            </th>
                            {weekTotals.map((count, i) => (
                                <td
                                    key={i}
                                    className="border border-gray-gray200 bg-gray-gray50 p-1 text-center font-semibold dark:border-gray-gray700 dark:bg-gray-gray800"
                                >
                                    {count}
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                </table>
            </div>

            {skippedTotal > 0 && (
                <p className="mt-2 text-gray-gray600 dark:text-gray-gray400">
                    {skippedTotal} contenu{skippedTotal > 1 ? 's' : ''} exclu
                    {skippedTotal > 1 ? 's' : ''} du calcul :{' '}
                    {skippedNoDate > 0 && <>{skippedNoDate} sans aucune date</>}
                    {skippedNoDate > 0 && skippedInverted > 0 && ', '}
                    {skippedInverted > 0 && (
                        <>{skippedInverted} dont la date de fin précède la date de début</>
                    )}
                    .
                </p>
            )}

            {threshold === null ? (
                <p className="mt-1 text-gray-gray600 dark:text-gray-gray400">
                    Aucun plafond défini : renseignez-le dans les réglages de l’extension pour
                    signaler les dépassements.
                </p>
            ) : !showCeiling ? (
                <p className="mt-1 text-gray-gray600 dark:text-gray-gray400">
                    Le plafond de {threshold} messages ne s’applique qu’à la vue par marché.
                </p>
            ) : null}

            {hover && <CellTooltip hover={hover} />}
        </div>
    );
}

// Fixed-position so it escapes the horizontally scrolling table, and pointer-events-none so it
// never steals the hover that spawned it.
function CellTooltip({hover}) {
    const {rect, items, rowLabel, week} = hover;

    const width = 320;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    // Flipped above the cell in the lower half of the viewport, where a tooltip below would be
    // clipped by the extension's own frame.
    const below = rect.bottom < window.innerHeight / 2;
    const position = below
        ? {top: rect.bottom + 4}
        : {bottom: window.innerHeight - rect.top + 4};

    const shown = items.slice(0, TOOLTIP_MAX_ITEMS);
    const rest = items.length - shown.length;

    return (
        <div
            className="pointer-events-none fixed z-50 rounded border border-gray-gray300 bg-white p-2 shadow-lg dark:border-gray-gray600 dark:bg-gray-gray800"
            style={{left, width, ...position}}
        >
            <div className="mb-1 font-semibold">
                {rowLabel} — semaine du {fmtShort(week)}
            </div>
            <div className="mb-1 text-gray-gray600 dark:text-gray-gray400">
                {items.length} publicité{items.length > 1 ? 's' : ''} active
                {items.length > 1 ? 's' : ''}
            </div>
            {shown.map((it, i) => (
                <div key={i} className="leading-tight">
                    {it.label}{' '}
                    <span className="text-gray-gray600 dark:text-gray-gray400">
                        ({fmtShort(it.start)} → {fmtShort(it.end)})
                    </span>
                </div>
            ))}
            {rest > 0 && (
                <div className="mt-1 text-gray-gray600 dark:text-gray-gray400">
                    + {rest} autre{rest > 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
}

initializeBlock({interface: () => <AdPressureApp />});
