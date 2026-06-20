import {useMemo, useState} from 'react';
import {
    initializeBlock,
    useRecords,
    useCustomProperties,
    expandRecord,
} from '@airtable/blocks/interface/ui';
import {FieldType, Base, Table, Field, Record} from '@airtable/blocks/interface/models';
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
function parseDate(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    const str = typeof value === 'string' ? value : String(value);
    const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const fallback = new Date(str);
    if (isNaN(fallback.getTime())) return null;
    fallback.setHours(0, 0, 0, 0);
    return fallback;
}

// Sunday-anchored start of the week containing `date`, normalized to midnight.
function weekStart(date: Date): Date {
    const x = new Date(date);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());
    return x;
}

function addDays(date: Date, days: number): Date {
    const x = new Date(date);
    x.setDate(x.getDate() + days);
    return x;
}

// Format a Date as YYYY-MM-DD (local).
function fmtDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Whole-day offset between two midnight-normalized dates.
function dayDiff(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

// Extract the first HH:MM in a string and turn it into minutes, for intra-cell sorting.
function timeSortKey(str: string): number {
    const m = str.match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 99999;
}

// Read a Duration field as a number of seconds (time-of-day since midnight). Null if empty.
function readDurationSeconds(record: Record, field: Field): number | null {
    const v = record.getCellValue(field);
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return isNaN(n) ? null : n;
}

// Format a number of seconds as H:MM (e.g. 45000 -> "12:30").
function fmtDuration(seconds: number): string {
    const totalMin = Math.round(seconds / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
}

function compareCategories(a: string, b: string): number {
    const ai = CATEGORY_PRIORITY_ORDER.indexOf(a);
    const bi = CATEGORY_PRIORITY_ORDER.indexOf(b);
    const an = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bn = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (an !== bn) return an - bn;
    return a.localeCompare(b, 'fr');
}

// === CUSTOM PROPERTIES ===

type FieldLike = {config: {type: string}};

function getCustomProperties(base: Base) {
    const eventsTable =
        base.tables.find((t: Table) => t.name.toLowerCase().includes('événement')) ||
        base.tables.find((t: Table) => t.name.toLowerCase().includes('evenement')) ||
        base.tables[0];

    const staffTable =
        base.tables.find((t: Table) => t.name.toLowerCase().includes('equipe_accueil')) ||
        base.tables.find((t: Table) => t.name.toLowerCase().includes('accueil')) ||
        base.tables.find((t: Table) => t.name.toLowerCase().includes('équipe')) ||
        base.tables[1] ||
        base.tables[0];

    const isTextLike = (field: FieldLike) =>
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.MULTILINE_TEXT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
        field.config.type === FieldType.ROLLUP;

    const isDateLike = (field: FieldLike) =>
        field.config.type === FieldType.DATE ||
        field.config.type === FieldType.DATE_TIME ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
        field.config.type === FieldType.SINGLE_LINE_TEXT;

    const isCategoryLike = (field: FieldLike) =>
        field.config.type === FieldType.SINGLE_SELECT ||
        field.config.type === FieldType.MULTIPLE_SELECTS ||
        field.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

    const isTimeLike = (field: FieldLike) =>
        field.config.type === FieldType.DATE_TIME ||
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.DURATION ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

    const byName = (table: Table, predicate: (f: FieldLike) => boolean, ...needles: string[]) =>
        table.fields.find(
            (f: Field) => predicate(f) && needles.some((n) => f.name.toLowerCase().includes(n)),
        );

    // Match a field whose name contains ALL of `needles` and NONE of `excludes`.
    const findAll = (
        table: Table,
        predicate: (f: FieldLike) => boolean,
        needles: string[],
        excludes: string[] = [],
    ) =>
        table.fields.find((f: Field) => {
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
            type: 'table' as const,
            defaultValue: eventsTable,
        },
        {
            key: 'staffTable',
            label: 'Table Équipe accueil (quarts)',
            type: 'table' as const,
            defaultValue: staffTable,
        },
        {
            key: 'eventLabelField',
            label: 'Libellé événement (ex. identifiant_court)',
            type: 'field' as const,
            table: eventsTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                eventsTable.fields.find((f: Field) => f.name.toLowerCase() === 'identifiant_court') ||
                byName(eventsTable, isTextLike, 'identifiant', 'titre', 'nom'),
        },
        {
            key: 'eventDateField',
            label: 'Date événement',
            type: 'field' as const,
            table: eventsTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue:
                byName(eventsTable, isDateLike, 'événement', 'evenement') ||
                byName(eventsTable, isDateLike, 'date'),
        },
        {
            key: 'contactField',
            label: 'Nom du contact (ex. nom_contact)',
            type: 'field' as const,
            table: staffTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                staffTable.fields.find((f: Field) => f.name.toLowerCase() === 'nom_contact') ||
                byName(staffTable, isTextLike, 'contact', 'nom', 'equipier', 'équipier'),
        },
        {
            key: 'categoryField',
            label: 'Catégorie (Placiers / seniors / Merch)',
            type: 'field' as const,
            table: staffTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(staffTable, isCategoryLike, 'rôle', 'role', 'categor', 'catégor', 'type', 'poste'),
        },
        {
            key: 'staffDateField',
            label: 'Date du quart',
            type: 'field' as const,
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
            type: 'field' as const,
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue: findAll(staffTable, isTimeLike, ['montage', 'in'], ['démontage', 'demontage']),
        },
        {
            key: 'montageOutField',
            label: 'Montage — Out',
            type: 'field' as const,
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue: findAll(staffTable, isTimeLike, ['montage', 'out'], ['démontage', 'demontage']),
        },
        {
            key: 'showcallInField',
            label: 'Show call — In',
            type: 'field' as const,
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue:
                findAll(staffTable, isTimeLike, ['show call', 'in']) ||
                findAll(staffTable, isTimeLike, ['appel', 'in']),
        },
        {
            key: 'showcallOutField',
            label: 'Show call — Out',
            type: 'field' as const,
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue:
                findAll(staffTable, isTimeLike, ['show call', 'out']) ||
                findAll(staffTable, isTimeLike, ['appel', 'out']),
        },
        {
            key: 'demontageInField',
            label: 'Démontage — In',
            type: 'field' as const,
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue:
                findAll(staffTable, isTimeLike, ['démontage', 'in']) ||
                findAll(staffTable, isTimeLike, ['demontage', 'in']),
        },
        {
            key: 'demontageOutField',
            label: 'Démontage — Out',
            type: 'field' as const,
            table: staffTable,
            shouldFieldBeAllowed: isTimeLike,
            defaultValue:
                findAll(staffTable, isTimeLike, ['démontage', 'out']) ||
                findAll(staffTable, isTimeLike, ['demontage', 'out']),
        },
    ];
}

// === DATA SHAPING ===

interface CellEntry {
    text: string;
    sortKey: number;
    highlight: boolean;
    record: Record;
}

// === MAIN APP ===

function ScheduleGridApp() {
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const eventsTable = customPropertyValueByKey.eventsTable as Table;
    const staffTable = customPropertyValueByKey.staffTable as Table;
    const eventLabelField = customPropertyValueByKey.eventLabelField as Field;
    const eventDateField = customPropertyValueByKey.eventDateField as Field;
    const contactField = customPropertyValueByKey.contactField as Field;
    const categoryField = customPropertyValueByKey.categoryField as Field;
    const staffDateField = customPropertyValueByKey.staffDateField as Field;
    const montageInField = customPropertyValueByKey.montageInField as Field | undefined;
    const showcallInField = customPropertyValueByKey.showcallInField as Field | undefined;
    const demontageInField = customPropertyValueByKey.demontageInField as Field | undefined;
    const montageOutField = customPropertyValueByKey.montageOutField as Field | undefined;
    const showcallOutField = customPropertyValueByKey.showcallOutField as Field | undefined;
    const demontageOutField = customPropertyValueByKey.demontageOutField as Field | undefined;

    const inFields = useMemo(
        () => [montageInField, showcallInField, demontageInField].filter(Boolean) as Field[],
        [montageInField, showcallInField, demontageInField],
    );
    const outFields = useMemo(
        () => [montageOutField, showcallOutField, demontageOutField].filter(Boolean) as Field[],
        [montageOutField, showcallOutField, demontageOutField],
    );

    const eventRecords = useRecords(eventsTable);
    const staffRecords = useRecords(staffTable);

    const [selectedWeekMs, setSelectedWeekMs] = useState<number | null>(null);
    const [numWeeks, setNumWeeks] = useState(1);

    const configured =
        eventsTable && staffTable && eventLabelField && eventDateField &&
        contactField && categoryField && staffDateField;

    // Distinct week starts present in the data, plus the current week, sorted ascending.
    const weeks = useMemo(() => {
        const set = new Set<number>();
        if (configured) {
            for (const r of eventRecords) {
                const d = parseDate(r.getCellValueAsString(eventDateField));
                if (d) set.add(weekStart(d).getTime());
            }
            for (const r of staffRecords) {
                const d = parseDate(r.getCellValueAsString(staffDateField));
                if (d) set.add(weekStart(d).getTime());
            }
        }
        const today = new Date();
        set.add(weekStart(today).getTime());
        return Array.from(set).sort((a, b) => a - b);
    }, [configured, eventRecords, staffRecords, eventDateField, staffDateField]);

    // Default to the week containing today, otherwise the most recent week with data.
    const effectiveWeekMs = useMemo(() => {
        if (selectedWeekMs !== null && weeks.includes(selectedWeekMs)) return selectedWeekMs;
        const todayWeek = weekStart(new Date()).getTime();
        if (weeks.includes(todayWeek)) return todayWeek;
        return weeks.length ? weeks[weeks.length - 1] : todayWeek;
    }, [selectedWeekMs, weeks]);

    const weekDays = useMemo(() => {
        const start = new Date(effectiveWeekMs);
        return Array.from({length: 7 * numWeeks}, (_, i) => addDays(start, i));
    }, [effectiveWeekMs, numWeeks]);

    // Build: rowKey -> dayIndex -> CellEntry[], and the ordered list of category rows.
    const {grid, categoryRows} = useMemo(() => {
        const map = new Map<string, CellEntry[][]>();
        const categories = new Set<string>();
        const start = new Date(effectiveWeekMs);
        const numDays = 7 * numWeeks;

        const ensureRow = (key: string) => {
            if (!map.has(key)) map.set(key, Array.from({length: numDays}, () => [] as CellEntry[]));
            return map.get(key)!;
        };

        if (configured) {
            // Événements row
            for (const r of eventRecords) {
                const date = parseDate(r.getCellValueAsString(eventDateField));
                if (!date) continue;
                const idx = dayDiff(start, date);
                if (idx < 0 || idx >= numDays) continue;
                const text = r.getCellValueAsString(eventLabelField).trim();
                if (!text) continue;
                ensureRow(EVENTS_ROW_KEY)[idx].push({
                    text,
                    sortKey: timeSortKey(text),
                    highlight: false,
                    record: r,
                });
            }

            // Staff category rows
            for (const r of staffRecords) {
                const date = parseDate(r.getCellValueAsString(staffDateField));
                if (!date) continue;
                const idx = dayDiff(start, date);
                if (idx < 0 || idx >= numDays) continue;

                const category = r.getCellValueAsString(categoryField).trim() || 'Autres';
                categories.add(category);

                const contact = r.getCellValueAsString(contactField).trim();

                // Smallest In to largest Out across the filled Montage/Show call/Démontage shifts.
                const ins = inFields
                    .map((f) => readDurationSeconds(r, f))
                    .filter((v): v is number => v !== null);
                const outs = outFields
                    .map((f) => readDurationSeconds(r, f))
                    .filter((v): v is number => v !== null);
                const minIn = ins.length ? Math.min(...ins) : null;
                const maxOut = outs.length ? Math.max(...outs) : null;

                let range = '';
                if (minIn !== null && maxOut !== null) range = `${fmtDuration(minIn)} - ${fmtDuration(maxOut)}`;
                else if (minIn !== null) range = fmtDuration(minIn);

                let text: string;
                if (contact && range) text = `${contact} : ${range}`;
                else if (contact) text = contact;
                else text = range; // unassigned shift: time only (highlighted yellow)

                ensureRow(category)[idx].push({
                    text,
                    sortKey: minIn !== null ? minIn : timeSortKey(text),
                    highlight: !contact, // yellow when no contact assigned
                    record: r,
                });
            }
        }

        for (const cells of map.values()) {
            for (const day of cells) day.sort((a, b) => a.sortKey - b.sortKey);
        }

        return {
            grid: map,
            categoryRows: Array.from(categories).sort(compareCategories),
        };
    }, [
        configured, effectiveWeekMs, numWeeks, eventRecords, staffRecords,
        eventDateField, eventLabelField, staffDateField, categoryField,
        contactField, inFields, outFields,
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
    const rowLabel = (key: string) =>
        key === EVENTS_ROW_KEY ? EVENTS_ROW_LABEL : key;
    const canExpand = (table: Table) => table && table.hasPermissionToExpandRecords();

    return (
        <div className="p-4 text-gray-gray900 dark:text-gray-gray100">
            <div className="mb-3 flex items-center gap-2">
                <label className="text-sm text-gray-gray700 dark:text-gray-gray300">
                    Semaine à afficher :
                </label>
                <select
                    className="rounded border border-gray-gray300 bg-white px-2 py-1 text-sm dark:border-gray-gray600 dark:bg-gray-gray800"
                    value={effectiveWeekMs}
                    onChange={(e) => setSelectedWeekMs(Number(e.target.value))}
                >
                    {weeks.map((ms) => {
                        const s = new Date(ms);
                        return (
                            <option key={ms} value={ms}>
                                {fmtDate(s)} au {fmtDate(addDays(s, 6))}
                            </option>
                        );
                    })}
                </select>
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
                            const cells = grid.get(key) ?? Array.from({length: weekDays.length}, () => [] as CellEntry[]);
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
                                                            (entry.highlight
                                                                ? 'border-yellow-yellow bg-yellow-yellowLight1 text-gray-gray900 min-h-[1.5rem] '
                                                                : 'border-gray-gray200 bg-white dark:border-gray-gray600 dark:bg-gray-gray800')
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
                </table>
            </div>
        </div>
    );
}

initializeBlock({interface: () => <ScheduleGridApp />});
