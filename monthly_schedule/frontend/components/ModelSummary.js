import {fmtHours, fmtMoneyShort, fmtNumber} from '../utils/format';

// Temporary: the derived model rendered as counts, so it can be checked against
// the base before any real UI is built on top of it. Replaced by the Heures tab
// in the next commit.
export function ModelSummary({model, data, nav}) {
    const {totals, coverage, period} = model;

    return (
        <section className="rounded border border-gray-gray200 bg-white p-3 dark:border-gray-gray600 dark:bg-gray-gray700">
            <h2 className="mb-2 font-display text-sm font-semibold text-gray-gray800 dark:text-gray-gray100">
                Modèle de la période — {period.title}
            </h2>

            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
                <Stat label="Techniciens" value={fmtNumber(totals.people)} />
                <Stat label="Jours travaillés" value={fmtNumber(totals.joursTravailles)} />
                <Stat label="Heures payées" value={fmtHours(totals.heuresPayees)} />
                <Stat label="Heures réelles" value={fmtHours(totals.heuresReelles)} />
                <Stat label="Heures majorées" value={fmtHours(totals.heuresMajorees)} />
                <Stat label="Heures de nuit" value={fmtHours(totals.heuresNuit)} />
                <Stat label="Coûts" value={fmtMoneyShort(totals.couts)} />
                <Stat label="Montant total (paie)" value={fmtMoneyShort(totals.montantTotal)} />
                <Stat label="Clauses déclenchées" value={fmtNumber(totals.clauseHits)} />
                <Stat label="Techniciens en anomalie" value={fmtNumber(totals.anomalies)} />
                <Stat label="Semaines de la période" value={period.weekKeys.join(', ')} />
                <Stat label="Jours de la période" value={fmtNumber(period.days.length)} />
            </div>

            <h3 className="mb-1 mt-3 font-mono text-[10px] uppercase tracking-wider text-gray-gray500 dark:text-gray-gray400">
                Base entière
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
                <Stat label="Quarts" value={fmtNumber(data.totals.shifts)} />
                <Stat label="Lignes jours_contact" value={fmtNumber(data.totals.days)} />
                <Stat label="Lignes heures_semaine" value={fmtNumber(data.totals.weeks)} />
                <Stat label="Lignes dispo_mois" value={fmtNumber(data.totals.months)} />
            </div>

            <Coverage coverage={coverage} quality={data.quality} nav={nav} present={data.presentWeekKeys} />
        </section>
    );
}

function Stat({label, value}) {
    return (
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-gray100 py-0.5 dark:border-gray-gray600">
            <span className="truncate text-gray-gray600 dark:text-gray-gray300">{label}</span>
            <span className="shrink-0 font-mono tabular-nums text-gray-gray900 dark:text-gray-gray100">
                {value}
            </span>
        </div>
    );
}

// Data-quality findings. These are not cosmetic: a missing jours_contact row
// means a stale automation, and a shift linked to two events is filed on the
// wrong day entirely.
function Coverage({coverage, quality, nav, present}) {
    const lines = [];

    if (quality.multiEvent) {
        lines.push(
            `${quality.multiEvent} quart(s) liés à plus d’un événement — date_evenement_min est un ` +
            `rollup MIN, donc ces quarts sont classés à la mauvaise date.`,
        );
    }
    if (quality.noDate) lines.push(`${quality.noDate} quart(s) sans date exploitable.`);
    if (quality.noContact) lines.push(`${quality.noContact} quart(s) sans contact.`);
    if (quality.monthMismatch) {
        lines.push(
            `${quality.monthMismatch} quart(s) dont le champ « mois » ne correspond pas à leur date.`,
        );
    }
    if (coverage.peopleWithoutDayRow.length) {
        lines.push(
            `Aucune ligne jours_contact pour : ${coverage.peopleWithoutDayRow.join(', ')} ` +
            `— l’automatisation ne l’a pas encore créée.`,
        );
    }
    if (coverage.peopleWithoutWeekRow.length) {
        lines.push(`Aucune ligne heures_semaine pour : ${coverage.peopleWithoutWeekRow.join(', ')}.`);
    }
    if (coverage.peopleWithWeekMismatch.length) {
        lines.push(
            `Total hebdomadaire en désaccord avec les journées pour : ` +
            `${coverage.peopleWithWeekMismatch.join(', ')} — recalcul Airtable en attente.`,
        );
    }
    if (coverage.undeclaredWeeks.length) {
        lines.push(
            `Semaine(s) absente(s) de la table semaines : ${coverage.undeclaredWeeks.join(', ')} ` +
            `— les automatisations ne produiront pas de ligne heures_semaine.`,
        );
    }

    if (!lines.length) {
        return (
            <p className="mt-3 border-t border-gray-gray100 pt-2 text-xs text-green-green dark:border-gray-gray600">
                Aucun écart détecté sur cette période.
            </p>
        );
    }

    const nearest = nearestWeekWithData(present, nav.period.weekKeys[0]);

    return (
        <div className="mt-3 border-t border-gray-gray100 pt-2 dark:border-gray-gray600">
            <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-orange-orange">
                Écarts
            </h3>
            <ul className="ml-4 list-disc space-y-0.5 text-xs text-gray-gray700 dark:text-gray-gray200">
                {lines.map((l, i) => (
                    <li key={i}>{l}</li>
                ))}
            </ul>
            {nearest && nearest !== nav.period.weekKeys[0] && (
                <button
                    type="button"
                    onClick={() => nav.goToWeek(nearest)}
                    className="mt-2 text-xs font-medium text-blue-blue hover:underline dark:text-blue-blueLight1"
                >
                    Aller à la semaine du {nearest}, qui contient des données
                </button>
            )}
        </div>
    );
}

function nearestWeekWithData(present, current) {
    if (!present.length) return null;
    if (present.includes(current)) return current;
    let best = present[0];
    let bestGap = Infinity;
    for (const wk of present) {
        const gap = Math.abs(new Date(wk).getTime() - new Date(current).getTime());
        if (gap < bestGap) {
            bestGap = gap;
            best = wk;
        }
    }
    return best;
}
