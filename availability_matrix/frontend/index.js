import {useMemo, useState} from 'react';
import {
    initializeBlock,
    useRecords,
    useCustomProperties,
} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import './style.css';

// === CONSTANTS ===

// Abbreviated to fit a 14-column header; the ISO date sits underneath.
const DAY_LABELS_FR = ['Dim.', 'Lun.', 'Mar.', 'Merc.', 'Jeu.', 'Ven.', 'Sam.'];

const MS_PER_DAY = 86400000;

// The venue reads this two weeks at a time, matching the document it replaces.
const DEFAULT_NUM_WEEKS = 2;
const WEEK_OPTIONS = [1, 2, 4];

// Contacts holds producers, venue teams and suppliers too: only employees can be scheduled.
const DEFAULT_CONTACT_CATEGORY = 'Employés';

const AVAILABILITY_TABLE_NEEDLE = 'disponibilit';

// === HELPERS ===

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
// without it, an availability lands on the wrong column in a UTC-N timezone.
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

function fmtDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function dayDiff(from, to) {
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

// Read a Duration field as seconds since midnight. Null when empty — which the portal uses to mean
// "no bound", not "midnight".
function readDurationSeconds(record, field) {
    if (!field) return null;
    const v = record.getCellValue(field);
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return isNaN(n) ? null : n;
}

// "18h00", in the format of the document this table replaces.
function fmtHeure(seconds) {
    const totalMin = Math.round(seconds / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}`;
}

// Label one submitted window. Either bound may be missing: the portal's calendar lets an employee
// submit a day without hours, which means the whole day and not midnight.
function fmtWindow(start, end) {
    if (start === null && end === null) return 'Toute la journée';
    if (start === null) return `Jusqu’à ${fmtHeure(end)}`;
    if (end === null) return `À partir de ${fmtHeure(start)}`;
    return `${fmtHeure(start)} à ${fmtHeure(end)}`;
}

function readLinkedIds(record, field) {
    if (!field) return [];
    const v = record.getCellValue(field);
    return Array.isArray(v) ? v.map((x) => x?.id).filter(Boolean) : [];
}

function normalizeToken(value) {
    return String(value ?? '').trim().toLowerCase();
}

// Flatten any cell value into plain strings, covering the shapes getCellValue returns for
// select / lookup / rollup fields.
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
    const availabilityTable =
        base.tables.find((t) => t.name.toLowerCase().includes(AVAILABILITY_TABLE_NEEDLE)) ||
        base.tables[0];

    const isDateLike = (field) =>
        field.config.type === FieldType.DATE ||
        field.config.type === FieldType.DATE_TIME ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
        field.config.type === FieldType.SINGLE_LINE_TEXT;

    const isDuration = (field) => field.config.type === FieldType.DURATION;

    const isLinkedRecord = (field) => field.config.type === FieldType.MULTIPLE_RECORD_LINKS;

    const isCategoryLike = (field) =>
        field.config.type === FieldType.SINGLE_SELECT ||
        field.config.type === FieldType.MULTIPLE_SELECTS ||
        field.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

    const byName = (table, predicate, ...needles) =>
        table.fields.find(
            (f) => predicate(f) && needles.some((n) => f.name.toLowerCase().includes(n)),
        );

    // Derive the Contacts table from the link the availabilities actually carry, rather than from
    // its name: that guarantees the rows we draw match the records the table points at.
    const contactLinkGuess = byName(availabilityTable, isLinkedRecord, 'contact', 'employé', 'employe');
    const linkedContactsTableId = contactLinkGuess?.config?.options?.linkedTableId;
    const contactsTable =
        base.tables.find((t) => t.id === linkedContactsTableId) ||
        base.tables.find((t) => t.name.toLowerCase().includes('contact'));

    return [
        {
            key: 'availabilityTable',
            label: 'Table Disponibilités',
            type: 'table',
            defaultValue: availabilityTable,
        },
        {
            key: 'dateField',
            label: 'Jour de la disponibilité',
            type: 'field',
            table: availabilityTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue: byName(availabilityTable, isDateLike, 'date', 'jour'),
        },
        {
            key: 'contactLinkField',
            label: 'Lien Contact (sur les disponibilités)',
            type: 'field',
            table: availabilityTable,
            shouldFieldBeAllowed: isLinkedRecord,
            defaultValue: contactLinkGuess,
        },
        // Both are optional: a day submitted with no hours reads as "Toute la journée".
        {
            key: 'startField',
            label: 'Heure de début',
            type: 'field',
            table: availabilityTable,
            shouldFieldBeAllowed: isDuration,
            defaultValue: byName(availabilityTable, isDuration, 'debut', 'début', 'start'),
        },
        {
            key: 'endField',
            label: 'Heure de fin',
            type: 'field',
            table: availabilityTable,
            shouldFieldBeAllowed: isDuration,
            defaultValue: byName(availabilityTable, isDuration, 'fin', 'end'),
        },
        {
            key: 'contactsTable',
            label: 'Table Contacts',
            type: 'table',
            defaultValue: contactsTable,
        },
        // Declared only when the table is known: a `field` property with no table breaks the panel.
        ...(contactsTable
            ? [
                {
                    key: 'contactCategoryField',
                    label: 'Catégorie de contact (sur la table Contacts)',
                    type: 'field',
                    table: contactsTable,
                    shouldFieldBeAllowed: isCategoryLike,
                    defaultValue: byName(
                        contactsTable, isCategoryLike,
                        'catégorie de contact', 'catégor', 'categor', 'type',
                    ),
                },
                {
                    key: 'contactCategoryValue',
                    label: 'Catégorie de contact à afficher',
                    type: 'string',
                    defaultValue: DEFAULT_CONTACT_CATEGORY,
                },
            ]
            : []),
    ];
}

// === MAIN APP ===

function AvailabilityMatrixApp() {
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const availabilityTable = customPropertyValueByKey.availabilityTable;
    const dateField = customPropertyValueByKey.dateField;
    const contactLinkField = customPropertyValueByKey.contactLinkField;
    const startField = customPropertyValueByKey.startField;
    const endField = customPropertyValueByKey.endField;
    const contactsTable = customPropertyValueByKey.contactsTable;
    const contactCategoryField = customPropertyValueByKey.contactCategoryField;
    const contactCategoryValue = customPropertyValueByKey.contactCategoryValue;

    // useRecords throws on an undefined table, and contactsTable is optional: fall back to a table
    // that always exists and ignore the result when Contacts is not configured.
    const availabilityRecords = useRecords(availabilityTable);
    const contactRecords = useRecords(contactsTable || availabilityTable);

    const [weekOffset, setWeekOffset] = useState(0);
    const [numWeeks, setNumWeeks] = useState(DEFAULT_NUM_WEEKS);
    const [hideEmpty, setHideEmpty] = useState(false);

    const configured = Boolean(availabilityTable && dateField && contactLinkField && contactsTable);

    // The window always starts on a Sunday, so a period reads as whole weeks whatever the offset.
    const periodStart = useMemo(
        () => addDays(weekStart(new Date()), weekOffset * 7),
        [weekOffset],
    );
    const numDays = numWeeks * 7;
    const days = useMemo(
        () => Array.from({length: numDays}, (_, i) => addDays(periodStart, i)),
        [periodStart, numDays],
    );
    const todayIso = fmtDate(new Date());

    // Employees are the rows. Narrowed to one category, since Contacts also holds producers,
    // venue teams and suppliers.
    const employees = useMemo(() => {
        if (!contactsTable) return [];
        const wanted = normalizeToken(contactCategoryValue ?? DEFAULT_CONTACT_CATEGORY);
        return contactRecords
            .filter((r) => {
                if (!contactCategoryField || !wanted) return true;
                return readTextValues(r, contactCategoryField).some(
                    (v) => normalizeToken(v) === wanted,
                );
            })
            .map((r) => ({id: r.id, name: r.name}))
            .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }, [contactsTable, contactRecords, contactCategoryField, contactCategoryValue]);

    // contactId → array (one slot per displayed day) of window labels. An array per day rather than
    // a single label: nothing in the schema forbids two records for the same contact and day, and
    // silently dropping the second would misreport someone's availability.
    const {byContact, dayCounts} = useMemo(() => {
        const map = new Map();
        const counts = Array.from({length: numDays}, () => 0);
        if (!configured) return {byContact: map, dayCounts: counts};

        for (const record of availabilityRecords) {
            const date = readDate(record, dateField);
            if (!date) continue;
            const idx = dayDiff(periodStart, date);
            if (idx < 0 || idx >= numDays) continue;

            const label = fmtWindow(
                readDurationSeconds(record, startField),
                readDurationSeconds(record, endField),
            );

            for (const contactId of readLinkedIds(record, contactLinkField)) {
                let cells = map.get(contactId);
                if (!cells) map.set(contactId, (cells = Array.from({length: numDays}, () => [])));
                if (!cells[idx].length) counts[idx]++;
                cells[idx].push(label);
            }
        }
        return {byContact: map, dayCounts: counts};
    }, [
        configured, availabilityRecords, dateField, contactLinkField,
        startField, endField, periodStart, numDays,
    ]);

    const rows = useMemo(() => {
        const all = employees.map((employee) => ({
            ...employee,
            cells: byContact.get(employee.id) ?? Array.from({length: numDays}, () => []),
        }));
        // Kept visible by default: an employee with an empty row has submitted nothing, which is
        // exactly what the dispatcher needs to see before chasing them.
        return hideEmpty ? all.filter((r) => r.cells.some((c) => c.length)) : all;
    }, [employees, byContact, numDays, hideEmpty]);

    const silentCount = employees.length - rows.length;

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
                Configurez la table Disponibilités (jour, lien Contact, heures) et la table Contacts
                dans le panneau de réglages de l’extension.
            </div>
        );
    }

    const periodEnd = days[days.length - 1];

    return (
        <div className="p-3 text-xs text-gray-gray900 dark:text-gray-gray100">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => setWeekOffset(weekOffset - 1)}
                    className="cursor-pointer rounded border border-gray-gray300 px-2 py-1 hover:bg-gray-gray100 dark:border-gray-gray600 dark:hover:bg-gray-gray700"
                >
                    ← Semaine précédente
                </button>
                <button
                    type="button"
                    onClick={() => setWeekOffset(0)}
                    className="cursor-pointer rounded border border-gray-gray300 px-2 py-1 hover:bg-gray-gray100 dark:border-gray-gray600 dark:hover:bg-gray-gray700"
                >
                    Aujourd’hui
                </button>
                <button
                    type="button"
                    onClick={() => setWeekOffset(weekOffset + 1)}
                    className="cursor-pointer rounded border border-gray-gray300 px-2 py-1 hover:bg-gray-gray100 dark:border-gray-gray600 dark:hover:bg-gray-gray700"
                >
                    Semaine suivante →
                </button>

                <select
                    value={numWeeks}
                    onChange={(e) => setNumWeeks(Number(e.target.value))}
                    className="cursor-pointer rounded border border-gray-gray300 px-2 py-1 dark:border-gray-gray600 dark:bg-gray-gray800"
                >
                    {WEEK_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                            {n} semaine{n > 1 ? 's' : ''}
                        </option>
                    ))}
                </select>

                <label className="flex cursor-pointer items-center gap-1">
                    <input
                        type="checkbox"
                        checked={hideEmpty}
                        onChange={(e) => setHideEmpty(e.target.checked)}
                        className="cursor-pointer"
                    />
                    Masquer les employés sans disponibilité
                </label>
            </div>

            <h1 className="mb-3 text-center font-display text-base font-semibold">
                Disponibilités du {fmtDate(periodStart)} au {fmtDate(periodEnd)}
            </h1>

            <div className="overflow-x-auto">
                <table
                    className="w-full table-fixed border-collapse text-xs"
                    style={{minWidth: `${160 + numDays * 76}px`}}
                >
                    <thead>
                        <tr>
                            <th className="w-40 border border-gray-gray200 bg-gray-gray50 p-2 text-left dark:border-gray-gray700 dark:bg-gray-gray800">
                                Employé
                            </th>
                            {days.map((d) => {
                                const iso = fmtDate(d);
                                return (
                                    <th
                                        key={iso}
                                        className={
                                            'border border-gray-gray200 p-2 text-center font-semibold dark:border-gray-gray700 ' +
                                            (iso === todayIso
                                                ? 'bg-blue-blueLight2 dark:bg-gray-gray700'
                                                : 'bg-gray-gray50 dark:bg-gray-gray800')
                                        }
                                    >
                                        <div>{DAY_LABELS_FR[d.getDay()]}</div>
                                        <div className="font-normal text-gray-gray600 dark:text-gray-gray400">
                                            {iso}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.id}>
                                <th className="border border-gray-gray200 bg-gray-gray50 p-2 text-left font-semibold dark:border-gray-gray700 dark:bg-gray-gray800">
                                    {row.name}
                                </th>
                                {row.cells.map((labels, i) => (
                                    <td
                                        key={i}
                                        className={
                                            'border border-gray-gray200 p-1 text-center align-top dark:border-gray-gray700 ' +
                                            (labels.length
                                                ? 'bg-green-greenLight2 text-gray-gray900'
                                                : '')
                                        }
                                    >
                                        {labels.map((label, j) => (
                                            <div key={j} className="leading-tight">
                                                {label}
                                            </div>
                                        ))}
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td
                                    colSpan={numDays + 1}
                                    className="border border-gray-gray200 p-4 text-center text-gray-gray600 dark:border-gray-gray700 dark:text-gray-gray400"
                                >
                                    Aucune disponibilité soumise sur cette période.
                                </td>
                            </tr>
                        )}
                    </tbody>
                    <tfoot>
                        <tr>
                            <th className="border border-gray-gray200 bg-gray-gray50 p-2 text-left font-semibold dark:border-gray-gray700 dark:bg-gray-gray800">
                                Employés disponibles
                            </th>
                            {dayCounts.map((count, i) => (
                                <td
                                    key={i}
                                    className={
                                        'border border-gray-gray200 p-2 text-center font-semibold dark:border-gray-gray700 ' +
                                        (count === 0 ? 'text-orange-orange' : '')
                                    }
                                >
                                    {count}
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                </table>
            </div>

            {hideEmpty && silentCount > 0 && (
                <p className="mt-2 text-gray-gray600 dark:text-gray-gray400">
                    {silentCount} employé{silentCount > 1 ? 's' : ''} sans aucune disponibilité sur
                    la période {silentCount > 1 ? 'sont masqués' : 'est masqué'}.
                </p>
            )}
        </div>
    );
}

initializeBlock({interface: () => <AvailabilityMatrixApp />});
