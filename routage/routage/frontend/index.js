import React, {useMemo} from 'react';
import {
    initializeBlock,
    useRecords,
    useCustomProperties,
} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import './style.css';

// === CONSTANTS ===

const BLOC_ORDER = ['AM', 'PM', 'SOIR', 'NUIT'];
const DAY_CODES = ['D', 'L', 'M', 'M2', 'J', 'V', 'S'];
const DAY_LABELS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const TOTAL_COLS = BLOC_ORDER.length * (DAY_CODES.length + 1); // 4 * 8 = 32

// === HELPERS ===

function parseAirtableDate(dateStr) {
    if (!dateStr) return null;
    const str = typeof dateStr === 'string' ? dateStr : String(dateStr);
    const parts = str.split('-');
    if (parts.length < 3) return null;
    const [year, month, day] = parts.map(Number);
    return new Date(year, month - 1, day);
}

function computeDayNumbers(dateDebut) {
    if (!dateDebut) return Array(7).fill(null);
    const start = new Date(dateDebut);
    return DAY_CODES.map((_, index) => {
        const d = new Date(start);
        d.setDate(d.getDate() + index);
        return d.getDate();
    });
}

// === CUSTOM PROPERTIES ===

function getCustomProperties(base) {
    const eventsTable =
        base.tables.find((t) => t.name.toLowerCase().includes('événement')) ||
        base.tables.find((t) => t.name.toLowerCase().includes('evenement')) ||
        base.tables[0];

    const weeksTable =
        base.tables.find((t) => t.name.toLowerCase().includes('semaine')) ||
        base.tables[1] ||
        base.tables[0];

    const blocsTable =
        base.tables.find((t) => t.name.toLowerCase().includes('bloc')) ||
        base.tables[2] ||
        base.tables[0];

    const isLinkedRecord = (field) =>
        field.config.type === FieldType.MULTIPLE_RECORD_LINKS;

    const isMultipleSelect = (field) =>
        field.config.type === FieldType.MULTIPLE_SELECTS;

    const isDateField = (field) =>
        field.config.type === FieldType.DATE ||
        field.config.type === FieldType.DATE_TIME;

    return [
        {
            key: 'eventsTable',
            label: 'Table Evenements',
            type: 'table',
            defaultValue: eventsTable,
        },
        {
            key: 'weeksTable',
            label: 'Table Semaines',
            type: 'table',
            defaultValue: weeksTable,
        },
        {
            key: 'blocsTable',
            label: 'Table Blocs',
            type: 'table',
            defaultValue: blocsTable,
        },
        {
            key: 'weekLinkField',
            label: 'Lien Semaines (sur Evenements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isLinkedRecord,
            defaultValue: eventsTable.fields.find(
                (f) => isLinkedRecord(f) && f.name.toLowerCase().includes('semaine'),
            ),
        },
        {
            key: 'blocLinkField',
            label: 'Lien Blocs (sur Evenements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isLinkedRecord,
            defaultValue: eventsTable.fields.find(
                (f) => isLinkedRecord(f) && f.name.toLowerCase().includes('bloc'),
            ),
        },
        {
            key: 'joursField',
            label: 'Champ Jours (sur Evenements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isMultipleSelect,
            defaultValue: eventsTable.fields.find(
                (f) => isMultipleSelect(f) && f.name.toLowerCase().includes('jour'),
            ),
        },
        {
            key: 'dateDebutField',
            label: 'Date debut (sur Semaines)',
            type: 'field',
            table: weeksTable,
            shouldFieldBeAllowed: isDateField,
            defaultValue: weeksTable.fields.find(
                (f) => isDateField(f) && (f.name.toLowerCase().includes('debut') || f.name.toLowerCase().includes('start')),
            ),
        },
        {
            key: 'dateFinField',
            label: 'Date fin (sur Semaines)',
            type: 'field',
            table: weeksTable,
            shouldFieldBeAllowed: isDateField,
            defaultValue: weeksTable.fields.find(
                (f) => isDateField(f) && (f.name.toLowerCase().includes('fin') || f.name.toLowerCase().includes('end')),
            ),
        },
    ];
}

// === MAIN APP ===

