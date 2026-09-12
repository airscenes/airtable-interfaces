// All record reading, in one place.
//
// Every table is loaded whole (useRecords has no filtering in the interface
// SDK) and turned into plain row objects once. Everything downstream — the
// period model, the three tabs — works on those objects and never touches
// getCellValue again.
//
// Optional tables use the `|| fallbackTable` idiom: useRecords throws on an
// undefined table and hooks cannot be conditional, so we read a table that
// always exists and ignore the result when the real one is not configured.

import {useMemo} from 'react';
import {useRecords} from '@airtable/blocks/interface/ui';
import {
    getCellDateIso,
    getColSelect,
    readCheckbox,
    readDurationSeconds,
    readHours,
    readLinked,
    readLinkedIds,
    readNumber,
    readText,
    safeCellValue,
    sumOrNull,
} from '../utils/airtable';
import {parseClauses} from '../utils/clauses';
import {monthKeyOf, weekKeyOf} from '../utils/dates';
import {SHIFT_BLOCKS} from '../constants';

export function useGrainData(base, cp) {
    const shiftsTable = cp.shiftsTable;
    const daysTable = cp.daysTable;
    const weeksTable = cp.weeksTable;

    const shiftRecords = useRecords(shiftsTable);
    const dayRecords = useRecords(daysTable);
    const weekRecords = useRecords(weeksTable);
    const monthRecords = useRecords(cp.monthsTable || shiftsTable);
    const contactRecords = useRecords(cp.contactsTable || shiftsTable);
    const eventRecords = useRecords(cp.eventsTable || shiftsTable);
    const semaineRecords = useRecords(cp.semainesTable || shiftsTable);

    // --- Contacts ----------------------------------------------------------
    // Names come from the Contacts table when it is configured; otherwise from
    // the {id, name} pairs already carried by the link cells, which is enough to
    // label a row without loading another table.
    const peopleById = useMemo(() => {
        const map = new Map();
        if (!cp.contactsTable) return map;
        for (const r of contactRecords) {
            map.set(r.id, {
                id: r.id,
                record: r,
                name: readText(r, cp.contactNameField) || r.name || '(sans nom)',
                isChef: readCheckbox(r, cp.contactChefField),
                salles: cp.contactSallesField
                    ? readLinked(r, cp.contactSallesField).map((l) => l.name).filter(Boolean)
                    : [],
                categorie904: readText(r, cp.contactCategorie904Field),
            });
        }
        return map;
    }, [
        cp.contactsTable, cp.contactNameField, cp.contactChefField,
        cp.contactSallesField, cp.contactCategorie904Field, contactRecords,
    ]);

    // --- Events -------------------------------------------------------------
    const eventsById = useMemo(() => {
        const map = new Map();
        if (!cp.eventsTable) return map;
        for (const r of eventRecords) {
            const salle = getColSelect(r, cp.eventSalleField, base);
            map.set(r.id, {
                id: r.id,
                record: r,
                dateIso: getCellDateIso(r, cp.eventDateField),
                salle: salle.text,
                salleColor: salle.color,
                name: readText(r, cp.eventNameField) || r.name || '',
                nbAppels: readNumber(r, cp.eventNbAppelsField),
            });
        }
        return map;
    }, [
        base, cp.eventsTable, cp.eventDateField, cp.eventSalleField,
        cp.eventNameField, cp.eventNbAppelsField, eventRecords,
    ]);

    // --- Weeks declared in the `semaines` table -------------------------------
    // Only used to label a week and to warn when the Monday on screen has no row
    // here — which means the automations will not produce a heures_semaine line.
    const declaredWeeks = useMemo(() => {
        const map = new Map();
        if (!cp.semainesTable || !cp.semaineDebutField) return map;
        for (const r of semaineRecords) {
            const iso = getCellDateIso(r, cp.semaineDebutField);
            const key = weekKeyOf(iso);
            if (key) map.set(key, {id: r.id, label: readText(r, cp.semaineLabelField) || r.name || ''});
        }
        return map;
    }, [cp.semainesTable, cp.semaineDebutField, cp.semaineLabelField, semaineRecords]);

    // --- Shifts ---------------------------------------------------------------
    // One record = one role on one event for one contact, carrying all three
    // blocks on the SAME row. Never one row per block.
    const shifts = useMemo(() => {
        const out = [];
        for (const r of shiftRecords) {
            const contactIds = readLinkedIds(r, cp.shiftContactLink);
            const eventIds = cp.shiftEventLink ? readLinkedIds(r, cp.shiftEventLink) : [];
            const dateIso = getCellDateIso(r, cp.shiftDateField);
            const linkedContact = readLinked(r, cp.shiftContactLink)[0] ?? null;

            const blocks = SHIFT_BLOCKS.map((b) => {
                const inField = cp[b.inKey];
                const outField = cp[b.outKey];
                const inSec = inField ? readDurationSeconds(r, inField) : null;
                const outSec = outField ? readDurationSeconds(r, outField) : null;
                return {
                    key: b.key,
                    label: b.label,
                    inField,
                    outField,
                    inSec,
                    outSec,
                    // Configurable and writable only when BOTH members resolved:
                    // a half-configured pair cannot be saved coherently.
                    configured: Boolean(inField && outField),
                    filled: inSec !== null || outSec !== null,
                };
            });

            out.push({
                id: r.id,
                record: r,
                contactId: contactIds[0] ?? null,
                contactName: linkedContact?.name ?? '',
                multiContact: contactIds.length > 1,
                eventId: eventIds[0] ?? null,
                // date_evenement_min is a rollup MIN: a shift linked to two
                // events on different dates collapses to one date and is filed
                // on the wrong day. Count them so the diagnostics can say so.
                multiEvent: eventIds.length > 1,
                dateIso,
                weekKey: weekKeyOf(dateIso),
                monthKey: monthKeyOf(dateIso),
                // The `mois` formula is a cross-check, never the source of truth.
                declaredMonth: readText(r, cp.shiftMoisField) || null,
                roleName: readText(r, cp.shiftRoleNameField),
                heuresPayees: readNumber(r, cp.shiftHeuresPayeesField),
                heuresReelles: readNumber(r, cp.shiftHeuresReellesField),
                heuresShowcall: readNumber(r, cp.shiftHeuresShowcallField),
                heuresNuit: readNumber(r, cp.shiftHeuresNuitField),
                taux: readNumber(r, cp.shiftTauxField),
                tauxShowcall: readNumber(r, cp.shiftTauxShowcallField),
                couts: readNumber(r, cp.shiftCoutsField),
                nbAppels: readNumber(r, cp.shiftNbAppelsField),
                blocks,
                diner: readDurationSeconds(r, cp.dinerField),
                dureeDiner: readText(r, cp.dureeDinerField),
                souper: readDurationSeconds(r, cp.souperField),
                dureeSouper: readText(r, cp.dureeSouperField),
                disponible: readCheckbox(r, cp.shiftDisponibleField),
                clauses: parseClauses(
                    cp.shiftClausesField ? String(safeCellValue(r, cp.shiftClausesField) ?? '') : '',
                ),
            });
        }
        return out;
    }, [shiftRecords, cp]);

    // --- Day rows ---------------------------------------------------------------
    const dayRows = useMemo(() => {
        const out = [];
        for (const r of dayRecords) {
            const contactId = readLinkedIds(r, cp.dayContactLink)[0] ?? null;
            const dateIso = getCellDateIso(r, cp.dayDateField);
            if (!contactId || !dateIso) continue;
            out.push({
                id: r.id,
                record: r,
                key: `${contactId}|${dateIso}`,
                contactId,
                dateIso,
                weekKey: weekKeyOf(dateIso),
                monthKey: monthKeyOf(dateIso),
                ferie: readCheckbox(r, cp.dayFerieField),
                heuresPayees: readNumber(r, cp.dayHeuresPayeesField),
                heuresNuit: readNumber(r, cp.dayHeuresNuitField),
                nbAppels: readNumber(r, cp.dayNbAppelsField),
                debutSec: readNumber(r, cp.dayDebutField),
                finSec: readNumber(r, cp.dayFinField),
                joursConsecutifs: readNumber(r, cp.dayJoursConsecutifsField),
                // In hours, whichever way the field was configured — see readHours.
                reposPrecedent: readHours(r, cp.dayReposPrecedentField),
                clauses: parseClauses(
                    cp.dayClausesField ? String(safeCellValue(r, cp.dayClausesField) ?? '') : '',
                ),
            });
        }
        return out;
    }, [dayRecords, cp]);

    // --- Week rows ----------------------------------------------------------------
    const weekRows = useMemo(() => {
        const out = [];
        for (const r of weekRecords) {
            const contactId = readLinkedIds(r, cp.weekContactLink)[0] ?? null;
            // Join on the Monday derived from date_semaine, not on the semaine
            // link's label: the label is free text and the Monday is not.
            const weekKey = weekKeyOf(getCellDateIso(r, cp.weekDateSemaineField));
            if (!contactId || !weekKey) continue;

            const approvedAt = cp.weekApprovedAtField
                ? safeCellValue(r, cp.weekApprovedAtField)
                : null;

            out.push({
                id: r.id,
                record: r,
                key: `${contactId}|${weekKey}`,
                contactId,
                weekKey,
                monthKey: monthKeyOf(weekKey),
                semaineLabel: readText(r, cp.weekSemaineField),
                totalHeures: readNumber(r, cp.weekTotalHeuresField),
                heures: readNumber(r, cp.weekHeuresField),
                heuresRegulieres: readNumber(r, cp.weekHeuresRegulieresField),
                heuresMajorees: readNumber(r, cp.weekHeuresMajoreesField),
                montantRegulier: readNumber(r, cp.weekMontantRegulierField),
                montantMajore: readNumber(r, cp.weekMontantMajoreField),
                montantTotal: readNumber(r, cp.weekMontantTotalField),
                totalDispo: readNumber(r, cp.weekTotalDispoField),
                clauses: parseClauses(
                    cp.weekClausesField ? String(safeCellValue(r, cp.weekClausesField) ?? '') : '',
                ),
                approvedAt: approvedAt ?? null,
                approvedBy: readText(r, cp.weekApprovedByField),
                approved: Boolean(approvedAt),
            });
        }
        return out;
    }, [weekRecords, cp]);

    // --- Month rows (9.04) ------------------------------------------------------------
    const monthRows = useMemo(() => {
        const out = [];
        if (!cp.monthsTable || !cp.monthContactLink || !cp.monthMoisField) return out;
        for (const r of monthRecords) {
            const contactId = readLinkedIds(r, cp.monthContactLink)[0] ?? null;
            const monthKey = readText(r, cp.monthMoisField);
            if (!contactId || !monthKey) continue;
            const statut = getColSelect(r, cp.monthStatutField, base);
            out.push({
                id: r.id,
                record: r,
                key: `${contactId}|${monthKey}`,
                contactId,
                monthKey,
                appelsPrevus: readNumber(r, cp.monthAppelsPrevusField),
                appelsDisponibles: readNumber(r, cp.monthAppelsDisponiblesField),
                categorie904: readText(r, cp.monthCategorieField),
                quotaRequis: readNumber(r, cp.monthQuotaField),
                pourcentage: readNumber(r, cp.monthPourcentageField),
                statut: statut.text,
                statutColor: statut.color,
            });
        }
        return out;
    }, [base, monthRecords, cp]);

    // --- Person directory -------------------------------------------------------------
    // Everyone who appears anywhere, named as well as we can. A contact with
    // rows but no Contacts record still gets a usable label.
    const people = useMemo(() => {
        const map = new Map();
        const ensure = (id, fallbackName) => {
            if (!id) return null;
            let p = map.get(id);
            if (!p) {
                const known = peopleById.get(id);
                p = known
                    ? {...known}
                    : {id, record: null, name: fallbackName || '(contact inconnu)', isChef: false, salles: [], categorie904: ''};
                map.set(id, p);
            } else if (p.name === '(contact inconnu)' && fallbackName) {
                p.name = fallbackName;
            }
            return p;
        };

        for (const s of shifts) ensure(s.contactId, s.contactName);
        for (const d of dayRows) ensure(d.contactId, '');
        for (const w of weekRows) ensure(w.contactId, '');
        for (const m of monthRows) ensure(m.contactId, '');
        return map;
    }, [peopleById, shifts, dayRows, weekRows, monthRows]);

    // --- Totals used by empty states and navigation shortcuts ---------------------------
    const presentWeekKeys = useMemo(() => {
        const set = new Set();
        for (const s of shifts) if (s.weekKey) set.add(s.weekKey);
        for (const w of weekRows) set.add(w.weekKey);
        return Array.from(set).sort();
    }, [shifts, weekRows]);

    const presentMonthKeys = useMemo(() => {
        const set = new Set();
        for (const s of shifts) if (s.monthKey) set.add(s.monthKey);
        for (const m of monthRows) set.add(m.monthKey);
        return Array.from(set).sort();
    }, [shifts, monthRows]);

    // --- Data-quality counts -----------------------------------------------------------
    const quality = useMemo(() => {
        let multiEvent = 0;
        let noDate = 0;
        let noContact = 0;
        let monthMismatch = 0;
        for (const s of shifts) {
            if (s.multiEvent) multiEvent++;
            if (!s.dateIso) noDate++;
            if (!s.contactId) noContact++;
            if (s.declaredMonth && s.monthKey && s.declaredMonth !== s.monthKey) monthMismatch++;
        }
        return {multiEvent, noDate, noContact, monthMismatch, shiftCount: shifts.length};
    }, [shifts]);

    return {
        shifts, dayRows, weekRows, monthRows,
        people, eventsById, declaredWeeks,
        presentWeekKeys, presentMonthKeys, quality,
        totals: {
            shifts: shifts.length,
            days: dayRows.length,
            weeks: weekRows.length,
            months: monthRows.length,
            people: people.size,
        },
    };
}

// Sum a numeric property across rows, keeping null when nothing was summed.
export function sumBy(rows, pick) {
    return sumOrNull(rows.map(pick));
}
