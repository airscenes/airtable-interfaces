// The extension's whole configuration surface.
//
// Three hard constraints learned the hard way elsewhere in this repo:
//
//  1. A `type: 'field'` property whose `table` is undefined breaks the ENTIRE
//     settings panel, not just its own row. Every field property that hangs off
//     an optional table is therefore spread in conditionally.
//  2. `useRecords` throws on an undefined table, so optional tables are read
//     with the `|| fallbackTable` idiom in useGrainData.
//  3. A `type: 'string'` property is silently truncated around 255 characters,
//     so nothing here carries JSON — every scalar is a short number or an enum.
//
// Also worth remembering: `table.fields` only contains fields ticked **Visible**
// in the extension's *Données* panel. A field that exists in Airtable but is not
// ticked is simply absent here, with no error — which is why every optional
// field produces a named diagnostic downstream rather than an empty render.

import {FieldType} from '@airtable/blocks/interface/models';
import {
    TABLE_NEEDLES,
    GRAIN_WEEK,
    GRAIN_MONTH,
    TAB_HOURS,
    TAB_PAY,
    TAB_DISPO,
    DEFAULT_SEUIL_HEURES_SEMAINE,
    DEFAULT_SEUIL_HEURES_JOUR,
    DEFAULT_SEUIL_JOURS_CONSECUTIFS,
    DEFAULT_SEUIL_REPOS_HEURES,
} from '../constants';

// --- Field predicates --------------------------------------------------------

const t = (field) => field?.config?.type;

export const isTextLike = (f) =>
    t(f) === FieldType.SINGLE_LINE_TEXT ||
    t(f) === FieldType.MULTILINE_TEXT ||
    t(f) === FieldType.FORMULA ||
    t(f) === FieldType.MULTIPLE_LOOKUP_VALUES ||
    t(f) === FieldType.ROLLUP;

export const isDateLike = (f) =>
    t(f) === FieldType.DATE ||
    t(f) === FieldType.DATE_TIME ||
    t(f) === FieldType.FORMULA ||
    t(f) === FieldType.ROLLUP ||
    t(f) === FieldType.MULTIPLE_LOOKUP_VALUES ||
    t(f) === FieldType.SINGLE_LINE_TEXT;

export const isNumberLike = (f) =>
    t(f) === FieldType.NUMBER ||
    t(f) === FieldType.CURRENCY ||
    t(f) === FieldType.PERCENT ||
    t(f) === FieldType.COUNT ||
    t(f) === FieldType.AUTO_NUMBER ||
    t(f) === FieldType.DURATION ||
    t(f) === FieldType.FORMULA ||
    t(f) === FieldType.ROLLUP ||
    t(f) === FieldType.MULTIPLE_LOOKUP_VALUES;

// Strict: In/Out values are read as raw seconds-since-midnight AND written back,
// which only a Duration field round-trips.
export const isDuration = (f) => t(f) === FieldType.DURATION;

export const isCheckbox = (f) => t(f) === FieldType.CHECKBOX;

export const isLinkedRecord = (f) => t(f) === FieldType.MULTIPLE_RECORD_LINKS;

export const isCategoryLike = (f) =>
    t(f) === FieldType.SINGLE_SELECT ||
    t(f) === FieldType.MULTIPLE_SELECTS ||
    t(f) === FieldType.MULTIPLE_RECORD_LINKS ||
    t(f) === FieldType.SINGLE_LINE_TEXT ||
    t(f) === FieldType.FORMULA ||
    t(f) === FieldType.ROLLUP ||
    t(f) === FieldType.MULTIPLE_LOOKUP_VALUES;

// The approval stamp must be writable and must carry a time, so a formula or a
// plain Date will not do.
export const isWritableDateTime = (f) => t(f) === FieldType.DATE_TIME;

export const isWritableText = (f) =>
    t(f) === FieldType.SINGLE_LINE_TEXT || t(f) === FieldType.MULTILINE_TEXT;

// --- Lookup helpers ----------------------------------------------------------

const lower = (s) => String(s ?? '').toLowerCase();

