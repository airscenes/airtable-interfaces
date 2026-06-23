import {useMemo, useState} from 'react';
import {initializeBlock, useRecords, useCustomProperties} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import type {Base, Table, Field, Record as AirtableRecord} from '@airtable/blocks/interface/models';
import './style.css';

// ============================================================================
// Rapport d'occupation journalier — Espace Saint-Denis
// ----------------------------------------------------------------------------
// One page per day. For the selected day, each venue ("salle") that hosts at
// least one event is rendered as a section with the production-sheet fields
// from the PDF model. Venues with no event that day are omitted entirely.
// ============================================================================

// === CONSTANTS ===

// Per-venue color palette (Airtable-style, matching the schedule grid look).
// A stable hash maps each venue name to one color so a venue keeps its color.
const VENUE_COLORS = ['#7c3aed', '#0ea5e9', '#2563eb', '#0d9488', '#ea580c', '#db2777', '#16a34a', '#dc2626'];

function colorForVenue(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return VENUE_COLORS[h % VENUE_COLORS.length];
}

// Preferred venue ordering; tokens are matched (lowercased, accent-stripped)
// against the venue name. Unknown venues fall through alphabetically.
const VENUE_PRIORITY_TOKENS = ['denis', 'trattoria', 'cabaret'];

// === FIELD SPECS ===
// A single source of truth driving both the custom-property definitions and
// the rendering. `kind` selects the field-type filter + value formatting.

type Kind = 'text' | 'number' | 'time' | 'category' | 'date';

interface Spec {
    key: string;
    label: string; // label as printed on the production sheet
    kind: Kind;
    needles: string[]; // substrings used to auto-detect the default field
    full?: boolean; // render as a full-width row instead of a 2-column cell
    // When set, the value is NOT read from a mapped field: it is derived from the
    // linked team members whose `rôle` matches any of these (accent-insensitive)
    // tokens. No field custom-property is generated for such specs.
    role?: string[];
    // For role specs: which linked team table to read members from.
    team?: 'technique' | 'accueil';
    // For role specs: show the count of matching members instead of their names.
    count?: boolean;
}

// Day-level info shown once in the header band (assumed constant per day).
const GENERAL_SPECS: Spec[] = [
    {key: 'vestiaireField', label: 'Vestiaire (payant / corpo)', kind: 'text', needles: ['vestiaire']},
    {key: 'dtField', label: 'Directeur technique ESD', kind: 'text', needles: ['directeur'], role: ['directeur'], team: 'technique'},
    {key: 'gerantField', label: 'Gérant(e) de salle', kind: 'text', needles: ['gérant', 'gerant'], role: ['gerant'], team: 'accueil'},
];

// Per-event fields, in print order. Only mapped fields with a value are shown,
// so show-style and Trattoria-style events naturally render different subsets.
const EVENT_SPECS: Spec[] = [
    {key: 'artistField', label: 'Artiste / Production', kind: 'text', needles: ['artiste', 'production'], full: true},
    {key: 'contactField', label: 'Contact production', kind: 'text', needles: ['contact']},
    {key: 'configField', label: 'Configuration', kind: 'number', needles: ['configuration', 'config']},
    {key: 'ticketsField', label: 'Billets vendus', kind: 'number', needles: ['billet', 'vendu']},
    {key: 'portesField', label: 'Portes', kind: 'time', needles: ['porte']},
    {key: 'debutField', label: 'Début', kind: 'time', needles: ['début', 'debut', 'représentation', 'representation']},
    {key: 'dureeField', label: 'Durée du spectacle', kind: 'text', needles: ['durée', 'duree']},
    {key: 'entracteField', label: 'Entracte', kind: 'text', needles: ['entracte']},
    {key: 'premiereField', label: 'Première partie', kind: 'text', needles: ['première', 'premiere'], full: true},
    {key: 'placiersField', label: 'Placiers (nombre)', kind: 'text', needles: ['placier'], role: ['placier', 'senior'], team: 'accueil', count: true},
    {key: 'securiteField', label: 'Sécurité (nombre)', kind: 'text', needles: ['sécurité', 'securite'], role: ['secur'], count: true},
    {key: 'barsField', label: 'Bars ouverts (nombre)', kind: 'number', needles: ['bar']},
    {key: 'personnelBarsField', label: 'Personnel aux bars', kind: 'text', needles: ['personnel']},
    {key: 'merchPreposeField', label: 'Marchandise – préposé', kind: 'text', needles: ['préposé', 'prepose']},
    {key: 'merchTpvField', label: 'Marchandise – TPV', kind: 'text', needles: ['tpv']},
    {key: 'relocField', label: 'Relocalisation', kind: 'text', needles: ['relocalisation', 'reloc']},
    {key: 'photoVideoField', label: 'Photo & vidéo', kind: 'text', needles: ['photo']},
    {key: 'messageField', label: "Message d'accueil", kind: 'text', needles: ['message', 'accueil'], full: true},
    // Trattoria / corporate-style fields
    {key: 'clientField', label: 'Client', kind: 'text', needles: ['client']},
    {key: 'responsableField', label: 'Responsable Molière', kind: 'text', needles: ['responsable', 'molière', 'moliere']},
    {key: 'nbPersonnesField', label: 'Nombre de personnes', kind: 'number', needles: ['personnes']},
    {key: 'typeEvenementField', label: "Type d'événement", kind: 'text', needles: ["type d'", 'type evenement', "type d’"]},
    {key: 'notesField', label: 'Mentions spéciales / Notes', kind: 'text', needles: ['mention', 'note'], full: true},
];

