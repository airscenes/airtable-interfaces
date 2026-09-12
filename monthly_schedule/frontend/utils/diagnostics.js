// Never fail silently.
//
// `table.fields` only contains fields ticked **Visible** in the extension's
// *Données* panel, so a mis-configuration looks exactly like "there is no data":
// a column quietly disappears and a colour rule quietly stops firing. Every
// optional property therefore names itself here, with the consequence spelled
// out, rather than letting the screen lie by omission.

import {TAB_HOURS, TAB_PAY, TAB_DISPO} from '../constants';

// key → what breaks when it is not configured. Order is the order shown.
const OPTIONAL_FIELDS = [
    // --- Heures ---
    {key: 'shiftEventLink', tab: TAB_HOURS,
        label: 'Quart — lien Événement',
        effect: 'le détail d’un quart n’affiche ni l’événement ni la salle.'},
    {key: 'shiftRoleNameField', tab: TAB_HOURS,
        label: 'Quart — nom du rôle',
        effect: 'les quarts s’affichent sans leur rôle.'},
    {key: 'shiftHeuresReellesField', tab: TAB_HOURS,
        label: 'Quart — heures réelles',
        effect: 'la colonne Δ disparaît — impossible de voir l’effet du minimum de 4 h.'},
    {key: 'shiftHeuresNuitField', tab: TAB_HOURS,
        label: 'Quart — heures de nuit',
        effect: 'les heures de nuit (4.02) ne sont plus totalisées au niveau du quart.'},
    {key: 'shiftCoutsField', tab: TAB_HOURS,
        label: 'Quart — coûts',
        effect: 'l’indicateur Coûts et la colonne Coûts disparaissent.'},
    {key: 'shiftClausesField', tab: TAB_HOURS,
        label: 'Quart — clauses appliquées',
        effect: 'aucune pastille de clause au niveau du quart.'},

    {key: 'dayFerieField', tab: TAB_HOURS,
        label: 'Jour — férié (4.04)',
        effect: 'la case férié est en lecture seule : impossible de marquer un jour férié depuis l’extension.'},
    {key: 'dayHeuresPayeesField', tab: TAB_HOURS,
        label: 'Jour — heures payées',
        effect: 'les heures d’une journée sont recalculées en sommant ses quarts, ce qui peut diverger de jours_contact.'},
    {key: 'dayJoursConsecutifsField', tab: TAB_HOURS,
        label: 'Jour — jours consécutifs',
        effect: 'l’alerte 7e journée consécutive (4.03 A) ne se déclenche plus.'},
    {key: 'dayReposPrecedentField', tab: TAB_HOURS,
        label: 'Jour — repos précédent',
        effect: 'l’avertissement de repos court (8.02) ne se déclenche plus.'},
    {key: 'dayClausesField', tab: TAB_HOURS,
        label: 'Jour — clauses appliquées',
        effect: 'aucune pastille de clause au niveau de la journée.'},

    // --- Paie ---
    {key: 'weekHeuresRegulieresField', tab: TAB_PAY,
        label: 'Semaine — heures régulières',
        effect: 'la colonne Heures régulières disparaît.'},
    {key: 'weekHeuresMajoreesField', tab: TAB_PAY,
        label: 'Semaine — heures majorées (4.01)',
        effect: 'les heures majorées ne sont plus affichées ni totalisées.'},
    {key: 'weekMontantTotalField', tab: TAB_PAY,
        label: 'Semaine — montant total',
        effect: 'la masse salariale de la semaine ne peut pas être calculée.'},
    {key: 'weekClausesField', tab: TAB_PAY,
        label: 'Semaine — clauses appliquées',
        effect: 'aucune pastille de clause au niveau de la semaine.'},
];

// Optional tables and what they gate.
const OPTIONAL_TABLES = [
    {key: 'monthsTable', label: 'Table Dispo mois', tab: TAB_DISPO,
        effect: 'l’onglet Disponibilités 9.04 est vide — c’est la seule source du calcul de quota.'},
    {key: 'contactsTable', label: 'Table Contacts', tab: TAB_HOURS,
        effect: 'les techniciens sont nommés d’après le champ lien, et les filtres Chef / Salle disparaissent.'},
    {key: 'eventsTable', label: 'Table Événements', tab: TAB_HOURS,
        effect: 'le détail d’un quart n’affiche pas la salle de l’événement.'},
    {key: 'semainesTable', label: 'Table Semaines', tab: TAB_PAY,
        effect: 'pas de libellé de semaine, et aucun avertissement quand une semaine n’existe pas dans la table.'},
];

export function buildDiagnostics(cp) {
    const items = [];

    for (const tbl of OPTIONAL_TABLES) {
        if (!cp[tbl.key]) {
            items.push({
                level: 'warn',
                tab: tbl.tab,
                title: `${tbl.label} n’est pas configurée`,
                effect: tbl.effect,
            });
        }
    }

    for (const f of OPTIONAL_FIELDS) {
        // Skip fields whose table itself is missing — the table diagnostic above
        // already explains it, and repeating it per field is noise.
        if (f.key.startsWith('month') && !cp.monthsTable) continue;
        if (f.key.startsWith('event') && !cp.eventsTable) continue;
        if (!cp[f.key]) {
            items.push({
                level: 'warn',
                tab: f.tab,
                title: `« ${f.label} » n’est pas configuré`,
                effect: f.effect,
            });
        }
    }

    // The payroll lock needs a field that does not exist in a fresh base, so its
    // diagnostic carries the creation recipe rather than a generic complaint.
    if (!cp.weekApprovedAtField) {
        items.push({
            level: 'warn',
            tab: TAB_PAY,
            title: 'Approbation de la paie indisponible',
            effect:
                'créez sur heures_semaine un champ Date avec heure nommé « paie_approuvee_le » ' +
                '(fuseau America/Toronto, 24 h, même fuseau pour tous les collaborateurs), ' +
                'cochez-le Visible dans le panneau Données, puis sélectionnez-le dans la propriété ' +
                '« Paie — approuvée le ».',
        });
    }

    return items;
}

// Which In/Out pairs can actually be edited. A pair is editable only when BOTH
// members resolved to a Duration field — anything else would fail to save.
export function writableBlocks(cp, shiftBlocks) {
    return shiftBlocks.filter((b) => cp[b.inKey] && cp[b.outKey]);
}
