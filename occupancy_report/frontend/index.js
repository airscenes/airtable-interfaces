import {useMemo, useState} from 'react';
import {initializeBlock, useRecords, useCustomProperties} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
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

function colorForVenue(name) {
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
//
// Each spec: {key, label, kind, needles, full?, role?, team?, count?}
//   kind    : 'text' | 'number' | 'time' | 'category' | 'date'
//   full    : render as a full-width row instead of a 2-column cell
//   role    : value derived from linked team members whose `rôle` matches any
//             of these (accent-insensitive) tokens; no custom property generated
//   team    : which linked team table to read members from ('technique'|'accueil')
//   count   : show the count of matching members instead of their names

// Day-level info shown once in the header band (assumed constant per day).
const GENERAL_SPECS = [
    {key: 'vestiaireField', label: 'Vestiaire (payant / corpo)', kind: 'text', needles: ['vestiaire']},
    {key: 'dtField', label: 'Directeur technique ESD', kind: 'text', needles: ['directeur'], role: ['directeur'], team: 'technique'},
    {key: 'gerantField', label: 'Gérant(e) de salle', kind: 'text', needles: ['gérant', 'gerant'], role: ['gerant'], team: 'accueil'},
];

// Per-event fields, in print order. Only mapped fields with a value are shown,
// so show-style and Trattoria-style events naturally render different subsets.
const EVENT_SPECS = [
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

// Specs surfaced in the daily timeline and event header (start time / artist / duration).
const DEBUT_SPEC = EVENT_SPECS.find((s) => s.key === 'debutField');
const ARTIST_SPEC = EVENT_SPECS.find((s) => s.key === 'artistField');
const DUREE_SPEC = EVENT_SPECS.find((s) => s.key === 'dureeField');

// === HELPERS ===

function parseDate(value) {
    if (value === null || value === undefined) return null;
    const str = typeof value === 'string' ? value : String(value);
    const m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const fb = new Date(str);
    if (isNaN(fb.getTime())) return null;
    fb.setHours(0, 0, 0, 0);
    return fb;
}

function dayStart(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
}

function norm(s) {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

function venueRank(name) {
    const n = norm(name);
    const idx = VENUE_PRIORITY_TOKENS.findIndex((t) => n.includes(t));
    return idx === -1 ? VENUE_PRIORITY_TOKENS.length : idx;
}

// Extract HH:MM from any time-ish string and render it as e.g. "19h30".
function fmtHeure(raw) {
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
function readTime(record, field) {
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
function fmtDurationSeconds(total) {
    const sign = total < 0 ? '-' : '';
    const t = Math.abs(Math.round(total));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    return `${sign}${h}h${String(m).padStart(2, '0')}`;
}

// Minutes since midnight from an already-formatted time like "19h30" (or "19h").
function heureToMinutes(hhmm) {
    if (!hhmm) return null;
    const m = hhmm.match(/(\d{1,2})\s*h\s*(\d{0,2})/i);
    return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
}

// Minutes from a duration string like "1h45", "2 h", "90 min".
function durationToMinutes(str) {
    if (!str) return null;
    const hm = str.match(/(\d{1,2})\s*h\s*(\d{2})/i);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
    const h = str.match(/(\d+(?:[.,]\d+)?)\s*h/i);
    if (h) return Math.round(parseFloat(h[1].replace(',', '.')) * 60);
    const min = str.match(/(\d+)\s*min/i);
    if (min) return Number(min[1]);
    return null;
}

// True when the field is a Duration, or a lookup/rollup whose result is a Duration.
function isDurationResult(field) {
    const config = field.config;
    if (config.type === FieldType.DURATION) return true;
    if (config.type === FieldType.MULTIPLE_LOOKUP_VALUES || config.type === FieldType.ROLLUP) {
        return config.options?.result?.type === FieldType.DURATION;
    }
    return false;
}

// Pull every numeric value out of an arbitrarily nested cell value (lookups return
// arrays, sometimes of {value} wrappers).
function collectNumbers(v) {
    if (typeof v === 'number') return [v];
    if (Array.isArray(v)) return v.flatMap(collectNumbers);
    if (v && typeof v === 'object' && 'value' in v) {
        return collectNumbers(v.value);
    }
    return [];
}

// Stringify any cell value, drilling into arrays and link/select object wrappers.
function stringifyCellValue(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(stringifyCellValue).filter(Boolean).join(', ');
    if (typeof v === 'object') {
        const obj = v;
        if ('name' in obj) return stringifyCellValue(obj.name);
        if ('value' in obj) return stringifyCellValue(obj.value);
        if ('label' in obj) return stringifyCellValue(obj.label);
    }
    return '';
}

// Display string for a non-time field. Formats durations (incl. duration lookups)
// and falls back to the raw value when the formatted string is empty (e.g. lookups).
function readDisplay(record, field) {
    if (isDurationResult(field)) {
        const nums = collectNumbers(record.getCellValue(field));
        if (nums.length) return nums.map(fmtDurationSeconds).join(', ');
    }
    const str = record.getCellValueAsString(field).trim();
    if (str) return str;
    return stringifyCellValue(record.getCellValue(field)).trim();
}

// Index linked-staff records by id → {name, role} for the role-based join.
function buildStaffMap(records, nameField, roleField) {
    const map = new Map();
    if (nameField && roleField) {
        for (const r of records ?? []) {
            map.set(r.id, {name: readDisplay(r, nameField), role: readDisplay(r, roleField)});
        }
    }
    return map;
}

// French long date, e.g. "dimanche 10 mai 2026".
function fmtDateFr(ms) {
    return new Intl.DateTimeFormat('fr-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(new Date(ms));
}

// === CUSTOM PROPERTIES ===

const isTextLike = (f) =>
    f.config.type === FieldType.SINGLE_LINE_TEXT ||
    f.config.type === FieldType.MULTILINE_TEXT ||
    f.config.type === FieldType.RICH_TEXT ||
    f.config.type === FieldType.SINGLE_SELECT ||
    f.config.type === FieldType.MULTIPLE_SELECTS ||
    f.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
    f.config.type === FieldType.ROLLUP;

const isNumberLike = (f) =>
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

const isDateLike = (f) =>
    f.config.type === FieldType.DATE ||
    f.config.type === FieldType.DATE_TIME ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.ROLLUP ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES ||
    f.config.type === FieldType.SINGLE_LINE_TEXT;

const isTimeLike = (f) =>
    f.config.type === FieldType.DATE_TIME ||
    f.config.type === FieldType.DURATION ||
    f.config.type === FieldType.SINGLE_LINE_TEXT ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

const isCategoryLike = (f) =>
    f.config.type === FieldType.SINGLE_SELECT ||
    f.config.type === FieldType.MULTIPLE_SELECTS ||
    f.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
    f.config.type === FieldType.SINGLE_LINE_TEXT ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.ROLLUP ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

function predicateFor(kind) {
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

function byName(table, pred, ...needles) {
    return table.fields.find((f) => pred(f) && needles.some((n) => norm(f.name).includes(norm(n))));
}

const isLinkLike = (f) => f.config.type === FieldType.MULTIPLE_RECORD_LINKS;

function getCustomProperties(base) {
    const eventsTable =
        base.tables.find((t) => norm(t.name).includes('evenement')) || base.tables[0];

    const teamTable =
        base.tables.find((t) => norm(t.name).includes('equipe_technique')) ||
        base.tables.find((t) => norm(t.name).includes('technique')) ||
        base.tables.find((t) => norm(t.name).includes('equipe')) ||
        eventsTable;

    const accueilTable =
        base.tables.find((t) => norm(t.name).includes('equipe_accueil')) ||
        base.tables.find((t) => norm(t.name).includes('accueil')) ||
        teamTable;

    const specToProp = (spec) => {
        const pred = predicateFor(spec.kind);
        return {
            key: spec.key,
            label: spec.label,
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: pred,
            defaultValue: byName(eventsTable, pred, ...spec.needles),
        };
    };

    return [
        {key: 'eventsTable', label: 'Table des événements', type: 'table', defaultValue: eventsTable},
        {
            key: 'dateField',
            label: "Date de l'événement",
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue: byName(eventsTable, isDateLike, 'date'),
        },
        {
            key: 'venueField',
            label: 'Salle / Espace',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(eventsTable, isCategoryLike, 'salle', 'espace', 'venue', 'lieu'),
        },
        {
            key: 'titleField',
            label: "Titre de l'événement",
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                byName(eventsTable, isTextLike, 'titre', 'title', 'spectacle', 'nom') || eventsTable.primaryField,
        },
        // Linked team ("equipe_technique") used to derive role-based people below.
        {key: 'teamTable', label: 'Table Équipe technique', type: 'table', defaultValue: teamTable},
        {
            key: 'teamLinkField',
            label: 'Lien Équipe technique (sur les événements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isLinkLike,
            defaultValue: byName(eventsTable, isLinkLike, 'equipe_technique', 'equipe', 'technique', 'equipier'),
        },
        {
            key: 'teamRoleField',
            label: 'Rôle (sur Équipe technique)',
            type: 'field',
            table: teamTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(teamTable, isCategoryLike, 'rôle', 'role', 'poste', 'fonction'),
        },
        {
            key: 'teamNameField',
            label: 'Nom de l’équipier (sur Équipe technique)',
            type: 'field',
            table: teamTable,
            shouldFieldBeAllowed: isTextLike,
            defaultValue:
                byName(teamTable, isTextLike, 'nom', 'name', 'équipier', 'equipier', 'contact', 'membre') ||
                teamTable.primaryField,
        },
        // Linked "Équipe accueil" used to derive the gérant·e de salle.
        {key: 'accueilTable', label: 'Table Équipe accueil', type: 'table', defaultValue: accueilTable},
        {
            key: 'accueilLinkField',
            label: 'Lien Équipe accueil (sur les événements)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isLinkLike,
            defaultValue: byName(eventsTable, isLinkLike, 'equipe_accueil', 'accueil'),
        },
        {
            key: 'accueilRoleField',
            label: 'Rôle (sur Équipe accueil)',
            type: 'field',
            table: accueilTable,
            shouldFieldBeAllowed: isCategoryLike,
            defaultValue: byName(accueilTable, isCategoryLike, 'rôle', 'role', 'poste', 'fonction'),
        },
        {
            key: 'accueilNameField',
            label: 'Nom de l’équipier (sur Équipe accueil)',
            type: 'field',
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

function LabelValue({label, value, full}) {
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

    const eventsTable = customPropertyValueByKey.eventsTable;
    const dateField = customPropertyValueByKey.dateField;
    const venueField = customPropertyValueByKey.venueField;
    const teamTable = customPropertyValueByKey.teamTable;
    const teamLinkField = customPropertyValueByKey.teamLinkField;
    const teamRoleField = customPropertyValueByKey.teamRoleField;
    const teamNameField = customPropertyValueByKey.teamNameField;
    const accueilTable = customPropertyValueByKey.accueilTable;
    const accueilLinkField = customPropertyValueByKey.accueilLinkField;
    const accueilRoleField = customPropertyValueByKey.accueilRoleField;
    const accueilNameField = customPropertyValueByKey.accueilNameField;

    const records = useRecords(eventsTable ?? null);
    const teamRecords = useRecords(teamTable ?? null);
    const accueilRecords = useRecords(accueilTable ?? null);
    const [selectedDay, setSelectedDay] = useState(null);
    const [activeVenue, setActiveVenue] = useState(null);
    const [activeEvent, setActiveEvent] = useState(null);

    // Index members of each linked staff table by record id → {name, role}.
    const staffByTeam = useMemo(
        () => ({
            technique: buildStaffMap(teamRecords, teamNameField, teamRoleField),
            accueil: buildStaffMap(accueilRecords, accueilNameField, accueilRoleField),
        }),
        [teamRecords, teamNameField, teamRoleField, accueilRecords, accueilNameField, accueilRoleField],
    );

    // Names of an event's linked members (from the given team) whose rôle matches any token.
    const namesForRole = (record, tokens, team) => {
        const linkField = team === 'accueil' ? accueilLinkField : teamLinkField;
        const staffById = staffByTeam[team];
        if (!linkField) return [];
        const links = record.getCellValue(linkField);
        if (!Array.isArray(links)) return [];
        const names = [];
        for (const link of links) {
            const id = link.id;
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
        const set = new Set();
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
        const map = {};
        for (const spec of ALL_SPECS) map[spec.key] = customPropertyValueByKey[spec.key];
        return map;
    }, [customPropertyValueByKey]);

    const readValue = (record, spec) => {
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
        const byVenue = new Map();
        for (const r of records ?? []) {
            const d = parseDate(r.getCellValueAsString(dateField));
            if (!d || dayStart(d) !== effectiveDay) continue;
            const venue = r.getCellValueAsString(venueField).trim() || 'Sans salle';
            if (!byVenue.has(venue)) byVenue.set(venue, []);
            byVenue.get(venue).push(r);
        }
        return Array.from(byVenue.entries())
            .sort((a, b) => venueRank(a[0]) - venueRank(b[0]) || a[0].localeCompare(b[0], 'fr'));
    }, [configured, effectiveDay, records, dateField, venueField]);

    // Per-venue header info (Vestiaire, Directeur technique, Gérant·e). Each field
    // is shown even when empty; the value is taken from the venue's first event
    // that fills it. These differ per venue (DT/gérant are linked per event).
    const generalInfoFor = (recs) =>
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

    // Active venue tab; falls back to the first venue when the current selection
    // is not among today's venues (e.g. after changing the day).
    const venueNames = venues.map(([v]) => v);
    const effectiveVenue = activeVenue && venueNames.includes(activeVenue) ? activeVenue : (venueNames[0] ?? null);

    const dayIndex = days.indexOf(effectiveDay);
    const today = dayStart(new Date());
    const navBtn = 'rounded border border-gray-300 bg-white px-2 py-1 text-sm enabled:hover:bg-gray-50 disabled:opacity-40';
    const arrowBtn = 'rounded border border-gray-300 bg-white px-2.5 py-1 text-lg leading-none enabled:hover:bg-gray-50 disabled:opacity-40';

    // Highlighted event in the timeline = active event of the active venue.
    const activeVenueRecs = venues.find(([v]) => v === effectiveVenue)?.[1] ?? [];
    const effectiveEventId =
        activeEvent && activeVenueRecs.some((r) => r.id === activeEvent) ? activeEvent : activeVenueRecs[0]?.id;

    // ---- Daily timeline geometry (Google-calendar-like day view) ----
    const PX_PER_MIN = 1; // vertical scale: 60px per hour
    const DEFAULT_DUR = 90; // fallback block length when the duration is unknown
    let minStart = Infinity;
    let maxEnd = -Infinity;
    const timeline = venues.map(([venue, recs]) => {
        const items = recs.map((record) => {
            const heure = DEBUT_SPEC ? readValue(record, DEBUT_SPEC) : '';
            const artist = ARTIST_SPEC ? readValue(record, ARTIST_SPEC) : '';
            const startMin = heureToMinutes(heure);
            const durMin = DUREE_SPEC ? durationToMinutes(readValue(record, DUREE_SPEC)) : null;
            const endMin = startMin !== null ? startMin + (durMin || DEFAULT_DUR) : null;
            if (startMin !== null) {
                minStart = Math.min(minStart, startMin);
                maxEnd = Math.max(maxEnd, endMin);
            }
            return {record, heure, artist, startMin, endMin};
        });
        return {venue, color: colorForVenue(venue), items};
    });
    const hasTimes = minStart !== Infinity;
    const axisStart = hasTimes ? Math.floor(minStart / 60) * 60 : 8 * 60;
    const axisEnd = hasTimes ? Math.max(axisStart + 120, Math.ceil(maxEnd / 60) * 60) : 22 * 60;
    const hourMarks = [];
    for (let h = axisStart; h <= axisEnd; h += 60) hourMarks.push(h);
    const gridHeight = (axisEnd - axisStart) * PX_PER_MIN;

    return (
        <div className="min-h-screen bg-gray-100 p-4 text-gray-900 print:min-h-0 print:bg-white print:p-0">
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
            <div className="mx-auto max-w-6xl rounded-lg bg-white p-6 shadow-sm print:max-w-none print:rounded-none print:p-0 print:shadow-none">
                <h1 className="mb-4 text-center text-lg font-semibold">
                    Rapport d&apos;occupation — <span className="capitalize">{fmtDateFr(effectiveDay)}</span>
                </h1>

                {/* Two-pane layout: timeline (1/3) + details (2/3). Print stacks and
                    shows every venue/event with one event per page. */}
                <div className="flex gap-4 print:block">
                    {/* ---- Left: daily timeline (screen only) ---- */}
                    <div className="w-1/3 shrink-0 print:hidden">
                        {/* Venue column headers */}
                        <div className="flex">
                            <div className="w-10 shrink-0" />
                            {timeline.map((col) => {
                                const active = col.venue === effectiveVenue;
                                return (
                                    <button
                                        key={col.venue}
                                        type="button"
                                        onClick={() => setActiveVenue(col.venue)}
                                        title={col.venue}
                                        className={`mx-0.5 flex-1 truncate rounded-t px-1 py-1 text-[11px] font-bold uppercase tracking-wide text-white ${
                                            active ? '' : 'opacity-50 hover:opacity-80'
                                        }`}
                                        style={{backgroundColor: col.color}}
                                    >
                                        {col.venue}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Time grid */}
                        <div className="relative flex" style={{height: `${gridHeight}px`}}>
                            {/* Hour gutter */}
                            <div className="relative w-10 shrink-0">
                                {hourMarks.map((h) => (
                                    <div
                                        key={h}
                                        className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-gray-400"
                                        style={{top: `${(h - axisStart) * PX_PER_MIN}px`}}
                                    >
                                        {h / 60}h
                                    </div>
                                ))}
                            </div>

                            {/* One column per venue */}
                            {timeline.map((col) => (
                                <div key={col.venue} className="relative mx-0.5 flex-1 border-l border-gray-200">
                                    {hourMarks.map((h) => (
                                        <div
                                            key={h}
                                            className="absolute inset-x-0 border-t border-gray-100"
                                            style={{top: `${(h - axisStart) * PX_PER_MIN}px`}}
                                        />
                                    ))}
                                    {col.items.map((it) => {
                                        if (it.startMin === null) return null;
                                        const active =
                                            col.venue === effectiveVenue && it.record.id === effectiveEventId;
                                        return (
                                            <button
                                                key={it.record.id}
                                                type="button"
                                                onClick={() => {
                                                    setActiveVenue(col.venue);
                                                    setActiveEvent(it.record.id);
                                                }}
                                                className={`absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-left text-white ${
                                                    active ? 'z-10 ring-2 ring-gray-900' : 'opacity-80 hover:opacity-100'
                                                }`}
                                                style={{
                                                    top: `${(it.startMin - axisStart) * PX_PER_MIN}px`,
                                                    height: `${Math.max(20, (it.endMin - it.startMin) * PX_PER_MIN)}px`,
                                                    backgroundColor: col.color,
                                                }}
                                            >
                                                <div className="text-[10px] font-bold leading-tight tabular-nums">{it.heure}</div>
                                                <div className="truncate text-[11px] font-semibold leading-tight">{it.artist}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>

                        {/* Events without a parsed start time */}
                        {timeline.some((col) => col.items.some((it) => it.startMin === null)) && (
                            <div className="mt-2 border-t border-gray-200 pt-2">
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                                    Sans heure
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {timeline.flatMap((col) =>
                                        col.items
                                            .filter((it) => it.startMin === null)
                                            .map((it) => (
                                                <button
                                                    key={it.record.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveVenue(col.venue);
                                                        setActiveEvent(it.record.id);
                                                    }}
                                                    className="rounded px-2 py-0.5 text-[11px] font-semibold text-white opacity-80 hover:opacity-100"
                                                    style={{backgroundColor: col.color}}
                                                >
                                                    {it.artist || col.venue}
                                                </button>
                                            )),
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ---- Right: details of the selected event ---- */}
                    <div className="min-w-0 flex-1">
                        {venues.map(([venue, recs], vIdx) => {
                            const color = colorForVenue(venue);
                            const hiddenOnScreen = venue !== effectiveVenue ? 'hidden print:block' : '';
                            // Each venue (except the first) starts a new printed page.
                            const sectionBreak = vIdx > 0 ? 'print:break-before-page' : '';
                            const multiEvents = recs.length > 1;
                            const activeEventId =
                                activeEvent && recs.some((r) => r.id === activeEvent) ? activeEvent : recs[0]?.id;
                            return (
                                <section
                                    key={venue}
                                    className={`mb-5 overflow-hidden rounded-lg border border-gray-200 last:mb-0 ${hiddenOnScreen} ${sectionBreak}`}
                                    style={{borderLeft: `6px solid ${color}`}}
                                >
                                    {/* Venue name — printed only (on screen the left column shows it). */}
                                    <div
                                        className="hidden items-center gap-2 px-3 py-2 text-white print:flex"
                                        style={{backgroundColor: color}}
                                    >
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
                                            const heure = DEBUT_SPEC ? readValue(record, DEBUT_SPEC) : '';
                                            const artist = ARTIST_SPEC ? readValue(record, ARTIST_SPEC) : '';
                                            // On screen show only the active event; print shows all.
                                            const hiddenEvent =
                                                multiEvents && record.id !== activeEventId ? 'hidden print:block' : '';
                                            // One event per printed page (venue's first event stays with the header).
                                            const pageBreak = rIdx > 0 ? 'print:break-before-page' : '';
                                            return (
                                                <div key={record.id} className={`${hiddenEvent} ${pageBreak}`}>
                                                    {(heure || artist) && (
                                                        <div className="mb-2 flex items-baseline gap-2">
                                                            {heure && (
                                                                <span className="text-sm font-bold tabular-nums text-gray-500">
                                                                    {heure}
                                                                </span>
                                                            )}
                                                            <h3 className="text-base font-semibold text-gray-900">
                                                                {artist}
                                                            </h3>
                                                        </div>
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
            </div>
        </div>
    );
}

initializeBlock({interface: () => <RapportOccupationApp />});
