// Raw grain rows -> the one object the whole UI reads.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: severity, every total and every clause
// set is computed HERE. Components never call getCellValue and never test a
// threshold. That is what keeps the chosen layout — a master list plus a detail
// panel — a rendering decision rather than a data decision, and what would make
// swapping it for a matrix a component-only change.

import {mergeClauses, highestSeverity, countClauses} from './clauses';
import {dayLabel, isWeekendIso, todayIso, weekKeyOf} from './dates';
import {SEVERITY_ORDER} from '../constants';

// A person-day with no shift and no jours_contact row: the empty cell.
function emptyCell(dateIso) {
    return {
        dateIso,
        dayRow: null,
        shifts: [],
        heures: null,
        heuresFromShifts: false,
        heuresReelles: null,
        ferie: false,
        nbAppels: null,
        heuresNuit: null,
        joursConsecutifs: null,
        reposPrecedent: null,
        couts: null,
        clauses: [],
        severity: 'none',
        isEmpty: true,
    };
}

function buildCell(dateIso, dayRow, shifts, thresholds) {
    if (!dayRow && !shifts.length) return emptyCell(dateIso);

    // Prefer the pre-computed day total. Falling back to the sum of the shifts
    // is a stopgap for a jours_contact row the automation has not created yet —
    // it is flagged, never silently substituted.
    const shiftSum = shifts.reduce(
        (acc, s) => (s.heuresPayees === null ? acc : acc + s.heuresPayees),
        0,
    );
    const hasShiftHours = shifts.some((s) => s.heuresPayees !== null);
    const dayHours = dayRow?.heuresPayees ?? null;
    const heures = dayHours !== null ? dayHours : hasShiftHours ? shiftSum : null;

    const heuresReelles = shifts.reduce(
        (acc, s) => (s.heuresReelles === null ? acc : acc + s.heuresReelles),
        0,
    );
    const couts = shifts.reduce((acc, s) => (s.couts === null ? acc : acc + s.couts), 0);

    const nuitFromShifts = shifts.reduce(
        (acc, s) => (s.heuresNuit === null ? acc : acc + s.heuresNuit),
        0,
    );
    const heuresNuit = dayRow?.heuresNuit ?? (shifts.some((s) => s.heuresNuit !== null) ? nuitFromShifts : null);

    const clauses = mergeClauses(dayRow?.clauses, ...shifts.map((s) => s.clauses));

    // One colour decision, taken here.
    //
    // The clause text written by Airtable is the authority: if the scripts said
    // 4.03 B applies, the cell is an alert whatever our display threshold says.
    // The thresholds only catch what the clause text has not (yet) named —
    // a stale automation, or a clauses field that is not configured.
    let severity = highestSeverity(clauses);
    const ferie = Boolean(dayRow?.ferie);
    const joursConsecutifs = dayRow?.joursConsecutifs ?? null;
    const reposPrecedent = dayRow?.reposPrecedent ?? null;

    const bump = (level) => {
        if (SEVERITY_ORDER[level] > SEVERITY_ORDER[severity]) severity = level;
    };

    if (heures !== null && heures >= thresholds.heuresJour) bump('alert');
    if (joursConsecutifs !== null && joursConsecutifs >= thresholds.joursConsecutifs) bump('alert');
    if (heuresNuit !== null && heuresNuit > 0) bump('warn');
    if (ferie) bump('warn');
    if (reposPrecedent !== null && reposPrecedent < thresholds.reposHeures) bump('warn');
    if (severity === 'none') severity = 'info';

    return {
        dateIso,
        dayRow: dayRow ?? null,
        shifts,
        heures,
        heuresFromShifts: dayHours === null && hasShiftHours,
        heuresReelles: shifts.some((s) => s.heuresReelles !== null) ? heuresReelles : null,
        ferie,
        nbAppels: dayRow?.nbAppels ?? null,
        heuresNuit,
        joursConsecutifs,
        reposPrecedent,
        couts: shifts.some((s) => s.couts !== null) ? couts : null,
        clauses,
        severity,
        isEmpty: false,
    };
}

