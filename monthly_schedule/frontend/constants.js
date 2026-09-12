// Shared constants for the Odyscène hours / collective-agreement dashboard.
//
// The extension READS the four pre-computed grains (equipe_technique →
// jours_contact → heures_semaine → dispo_mois). It never recomputes the
// collective agreement: any disagreement between this screen and Airtable is a
// reading bug here, not a reason to compute something in JS.

export const SECONDS_PER_DAY = 24 * 60 * 60;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Airtable rejects more than 50 records per create/update call.
export const MAX_RECORDS_PER_CALL = 50;

// --- Tabs -------------------------------------------------------------------

export const TAB_HOURS = 'heures';
export const TAB_PAY = 'paie';
export const TAB_DISPO = 'dispo';

export const TABS = [
    {key: TAB_HOURS, label: 'Heures'},
    {key: TAB_PAY, label: 'Paie'},
    {key: TAB_DISPO, label: 'Disponibilités 9.04'},
];

// --- Period grain -----------------------------------------------------------

export const GRAIN_WEEK = 'week';
export const GRAIN_MONTH = 'month';

// Each tab pins the grain it can actually read: Paie is keyed on heures_semaine
// (one row per week) and 9.04 on dispo_mois (one row per month). Only the Heures
// tab lets the user choose, and its choice is remembered across tab switches.
export const GRAIN_BY_TAB = {
    [TAB_HOURS]: null, // user's preference wins
    [TAB_PAY]: GRAIN_WEEK,
    [TAB_DISPO]: GRAIN_MONTH,
};

// --- French labels ----------------------------------------------------------

// Weeks run Monday → Sunday here, matching the `semaines` table. Index by
// ((jsDay + 6) % 7), never by a raw getDay().
export const DAY_LABELS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export const DAY_LABELS_SHORT_FR = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

export const MONTH_LABELS_FR = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
export const MONTH_LABELS_SHORT_FR = [
    'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
    'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

// --- Collective agreement clauses -------------------------------------------

// Airtable writes these codes into the `clauses_appliquees` text fields. We only
// map a code to a label and a severity for display — the decision that a clause
// applies was already made by the scripts.
//
// severity drives one colour decision per cell, computed in utils/model.js:
//   'info'  — worked, nothing flagged
//   'warn'  — worth a look before payroll
//   'alert' — a premium that materially changes the amount owed
export const CLAUSE_INFO = {
    '4.01': {label: 'plus de 40 h dans la semaine', severity: 'alert'},
    '4.02': {label: 'heures entre 00 h et 8 h', severity: 'warn'},
    '4.03A': {label: '7e journée consécutive', severity: 'alert'},
    '4.03B': {label: 'plus de 12 h payées dans la journée', severity: 'alert'},
    '4.04': {label: 'jour férié', severity: 'warn'},
    '4.05': {label: 'majoration maintenue jusqu’à la fin de l’appel', severity: 'info'},
    '4.08': {label: 'création d’un plan d’éclairage', severity: 'info'},
    '8.01': {label: 'repas non accordé — majoration 50 %', severity: 'warn'},
    '8.02': {label: 'moins de 8 h de repos entre deux appels', severity: 'warn'},
    '9.04': {label: 'quota de disponibilités', severity: 'info'},
    '11.01': {label: 'captation — tarif spectacle double', severity: 'info'},
    '11.04': {label: 'captation audio — tarif spectacle supplémentaire', severity: 'info'},
};

export const SEVERITY_ORDER = {none: 0, info: 1, warn: 2, alert: 3};

// --- Display thresholds ------------------------------------------------------
//
// These colour the screen and nothing else. The convention itself is applied by
// Airtable; if a threshold here disagrees with what the scripts decided, the
// scripts are right and this is a display bug.
export const DEFAULT_SEUIL_HEURES_SEMAINE = 40;
export const DEFAULT_SEUIL_HEURES_JOUR = 12;
export const DEFAULT_SEUIL_JOURS_CONSECUTIFS = 7;
export const DEFAULT_SEUIL_REPOS_HEURES = 8;

// --- Shift blocks ------------------------------------------------------------

// One equipe_technique record is a role on an event and carries all three blocks
// on the SAME row. It is never one row per block.
export const SHIFT_BLOCKS = [
    {key: 'montage', label: 'Montage', inKey: 'montageInField', outKey: 'montageOutField'},
    {key: 'showcall', label: 'Show call', inKey: 'showcallInField', outKey: 'showcallOutField'},
    {key: 'demontage', label: 'Démontage', inKey: 'demontageInField', outKey: 'demontageOutField'},
];

// --- Table auto-detection needles -------------------------------------------

export const TABLE_NEEDLES = {
    shifts: ['equipe_technique', 'équipe technique', 'equipe technique', 'technique'],
    days: ['jours_contact', 'jours contact', 'jours'],
    weeks: ['heures_semaine', 'heures semaine', 'heures'],
    months: ['dispo_mois', 'dispo mois', 'dispo'],
    contacts: ['contact'],
    events: ['événement', 'evenement'],
    semaines: ['semaines'],
};
