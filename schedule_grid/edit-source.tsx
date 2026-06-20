import React, {useMemo, useState} from 'react';
import {
    initializeBlock,
    useRecords,
    useCustomProperties,
    expandRecord,
    useColorScheme,
} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import type {Base, Table, Field, Record as AirtableRecord} from '@airtable/blocks/interface/models';

// ===== Constants =====
const DAY_LABELS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const EVENTS_ROW_KEY = '__events__';
const EVENTS_ROW_LABEL = 'Événements';
const CATEGORY_PRIORITY_ORDER = ['Placiers', 'Placiers seniors', 'Merch'];
const MS_PER_DAY = 86400000;

type FieldLike = {config: {type: string}};

// ===== Helpers =====
function parseDate(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    const str = typeof value === 'string' ? value : String(value);
    const m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const fb = new Date(str);
    if (isNaN(fb.getTime())) return null;
    fb.setHours(0, 0, 0, 0);
    return fb;
}
function weekStart(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());
    return x;
}
function addDays(d: Date, n: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}
function fmtDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function dayDiff(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}
function timeSortKey(s: string): number {
    const m = s.match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 99999;
}
function readDurationSeconds(record: AirtableRecord, field: Field): number | null {
    const v = record.getCellValue(field);
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return isNaN(n) ? null : n;
}
function fmtDuration(seconds: number): string {
    const total = Math.round(seconds / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
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

// ===== Custom properties =====
function getCustomProperties(base: Base) {
    const eventsTable =
        base.tables.find((t: Table) => t.name.toLowerCase().includes('événement')) ||
        base.tables.find((t: Table) => t.name.toLowerCase().includes('evenement')) ||
        base.tables[0];
    const staffTable =
        base.tables.find((t: Table) => t.name.toLowerCase().includes('equipe_accueil')) ||
        base.tables.find((t: Table) => t.name.toLowerCase().includes('accueil')) ||
        base.tables[1] ||
        base.tables[0];

    const isTextLike = (f: FieldLike) =>
        f.config.type === FieldType.SINGLE_LINE_TEXT ||
        f.config.type === FieldType.MULTILINE_TEXT ||
        f.config.type === FieldType.FORMULA ||
        f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
        f.config.type === FieldType.ROLLUP;
    const isDateLike = (f: FieldLike) =>
        f.config.type === FieldType.DATE ||
        f.config.type === FieldType.DATE_TIME ||
        f.config.type === FieldType.FORMULA ||
        f.config.type === FieldType.ROLLUP ||
        f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
        f.config.type === FieldType.SINGLE_LINE_TEXT;
    const isCategoryLike = (f: FieldLike) =>
        f.config.type === FieldType.SINGLE_SELECT ||
        f.config.type === FieldType.MULTIPLE_SELECTS ||
        f.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
        f.config.type === FieldType.SINGLE_LINE_TEXT ||
        f.config.type === FieldType.FORMULA ||
        f.config.type === FieldType.ROLLUP ||
        f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;
    const isTimeLike = (f: FieldLike) =>
        f.config.type === FieldType.DATE_TIME ||
        f.config.type === FieldType.SINGLE_LINE_TEXT ||
        f.config.type === FieldType.FORMULA ||
        f.config.type === FieldType.DURATION ||
        f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

    const byName = (table: Table, pred: (f: FieldLike) => boolean, ...needles: string[]) =>
        table.fields.find((f: Field) => pred(f) && needles.some((n) => f.name.toLowerCase().includes(n)));
    const findAll = (
        table: Table,
        pred: (f: FieldLike) => boolean,
        needles: string[],
        excludes: string[] = [],
    ) =>
        table.fields.find((f: Field) => {
            const n = f.name.toLowerCase();
            return pred(f) && needles.every((x) => n.includes(x)) && !excludes.some((x) => n.includes(x));
        });

    return [
        {key: 'eventsTable', label: 'Table Événements', type: 'table' as const, defaultValue: eventsTable},
        {
            key: 'staffTable',
            label: 'Table Équipe accueil (quarts)',
            type: 'table' as const,
            defaultValue: staffTable,
        },
        {
            key: 'eventLabelField',
            label: 'Libellé événement (identifiant_court)',
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
            label: 'Nom du contact (nom_contact)',
            type: 'field' as const,
            table: staffTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                staffTable.fields.find((f: Field) => f.name.toLowerCase() === 'nom_contact') ||
                byName(staffTable, isTextLike, 'contact', 'nom'),
        },
        {
            key: 'categoryField',
            label: 'Catégorie (Rôles)',
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
                byName(staffTable, isDateLike, 'date_courte') || byName(staffTable, isDateLike, 'date'),
        },
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

interface CellEntry {
    text: string;
    sortKey: number;
    highlight: boolean;
    record: AirtableRecord;
}

function ScheduleGridApp() {
    const {colorScheme} = useColorScheme();
    const isDark = colorScheme === 'dark';
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const eventsTable = customPropertyValueByKey.eventsTable as Table | undefined;
    const staffTable = customPropertyValueByKey.staffTable as Table | undefined;
    const eventLabelField = customPropertyValueByKey.eventLabelField as Field | undefined;
    const eventDateField = customPropertyValueByKey.eventDateField as Field | undefined;
    const contactField = customPropertyValueByKey.contactField as Field | undefined;
    const categoryField = customPropertyValueByKey.categoryField as Field | undefined;
    const staffDateField = customPropertyValueByKey.staffDateField as Field | undefined;
    const montageInField = customPropertyValueByKey.montageInField as Field | undefined;
    const showcallInField = customPropertyValueByKey.showcallInField as Field | undefined;
    const demontageInField = customPropertyValueByKey.demontageInField as Field | undefined;
    const montageOutField = customPropertyValueByKey.montageOutField as Field | undefined;
    const showcallOutField = customPropertyValueByKey.showcallOutField as Field | undefined;
    const demontageOutField = customPropertyValueByKey.demontageOutField as Field | undefined;

    const eventRecords = useRecords(eventsTable ?? null);
    const staffRecords = useRecords(staffTable ?? null);

    const [selectedWeekMs, setSelectedWeekMs] = useState<number | null>(null);
    const [numWeeks, setNumWeeks] = useState(1);

    const inFields = useMemo(
        () => [montageInField, showcallInField, demontageInField].filter(Boolean) as Field[],
        [montageInField, showcallInField, demontageInField],
    );
    const outFields = useMemo(
        () => [montageOutField, showcallOutField, demontageOutField].filter(Boolean) as Field[],
        [montageOutField, showcallOutField, demontageOutField],
    );

    const configured = Boolean(
        eventsTable && staffTable && eventLabelField && eventDateField &&
        contactField && categoryField && staffDateField,
    );

    const weeks = useMemo(() => {
        const set = new Set<number>();
        if (configured && eventDateField && staffDateField) {
            for (const r of eventRecords ?? []) {
                const d = parseDate(r.getCellValueAsString(eventDateField));
                if (d) set.add(weekStart(d).getTime());
            }
            for (const r of staffRecords ?? []) {
                const d = parseDate(r.getCellValueAsString(staffDateField));
                if (d) set.add(weekStart(d).getTime());
            }
        }
        set.add(weekStart(new Date()).getTime());
        return Array.from(set).sort((a, b) => a - b);
    }, [configured, eventRecords, staffRecords, eventDateField, staffDateField]);

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

    const {grid, categoryRows} = useMemo(() => {
        const map = new Map<string, CellEntry[][]>();
        const categories = new Set<string>();
        const start = new Date(effectiveWeekMs);
        const numDays = 7 * numWeeks;
        const ensureRow = (key: string) => {
            if (!map.has(key)) map.set(key, Array.from({length: numDays}, () => [] as CellEntry[]));
            return map.get(key)!;
        };
        if (configured && eventDateField && eventLabelField && staffDateField && categoryField && contactField) {
            for (const r of eventRecords ?? []) {
                const date = parseDate(r.getCellValueAsString(eventDateField));
                if (!date) continue;
                const idx = dayDiff(start, date);
                if (idx < 0 || idx >= numDays) continue;
                const text = r.getCellValueAsString(eventLabelField).trim();
                if (!text) continue;
                ensureRow(EVENTS_ROW_KEY)[idx].push({text, sortKey: timeSortKey(text), highlight: false, record: r});
            }
            for (const r of staffRecords ?? []) {
                const date = parseDate(r.getCellValueAsString(staffDateField));
                if (!date) continue;
                const idx = dayDiff(start, date);
                if (idx < 0 || idx >= numDays) continue;
                const category = r.getCellValueAsString(categoryField).trim() || 'Autres';
                categories.add(category);
                const contact = r.getCellValueAsString(contactField).trim();
                const ins = inFields.map((f) => readDurationSeconds(r, f)).filter((v): v is number => v !== null);
                const outs = outFields.map((f) => readDurationSeconds(r, f)).filter((v): v is number => v !== null);
                const minIn = ins.length ? Math.min(...ins) : null;
                const maxOut = outs.length ? Math.max(...outs) : null;
                let range = '';
                if (minIn !== null && maxOut !== null) range = `${fmtDuration(minIn)} - ${fmtDuration(maxOut)}`;
                else if (minIn !== null) range = fmtDuration(minIn);
                let text: string;
                if (contact && range) text = `${contact} : ${range}`;
                else if (contact) text = contact;
                else text = range;
                ensureRow(category)[idx].push({
                    text,
                    sortKey: minIn !== null ? minIn : timeSortKey(text),
                    highlight: !contact,
                    record: r,
                });
            }
        }
        for (const cells of map.values()) for (const day of cells) day.sort((a, b) => a.sortKey - b.sortKey);
        return {grid: map, categoryRows: Array.from(categories).sort(compareCategories)};
    }, [
        configured, effectiveWeekMs, numWeeks, eventRecords, staffRecords,
        eventDateField, eventLabelField, staffDateField, categoryField, contactField, inFields, outFields,
    ]);

    const txt = isDark ? 'text-gray-100' : 'text-gray-900';
    const subtle = isDark ? 'text-gray-400' : 'text-gray-500';
    const border = isDark ? 'border-gray-700' : 'border-gray-200';
    const headBg = isDark ? 'bg-gray-700' : 'bg-gray-100';
    const cellBg = isDark ? 'bg-gray-800' : 'bg-white';
    const entryBox = isDark ? 'border-gray-600 bg-gray-700' : 'border-gray-200 bg-white';
    const pageBg = isDark ? 'bg-gray-800' : 'bg-white';

    if (errorState) {
        return <div className={`p-4 text-sm text-red-500 ${pageBg}`}>{errorState.error?.message ?? 'Erreur de configuration'}</div>;
    }
    if (!configured) {
        return (
            <div className={`p-4 text-sm ${subtle} ${pageBg}`}>
                Configurez les tables et champs de l’extension (Événements, Équipe accueil, dates, contact,
                catégorie) dans le panneau de réglages.
            </div>
        );
    }

    const weekEndDate = addDays(new Date(effectiveWeekMs), 7 * numWeeks - 1);
    const rowKeys = [EVENTS_ROW_KEY, ...categoryRows];
    const rowLabel = (key: string) => (key === EVENTS_ROW_KEY ? EVENTS_ROW_LABEL : key);
    const canExpandEvents = eventsTable?.hasPermissionToExpandRecords() ?? false;
    const canExpandStaff = staffTable?.hasPermissionToExpandRecords() ?? false;

    return (
        <div className={`min-h-screen w-full p-4 ${pageBg} ${txt}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <label className={`text-sm ${subtle}`}>Semaine à afficher :</label>
                <select
                    className={`rounded border px-2 py-1 text-sm ${border} ${cellBg} ${txt}`}
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
                                `rounded border px-2 py-1 text-sm ${border} ` +
                                (numWeeks === n
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : `${cellBg} ${txt}`)
                            }
                        >
                            {n} semaine{n > 1 ? 's' : ''}
                        </button>
                    ))}
                </div>
            </div>

            <h1 className="mb-3 text-center text-base font-semibold">
                Horaire du {fmtDate(new Date(effectiveWeekMs))} au {fmtDate(weekEndDate)}
            </h1>

            <div className="overflow-x-auto">
                <table
                    className="w-full table-fixed border-collapse text-xs"
                    style={numWeeks > 1 ? {minWidth: `${112 + weekDays.length * 96}px`} : undefined}
                >
                    <thead>
                        <tr>
                            <th className={`w-28 border p-2 ${border} ${headBg}`} />
                            {weekDays.map((d, i) => (
                                <th key={i} className={`border p-2 text-center font-semibold ${border} ${headBg}`}>
                                    <div>{DAY_LABELS_FR[i % 7]}</div>
                                    <div className={`font-normal ${subtle}`}>{fmtDate(d)}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rowKeys.map((key) => {
                            const cells = grid.get(key) ?? Array.from({length: weekDays.length}, () => [] as CellEntry[]);
                            const isEvents = key === EVENTS_ROW_KEY;
                            const canExpand = isEvents ? canExpandEvents : canExpandStaff;
                            return (
                                <tr key={key}>
                                    <th className={`border p-2 text-center align-middle font-semibold ${border} ${headBg}`}>
                                        {rowLabel(key)}
                                    </th>
                                    {cells.map((entries, i) => (
                                        <td key={i} className={`border p-1 align-top ${border}`}>
                                            <div className="flex flex-col gap-1">
                                                {entries.map((entry, j) => (
                                                    <div
                                                        key={j}
                                                        onClick={() => canExpand && expandRecord(entry.record)}
                                                        className={
                                                            'rounded border px-1.5 py-1 leading-tight ' +
                                                            (canExpand ? 'cursor-pointer ' : '') +
                                                            (entry.highlight
                                                                ? 'border-yellow-400 bg-yellow-200 text-gray-900 min-h-[1.5rem] '
                                                                : `${entryBox} ${txt}`)
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