export function buildPeriodModel({period, data, thresholds}) {
    const {days} = period;
    const dayIsoSet = new Set(days);
    const weekKeySet = new Set(period.weekKeys);

    // --- Index the raw rows onto the period ---------------------------------
    const shiftsByPersonDay = new Map();
    for (const s of data.shifts) {
        if (!s.contactId || !s.dateIso || !dayIsoSet.has(s.dateIso)) continue;
        const k = `${s.contactId}|${s.dateIso}`;
        const list = shiftsByPersonDay.get(k);
        if (list) list.push(s);
        else shiftsByPersonDay.set(k, [s]);
    }

    const dayByKey = new Map();
    for (const d of data.dayRows) {
        if (!dayIsoSet.has(d.dateIso)) continue;
        dayByKey.set(d.key, d);
    }

    const weekByKey = new Map();
    for (const w of data.weekRows) {
        if (!weekKeySet.has(w.weekKey)) continue;
        weekByKey.set(w.key, w);
    }

    // 9.04 is a monthly grain: in week view we still surface the row of the month
    // the week's first day falls in, so switching tabs never lands on nothing.
    const periodMonth = monthOf(period);
    const monthByContact = new Map();
    for (const m of data.monthRows) {
        if (m.monthKey !== periodMonth) continue;
        monthByContact.set(m.contactId, m);
    }

    // --- Which people are rows ------------------------------------------------
    // Anyone with a shift, a day row or a week row inside the period. Someone
    // with no trace at all this period is not a row: the tab is about the period,
    // not about the roster.
    const activeIds = new Set();
    for (const k of shiftsByPersonDay.keys()) activeIds.add(k.split('|')[0]);
    for (const d of dayByKey.values()) activeIds.add(d.contactId);
    for (const w of weekByKey.values()) activeIds.add(w.contactId);

    // --- Build one PersonPeriod per person ------------------------------------
    const people = [];
    for (const id of activeIds) {
        const person = data.people.get(id) ?? {
            id, name: '(contact inconnu)', isChef: false, salles: [], record: null,
        };

        const cells = days.map((iso) =>
            buildCell(iso, dayByKey.get(`${id}|${iso}`) ?? null, shiftsByPersonDay.get(`${id}|${iso}`) ?? [], thresholds),
        );

        const weeks = period.weekKeys.map((wk) => weekByKey.get(`${id}|${wk}`) ?? null);
        const presentWeeks = weeks.filter(Boolean);

        const worked = cells.filter((c) => !c.isEmpty);
        const totals = {
            heuresPayees: sumCells(worked, (c) => c.heures),
            heuresReelles: sumCells(worked, (c) => c.heuresReelles),
            heuresNuit: sumCells(worked, (c) => c.heuresNuit),
            nbAppels: sumCells(worked, (c) => c.nbAppels),
            couts: sumCells(worked, (c) => c.couts),
            joursTravailles: worked.length,
            heuresRegulieres: sumCells(presentWeeks, (w) => w.heuresRegulieres),
            heuresMajorees: sumCells(presentWeeks, (w) => w.heuresMajorees),
            montantRegulier: sumCells(presentWeeks, (w) => w.montantRegulier),
            montantMajore: sumCells(presentWeeks, (w) => w.montantMajore),
            montantTotal: sumCells(presentWeeks, (w) => w.montantTotal),
            totalDispo: sumCells(presentWeeks, (w) => w.totalDispo),
            clauseCounts: countClauses(cells.map((c) => c.clauses)),
        };

        // A heures_semaine row whose total disagrees with the days we can see
        // means an automation has not caught up — the single most dangerous
        // state to run payroll in, so it gets its own flag rather than hiding
        // inside a generic warning.
        const weekMismatch = presentWeeks.some((w) => {
            if (w.totalHeures === null) return false;
            const fromDays = sumCells(
                cells.filter((c) => !c.isEmpty && weekKeyOf(c.dateIso) === w.weekKey),
                (c) => c.heures,
            );
            return fromDays !== null && Math.abs(fromDays - w.totalHeures) > 0.1;
        });

        const flags = {
            hasNight: cells.some((c) => (c.heuresNuit ?? 0) > 0),
            hasFerie: cells.some((c) => c.ferie),
            hasOver12h: cells.some((c) => c.heures !== null && c.heures >= thresholds.heuresJour),
            has7thDay: cells.some(
                (c) => c.joursConsecutifs !== null && c.joursConsecutifs >= thresholds.joursConsecutifs,
            ),
            hasShortRest: cells.some(
                (c) => c.reposPrecedent !== null && c.reposPrecedent < thresholds.reposHeures,
            ),
            hasOvertime:
                (totals.heuresMajorees ?? 0) > 0 ||
                presentWeeks.some((w) => (w.totalHeures ?? 0) > thresholds.heuresSemaine),
            // Worked a day for which the automation produced no jours_contact row.
            hasMissingDayRow: cells.some((c) => !c.isEmpty && !c.dayRow),
            // Worked a week for which no heures_semaine row exists at all.
            hasMissingWeekRow: period.weekKeys.some(
                (wk, i) =>
                    !weeks[i] &&
                    cells.some((c) => !c.isEmpty && weekKeyOf(c.dateIso) === wk),
            ),
            hasWeekMismatch: weekMismatch,
            allWeeksApproved: presentWeeks.length > 0 && presentWeeks.every((w) => w.approved),
            someWeeksApproved: presentWeeks.some((w) => w.approved),
        };

        flags.hasAnomaly =
            flags.hasOvertime || flags.hasOver12h || flags.has7thDay || flags.hasShortRest ||
            flags.hasMissingDayRow || flags.hasMissingWeekRow || flags.hasWeekMismatch;

        // The worst thing about this person, for the list's severity dot.
        let severity = 'none';
        for (const c of cells) {
            if (SEVERITY_ORDER[c.severity] > SEVERITY_ORDER[severity]) severity = c.severity;
        }
        if (flags.hasOvertime || flags.hasWeekMismatch) severity = 'alert';

        people.push({
            person,
            cells,
            weeks,
            month: monthByContact.get(id) ?? null,
            totals,
            flags,
            severity,
        });
    }

    people.sort((a, b) => a.person.name.localeCompare(b.person.name, 'fr'));

    // --- Day headers ------------------------------------------------------------
    const today = todayIso();
    const dayHeaders = days.map((iso, i) => {
        const workers = people.filter((p) => !p.cells[i].isEmpty);
        const ferieCount = workers.filter((p) => p.cells[i].ferie).length;
        return {
            iso,
            index: i,
            label: dayLabel(iso),
            isToday: iso === today,
            isWeekend: isWeekendIso(iso),
            people: workers.length,
            heures: sumCells(workers, (p) => p.cells[i].heures),
            ferieCount,
            // A statutory holiday ticked for some but not all of the day's crew
            // is almost always an oversight: 4.04 is per contact-day, so a
            // missed tick under-applies the premium for that person alone.
            ferieMixed: ferieCount > 0 && ferieCount < workers.length,
        };
    });

    // --- Period totals -------------------------------------------------------------
    const totals = {
        people: people.length,
        joursTravailles: people.reduce((a, p) => a + p.totals.joursTravailles, 0),
        heuresPayees: sumCells(people, (p) => p.totals.heuresPayees),
        heuresReelles: sumCells(people, (p) => p.totals.heuresReelles),
        heuresMajorees: sumCells(people, (p) => p.totals.heuresMajorees),
        heuresNuit: sumCells(people, (p) => p.totals.heuresNuit),
        couts: sumCells(people, (p) => p.totals.couts),
        montantTotal: sumCells(people, (p) => p.totals.montantTotal),
        montantRegulier: sumCells(people, (p) => p.totals.montantRegulier),
        montantMajore: sumCells(people, (p) => p.totals.montantMajore),
        clauseCounts: countClauses(people.flatMap((p) => p.cells.map((c) => c.clauses))),
        anomalies: people.filter((p) => p.flags.hasAnomaly).length,
    };
    totals.clauseHits = Object.values(totals.clauseCounts).reduce((a, n) => a + n, 0);

    // --- Coverage, for the diagnostics banner -----------------------------------------
    const coverage = {
        peopleWithoutDayRow: people.filter((p) => p.flags.hasMissingDayRow).map((p) => p.person.name),
        peopleWithoutWeekRow: people.filter((p) => p.flags.hasMissingWeekRow).map((p) => p.person.name),
        peopleWithWeekMismatch: people.filter((p) => p.flags.hasWeekMismatch).map((p) => p.person.name),
        // Mondays inside the period that the `semaines` table does not declare:
        // the automations will not produce heures_semaine rows for them.
        undeclaredWeeks: data.declaredWeeks.size
            ? period.weekKeys.filter((wk) => !data.declaredWeeks.has(wk))
            : [],
    };

    return {period, days: dayHeaders, people, totals, coverage, index: {dayByKey, weekByKey, shiftsByPersonDay}};
}

function monthOf(period) {
    return period.grain === 'month' ? period.key : String(period.startIso ?? '').slice(0, 7);
}

// Sum, keeping null when nothing contributed — "no data" must not read as 0.
function sumCells(rows, pick) {
    let total = 0;
    let seen = false;
    for (const r of rows) {
        const v = pick(r);
        if (v === null || v === undefined || Number.isNaN(v)) continue;
        total += v;
        seen = true;
    }
    return seen ? total : null;
}

export {sumCells};
