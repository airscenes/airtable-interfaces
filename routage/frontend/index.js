import React, {useMemo, useState} from 'react';
import {
    initializeBlock,
    useRecords,
    useCustomProperties,
    expandRecord,
} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import './style.css';

// === CONSTANTS ===

const BLOC_ORDER = ['am', 'pm', 'soir', 'nuit'];
const BLOC_LABELS = {'am': 'AM', 'pm': 'PM', 'soir': 'SOIR', 'nuit': 'NUIT'};
const DAY_CODES = ['D', 'L', 'Ma', 'Me', 'J', 'V', 'S'];
const DAY_LABELS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const TOTAL_COLS = 1 + BLOC_ORDER.length * DAY_CODES.length; // 1 name + 4 * 7 = 29
const ALERT_THRESHOLD = 5;

const MONTH_NAMES_FR = [
    'JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN',
    'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE',
];

// Pinned ordering for the Canal dropdown and Calendrier sections.
// Names not in this list fall through to alphabetical order.
const CANAL_PRIORITY_ORDER = [
    'Principal',
    'Aire d’attente',
    'Jeux',
    'Poker',
    'Hautes-mises',
    'Nambs',
];

function compareCanalNames(a, b) {
    const norm = (s) => (s || '')
        .trim()
        .toLowerCase()
        .replace(/[‘’]/g, "'");
    const priorityMap = new Map(
        CANAL_PRIORITY_ORDER.map((name, idx) => [norm(name), idx]),
    );
    const ai = priorityMap.has(norm(a)) ? priorityMap.get(norm(a)) : Number.MAX_SAFE_INTEGER;
    const bi = priorityMap.has(norm(b)) ? priorityMap.get(norm(b)) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return (a || '').localeCompare(b || '', 'fr');
}

// === HELPERS ===

function parseAirtableDate(dateStr) {
    if (!dateStr) return null;
    const str = typeof dateStr === 'string' ? dateStr : String(dateStr);
    const parts = str.split('-');
    if (parts.length < 3) return null;
    const [year, month, day] = parts.map(Number);
    return new Date(year, month - 1, day);
}