function RoutageApp() {
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const eventsTable = customPropertyValueByKey.eventsTable;
    const weeksTable = customPropertyValueByKey.weeksTable;
    const blocsTable = customPropertyValueByKey.blocsTable;

    const eventRecords = useRecords(eventsTable);
    const weekRecords = useRecords(weeksTable);
    const blocRecords = useRecords(blocsTable);

    const weekLinkField = customPropertyValueByKey.weekLinkField;
    const blocLinkField = customPropertyValueByKey.blocLinkField;
    const joursField = customPropertyValueByKey.joursField;
    const dateDebutField = customPropertyValueByKey.dateDebutField;
    const dateFinField = customPropertyValueByKey.dateFinField;

    const allConfigured =
        eventsTable && weeksTable && blocsTable &&
        weekLinkField && blocLinkField && joursField && dateDebutField;

    const sortedWeeks = useMemo(() => {
        if (!allConfigured) return [];

        // Build weeks lookup
        const weeksMap = new Map();
        for (const wr of weekRecords) {
            const startStr = dateDebutField ? wr.getCellValue(dateDebutField) : null;
            const endStr = dateFinField ? wr.getCellValue(dateFinField) : null;
            weeksMap.set(wr.id, {
                name: wr.name,
                dateDebut: parseAirtableDate(startStr),
                dateFin: endStr ? parseAirtableDate(endStr) : null,
            });
        }

        // Build blocs lookup
        const blocsMap = new Map();
        for (const br of blocRecords) {
            blocsMap.set(br.id, {name: br.name});
        }

        // Process events into grid structure
        const gridData = new Map();

        for (const event of eventRecords) {
            const eventName = event.name || '';

            const linkedWeeks = weekLinkField ? event.getCellValue(weekLinkField) : null;
            if (!linkedWeeks || !Array.isArray(linkedWeeks)) continue;

            const linkedBlocs = blocLinkField ? event.getCellValue(blocLinkField) : null;
            if (!linkedBlocs || !Array.isArray(linkedBlocs)) continue;

            const joursValue = joursField ? event.getCellValue(joursField) : null;
            const activeDays = new Set();
            if (Array.isArray(joursValue)) {
                for (const day of joursValue) {
                    activeDays.add(day.name);
                }
            }

            // Cross-product: event appears in every week × bloc combination
            for (const weekLink of linkedWeeks) {
                const weekInfo = weeksMap.get(weekLink.id);
                if (!weekInfo) continue;

                if (!gridData.has(weekLink.id)) {
                    gridData.set(weekLink.id, {
                        weekId: weekLink.id,
                        weekName: weekInfo.name,
                        dateDebut: weekInfo.dateDebut,
                        dateFin: weekInfo.dateFin,
                        blocs: new Map(),
                    });
                }
                const weekEntry = gridData.get(weekLink.id);

                for (const blocLink of linkedBlocs) {
                    const blocInfo = blocsMap.get(blocLink.id);
                    if (!blocInfo) continue;
                    const blocName = blocInfo.name;

                    if (!weekEntry.blocs.has(blocName)) {
                        weekEntry.blocs.set(blocName, {events: []});
                    }
                    weekEntry.blocs.get(blocName).events.push({
                        eventName,
                        activeDays,
                    });
                }
            }
        }

        // Sort weeks by start date
        return Array.from(gridData.values()).sort((a, b) => {
            if (!a.dateDebut) return 1;
            if (!b.dateDebut) return -1;
            return a.dateDebut.getTime() - b.dateDebut.getTime();
        });
    }, [
        eventRecords, weekRecords, blocRecords,
        weekLinkField, blocLinkField, joursField,
        dateDebutField, dateFinField, allConfigured,
    ]);

    // Error state
    if (errorState) {
        return (
            <div className="flex items-center justify-center h-screen p-6">
                <p className="text-base text-red-red dark:text-red-redLight1">
                    Erreur de configuration : {errorState.message || 'Erreur inconnue'}
                </p>
            </div>
        );
    }

    // Not configured
    if (!allConfigured) {
        return (
            <div className="flex items-center justify-center h-screen p-6">
                <div className="text-center max-w-md">
                    <p className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray200 mb-2">
                        Configuration requise
                    </p>
                    <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
                        Ouvrez le panneau des proprietes pour configurer les tables
                        (Evenements, Semaines, Blocs) et les champs associes.
                    </p>
                </div>
            </div>
        );
    }

    // No data
    if (sortedWeeks.length === 0) {
        return (
            <div className="flex items-center justify-center h-screen p-6">
                <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
                    Aucun evenement a afficher.
                </p>
            </div>
        );
    }

    // Render grid
    return (
        <div className="w-full h-screen overflow-auto bg-white dark:bg-gray-gray800 p-2">
            <table className="border-collapse text-xs min-w-max w-full">
                {sortedWeeks.map((weekData) => {
                    const dayNumbers = computeDayNumbers(weekData.dateDebut);
                    const maxEvents = Math.max(
                        1,
                        ...BLOC_ORDER.map((bn) => {
                            const bd = weekData.blocs.get(bn);
                            return bd ? bd.events.length : 0;
                        }),
                    );

                    return (
                        <React.Fragment key={weekData.weekId}>
                            {/* Week name header */}
                            <thead>
                                <tr>
                                    <th
                                        colSpan={TOTAL_COLS}
                                        className="border border-gray-gray200 dark:border-gray-gray600 bg-blue-blueLight3 dark:bg-blue-blueDark1 text-left px-2 py-1 font-semibold text-sm text-gray-gray700 dark:text-gray-gray200"
                                    >
                                        {weekData.weekName}
                                    </th>
                                </tr>
                                {/* Bloc headers */}
                                <tr>
                                    {BLOC_ORDER.map((blocName) => (
                                        <th
                                            key={blocName}
                                            colSpan={8}
                                            className="border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray75 dark:bg-gray-gray700 text-center px-1 py-1 font-semibold text-xs text-gray-gray600 dark:text-gray-gray300"
                                        >
                                            {blocName}
                                        </th>
                                    ))}
                                </tr>
                                {/* Day letter headers */}
                                <tr>
                                    {BLOC_ORDER.map((blocName) => (
                                        <React.Fragment key={blocName}>
                                            {DAY_LABELS.map((label, idx) => (
                                                <th
                                                    key={`${blocName}-label-${idx}`}
                                                    className="border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray50 dark:bg-gray-gray700 text-center px-0.5 py-0.5 font-medium text-gray-gray600 dark:text-gray-gray300"
                                                    style={{width: 32, minWidth: 32}}
                                                >
                                                    {label}
                                                </th>
                                            ))}
                                            <th className="border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray50 dark:bg-gray-gray700 text-left px-1 py-0.5 font-medium text-gray-gray600 dark:text-gray-gray300 min-w-[120px]">
                                                Nom
                                            </th>
                                        </React.Fragment>
                                    ))}
                                </tr>
                                {/* Day number headers */}
                                <tr>
                                    {BLOC_ORDER.map((blocName) => (
                                        <React.Fragment key={blocName}>
                                            {dayNumbers.map((num, idx) => (
                                                <th
                                                    key={`${blocName}-num-${idx}`}
                                                    className="border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray50 dark:bg-gray-gray700 text-center px-0.5 py-0.5 font-normal text-gray-gray500 dark:text-gray-gray400"
                                                    style={{width: 32, minWidth: 32}}
                                                >
                                                    {num}
                                                </th>
                                            ))}
                                            <th className="border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray50 dark:bg-gray-gray700 min-w-[120px]" />
                                        </React.Fragment>
                                    ))}
                                </tr>
                            </thead>
                            {/* Event rows */}
                            <tbody>
                                {Array.from({length: maxEvents}, (_, rowIdx) => (
                                    <tr key={`${weekData.weekId}-row-${rowIdx}`}>
                                        {BLOC_ORDER.map((blocName) => {
                                            const blocData = weekData.blocs.get(blocName);
                                            const event = blocData ? blocData.events[rowIdx] : null;

                                            return (
                                                <React.Fragment key={blocName}>
                                                    {DAY_CODES.map((dayCode, dayIdx) => {
                                                        const isActive = event && event.activeDays.has(dayCode);
                                                        return (
                                                            <td
                                                                key={`${blocName}-${dayIdx}`}
                                                                className={`border border-gray-gray200 dark:border-gray-gray600 text-center px-0.5 py-0.5 ${
                                                                    isActive
                                                                        ? 'font-bold text-gray-gray700 dark:text-gray-gray200'
                                                                        : ''
                                                                }`}
                                                                style={{width: 32, minWidth: 32}}
                                                            >
                                                                {isActive ? 'X' : ''}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="border border-gray-gray200 dark:border-gray-gray600 px-1 py-0.5 truncate max-w-[200px] min-w-[120px] text-gray-gray700 dark:text-gray-gray200">
                                                        {event ? event.eventName : ''}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </React.Fragment>
                    );
                })}
            </table>
        </div>
    );
}

initializeBlock({interface: () => <RoutageApp />});
