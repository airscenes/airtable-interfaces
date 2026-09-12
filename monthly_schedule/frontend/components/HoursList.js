import {fmtHours} from '../utils/format';
import {useSortedRows, compareText, compareNumber, SortArrow} from '../hooks/useSortedRows';

// The master half of the layout.
//
// Because the detail lives behind a click, this list is the ONLY place anomalies
// can be spotted at a glance. It therefore carries three things a plain name
// list would not: a severity dot, the period total with its over-threshold
// colour, and sorting — without them the tab would fail at the job it exists
// for.
const DOT = {
    alert: 'bg-red-red',
    warn: 'bg-yellow-yellow',
    info: 'bg-blue-blueLight1',
    none: 'bg-gray-gray200 dark:bg-gray-gray600',
};

const SEVERITY_TITLE = {
    alert: 'Alerte — majoration ou écart de données',
    warn: 'À surveiller',
    info: 'Travaillé, rien à signaler',
    none: 'Aucune heure',
};

export function HoursList({people, selectedId, onSelect, totals, thresholds}) {
    const comparators = {
        name: {compare: (a, b) => compareText(a.person.name, b.person.name)},
        total: {
            numeric: true,
            value: (p) => p.totals.heuresPayees,
            compare: (a, b) => compareNumber(a.totals.heuresPayees, b.totals.heuresPayees),
        },
        anomaly: {
            numeric: true,
            value: (p) => (p.flags.hasAnomaly ? 1 : 0),
            compare: (a, b) =>
                Number(a.flags.hasAnomaly) - Number(b.flags.hasAnomaly) ||
                compareNumber(a.totals.heuresPayees, b.totals.heuresPayees),
        },
    };

    const {sorted, sortKey, dir, toggle} = useSortedRows(people, comparators, 'name');

    return (
        <div className="flex flex-col overflow-hidden rounded border border-gray-gray200 dark:border-gray-gray600">
            <div className="flex items-center gap-2 border-b border-gray-gray200 bg-gray-gray25 px-3 py-1.5 dark:border-gray-gray600 dark:bg-gray-gray800">
                <span className="font-display text-xs font-semibold text-gray-gray700 dark:text-gray-gray200">
                    Techniciens · {people.length}
                </span>
                <div className="ml-auto flex items-center gap-2 text-[10px]">
                    <SortBtn label="Nom" k="name" sortKey={sortKey} dir={dir} onClick={toggle} />
                    <SortBtn label="Heures" k="total" sortKey={sortKey} dir={dir} onClick={toggle} />
                    <SortBtn label="⚠" k="anomaly" sortKey={sortKey} dir={dir} onClick={toggle} title="Anomalies d’abord" />
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto" style={{maxHeight: '62vh'}}>
                {sorted.map((p) => {
                    const selected = p.person.id === selectedId;
                    const over =
                        p.totals.heuresPayees !== null &&
                        p.totals.heuresPayees > thresholds.heuresSemaine;
                    return (
                        <button
                            key={p.person.id}
                            type="button"
                            aria-current={selected}
                            onClick={() => onSelect(p.person.id)}
                            className={
                                'flex w-full items-center gap-2 border-b border-l-[3px] border-gray-gray100 px-3 py-1.5 text-left text-xs ' +
                                'dark:border-gray-gray600 ' +
                                (selected
                                    ? 'border-l-blue-blue bg-blue-blueLight3 font-medium dark:bg-gray-gray600'
                                    : 'border-l-transparent bg-white hover:bg-gray-gray25 dark:bg-gray-gray700 dark:hover:bg-gray-gray600')
                            }
                        >
                            <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[p.severity] ?? DOT.none}`}
                                title={SEVERITY_TITLE[p.severity]}
                            />
                            <span className="min-w-0 flex-1 truncate text-gray-gray900 dark:text-gray-gray100">
                                {p.person.name}
                            </span>
                            {p.person.isChef && (
                                <span className="shrink-0 rounded-sm border border-blue-blueLight1 px-1 font-mono text-[9px] text-blue-blue">
                                    chef
                                </span>
                            )}
                            <span
                                className={
                                    'shrink-0 font-mono tabular-nums ' +
                                    (over
                                        ? 'font-semibold text-red-red'
                                        : 'text-gray-gray700 dark:text-gray-gray300')
                                }
                                title={over ? `Plus de ${thresholds.heuresSemaine} h (4.01)` : undefined}
                            >
                                {fmtHours(p.totals.heuresPayees)}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center justify-between border-t border-gray-gray200 bg-gray-gray25 px-3 py-1.5 dark:border-gray-gray600 dark:bg-gray-gray800">
                <span className="font-display text-xs font-semibold text-gray-gray700 dark:text-gray-gray200">
                    Total période
                </span>
                <span className="font-mono text-xs font-semibold tabular-nums text-gray-gray900 dark:text-gray-gray100">
                    {fmtHours(totals.heuresPayees)} h
                </span>
            </div>
        </div>
    );
}

function SortBtn({label, k, sortKey, dir, onClick, title}) {
    const active = sortKey === k;
    return (
        <button
            type="button"
            onClick={() => onClick(k)}
            title={title}
            className={
                'rounded px-1 py-px font-mono ' +
                (active ? 'text-blue-blue' : 'text-gray-gray500 hover:text-gray-gray800 dark:text-gray-gray400')
            }
        >
            {label}
            <SortArrow active={active} dir={dir} />
        </button>
    );
}