// Read a "BLOCS" value from a Semaines record. Tolerates formula (string),
// single-line text, or singleSelect ({name}). Returns trimmed string or null.
function readBlocSaisonValue(record, field) {
    if (!record || !field) return null;
    const v = record.getCellValue(field);
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number') return String(v).trim() || null;
    if (typeof v === 'object' && typeof v.name === 'string') return v.name.trim() || null;
    return null;
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

    const sitesTable =
        base.tables.find((t) => t.name.toLowerCase().includes('site')) ||
        base.tables[0];

    const canalsTable =
        base.tables.find((t) => t.name.toLowerCase().includes('canal') || t.name.toLowerCase().includes('canaux')) ||
        base.tables[0];

    const isLinkedRecord = (field) =>
        field.config.type === FieldType.MULTIPLE_RECORD_LINKS;

    const isMultipleSelect = (field) =>
        field.config.type === FieldType.MULTIPLE_SELECTS;

    const isDateField = (field) =>
        field.config.type === FieldType.DATE ||
        field.config.type === FieldType.DATE_TIME ||
        field.config.type === FieldType.FORMULA;

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
            key: 'sitesTable',
            label: 'Table Sites',
            type: 'table',
            defaultValue: sitesTable,
        },
        {
            key: 'canalsTable',
            label: 'Table Canaux',
            type: 'table',
            defaultValue: canalsTable,
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
            key: 'siteLinkField',
            label: 'Lien Sites (sur Evenements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isLinkedRecord,
            defaultValue: eventsTable.fields.find(
                (f) => isLinkedRecord(f) && f.name.toLowerCase().includes('site'),
            ),
        },
        {
            key: 'canalLinkField',
            label: 'Lien Canaux (sur Evenements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isLinkedRecord,
            defaultValue: eventsTable.fields.find(
                (f) => isLinkedRecord(f) && f.name.toLowerCase().includes('canal'),
            ),
        },
        {
            key: 'joursField',
            label: 'Champ Jours (sur Evenements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: (field) => isMultipleSelect(field) || isLinkedRecord(field),
            defaultValue: eventsTable.fields.find(
                (f) => (isMultipleSelect(f) || isLinkedRecord(f)) &&
                       f.name.toLowerCase().includes('jour') &&
                       !f.name.toLowerCase().includes('evenement'),
            ) || eventsTable.fields.find(
                (f) => (isMultipleSelect(f) || isLinkedRecord(f)) && f.name.toLowerCase().includes('jour'),
            ),
        },
        {
            key: 'joursEvenementField',
            label: 'Champ Jours Evenement (sur Evenements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: (field) => isMultipleSelect(field) || isLinkedRecord(field),
            defaultValue: eventsTable.fields.find(
                (f) => (isMultipleSelect(f) || isLinkedRecord(f)) &&
                       f.name.toLowerCase().includes('jour') &&
                       f.name.toLowerCase().includes('evenement'),
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
        {
            key: 'blocSaisonField',
            label: 'Bloc saisonnier (sur Semaines)',
            type: 'field',
            table: weeksTable,
            shouldFieldBeAllowed: (field) =>
                field.config.type === FieldType.FORMULA ||
                field.config.type === FieldType.SINGLE_LINE_TEXT ||
                field.config.type === FieldType.SINGLE_SELECT ||
                field.config.type === FieldType.NUMBER,
            defaultValue: weeksTable.fields.find(
                (f) => f.name.toLowerCase() === 'blocs' || f.name.toLowerCase() === 'bloc',
            ) || weeksTable.fields.find(
                (f) => f.name.toLowerCase().includes('bloc'),
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
    const sitesTable = customPropertyValueByKey.sitesTable;
    const canalsTable = customPropertyValueByKey.canalsTable;

    const eventRecords = useRecords(eventsTable);
    const weekRecords = useRecords(weeksTable);
    const blocRecords = useRecords(blocsTable);
    const siteRecords = useRecords(sitesTable);
    const canalRecords = useRecords(canalsTable);

    const weekLinkField = customPropertyValueByKey.weekLinkField;
    const blocLinkField = customPropertyValueByKey.blocLinkField;
    const siteLinkField = customPropertyValueByKey.siteLinkField;
    const canalLinkField = customPropertyValueByKey.canalLinkField;
    const joursField = customPropertyValueByKey.joursField;
    const joursEvenementField = customPropertyValueByKey.joursEvenementField;
    const dateDebutField = customPropertyValueByKey.dateDebutField;
    const dateFinField = customPropertyValueByKey.dateFinField;
    const blocSaisonField = customPropertyValueByKey.blocSaisonField;

    const [view, setView] = useState('routage'); // 'routage' or 'calendrier'
    const [selectedSiteId, setSelectedSiteId] = useState('__all__');
    const [selectedWeekId, setSelectedWeekId] = useState(null);
    const [selectedCanalId, setSelectedCanalId] = useState('__all__');
    const [selectedBlocSaison, setSelectedBlocSaison] = useState(null);
    const [selectedYear, setSelectedYear] = useState(null);
    const [selectedBlocHoraireId, setSelectedBlocHoraireId] = useState('__all__');

    const canExpand = eventsTable && eventsTable.hasPermissionToExpandRecords();

    const routageConfigured =
        eventsTable && weeksTable && blocsTable && sitesTable && canalsTable &&
        weekLinkField && blocLinkField && siteLinkField && canalLinkField && joursField && dateDebutField;

    const calendrierConfigured = routageConfigured && blocSaisonField;

    const allConfigured = view === 'calendrier' ? calendrierConfigured : routageConfigured;

    // Auto-detect current week
    const currentWeekId = useMemo(() => {
        if (!dateDebutField || !weekRecords) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const wr of weekRecords) {
            const start = parseAirtableDate(wr.getCellValue(dateDebutField));
            const end = dateFinField ? parseAirtableDate(wr.getCellValue(dateFinField)) : null;
            if (start) {
                const endDate = end || new Date(start.getTime() + 6 * 86400000);
                if (today >= start && today <= endDate) return wr.id;
            }
        }
        return null;
    }, [weekRecords, dateDebutField, dateFinField]);

    const effectiveWeekId = selectedWeekId === null ? (currentWeekId || '__all__') : selectedWeekId;

    // Build a lookup of event records by ID for expandRecord
    const eventRecordsById = useMemo(() => {
        const map = new Map();
        for (const r of eventRecords) {
            map.set(r.id, r);
        }
        return map;
    }, [eventRecords]);

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

        // Process events into grid structure (outer join across blocs)
        const gridData = new Map();

        for (const event of eventRecords) {
            // Site filter
            if (selectedSiteId !== '__all__') {
                const linkedSites = siteLinkField ? event.getCellValue(siteLinkField) : null;
                if (!Array.isArray(linkedSites) || !linkedSites.some((s) => s.id === selectedSiteId)) {
                    continue;
                }
            }

            // Canal filter
            if (selectedCanalId !== '__all__') {
                const linkedCanals = canalLinkField ? event.getCellValue(canalLinkField) : null;
                if (!Array.isArray(linkedCanals) || !linkedCanals.some((c) => c.id === selectedCanalId)) {
                    continue;
                }
            }

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

            const joursEvenementValue = joursEvenementField ? event.getCellValue(joursEvenementField) : null;
            const eventDays = new Set();
            if (Array.isArray(joursEvenementValue)) {
                for (const day of joursEvenementValue) {
                    eventDays.add(day.name);
                }
            }

            const blocNames = new Set();
            for (const blocLink of linkedBlocs) {
                const blocInfo = blocsMap.get(blocLink.id);
                if (blocInfo) blocNames.add(blocInfo.name);
            }

            for (const weekLink of linkedWeeks) {
                // Week filter
                if (effectiveWeekId !== '__all__' && weekLink.id !== effectiveWeekId) {
                    continue;
                }

                const weekInfo = weeksMap.get(weekLink.id);
                if (!weekInfo) continue;

                if (!gridData.has(weekLink.id)) {
                    gridData.set(weekLink.id, {
                        weekId: weekLink.id,
                        weekName: weekInfo.name,
                        dateDebut: weekInfo.dateDebut,
                        dateFin: weekInfo.dateFin,
                        events: [],
                    });
                }
                gridData.get(weekLink.id).events.push({
                    eventName,
                    eventId: event.id,
                    activeDays,
                    eventDays,
                    blocNames,
                });
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
        weekLinkField, blocLinkField, siteLinkField, canalLinkField, joursField, joursEvenementField,
        dateDebutField, dateFinField, allConfigured,
        selectedSiteId, effectiveWeekId, selectedCanalId,
    ]);

    // Sort week records by date for the dropdown
    const sortedWeekOptions = useMemo(() => {
        if (!dateDebutField || !weekRecords) return [];
        return [...weekRecords].sort((a, b) => {
            const da = parseAirtableDate(dateDebutField ? a.getCellValue(dateDebutField) : null);
            const db = parseAirtableDate(dateDebutField ? b.getCellValue(dateDebutField) : null);
            if (!da) return 1;
            if (!db) return -1;
            return da.getTime() - db.getTime();
        });
    }, [weekRecords, dateDebutField]);

    const handleRowClick = (eventId) => {
        if (!canExpand) return;
        const record = eventRecordsById.get(eventId);
        if (record) expandRecord(record);
    };

    // === CALENDRIER VIEW DATA ===

    // Distinct seasonal-bloc values found in the Semaines records
    const blocSaisonOptions = useMemo(() => {
        if (!blocSaisonField || !weekRecords) return [];
        const set = new Set();
        for (const wr of weekRecords) {
            const v = readBlocSaisonValue(wr, blocSaisonField);
            if (v) set.add(v);
        }
        return Array.from(set).sort();
    }, [weekRecords, blocSaisonField]);

    // Auto-detect the seasonal bloc that contains today
    const currentBlocSaison = useMemo(() => {
        if (!blocSaisonField || !dateDebutField || !weekRecords) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const wr of weekRecords) {
            const start = parseAirtableDate(wr.getCellValue(dateDebutField));
            const end = dateFinField ? parseAirtableDate(wr.getCellValue(dateFinField)) : null;
            if (start) {
                const endDate = end || new Date(start.getTime() + 6 * 86400000);
                if (today >= start && today <= endDate) {
                    return readBlocSaisonValue(wr, blocSaisonField);
                }
            }
        }
        return null;
    }, [weekRecords, blocSaisonField, dateDebutField, dateFinField]);

    const effectiveBlocSaison = selectedBlocSaison ?? currentBlocSaison ?? blocSaisonOptions[0] ?? null;

    // Canal records sorted by the pinned priority order
    const sortedCanalRecords = useMemo(() => {
        if (!canalRecords) return [];
        return [...canalRecords].sort((a, b) => compareCanalNames(a.name, b.name));
    }, [canalRecords]);

    // Bloc horaire records (e.g. AM, PM, SOIR, NUIT) sorted by the original
    // table order, used by the Calendrier filter.
    const blocHoraireOptions = useMemo(() => blocRecords ?? [], [blocRecords]);

    // Years available for the selected seasonal bloc (from week start dates)
    const yearOptions = useMemo(() => {
        if (!effectiveBlocSaison || !blocSaisonField || !dateDebutField || !weekRecords) return [];
        const set = new Set();
        for (const wr of weekRecords) {
            const v = readBlocSaisonValue(wr, blocSaisonField);
            if (v !== effectiveBlocSaison) continue;
            const d = parseAirtableDate(wr.getCellValue(dateDebutField));
            if (d) set.add(d.getFullYear());
        }
        return Array.from(set).sort((a, b) => a - b);
    }, [weekRecords, blocSaisonField, dateDebutField, effectiveBlocSaison]);

    // Year of the week containing today (fallback: current calendar year)
    const currentYear = useMemo(() => {
        if (!dateDebutField || !weekRecords) return new Date().getFullYear();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const wr of weekRecords) {
            const start = parseAirtableDate(wr.getCellValue(dateDebutField));
            const end = dateFinField ? parseAirtableDate(wr.getCellValue(dateFinField)) : null;
            if (start) {
                const endDate = end || new Date(start.getTime() + 6 * 86400000);
                if (today >= start && today <= endDate) return start.getFullYear();
            }
        }
        return new Date().getFullYear();
    }, [weekRecords, dateDebutField, dateFinField]);

    const effectiveYear =
        selectedYear !== null && yearOptions.includes(selectedYear)
            ? selectedYear
            : (yearOptions.includes(currentYear) ? currentYear : yearOptions[yearOptions.length - 1] ?? null);

    // Weeks of the selected seasonal bloc + year, sorted by start date
    const calendrierWeeks = useMemo(() => {
        if (!effectiveBlocSaison || !blocSaisonField || !dateDebutField || !weekRecords) return [];
        const arr = [];
        for (const wr of weekRecords) {
            const v = readBlocSaisonValue(wr, blocSaisonField);
            if (v !== effectiveBlocSaison) continue;
            const dateDebut = parseAirtableDate(wr.getCellValue(dateDebutField));
            if (!dateDebut) continue;
            if (effectiveYear !== null && dateDebut.getFullYear() !== effectiveYear) continue;
            arr.push({id: wr.id, name: wr.name, dateDebut});
        }
        arr.sort((a, b) => a.dateDebut.getTime() - b.dateDebut.getTime());
        return arr;
    }, [weekRecords, blocSaisonField, dateDebutField, effectiveBlocSaison, effectiveYear]);

    // Month headers spanning consecutive weeks. The "month" of a week is the
    // month of its Monday (dateDebut + 1 day), matching the BLOCS formula
    // convention so weeks always group under the same month they were
    // assigned to.
    const calendrierMonthHeaders = useMemo(() => {
        const headers = [];
        let current = null;
        for (const w of calendrierWeeks) {
            const mon = new Date(w.dateDebut);
            mon.setDate(mon.getDate() + 1);
            const m = mon.getMonth();
            const y = mon.getFullYear();
            if (current && current.month === m && current.year === y) {
                current.span++;
            } else {
                if (current) headers.push(current);
                current = {month: m, year: y, span: 1};
            }
        }
        if (current) headers.push(current);
        return headers;
    }, [calendrierWeeks]);

    // Events grouped by canal. An event appears under each of its linked
    // canaux (or "Sans canal" if none).
    const calendrierByCanal = useMemo(() => {
        const blocWeekIds = new Set(calendrierWeeks.map((w) => w.id));
        if (blocWeekIds.size === 0) return [];

        const canalsMap = new Map();

        for (const event of eventRecords) {
            if (selectedSiteId !== '__all__') {
                const linkedSites = siteLinkField ? event.getCellValue(siteLinkField) : null;
                if (!Array.isArray(linkedSites) || !linkedSites.some((s) => s.id === selectedSiteId)) continue;
            }

            if (selectedBlocHoraireId !== '__all__') {
                const linkedBlocs = blocLinkField ? event.getCellValue(blocLinkField) : null;
                if (!Array.isArray(linkedBlocs) || !linkedBlocs.some((b) => b.id === selectedBlocHoraireId)) continue;
            }

            const linkedWeeks = weekLinkField ? event.getCellValue(weekLinkField) : null;
            if (!Array.isArray(linkedWeeks)) continue;

            const eventWeekIds = new Set();
            for (const wl of linkedWeeks) {
                if (blocWeekIds.has(wl.id)) eventWeekIds.add(wl.id);
            }
            if (eventWeekIds.size === 0) continue;

            const linkedCanals = canalLinkField ? event.getCellValue(canalLinkField) : null;
            const canals = Array.isArray(linkedCanals) && linkedCanals.length > 0
                ? linkedCanals
                : [{id: '__no_canal__', name: 'Sans canal'}];

            for (const canal of canals) {
                if (selectedCanalId !== '__all__' && canal.id !== selectedCanalId) continue;
                if (!canalsMap.has(canal.id)) {
                    canalsMap.set(canal.id, {canalId: canal.id, canalName: canal.name || 'Sans canal', events: []});
                }
                canalsMap.get(canal.id).events.push({
                    eventId: event.id,
                    eventName: event.name || '',
                    weekIds: eventWeekIds,
                });
            }
        }

        return Array.from(canalsMap.values())
            .sort((a, b) => compareCanalNames(a.canalName, b.canalName));
    }, [
        eventRecords, calendrierWeeks,
        weekLinkField, siteLinkField, canalLinkField, blocLinkField,
        selectedSiteId, selectedCanalId, selectedBlocHoraireId,
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
                        (Evenements, Semaines, Blocs, Sites, Canaux) et les champs associes.
                    </p>
                </div>
            </div>
        );
    }

    const toggleBtn = (target, label) => (
        <button
            type="button"
            onClick={() => setView(target)}
            className={`text-sm px-3 py-1 rounded border transition-colors ${
                view === target
                    ? 'bg-blue-blue dark:bg-blue-blueDark1 text-white border-blue-blue dark:border-blue-blueDark1'
                    : 'bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200 border-gray-gray200 dark:border-gray-gray600 hover:bg-gray-gray50 dark:hover:bg-gray-gray600'
            }`}
        >
            {label}
        </button>
    );

    // Render
    return (
        <div className="w-full h-screen overflow-auto bg-white dark:bg-gray-gray800 px-2">
            {/* Filters */}
            <div className="mb-3 flex flex-wrap items-center gap-4 sticky top-0 z-10 bg-white dark:bg-gray-gray800 py-2">
                <div className="flex items-center gap-1">
                    {toggleBtn('routage', 'Routage')}
                    {toggleBtn('calendrier', 'Calendrier')}
                </div>
                {view === 'routage' && (
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-gray600 dark:text-gray-gray300">
                            Semaine :
                        </label>
                        <select
                            value={effectiveWeekId}
                            onChange={(e) => setSelectedWeekId(e.target.value)}
                            className="text-sm border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
                        >
                            <option value="__all__">Toutes les semaines</option>
                            {sortedWeekOptions.map((week) => (
                                <option key={week.id} value={week.id}>{week.name}</option>
                            ))}
                        </select>
                    </div>
                )}
                {view === 'calendrier' && (
                    <>
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-gray-gray600 dark:text-gray-gray300">
                                Bloc :
                            </label>
                            <select
                                value={effectiveBlocSaison || ''}
                                onChange={(e) => setSelectedBlocSaison(e.target.value || null)}
                                className="text-sm border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
                            >
                                {blocSaisonOptions.length === 0 && (
                                    <option value="">Aucun bloc</option>
                                )}
                                {blocSaisonOptions.map((bloc) => (
                                    <option key={bloc} value={bloc}>{bloc}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-gray-gray600 dark:text-gray-gray300">
                                Année :
                            </label>
                            <select
                                value={effectiveYear ?? ''}
                                onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : null)}
                                className="text-sm border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
                            >
                                {yearOptions.length === 0 && (
                                    <option value="">—</option>
                                )}
                                {yearOptions.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-gray-gray600 dark:text-gray-gray300">
                                Bloc(s) horaire :
                            </label>
                            <select
                                value={selectedBlocHoraireId}
                                onChange={(e) => setSelectedBlocHoraireId(e.target.value)}
                                className="text-sm border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
                            >
                                <option value="__all__">Tous</option>
                                {blocHoraireOptions.map((bloc) => (
                                    <option key={bloc.id} value={bloc.id}>{bloc.name}</option>
                                ))}
                            </select>
                        </div>
                    </>
                )}
                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-gray600 dark:text-gray-gray300">
                        Site :
                    </label>
                    <select
                        value={selectedSiteId}
                        onChange={(e) => setSelectedSiteId(e.target.value)}
                        className="text-sm border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
                    >
                        <option value="__all__">Tous les sites</option>
                        {siteRecords.map((site) => (
                            <option key={site.id} value={site.id}>{site.name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-gray600 dark:text-gray-gray300">
                        Canal :
                    </label>
                    <select
                        value={selectedCanalId}
                        onChange={(e) => setSelectedCanalId(e.target.value)}
                        className="text-sm border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
                    >
                        <option value="__all__">Tous les canaux</option>
                        {sortedCanalRecords.map((canal) => (
                            <option key={canal.id} value={canal.id}>{canal.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {view === 'routage' && (sortedWeeks.length === 0 ? (
                <p className="text-sm text-gray-gray500 dark:text-gray-gray400 text-center py-8">
                    Aucun événement à afficher.
                </p>
            ) : (
                <table className="border-collapse text-xs min-w-max w-full">
                    {sortedWeeks.map((weekData) => {
                        const dayNumbers = computeDayNumbers(weekData.dateDebut);
                        const events = weekData.events || [];

                        // Compute totals per bloc per day
                        const totals = {};
                        for (const bloc of BLOC_ORDER) {
                            totals[bloc] = DAY_CODES.map((dayCode) => {
                                let count = 0;
                                for (const ev of events) {
                                    if (ev.blocNames.has(bloc) && ev.activeDays.has(dayCode)) {
                                        count++;
                                    }
                                }
                                return count;
                            });
                        }

                        return (
                            <React.Fragment key={weekData.weekId}>
                                <thead>
                                    {/* Week name header */}
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
                                        <th
                                            rowSpan={3}
                                            className="border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray75 dark:bg-gray-gray700 text-left px-2 py-1 font-semibold text-xs text-gray-gray600 dark:text-gray-gray300 min-w-[100px]"
                                        >
                                            Nom
                                        </th>
                                        {BLOC_ORDER.map((blocName, blocIdx) => (
                                            <th
                                                key={blocName}
                                                colSpan={7}
                                                className={`border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray75 dark:bg-gray-gray700 text-center px-1 py-1 font-semibold text-xs text-gray-gray600 dark:text-gray-gray300${blocIdx > 0 ? ' border-l-2 border-l-gray-gray400 dark:border-l-gray-gray500' : ''}`}
                                            >
                                                {BLOC_LABELS[blocName] || blocName}
                                            </th>
                                        ))}
                                    </tr>
                                    {/* Day letter headers */}
                                    <tr>
                                        {BLOC_ORDER.map((blocName, blocIdx) => (
                                            <React.Fragment key={blocName}>
                                                {DAY_LABELS.map((label, idx) => (
                                                    <th
                                                        key={`${blocName}-label-${idx}`}
                                                        className={`border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray50 dark:bg-gray-gray700 text-center px-0.5 py-0.5 font-medium text-gray-gray600 dark:text-gray-gray300${blocIdx > 0 && idx === 0 ? ' border-l-2 border-l-gray-gray400 dark:border-l-gray-gray500' : ''}`}
                                                        style={{width: 32, minWidth: 32}}
                                                    >
                                                        {label}
                                                    </th>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </tr>
                                    {/* Day number headers */}
                                    <tr>
                                        {BLOC_ORDER.map((blocName, blocIdx) => (
                                            <React.Fragment key={blocName}>
                                                {dayNumbers.map((num, idx) => (
                                                    <th
                                                        key={`${blocName}-num-${idx}`}
                                                        className={`border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray50 dark:bg-gray-gray700 text-center px-0.5 py-0.5 font-normal text-gray-gray500 dark:text-gray-gray400${blocIdx > 0 && idx === 0 ? ' border-l-2 border-l-gray-gray400 dark:border-l-gray-gray500' : ''}`}
                                                        style={{width: 32, minWidth: 32}}
                                                    >
                                                        {num}
                                                    </th>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* Event rows */}
                                    {events.length === 0 && (
                                        <tr>
                                            <td colSpan={TOTAL_COLS} className="border border-gray-gray200 dark:border-gray-gray600 px-2 text-gray-gray400 dark:text-gray-gray500" style={{height: 18}} />
                                        </tr>
                                    )}
                                    {events.map((event, rowIdx) => (
                                        <tr
                                            key={`${weekData.weekId}-row-${rowIdx}`}
                                            style={{height: 18, cursor: canExpand ? 'pointer' : 'default'}}
                                            className="hover:bg-blue-blueLight3 dark:hover:bg-blue-blueDark1"
                                            onClick={() => handleRowClick(event.eventId)}
                                        >
                                            <td className="border border-gray-gray200 dark:border-gray-gray600 px-2 truncate max-w-[140px] min-w-[100px] text-gray-gray700 dark:text-gray-gray200">
                                                {event.eventName}
                                            </td>
                                            {BLOC_ORDER.map((blocName, blocIdx) => {
                                                const inBloc = event.blocNames.has(blocName);
                                                return (
                                                    <React.Fragment key={blocName}>
                                                        {DAY_CODES.map((dayCode, dayIdx) => {
                                                            const isActive = inBloc && event.activeDays.has(dayCode);
                                                            const isEventDay = isActive && event.eventDays && event.eventDays.has(dayCode);
                                                            const blocSep = blocIdx > 0 && dayIdx === 0 ? ' border-l-2 border-l-gray-gray400 dark:border-l-gray-gray500' : '';
                                                            return (
                                                                <td
                                                                    key={`${blocName}-${dayIdx}`}
                                                                    className={`border border-gray-gray200 dark:border-gray-gray600 text-center${blocSep} ${
                                                                        isEventDay
                                                                            ? 'font-bold text-blue-blueDark1 dark:text-cyan-cyanLight1 bg-cyan-cyanLight2 dark:bg-cyan-cyanDark1'
                                                                            : isActive
                                                                                ? 'font-bold text-gray-gray700 dark:text-gray-gray200'
                                                                                : ''
                                                                    }`}
                                                                    style={{width: 32, minWidth: 32}}
                                                                >
                                                                    {isActive ? 'X' : ''}
                                                                </td>
                                                            );
                                                        })}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                    {/* Totals row */}
                                    <tr style={{height: 18}}>
                                        <td className="border border-gray-gray200 dark:border-gray-gray600 px-2 font-semibold text-gray-gray600 dark:text-gray-gray300 bg-gray-gray50 dark:bg-gray-gray700">
                                            Total
                                        </td>
                                        {BLOC_ORDER.map((blocName, blocIdx) => (
                                            <React.Fragment key={blocName}>
                                                {totals[blocName].map((count, dayIdx) => {
                                                    let cellColor = 'bg-gray-gray50 dark:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300';
                                                    if (count > 0 && count < ALERT_THRESHOLD) {
                                                        cellColor = 'bg-green-greenLight2 dark:bg-green-greenDark1 text-green-green dark:text-green-greenLight1';
                                                    } else if (count === ALERT_THRESHOLD) {
                                                        cellColor = 'bg-gray-gray800 dark:bg-gray-gray900 text-white';
                                                    } else if (count > ALERT_THRESHOLD) {
                                                        cellColor = 'bg-red-redLight2 dark:bg-red-redDark1 text-red-red dark:text-red-redLight1';
                                                    }
                                                    const blocSep = blocIdx > 0 && dayIdx === 0 ? ' border-l-2 border-l-gray-gray400 dark:border-l-gray-gray500' : '';
                                                    return (
                                                        <td
                                                            key={`${blocName}-total-${dayIdx}`}
                                                            className={`border border-gray-gray200 dark:border-gray-gray600 text-center font-semibold${blocSep} ${cellColor}`}
                                                            style={{width: 32, minWidth: 32}}
                                                        >
                                                            {count || ''}
                                                        </td>
                                                    );
                                                })}
                                            </React.Fragment>
                                        ))}
                                    </tr>
                                </tbody>
                            </React.Fragment>
                        );
                    })}
                </table>
            ))}

            {view === 'calendrier' && (
                !effectiveBlocSaison ? (
                    <p className="text-sm text-gray-gray500 dark:text-gray-gray400 text-center py-8">
                        Aucun bloc saisonnier disponible.
                    </p>
                ) : calendrierByCanal.length === 0 ? (
                    <p className="text-sm text-gray-gray500 dark:text-gray-gray400 text-center py-8">
                        Aucun événement à afficher pour {effectiveBlocSaison}.
                    </p>
                ) : (
                    <div className="space-y-6">
                        {calendrierByCanal.map((canal) => {
                            const totalCols = 1 + calendrierWeeks.length;
                            const tableWidth = 380 + calendrierWeeks.length * 36;
                            return (
                                <table
                                    key={canal.canalId}
                                    className="border-collapse text-xs"
                                    style={{tableLayout: 'fixed', width: tableWidth}}
                                >
                                    <thead>
                                        {/* Canal name + month spans */}
                                        <tr>
                                            <th
                                                className="border border-gray-gray200 dark:border-gray-gray600 bg-yellow-yellowLight2 dark:bg-yellow-yellowDark1 text-left px-2 py-1 font-semibold text-sm text-gray-gray700 dark:text-gray-gray200 truncate"
                                                style={{width: 380, minWidth: 380, maxWidth: 380}}
                                            >
                                                {canal.canalName}
                                            </th>
                                            {calendrierMonthHeaders.map((h) => (
                                                <th
                                                    key={`${canal.canalId}-${h.year}-${h.month}`}
                                                    colSpan={h.span}
                                                    className="border border-gray-gray200 dark:border-gray-gray600 bg-yellow-yellowLight2 dark:bg-yellow-yellowDark1 text-center px-1 py-1 font-semibold text-xs text-gray-gray700 dark:text-gray-gray200"
                                                >
                                                    {MONTH_NAMES_FR[h.month]} {h.year}
                                                </th>
                                            ))}
                                        </tr>
                                        {/* PROJETS + Sunday day numbers */}
                                        <tr>
                                            <th
                                                className="border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray75 dark:bg-gray-gray700 text-left px-2 py-1 font-semibold text-xs text-gray-gray600 dark:text-gray-gray300"
                                                style={{width: 380, minWidth: 380, maxWidth: 380}}
                                            >
                                                PROJETS
                                            </th>
                                            {calendrierWeeks.map((w) => (
                                                <th
                                                    key={`${canal.canalId}-day-${w.id}`}
                                                    className="border border-gray-gray200 dark:border-gray-gray600 bg-gray-gray50 dark:bg-gray-gray700 text-center px-0.5 py-0.5 font-medium text-gray-gray600 dark:text-gray-gray300"
                                                    style={{width: 36, minWidth: 36}}
                                                >
                                                    {w.dateDebut.getDate()}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {canal.events.length === 0 && (
                                            <tr>
                                                <td colSpan={totalCols} className="border border-gray-gray200 dark:border-gray-gray600 px-2 text-gray-gray400 dark:text-gray-gray500" style={{height: 18}} />
                                            </tr>
                                        )}
                                        {canal.events.map((event) => (
                                            <tr
                                                key={`${canal.canalId}-${event.eventId}`}
                                                style={{height: 22, cursor: canExpand ? 'pointer' : 'default'}}
                                                className="hover:bg-blue-blueLight3 dark:hover:bg-blue-blueDark1"
                                                onClick={() => handleRowClick(event.eventId)}
                                            >
                                                <td
                                                    className="border border-gray-gray200 dark:border-gray-gray600 px-2 truncate text-gray-gray700 dark:text-gray-gray200"
                                                    style={{width: 380, minWidth: 380, maxWidth: 380}}
                                                >
                                                    {event.eventName}
                                                </td>
                                                {calendrierWeeks.map((w) => {
                                                    const active = event.weekIds.has(w.id);
                                                    return (
                                                        <td
                                                            key={`${canal.canalId}-${event.eventId}-${w.id}`}
                                                            className={`border border-gray-gray200 dark:border-gray-gray600 ${
                                                                active
                                                                    ? 'bg-blue-blue dark:bg-blue-blueDusty'
                                                                    : ''
                                                            }`}
                                                            style={{width: 36, minWidth: 36}}
                                                        />
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            );
                        })}
                    </div>
                )
            )}
        </div>
    );
}

initializeBlock({interface: () => <RoutageApp />});
