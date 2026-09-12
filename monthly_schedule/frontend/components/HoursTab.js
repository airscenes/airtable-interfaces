import {useEffect, useMemo, useState} from 'react';
import {fmtHours, fmtMoneyShort, fmtNumber, fmtPercent} from '../utils/format';
import {KpiRow} from './KpiRow';
import {HoursList} from './HoursList';
import {HoursPanel} from './HoursPanel';
import {EmptyState, LinkButton} from './EmptyState';

// Stacks to one column below lg, so the panel keeps its table width instead of
// being crushed next to the list.
const SPLIT = 'grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,268px)_minmax(0,1fr)]';

export function HoursTab({model, data, cp, thresholds, nav, canExpandShifts}) {
    const [selectedId, setSelectedId] = useState(null);
    const [search, setSearch] = useState('');
    const [chefsOnly, setChefsOnly] = useState(false);
    const [salle, setSalle] = useState('');
    const [anomaliesOnly, setAnomaliesOnly] = useState(false);

    const salles = useMemo(() => {
        const set = new Set();
        for (const p of model.people) for (const s of p.person.salles) set.add(s);
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
    }, [model.people]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return model.people.filter((p) => {
            if (q && !p.person.name.toLowerCase().includes(q)) return false;
            if (chefsOnly && !p.person.isChef) return false;
            if (salle && !p.person.salles.includes(salle)) return false;
            if (anomaliesOnly && !p.flags.hasAnomaly) return false;
            return true;
        });
    }, [model.people, search, chefsOnly, salle, anomaliesOnly]);

    // Keep a selection alive across period and filter changes: land on the first
    // row rather than on an empty panel, and never stay pointed at someone the
    // current filter has hidden.
    useEffect(() => {
        if (!filtered.length) {
            if (selectedId !== null) setSelectedId(null);
            return;
        }
        if (!filtered.some((p) => p.person.id === selectedId)) {
            setSelectedId(filtered[0].person.id);
        }
    }, [filtered, selectedId]);

    const entry = filtered.find((p) => p.person.id === selectedId) ?? null;

    const {totals} = model;
    const majPct =
        totals.heuresPayees && totals.heuresMajorees
            ? (totals.heuresMajorees / totals.heuresPayees) * 100
            : null;

    const kpis = [
        {label: 'Heures payées', value: fmtHours(totals.heuresPayees), unit: 'h'},
        {
            label: 'Heures majorées 4.01',
            value: fmtHours(totals.heuresMajorees),
            unit: 'h',
            tone: (totals.heuresMajorees ?? 0) > 0 ? 'alert' : undefined,
            hint: majPct !== null ? `${fmtPercent(majPct, 1)} du total` : null,
        },
        {label: 'Jours travaillés', value: fmtNumber(totals.joursTravailles)},
        {label: 'Techniciens actifs', value: fmtNumber(totals.people)},
        cp.shiftCoutsField ? {label: 'Coûts', value: fmtMoneyShort(totals.couts)} : null,
        {
            label: 'Clauses déclenchées',
            value: fmtNumber(totals.clauseHits),
            tone: totals.clauseHits > 0 ? 'warn' : undefined,
            hint: totals.anomalies ? `${totals.anomalies} technicien(s) en anomalie` : null,
        },
    ];

    if (!model.people.length) {
        return (
            <EmptyStatePeriod nav={nav} data={data} />
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <KpiRow items={kpis} />

            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-gray700 dark:text-gray-gray200">
                <input
                    id="ms-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher un technicien…"
                    aria-label="Rechercher un technicien"
                    className="rounded border border-gray-gray300 bg-white px-2 py-1 text-xs dark:border-gray-gray600 dark:bg-gray-gray800 dark:text-gray-gray100"
                />
                {salles.length > 0 && (
                    <select
                        id="ms-salle"
                        value={salle}
                        onChange={(e) => setSalle(e.target.value)}
                        aria-label="Salle"
                        className="rounded border border-gray-gray300 bg-white px-2 py-1 text-xs dark:border-gray-gray600 dark:bg-gray-gray800 dark:text-gray-gray100"
                    >
                        <option value="">Toutes les salles</option>
                        {salles.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                )}
                {cp.contactChefField && (
                    <Check id="ms-chefs" checked={chefsOnly} onChange={setChefsOnly} label="Chefs seulement" />
                )}
                <Check
                    id="ms-ano"
                    checked={anomaliesOnly}
                    onChange={setAnomaliesOnly}
                    label={`Anomalies seulement${totals.anomalies ? ` (${totals.anomalies})` : ''}`}
                />
                <span className="ml-auto text-[11px] text-gray-gray500 dark:text-gray-gray400">
                    {filtered.length} / {model.people.length} affichés
                </span>
            </div>

            {filtered.length === 0 ? (
                <EmptyState
                    title="Aucun technicien ne correspond aux filtres"
                    detail="Élargissez la recherche ou décochez un filtre."
                />
            ) : (
                <div className={SPLIT}>
                    <HoursList
                        people={filtered}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        totals={totals}
                        thresholds={thresholds}
                    />
                    <HoursPanel
                        entry={entry}
                        eventsById={data.eventsById}
                        dayHeaders={model.days}
                        thresholds={thresholds}
                        canExpandShifts={canExpandShifts}
                    />
                </div>
            )}
        </div>
    );
}

function Check({id, checked, onChange, label}) {
    return (
        <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-1.5">
            <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="accent-blue-blue"
            />
            {label}
        </label>
    );
}

// Nothing this period is not the same as nothing at all: offer the nearest
// period that does have data rather than leaving the user to hunt for it.
function EmptyStatePeriod({nav, data}) {
    const present = data.presentWeekKeys;
    const current = nav.period.weekKeys[0];
    const nearest = useMemo(() => {
        if (!present.length) return null;
        let best = null;
        let bestGap = Infinity;
        for (const wk of present) {
            const gap = Math.abs(new Date(wk).getTime() - new Date(current).getTime());
            if (gap < bestGap) {
                bestGap = gap;
                best = wk;
            }
        }
        return best;
    }, [present, current]);

    return (
        <EmptyState
            title={`Aucune heure enregistrée — ${nav.period.title}`}
            detail={
                present.length
                    ? 'Aucun quart ni ligne jours_contact ne tombe dans cette période.'
                    : 'Aucun quart n’a été lu dans la base. Vérifiez que les champs sont cochés Visible dans le panneau Données.'
            }
            action={
                nearest && nearest !== current ? (
                    <LinkButton onClick={() => nav.goToWeek(nearest)}>
                        Aller à la semaine du {nearest}, qui contient des heures
                    </LinkButton>
                ) : null
            }
        />
    );
}