function findTable(base, needles) {
    for (const needle of needles) {
        const hit = base.tables.find((tbl) => lower(tbl.name).includes(needle));
        if (hit) return hit;
    }
    return undefined;
}

// First field passing `predicate` whose name contains any of `needles`.
function byName(table, predicate, ...needles) {
    if (!table) return undefined;
    return table.fields.find(
        (f) => predicate(f) && needles.some((n) => lower(f.name).includes(n)),
    );
}

// First field passing `predicate` whose name contains ALL of `needles` and none
// of `excludes` — the only way to tell "Montage In" from "Démontage In".
function findAll(table, predicate, needles, excludes = []) {
    if (!table) return undefined;
    return table.fields.find((f) => {
        const n = lower(f.name);
        return (
            predicate(f) &&
            needles.every((x) => n.includes(x)) &&
            !excludes.some((x) => n.includes(x))
        );
    });
}

// Exact name first, then the loose needles — the base uses snake_case names we
// know, so an exact hit should always win over a substring collision.
function byExactThenName(table, predicate, exact, ...needles) {
    if (!table) return undefined;
    const hit = table.fields.find((f) => predicate(f) && lower(f.name) === lower(exact));
    return hit || byName(table, predicate, ...needles);
}

// Resolve the table a link field points at, so the table we offer is the one we
// actually write into.
function linkedTableOf(base, linkField) {
    const id = linkField?.config?.options?.linkedTableId;
    return id ? base.tables.find((tbl) => tbl.id === id) : undefined;
}

function fieldProp(key, label, table, predicate, defaultValue) {
    return {key, label, type: 'field', table, shouldFieldBeAllowed: predicate, defaultValue};
}

// --- The schema --------------------------------------------------------------