const ALL_SPECS = [...GENERAL_SPECS, ...EVENT_SPECS];

// === HELPERS ===

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

function dayStart(d: Date): number {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
}

function norm(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

function venueRank(name: string): number {
    const n = norm(name);
    const idx = VENUE_PRIORITY_TOKENS.findIndex((t) => n.includes(t));
    return idx === -1 ? VENUE_PRIORITY_TOKENS.length : idx;
}

// Extract HH:MM from any time-ish string and render it as e.g. "19h30".
function fmtHeure(raw: string): string {
    const ampm = raw.match(/(\d{1,2}):(\d{2})\s*([ap])\.?m/i);
    if (ampm) {
        let h = Number(ampm[1]) % 12;
        if (/p/i.test(ampm[3])) h += 12;
        return `${h}h${ampm[2]}`;
    }
    const m = raw.match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
    return m ? `${Number(m[1])}h${m[2]}` : raw;
}

// Read a time value. Prefer the field's formatted string when it already shows a
// time; otherwise (e.g. a date-time field displayed as date-only) fall back to the
// raw date-time value and extract HH:MM in the browser's local timezone.
function readTime(record: AirtableRecord, field: Field): string {
    const str = record.getCellValueAsString(field).trim();
    if (/\d{1,2}\s*[:hH]\s*\d{2}/.test(str)) return fmtHeure(str);
    if (field.config.type === FieldType.DATE_TIME) {
        const v = record.getCellValue(field);
        if (typeof v === 'string') {
            const d = new Date(v);
            if (!isNaN(d.getTime())) return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;
        }
    }
    return str;
}

// Format a number of seconds as e.g. "1h45".
function fmtDurationSeconds(total: number): string {
    const sign = total < 0 ? '-' : '';
    const t = Math.abs(Math.round(total));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    return `${sign}${h}h${String(m).padStart(2, '0')}`;
}

// True when the field is a Duration, or a lookup/rollup whose result is a Duration.
function isDurationResult(field: Field): boolean {
    const config = field.config as {type: string; options?: {result?: {type?: string}}};
    if (config.type === FieldType.DURATION) return true;
    if (config.type === FieldType.MULTIPLE_LOOKUP_VALUES || config.type === FieldType.ROLLUP) {
        return config.options?.result?.type === FieldType.DURATION;
    }
    return false;
}

// Pull every numeric value out of an arbitrarily nested cell value (lookups return
// arrays, sometimes of {value} wrappers).
function collectNumbers(v: unknown): number[] {
    if (typeof v === 'number') return [v];
    if (Array.isArray(v)) return v.flatMap(collectNumbers);
    if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
        return collectNumbers((v as Record<string, unknown>).value);
    }
    return [];
}

// Stringify any cell value, drilling into arrays and link/select object wrappers.
function stringifyCellValue(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(stringifyCellValue).filter(Boolean).join(', ');
    if (typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        if ('name' in obj) return stringifyCellValue(obj.name);
        if ('value' in obj) return stringifyCellValue(obj.value);
        if ('label' in obj) return stringifyCellValue(obj.label);
    }
    return '';
}

// Display string for a non-time field. Formats durations (incl. duration lookups)
// and falls back to the raw value when the formatted string is empty (e.g. lookups).
function readDisplay(record: AirtableRecord, field: Field): string {
    if (isDurationResult(field)) {
        const nums = collectNumbers(record.getCellValue(field));
        if (nums.length) return nums.map(fmtDurationSeconds).join(', ');
    }
    const str = record.getCellValueAsString(field).trim();
    if (str) return str;
    return stringifyCellValue(record.getCellValue(field)).trim();
}

// Index linked-staff records by id → {name, role} for the role-based join.
function buildStaffMap(
    records: ReadonlyArray<AirtableRecord> | null,
    nameField: Field | undefined,
    roleField: Field | undefined,
): Map<string, {name: string; role: string}> {
    const map = new Map<string, {name: string; role: string}>();
    if (nameField && roleField) {
        for (const r of records ?? []) {
            map.set(r.id, {name: readDisplay(r, nameField), role: readDisplay(r, roleField)});
        }
    }
    return map;
}

// French long date, e.g. "dimanche 10 mai 2026".
function fmtDateFr(ms: number): string {
    return new Intl.DateTimeFormat('fr-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(new Date(ms));
}

// === CUSTOM PROPERTIES ===

type FieldLike = {config: {type: string}};

const isTextLike = (f: FieldLike) =>
    f.config.type === FieldType.SINGLE_LINE_TEXT ||
    f.config.type === FieldType.MULTILINE_TEXT ||
    f.config.type === FieldType.RICH_TEXT ||
    f.config.type === FieldType.SINGLE_SELECT ||
    f.config.type === FieldType.MULTIPLE_SELECTS ||
    f.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
    f.config.type === FieldType.ROLLUP;

const isNumberLike = (f: FieldLike) =>
    f.config.type === FieldType.NUMBER ||
    f.config.type === FieldType.PERCENT ||
    f.config.type === FieldType.CURRENCY ||
    f.config.type === FieldType.AUTO_NUMBER ||
    f.config.type === FieldType.RATING ||
    f.config.type === FieldType.COUNT ||
    f.config.type === FieldType.SINGLE_LINE_TEXT ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.ROLLUP ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

const isDateLike = (f: FieldLike) =>
    f.config.type === FieldType.DATE ||
    f.config.type === FieldType.DATE_TIME ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.ROLLUP ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
    f.config.type === FieldType.SINGLE_LINE_TEXT;

const isTimeLike = (f: FieldLike) =>
    f.config.type === FieldType.DATE_TIME ||
    f.config.type === FieldType.DURATION ||
    f.config.type === FieldType.SINGLE_LINE_TEXT ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

const isCategoryLike = (f: FieldLike) =>
    f.config.type === FieldType.SINGLE_SELECT ||
    f.config.type === FieldType.MULTIPLE_SELECTS ||
    f.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
    f.config.type === FieldType.SINGLE_LINE_TEXT ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.ROLLUP ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

function predicateFor(kind: Kind): (f: FieldLike) => boolean {
    switch (kind) {
        case 'number':
            return isNumberLike;
        case 'time':
            return isTimeLike;
        case 'category':
            return isCategoryLike;
        case 'date':
            return isDateLike;
        default:
            return isTextLike;
    }
}

function byName(table: Table, pred: (f: FieldLike) => boolean, ...needles: string[]): Field | undefined {
    return table.fields.find((f: Field) => pred(f) && needles.some((n) => norm(f.name).includes(norm(n))));
}

const isLinkLike = (f: FieldLike) => f.config.type === FieldType.MULTIPLE_RECORD_LINKS;

function getCustomProperties(base: Base) {
    const eventsTable =
        base.tables.find((t: Table) => norm(t.name).includes('evenement')) || base.tables[0];

    const teamTable =
        base.tables.find((t: Table) => norm(t.name).includes('equipe_technique')) ||
        base.tables.find((t: Table) => norm(t.name).includes('technique')) ||
        base.tables.find((t: Table) => norm(t.name).includes('equipe')) ||
        eventsTable;

    const accueilTable =
        base.tables.find((t: Table) => norm(t.name).includes('equipe_accueil')) ||
        base.tables.find((t: Table) => norm(t.name).includes('accueil')) ||
        teamTable;

    const specToProp = (spec: Spec) => {
        const pred = predicateFor(spec.kind);
        return {
            key: spec.key,
            label: spec.label,
            type: 'field' as const,
            table: eventsTable,
            shouldFieldBeAllowed: pred,
            defaultValue: byName(eventsTable, pred, ...spec.needles),
        };
    };

    return [
        {key: 'eventsTable', label: 'Table des événements', type: 'table' as const, defaultValue: eventsTable},
        {
            key: 'dateField',
            label: "Date de l'événement",
            type: 'field' as const,
            table: eventsTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue: byName(eventsTable, isDateLike, 'date'),
        },
        {
            key: 'venueField',
            label: 'Salle / Espace',
            type: 'field' as const,
            table: eventsTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(eventsTable, isCategoryLike, 'salle', 'espace', 'venue', 'lieu'),
        },
        {
            key: 'titleField',
            label: "Titre de l'événement",
            type: 'field' as const,
            table: eventsTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                byName(eventsTable, isTextLike, 'titre', 'title', 'spectacle', 'nom') || eventsTable.primaryField,
        },
        // Linked team ("equipe_technique") used to derive role-based people below.
        {key: 'teamTable', label: 'Table Équipe technique', type: 'table' as const, defaultValue: teamTable},
        {
            key: 'teamLinkField',
            label: 'Lien Équipe technique (sur les événements)',
            type: 'field' as const,
            table: eventsTable,
            shouldFieldBeAllowed: isLinkLike,
            defaultValue: byName(eventsTable, isLinkLike, 'equipe_technique', 'equipe', 'technique', 'equipier'),
        },
        {
            key: 'teamRoleField',
            label: 'Rôle (sur Équipe technique)',
            type: 'field' as const,
            table: teamTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(teamTable, isCategoryLike, 'rôle', 'role', 'poste', 'fonction'),
        },
        {
            key: 'teamNameField',
            label: 'Nom de l’équipier (sur Équipe technique)',
            type: 'field' as const,
            table: teamTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                byName(teamTable, isTextLike, 'nom', 'name', 'équipier', 'equipier', 'contact', 'membre') ||
                teamTable.primaryField,
        },
        // Linked "Équipe accueil" used to derive the gérant·e de salle.
        {key: 'accueilTable', label: 'Table Équipe accueil', type: 'table' as const, defaultValue: accueilTable},
        {
            key: 'accueilLinkField',
            label: 'Lien Équipe accueil (sur les événements)',
            type: 'field' as const,
            table: eventsTable,
            shouldFieldBeAllowed: isLinkLike,
            defaultValue: byName(eventsTable, isLinkLike, 'equipe_accueil', 'accueil'),
        },
        {
            key: 'accueilRoleField',
            label: 'Rôle (sur Équipe accueil)',
            type: 'field' as const,
            table: accueilTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(accueilTable, isCategoryLike, 'rôle', 'role', 'poste', 'fonction'),
        },
        {
            key: 'accueilNameField',
            label: 'Nom de l’équipier (sur Équipe accueil)',
            type: 'field' as const,
            table: accueilTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                byName(accueilTable, isTextLike, 'nom', 'name', 'équipier', 'equipier', 'contact', 'membre') ||
                accueilTable.primaryField,
        },
        // Only field-backed specs become custom properties; role-derived specs
        // (dt, gérant, placiers, sécurité) are computed from the team links.
        ...ALL_SPECS.filter((s) => !s.role).map(specToProp),
    ];
}

// === RENDERING HELPERS ===

function LabelValue({label, value, full}: {label: string; value: string; full?: boolean}) {
    return (
        <div className={full ? 'col-span-2' : ''}>
            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
            <div className="min-h-[1.75rem] whitespace-pre-wrap rounded bg-[#eef1f8] px-2 py-1 text-[13px] text-gray-900">
                {value}
            </div>
        </div>
    );
}


// === MAIN APP ===

function RapportOccupationApp() {
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const eventsTable = customPropertyValueByKey.eventsTable as Table | undefined;
    const dateField = customPropertyValueByKey.dateField as Field | undefined;
    const venueField = customPropertyValueByKey.venueField as Field | undefined;
    const titleField = customPropertyValueByKey.titleField as Field | undefined;
    const teamTable = customPropertyValueByKey.teamTable as Table | undefined;
    const teamLinkField = customPropertyValueByKey.teamLinkField as Field | undefined;
    const teamRoleField = customPropertyValueByKey.teamRoleField as Field | undefined;
    const teamNameField = customPropertyValueByKey.teamNameField as Field | undefined;
    const accueilTable = customPropertyValueByKey.accueilTable as Table | undefined;
    const accueilLinkField = customPropertyValueByKey.accueilLinkField as Field | undefined;
    const accueilRoleField = customPropertyValueByKey.accueilRoleField as Field | undefined;
    const accueilNameField = customPropertyValueByKey.accueilNameField as Field | undefined;

    const records = useRecords((eventsTable ?? null) as Table);
    const teamRecords = useRecords((teamTable ?? null) as Table);
    const accueilRecords = useRecords((accueilTable ?? null) as Table);
    const [selectedDay, setSelectedDay] = useState<number | null>(null);

    // Index members of each linked staff table by record id → {name, role}.
    const staffByTeam = useMemo(
        () => ({
            technique: buildStaffMap(teamRecords, teamNameField, teamRoleField),
            accueil: buildStaffMap(accueilRecords, accueilNameField, accueilRoleField),
        }),
        [teamRecords, teamNameField, teamRoleField, accueilRecords, accueilNameField, accueilRoleField],
    );

    // Names of an event's linked members (from the given team) whose rôle matches any token.
    const namesForRole = (record: AirtableRecord, tokens: string[], team: 'technique' | 'accueil'): string[] => {
        const linkField = team === 'accueil' ? accueilLinkField : teamLinkField;
        const staffById = staffByTeam[team];
        if (!linkField) return [];
        const links = record.getCellValue(linkField);
        if (!Array.isArray(links)) return [];
        const names: string[] = [];
        for (const link of links) {
            const id = (link as {id?: string}).id;
            const member = id ? staffById.get(id) : undefined;
            if (member && tokens.some((t) => norm(member.role).includes(t)) && member.name) {
                names.push(member.name);
            }
        }
        return names;
    };

    const configured = Boolean(eventsTable && dateField && venueField);

    // Distinct days that have at least one event, ascending.
    const days = useMemo(() => {
        const set = new Set<number>();
        if (configured && dateField) {
            for (const r of records ?? []) {
                const d = parseDate(r.getCellValueAsString(dateField));
                if (d) set.add(dayStart(d));
            }
        }
        return Array.from(set).sort((a, b) => a - b);
    }, [configured, records, dateField]);

    // Default to today if it has events, else the most recent day with events.
    const effectiveDay = useMemo(() => {
        if (selectedDay !== null && days.includes(selectedDay)) return selectedDay;
        const today = dayStart(new Date());
        if (days.includes(today)) return today;
        return days.length ? days[days.length - 1] : null;
    }, [selectedDay, days]);

    // Resolve the mapped Field for each spec key once.
    const fieldByKey = useMemo(() => {
        const map: Record<string, Field | undefined> = {};
        for (const spec of ALL_SPECS) map[spec.key] = customPropertyValueByKey[spec.key] as Field | undefined;
        return map;
    }, [customPropertyValueByKey]);

    const readValue = (record: AirtableRecord, spec: Spec): string => {
        if (spec.role) {
            const names = namesForRole(record, spec.role, spec.team ?? 'technique');
            if (spec.count) return names.length ? String(names.length) : '';
            return names.join(', ');
        }
        const field = fieldByKey[spec.key];
        if (!field) return '';
        if (spec.kind === 'time') return readTime(record, field);
        return readDisplay(record, field);
    };

    // Events of the selected day, grouped by venue and ordered by priority.
    const venues = useMemo(() => {
        if (!configured || effectiveDay === null || !dateField || !venueField) return [];
        const byVenue = new Map<string, AirtableRecord[]>();
        for (const r of records ?? []) {
            const d = parseDate(r.getCellValueAsString(dateField));
            if (!d || dayStart(d) !== effectiveDay) continue;
            const venue = r.getCellValueAsString(venueField).trim() || 'Sans salle';
            if (!byVenue.has(venue)) byVenue.set(venue, []);
            byVenue.get(venue)!.push(r);
        }
        return Array.from(byVenue.entries())
            .sort((a, b) => venueRank(a[0]) - venueRank(b[0]) || a[0].localeCompare(b[0], 'fr'));
    }, [configured, effectiveDay, records, dateField, venueField]);

    // Per-venue header info (Vestiaire, Directeur technique, Gérant·e). Each field
    // is shown even when empty; the value is taken from the venue's first event
    // that fills it. These differ per venue (DT/gérant are linked per event).
    const generalInfoFor = (recs: AirtableRecord[]) =>
        GENERAL_SPECS.map((spec) => {
            let value = '';
            for (const r of recs) {
                const v = readValue(r, spec);
                if (v) {
                    value = v;
                    break;
                }
            }
            return {label: spec.label, value};
        });

    if (errorState) {
        return <div className="p-4 text-sm text-red-600">{errorState.error?.message ?? 'Erreur de configuration'}</div>;
    }

    if (!configured) {
        return (
            <div className="p-4 text-sm text-gray-600">
                Configurez l&apos;extension dans le panneau de réglages : table des événements, champ
                <span className="font-semibold"> Date</span> et champ <span className="font-semibold">Salle / Espace</span>.
            </div>
        );
    }

    if (effectiveDay === null) {
        return <div className="p-4 text-sm text-gray-600">Aucun événement daté dans la table sélectionnée.</div>;
    }

    const dayIndex = days.indexOf(effectiveDay);
    const today = dayStart(new Date());
    const navBtn = 'rounded border border-gray-300 bg-white px-2 py-1 text-sm enabled:hover:bg-gray-50 disabled:opacity-40';
    const arrowBtn = 'rounded border border-gray-300 bg-white px-2.5 py-1 text-lg leading-none enabled:hover:bg-gray-50 disabled:opacity-40';

    return (
        <div className="min-h-screen bg-gray-100 p-4 text-gray-900">
            {/* Toolbar (hidden when printing) */}
            <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
                <label className="text-sm text-gray-600">Journée :</label>
                <button
                    type="button"
                    className={arrowBtn}
                    disabled={dayIndex <= 0}
                    onClick={() => dayIndex > 0 && setSelectedDay(days[dayIndex - 1])}
                    aria-label="Journée précédente"
                >
                    {'<'}
                </button>
                <select
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                    value={effectiveDay}
                    onChange={(e) => setSelectedDay(Number(e.target.value))}
                >
                    {days.map((ms) => (
                        <option key={ms} value={ms}>
                            {fmtDateFr(ms)}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    className={arrowBtn}
                    disabled={dayIndex < 0 || dayIndex >= days.length - 1}
                    onClick={() => dayIndex < days.length - 1 && setSelectedDay(days[dayIndex + 1])}
                    aria-label="Journée suivante"
                >
                    {'>'}
                </button>
                <button
                    type="button"
                    className={navBtn}
                    disabled={!days.includes(today)}
                    onClick={() => setSelectedDay(today)}
                >
                    Aujourd&apos;hui
                </button>
                <button
                    type="button"
                    onClick={() => window.print()}
                    className="ml-auto rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-50"
                >
                    Imprimer
                </button>
            </div>

            {/* Sheet */}
            <div className="mx-auto max-w-4xl rounded-lg bg-white p-6 shadow-sm">
                <h1 className="mb-4 text-center text-lg font-semibold">
                    Rapport d&apos;occupation — <span className="capitalize">{fmtDateFr(effectiveDay)}</span>
                </h1>

                {/* One color-coded section per venue */}
                {venues.map(([venue, recs], vIdx) => {
                    const color = colorForVenue(venue);
                    return (
                        <section
                            key={venue}
                            className="mb-5 overflow-hidden rounded-lg border border-gray-200 last:mb-0"
                            style={{borderLeft: `6px solid ${color}`}}
                        >
                            <div
                                className="flex items-center gap-2 px-3 py-2 text-white"
                                style={{backgroundColor: color}}
                            >
                                <span className="flex h-6 w-6 items-center justify-center rounded bg-white/25 text-xs font-bold">
                                    {vIdx + 1}
                                </span>
                                <h2 className="text-sm font-bold uppercase tracking-wide">{venue}</h2>
                            </div>

                            {/* Venue header info: Vestiaire, Directeur technique, Gérant·e */}
                            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                                <div className="grid grid-cols-3 gap-x-6 gap-y-2">
                                    {generalInfoFor(recs).map((f) => (
                                        <LabelValue key={f.label} label={f.label} value={f.value} />
                                    ))}
                                </div>
                            </div>

                            <div className="px-4 py-3">
                                {recs.map((record, rIdx) => {
                                    const title = titleField ? readDisplay(record, titleField) : '';
                                    return (
                                        <div
                                            key={record.id}
                                            className={rIdx > 0 ? 'mt-3 border-t border-dashed border-gray-200 pt-3' : ''}
                                        >
                                            {title && (
                                                <h3 className="mb-2 text-base font-semibold text-gray-900">{title}</h3>
                                            )}
                                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                                {EVENT_SPECS.map((spec) => (
                                                    <LabelValue
                                                        key={spec.key}
                                                        label={spec.label}
                                                        value={readValue(record, spec)}
                                                        full={Boolean(spec.full)}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}

initializeBlock({interface: () => <RapportOccupationApp />});