export function getCustomProperties(base) {
    // Required grain tables. `base.tables[0]` is a last-resort default so the
    // settings panel always renders; App.js refuses to draw anything until the
    // user has actually pointed each one at the right table.
    const shiftsTable = findTable(base, TABLE_NEEDLES.shifts) || base.tables[0];
    const daysTable = findTable(base, TABLE_NEEDLES.days) || base.tables[0];
    const weeksTable = findTable(base, TABLE_NEEDLES.weeks) || base.tables[0];

    // Optional tables — no fallback: undefined means "not configured", and every
    // field property below them is spread in conditionally.
    const monthsTable = findTable(base, TABLE_NEEDLES.months);
    const semainesTable = findTable(base, TABLE_NEEDLES.semaines);

    const contactLinkGuess = byName(shiftsTable, isLinkedRecord, 'contact');
    const contactsTable =
        linkedTableOf(base, contactLinkGuess) || findTable(base, TABLE_NEEDLES.contacts);

    const eventLinkGuess = byName(shiftsTable, isLinkedRecord, 'événement', 'evenement');
    const eventsTable =
        linkedTableOf(base, eventLinkGuess) || findTable(base, TABLE_NEEDLES.events);

    return [
        // ---------- Tables ----------
        {key: 'shiftsTable', label: 'Table Équipe technique (quarts)', type: 'table', defaultValue: shiftsTable},
        {key: 'daysTable', label: 'Table Jours contact', type: 'table', defaultValue: daysTable},
        {key: 'weeksTable', label: 'Table Heures semaine', type: 'table', defaultValue: weeksTable},
        {key: 'monthsTable', label: 'Table Dispo mois (9.04) — facultative', type: 'table', defaultValue: monthsTable},
        {key: 'contactsTable', label: 'Table Contacts — facultative', type: 'table', defaultValue: contactsTable},
        {key: 'eventsTable', label: 'Table Événements — facultative', type: 'table', defaultValue: eventsTable},
        {key: 'semainesTable', label: 'Table Semaines — facultative', type: 'table', defaultValue: semainesTable},

        // ---------- equipe_technique ----------
        // shiftsTable always resolves (fallback above), so these are unconditional.
        fieldProp('shiftContactLink', 'Quart — lien Contact', shiftsTable, isLinkedRecord,
            byName(shiftsTable, isLinkedRecord, 'contact')),
        fieldProp('shiftEventLink', 'Quart — lien Événement', shiftsTable, isLinkedRecord,
            byName(shiftsTable, isLinkedRecord, 'événement', 'evenement')),
        fieldProp('shiftDateField', 'Quart — date (date_evenement_min)', shiftsTable, isDateLike,
            byExactThenName(shiftsTable, isDateLike, 'date_evenement_min', 'date_evenement', 'date')),
        fieldProp('shiftRoleNameField', 'Quart — nom du rôle', shiftsTable, isTextLike,
            byExactThenName(shiftsTable, isTextLike, 'nom du rôle', 'nom du rôle', 'nom du role', 'rôle', 'role')),
        fieldProp('shiftMoisField', 'Quart — mois (AAAA-MM, contre-vérification)', shiftsTable, isTextLike,
            byExactThenName(shiftsTable, isTextLike, 'mois', 'mois')),
        fieldProp('shiftHeuresPayeesField', 'Quart — nombre d’heures (payées)', shiftsTable, isNumberLike,
            byExactThenName(shiftsTable, isNumberLike, "nombre d'heures", "nombre d'heures", 'heures_payees')),
        fieldProp('shiftHeuresReellesField', 'Quart — heures réelles', shiftsTable, isNumberLike,
            byExactThenName(shiftsTable, isNumberLike, 'heures_reelles', 'heures_reelles', 'heures réelles')),
        fieldProp('shiftHeuresShowcallField', 'Quart — heures show call', shiftsTable, isNumberLike,
            byName(shiftsTable, isNumberLike, 'heures show call', 'heures showcall')),
        fieldProp('shiftHeuresNuitField', 'Quart — heures de nuit (4.02)', shiftsTable, isNumberLike,
            byExactThenName(shiftsTable, isNumberLike, 'heures_nuit', 'heures_nuit', 'heures de nuit')),
        fieldProp('shiftTauxField', 'Quart — taux', shiftsTable, isNumberLike,
            findAll(shiftsTable, isNumberLike, ['taux'], ['showcall', 'show call'])),
        fieldProp('shiftTauxShowcallField', 'Quart — taux show call', shiftsTable, isNumberLike,
            byName(shiftsTable, isNumberLike, 'taux_showcall', 'taux show call')),
        fieldProp('shiftCoutsField', 'Quart — coûts', shiftsTable, isNumberLike,
            byName(shiftsTable, isNumberLike, 'coût', 'cout')),
        fieldProp('shiftNbAppelsField', 'Quart — nb d’appels (9.04)', shiftsTable, isNumberLike,
            byName(shiftsTable, isNumberLike, 'nb_appels', "nb d'appels")),
        fieldProp('shiftClausesField', 'Quart — clauses appliquées', shiftsTable, isTextLike,
            byName(shiftsTable, isTextLike, 'clauses')),
        fieldProp('shiftDisponibleField', 'Quart — contact disponible (portail)', shiftsTable, isCheckbox,
            byName(shiftsTable, isCheckbox, 'disponible')),

        // The three In/Out pairs. Strict Duration: these are both read as raw
        // seconds and written back, and a rollup would silently fail to save.
        fieldProp('montageInField', 'Montage — In', shiftsTable, isDuration,
            findAll(shiftsTable, isDuration, ['montage', 'in'], ['démontage', 'demontage'])),
        fieldProp('montageOutField', 'Montage — Out', shiftsTable, isDuration,
            findAll(shiftsTable, isDuration, ['montage', 'out'], ['démontage', 'demontage'])),
        fieldProp('showcallInField', 'Show call — In', shiftsTable, isDuration,
            findAll(shiftsTable, isDuration, ['show call', 'in']) ||
            findAll(shiftsTable, isDuration, ['showcall', 'in'])),
        fieldProp('showcallOutField', 'Show call — Out', shiftsTable, isDuration,
            findAll(shiftsTable, isDuration, ['show call', 'out']) ||
            findAll(shiftsTable, isDuration, ['showcall', 'out'])),
        fieldProp('demontageInField', 'Démontage — In', shiftsTable, isDuration,
            findAll(shiftsTable, isDuration, ['démontage', 'in']) ||
            findAll(shiftsTable, isDuration, ['demontage', 'in'])),
        fieldProp('demontageOutField', 'Démontage — Out', shiftsTable, isDuration,
            findAll(shiftsTable, isDuration, ['démontage', 'out']) ||
            findAll(shiftsTable, isDuration, ['demontage', 'out'])),

        // Meals. `Diner` / `Souper` give the START of the break; the duration is
        // a single select ("30 min" / "60 min"). A 30-minute break is PAID
        // (art. 8.01), so only the 60-minute one is deducted — by Airtable, not
        // by us.
        fieldProp('dinerField', 'Dîner — début', shiftsTable, isNumberLike,
            byExactThenName(shiftsTable, isNumberLike, 'diner', 'dîner', 'diner')),
        fieldProp('dureeDinerField', 'Dîner — durée', shiftsTable, isCategoryLike,
            byName(shiftsTable, isCategoryLike, 'duree_diner', 'durée_diner', 'duree diner')),
        fieldProp('souperField', 'Souper — début', shiftsTable, isNumberLike,
            byExactThenName(shiftsTable, isNumberLike, 'souper', 'souper')),
        fieldProp('dureeSouperField', 'Souper — durée', shiftsTable, isCategoryLike,
            byName(shiftsTable, isCategoryLike, 'duree_souper', 'durée_souper', 'duree souper')),

        // ---------- jours_contact ----------
        fieldProp('dayContactLink', 'Jour — lien Contact', daysTable, isLinkedRecord,
            byName(daysTable, isLinkedRecord, 'contact')),
        fieldProp('dayDateField', 'Jour — date', daysTable, isDateLike,
            byExactThenName(daysTable, isDateLike, 'date', 'date')),
        // The only manual input in the whole calculation, and the one write that
        // matters most: art. 4.04 is applied per contact-day.
        fieldProp('dayFerieField', 'Jour — férié (4.04, case à cocher)', daysTable, isCheckbox,
            byName(daysTable, isCheckbox, 'ferie', 'férié')),
        fieldProp('dayHeuresPayeesField', 'Jour — heures payées', daysTable, isNumberLike,
            byExactThenName(daysTable, isNumberLike, 'heures_payees', 'heures_payees', 'heures payées')),
        fieldProp('dayHeuresNuitField', 'Jour — heures de nuit', daysTable, isNumberLike,
            byExactThenName(daysTable, isNumberLike, 'heures_nuit', 'heures_nuit')),
        fieldProp('dayNbAppelsField', 'Jour — nb d’appels', daysTable, isNumberLike,
            byName(daysTable, isNumberLike, 'nb_appels')),
        fieldProp('dayDebutField', 'Jour — début', daysTable, isNumberLike,
            byName(daysTable, isNumberLike, 'debut_jour', 'début_jour')),
        fieldProp('dayFinField', 'Jour — fin', daysTable, isNumberLike,
            byName(daysTable, isNumberLike, 'fin_jour')),
        fieldProp('dayJoursConsecutifsField', 'Jour — jours consécutifs (4.03 A)', daysTable, isNumberLike,
            byName(daysTable, isNumberLike, 'consecutif', 'consécutif')),
        fieldProp('dayReposPrecedentField', 'Jour — repos précédent (8.02)', daysTable, isNumberLike,
            byName(daysTable, isNumberLike, 'repos')),
        fieldProp('dayClausesField', 'Jour — clauses appliquées', daysTable, isTextLike,
            byName(daysTable, isTextLike, 'clauses')),

        // ---------- heures_semaine ----------
        fieldProp('weekContactLink', 'Semaine — lien Contact', weeksTable, isLinkedRecord,
            byName(weeksTable, isLinkedRecord, 'contact')),
        // The join key to the period: always a Monday.
        fieldProp('weekDateSemaineField', 'Semaine — date de la semaine (lundi)', weeksTable, isDateLike,
            byExactThenName(weeksTable, isDateLike, 'date_semaine', 'date_semaine', 'date')),
        fieldProp('weekSemaineField', 'Semaine — libellé / lien semaine', weeksTable, isCategoryLike,
            byExactThenName(weeksTable, isCategoryLike, 'semaine', 'semaine')),
        fieldProp('weekTotalHeuresField', 'Semaine — total des heures', weeksTable, isNumberLike,
            byExactThenName(weeksTable, isNumberLike, 'total_heures', 'total_heures')),
        fieldProp('weekHeuresField', 'Semaine — heures (arrondi)', weeksTable, isNumberLike,
            byExactThenName(weeksTable, isNumberLike, 'heures', 'heures')),
        fieldProp('weekHeuresRegulieresField', 'Semaine — heures régulières', weeksTable, isNumberLike,
            byName(weeksTable, isNumberLike, 'heures_regulieres', 'heures régulières')),
        fieldProp('weekHeuresMajoreesField', 'Semaine — heures majorées (4.01)', weeksTable, isNumberLike,
            byName(weeksTable, isNumberLike, 'heures_majorees', 'heures majorées')),
        fieldProp('weekMontantRegulierField', 'Semaine — montant régulier', weeksTable, isNumberLike,
            byName(weeksTable, isNumberLike, 'montant_regulier', 'montant régulier')),
        fieldProp('weekMontantMajoreField', 'Semaine — montant majoré', weeksTable, isNumberLike,
            byName(weeksTable, isNumberLike, 'montant_majore', 'montant majoré')),
        fieldProp('weekMontantTotalField', 'Semaine — montant total', weeksTable, isNumberLike,
            byName(weeksTable, isNumberLike, 'montant_total')),
        fieldProp('weekTotalDispoField', 'Semaine — total des disponibilités', weeksTable, isNumberLike,
            byName(weeksTable, isNumberLike, 'total_dispo')),
        fieldProp('weekClausesField', 'Semaine — clauses appliquées', weeksTable, isTextLike,
            byName(weeksTable, isTextLike, 'clauses')),

        // Payroll approval. Both fields must be CREATED in Airtable first — see
        // the README. Absent, the whole approval feature hides itself and a
        // banner spells out what to create.
        fieldProp('weekApprovedAtField', 'Paie — approuvée le (champ Date avec heure à créer)',
            weeksTable, isWritableDateTime,
            byName(weeksTable, isWritableDateTime, 'paie_approuvee_le', 'approuv')),
        fieldProp('weekApprovedByField', 'Paie — approuvée par', weeksTable, isWritableText,
            byName(weeksTable, isWritableText, 'paie_approuvee_par', 'approuvee_par', 'approuvée par')),

        // ---------- dispo_mois (optional table) ----------
        ...(monthsTable
            ? [
                fieldProp('monthContactLink', '9.04 — lien Contact', monthsTable, isLinkedRecord,
                    byName(monthsTable, isLinkedRecord, 'contact')),
                fieldProp('monthMoisField', '9.04 — mois (AAAA-MM)', monthsTable, isTextLike,
                    byExactThenName(monthsTable, isTextLike, 'mois', 'mois')),
                fieldProp('monthAppelsPrevusField', '9.04 — appels prévus', monthsTable, isNumberLike,
                    byName(monthsTable, isNumberLike, 'appels_prevus', 'appels prévus')),
                fieldProp('monthAppelsDisponiblesField', '9.04 — appels disponibles', monthsTable, isNumberLike,
                    byName(monthsTable, isNumberLike, 'appels_disponibles', 'appels disponibles')),
                fieldProp('monthCategorieField', '9.04 — catégorie', monthsTable, isCategoryLike,
                    byName(monthsTable, isCategoryLike, 'categorie_904', 'catégorie', 'categorie')),
                fieldProp('monthQuotaField', '9.04 — quota requis', monthsTable, isNumberLike,
                    byName(monthsTable, isNumberLike, 'quota')),
                fieldProp('monthPourcentageField', '9.04 — pourcentage atteint', monthsTable, isNumberLike,
                    byName(monthsTable, isNumberLike, 'pourcentage')),
                fieldProp('monthStatutField', '9.04 — statut', monthsTable, isCategoryLike,
                    byName(monthsTable, isCategoryLike, 'statut')),
            ]
            : []),

        // ---------- Contacts (optional table) ----------
        ...(contactsTable
            ? [
                fieldProp('contactNameField', 'Contact — nom complet', contactsTable, isTextLike,
                    byExactThenName(contactsTable, isTextLike, 'nom complet', 'nom complet', 'nom')),
                fieldProp('contactChefField', 'Contact — chef (case à cocher)', contactsTable, isCheckbox,
                    byName(contactsTable, isCheckbox, 'chef')),
                fieldProp('contactSallesField', 'Contact — salles', contactsTable, isCategoryLike,
                    byName(contactsTable, isCategoryLike, 'salle')),
                fieldProp('contactCategorie904Field', 'Contact — catégorie 9.04', contactsTable, isCategoryLike,
                    byName(contactsTable, isCategoryLike, 'categorie_904', 'catégorie 9.04')),
            ]
            : []),

        // ---------- Événements (optional table) ----------
        ...(eventsTable
            ? [
                fieldProp('eventDateField', 'Événement — date', eventsTable, isDateLike,
                    byName(eventsTable, isDateLike, "date de l'événement", 'date')),
                fieldProp('eventSalleField', 'Événement — salle', eventsTable, isCategoryLike,
                    byName(eventsTable, isCategoryLike, 'nom de la salle', 'salle')),
                fieldProp('eventNameField', 'Événement — nom', eventsTable, isTextLike,
                    byName(eventsTable, isTextLike, 'identifiant_court', 'titre', 'nom')),
                fieldProp('eventNbAppelsField', 'Événement — nb d’appels techniciens', eventsTable, isNumberLike,
                    byName(eventsTable, isNumberLike, 'nb_appels_techniciens', 'nb_appels')),
            ]
            : []),

        // ---------- semaines (optional table) ----------
        // Used for the week label and for one genuinely useful warning — a Monday
        // with no row here means the automations will not produce a
        // heures_semaine line. Never used for navigation: the 226 pre-created
        // weeks must not bound what the user can look at.
        ...(semainesTable
            ? [
                fieldProp('semaineDebutField', 'Semaines — date du lundi', semainesTable, isDateLike,
                    byName(semainesTable, isDateLike, 'lundi', 'debut', 'début', 'date')),
                fieldProp('semaineLabelField', 'Semaines — libellé', semainesTable, isTextLike,
                    byName(semainesTable, isTextLike, 'semaine', 'nom')),
            ]
            : []),

        // ---------- Scalars ----------
        {
            key: 'defaultTab',
            label: 'Onglet par défaut',
            type: 'enum',
            possibleValues: [
                {value: TAB_HOURS, label: 'Heures'},
                {value: TAB_PAY, label: 'Paie'},
                {value: TAB_DISPO, label: 'Disponibilités 9.04'},
            ],
            defaultValue: TAB_HOURS,
        },
        {
            key: 'defaultGrain',
            label: 'Granularité par défaut (onglet Heures)',
            type: 'enum',
            possibleValues: [
                {value: GRAIN_WEEK, label: 'Semaine'},
                {value: GRAIN_MONTH, label: 'Mois'},
            ],
            defaultValue: GRAIN_WEEK,
        },

        // Display thresholds. These colour the screen and nothing else — the
        // convention is applied by Airtable, and these only decide when to draw
        // attention to what it already decided.
        {key: 'seuilHeuresSemaine', label: 'Seuil heures / semaine (4.01)', type: 'string',
            defaultValue: String(DEFAULT_SEUIL_HEURES_SEMAINE)},
        {key: 'seuilHeuresJour', label: 'Seuil heures / jour (4.03 B)', type: 'string',
            defaultValue: String(DEFAULT_SEUIL_HEURES_JOUR)},
        {key: 'seuilJoursConsecutifs', label: 'Seuil jours consécutifs (4.03 A)', type: 'string',
            defaultValue: String(DEFAULT_SEUIL_JOURS_CONSECUTIFS)},
        {key: 'seuilReposHeures', label: 'Seuil de repos entre appels (8.02)', type: 'string',
            defaultValue: String(DEFAULT_SEUIL_REPOS_HEURES)},
    ];
}

// A threshold property is a short string. Accept a comma decimal, and fall back
// to the documented default rather than propagating NaN into a colour rule.
export function readThreshold(value, fallback) {
    const n = Number(String(value ?? '').replace(',', '.').trim());
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
