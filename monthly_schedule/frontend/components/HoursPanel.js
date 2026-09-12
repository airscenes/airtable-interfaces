import {expandRecord} from '@airtable/blocks/interface/ui';
import {fmtHours, fmtDelta, fmtMoney, fmtNumber} from '../utils/format';
import {fmtHHMM} from '../utils/airtable';
import {longDate} from '../utils/dates';
import {SHIFT_BLOCKS} from '../constants';
import {ClauseChips, SelectBadge} from './ClauseChips';
import {EmptyState} from './EmptyState';

// The detail half of the layout: one technician's whole period, day by day.
//
// One row per `equipe_technique` record — a role on an event — carrying its
// three blocks across three column pairs. It is never one row per block.

const TH =
    'sticky top-0 z-10 bg-gray-gray25 px-2 py-1 text-left font-mono text-[10px] uppercase ' +
    'tracking-wider text-gray-gray500 shadow-[inset_0_-1px_0_#dfe3e8] ' +
    'dark:bg-gray-gray800 dark:text-gray-gray400 dark:shadow-[inset_0_-1px_0_#41454d]';

const TD = 'border-b border-gray-gray100 px-2 py-1 align-middle dark:border-gray-gray600';

export function HoursPanel({entry, eventsById, dayHeaders, thresholds, canExpandShifts}) {
    if (!entry) {
        return (
            <EmptyState
                title="Aucun technicien sélectionné"
                detail="Choisissez un technicien dans la liste pour voir le détail de sa période."
            />
        );
    }

    const worked = entry.cells.filter((c) => !c.isEmpty);
    const {totals, flags, person} = entry;

    return (
        <div className="flex flex-col overflow-hidden rounded border border-gray-gray200 dark:border-gray-gray600">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-gray200 bg-gray-gray25 px-3 py-2 dark:border-gray-gray600 dark:bg-gray-gray800">
                <h2 className="font-display text-base font-bold text-gray-gray900 dark:text-gray-gray100">
                    {person.name}
                </h2>
                {person.isChef && (
                    <span className="rounded-sm border border-blue-blueLight1 px-1 font-mono text-[9px] text-blue-blue">
                        chef
                    </span>
                )}
                {person.salles.map((s) => (
                    <SelectBadge key={s} text={s} />
                ))}

                <span className="ml-auto flex flex-wrap items-baseline gap-x-3 text-[11px] text-gray-gray600 dark:text-gray-gray300">
                    <Metric label="payées" value={`${fmtHours(totals.heuresPayees)} h`} strong />
                    <Metric label="réelles" value={`${fmtHours(totals.heuresReelles)} h`} />
                    <Metric
                        label="majorées"
                        value={`${fmtHours(totals.heuresMajorees)} h`}
                        tone={(totals.heuresMajorees ?? 0) > 0 ? 'alert' : undefined}
                    />
                    <Metric label="jours" value={fmtNumber(totals.joursTravailles)} />
                    {totals.couts !== null && <Metric label="coûts" value={fmtMoney(totals.couts)} />}
                </span>
            </header>

            <PanelFlags flags={flags} thresholds={thresholds} />

            {worked.length === 0 ? (
                <EmptyState
                    title="Aucune heure sur cette période"
                    detail={`${person.name} n’a aucun quart enregistré ici.`}
                />
            ) : (
                <div className="overflow-auto" style={{maxHeight: '62vh'}}>
                    <table className="w-full text-xs" style={{minWidth: 1080}}>
                        <thead>
                            <tr>
                                <th className={TH} style={{minWidth: 190}}>Événement</th>
                                <th className={TH} style={{minWidth: 120}}>Rôle</th>
                                {SHIFT_BLOCKS.map((b) => (
                                    <th key={b.key} className={TH} style={{minWidth: 108}}>
                                        {b.label}
                                    </th>
                                ))}
                                <th className={TH} style={{minWidth: 96}}>Repas</th>
                                <th className={`${TH} text-right`}>Réelles</th>
                                <th className={`${TH} text-right`}>Payées</th>
                                <th className={`${TH} text-right`} title="Payées moins réelles — l’effet du minimum de 4 h par bloc">
                                    Δ
                                </th>
                                <th className={`${TH} text-right`}>Taux</th>
                                <th className={`${TH} text-right`}>Coûts</th>
                                <th className={TH} style={{minWidth: 120}}>Clauses</th>
                            </tr>
                        </thead>
                        <tbody>
                            {worked.map((cell) => (
                                <DaySection
                                    key={cell.dateIso}
                                    cell={cell}
                                    header={dayHeaders.find((d) => d.iso === cell.dateIso)}
                                    eventsById={eventsById}
                                    thresholds={thresholds}
                                    canExpandShifts={canExpandShifts}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function Metric({label, value, strong, tone}) {
    return (
        <span>
            <span className="text-gray-gray500 dark:text-gray-gray400">{label} </span>
            <span
                className={
                    'font-mono tabular-nums ' +
                    (tone === 'alert' ? 'font-semibold text-red-red' : strong ? 'font-semibold' : '')
                }
            >
                {value}
            </span>
        </span>
    );
}

// What is wrong with this person's period, stated in words. The list view only
// has room for a coloured dot; this is where the dot is explained.
function PanelFlags({flags, thresholds}) {
    const msgs = [];
    if (flags.hasOvertime) msgs.push({tone: 'alert', text: `Plus de ${thresholds.heuresSemaine} h dans une semaine (4.01)`});
    if (flags.hasOver12h) msgs.push({tone: 'alert', text: `Une journée d’au moins ${thresholds.heuresJour} h (4.03 B)`});
    if (flags.has7thDay) msgs.push({tone: 'alert', text: `${thresholds.joursConsecutifs}e journée consécutive (4.03 A)`});
    if (flags.hasShortRest) msgs.push({tone: 'warn', text: `Moins de ${thresholds.reposHeures} h de repos entre deux appels (8.02)`});
    if (flags.hasNight) msgs.push({tone: 'warn', text: 'Heures entre 00 h et 8 h (4.02)'});
    if (flags.hasFerie) msgs.push({tone: 'warn', text: 'Jour férié (4.04)'});
    if (flags.hasMissingDayRow) {
        msgs.push({tone: 'alert', text: 'Une journée travaillée n’a pas de ligne jours_contact — l’automatisation ne l’a pas créée'});
    }
    if (flags.hasMissingWeekRow) {
        msgs.push({tone: 'alert', text: 'Une semaine travaillée n’a pas de ligne heures_semaine'});
    }
    if (flags.hasWeekMismatch) {
        msgs.push({tone: 'alert', text: 'Le total hebdomadaire ne correspond pas aux journées — recalcul Airtable en attente'});
    }
    if (!msgs.length) return null;

    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-gray-gray200 px-3 py-1.5 text-[11px] dark:border-gray-gray600">
            {msgs.map((m, i) => (
                <span key={i} className={m.tone === 'alert' ? 'text-red-red' : 'text-orange-orange'}>
                    ● {m.text}
                </span>
            ))}
        </div>
    );
}

// A date header row followed by that day's shift rows.
function DaySection({cell, header, eventsById, thresholds, canExpandShifts}) {
    const over = cell.heures !== null && cell.heures >= thresholds.heuresJour;
    const shortRest =
        cell.reposPrecedent !== null && cell.reposPrecedent < thresholds.reposHeures;

    return (
        <>
            <tr>
                <td colSpan={12} className="p-0">
                    <div
                        className={
                            'mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 border border-l-[3px] px-2 py-1 ' +
                            'border-gray-gray200 bg-white dark:border-gray-gray600 dark:bg-gray-gray700 ' +
                            (over
                                ? 'border-l-red-red'
                                : cell.severity === 'warn'
                                  ? 'border-l-yellow-yellow'
                                  : 'border-l-blue-blue')
                        }
                    >
                        <span className="font-display text-xs font-semibold text-gray-gray900 dark:text-gray-gray100">
                            {longDate(cell.dateIso)}
                        </span>

                        <FerieState cell={cell} />

                        <DayMeta label="payées" value={`${fmtHours(cell.heures)} h`} strong tone={over ? 'alert' : undefined} />
                        {cell.heuresFromShifts && (
                            <span
                                className="font-mono text-[10px] text-orange-orange"
                                title="Aucune ligne jours_contact pour ce jour : le total est la somme des quarts."
                            >
                                somme des quarts
                            </span>
                        )}
                        {cell.heuresNuit !== null && cell.heuresNuit > 0 && (
                            <DayMeta label="dont nuit" value={`${fmtHours(cell.heuresNuit)} h`} tone="warn" />
                        )}
                        {cell.joursConsecutifs !== null && (
                            <DayMeta
                                label="jours consécutifs"
                                value={fmtNumber(cell.joursConsecutifs)}
                                tone={cell.joursConsecutifs >= thresholds.joursConsecutifs ? 'alert' : undefined}
                            />
                        )}
                        {cell.reposPrecedent !== null && (
                            <DayMeta
                                label="repos précédent"
                                value={`${fmtHours(cell.reposPrecedent)} h`}
                                tone={shortRest ? 'warn' : undefined}
                            />
                        )}

                        <ClauseChips clauses={cell.clauses} />

                        {/* The master/detail layout hides the per-day column totals a
                            matrix would have shown, and those are what catch an
                            under-staffed or overloaded day. Carry the team's load for
                            this date here instead. */}
                        {header && (
                            <span
                                className="ml-auto font-mono text-[10px] text-gray-gray500 dark:text-gray-gray400"
                                title="Charge de toute l’équipe ce jour-là"
                            >
                                équipe : {header.people} pers. · {fmtHours(header.heures)} h
                                {header.ferieMixed ? ' · férié partiel ⚠' : ''}
                            </span>
                        )}
                    </div>
                </td>
            </tr>

            {cell.shifts.map((s) => (
                <ShiftRow
                    key={s.id}
                    shift={s}
                    event={s.eventId ? eventsById.get(s.eventId) : null}
                    canExpand={canExpandShifts}
                />
            ))}
        </>
    );
}

function DayMeta({label, value, strong, tone}) {
    return (
        <span className="font-mono text-[10px] text-gray-gray500 dark:text-gray-gray400">
            {label}{' '}
            <span
                className={
                    'tabular-nums ' +
                    (tone === 'alert'
                        ? 'font-semibold text-red-red'
                        : tone === 'warn'
                          ? 'font-semibold text-orange-orange'
                          : 'text-gray-gray800 dark:text-gray-gray200') +
                    (strong ? ' font-semibold' : '')
                }
            >
                {value}
            </span>
        </span>
    );
}

// Read-only for now; the checkbox write lands with the écriture-1 commit.
function FerieState({cell}) {
    if (!cell.ferie) return null;
    return (
        <span className="rounded-sm border border-yellow-yellow bg-yellow-yellowLight2 px-1 font-mono text-[10px] text-gray-gray900">
            férié 4.04
        </span>
    );
}

function ShiftRow({shift, event, canExpand}) {
    const delta =
        shift.heuresPayees !== null && shift.heuresReelles !== null
            ? shift.heuresPayees - shift.heuresReelles
            : null;

    return (
        <tr className="bg-white hover:bg-gray-gray25 dark:bg-gray-gray700 dark:hover:bg-gray-gray600">
            <td className={TD}>
                <div className="flex items-center gap-1.5">
                    {event?.salle && <SelectBadge text={event.salle} color={null} />}
                    <span className="truncate text-gray-gray800 dark:text-gray-gray100" title={event?.name}>
                        {event?.name || (shift.eventId ? '(événement non lisible)' : '—')}
                    </span>
                    {shift.multiEvent && (
                        <span
                            className="font-mono text-[10px] text-red-red"
                            title="Ce quart est lié à plusieurs événements : sa date vient d’un rollup MIN et peut être fausse."
                        >
                            ⚠
                        </span>
                    )}
                    {canExpand && (
                        <button
                            type="button"
                            onClick={() => expandRecord(shift.record)}
                            className="ml-auto shrink-0 text-gray-gray400 hover:text-blue-blue"
                            title="Ouvrir la fiche du quart"
                        >
                            ⤢
                        </button>
                    )}
                </div>
            </td>
            <td className={TD}>{shift.roleName || '—'}</td>

            {shift.blocks.map((b) => (
                <td key={b.key} className={TD}>
                    <BlockTime block={b} />
                </td>
            ))}

            <td className={`${TD} text-gray-gray600 dark:text-gray-gray300`}>
                <Meals shift={shift} />
            </td>
            <td className={`${TD} text-right font-mono tabular-nums`}>{fmtHours(shift.heuresReelles)}</td>
            <td className={`${TD} text-right font-mono font-semibold tabular-nums`}>
                {fmtHours(shift.heuresPayees)}
            </td>
            <td
                className={
                    `${TD} text-right font-mono tabular-nums ` +
                    (delta ? 'text-orange-orange' : 'text-gray-gray400')
                }
                title={
                    delta
                        ? 'Écart dû au minimum de 4 h par bloc (art. 8.01) et aux pauses déduites.'
                        : undefined
                }
            >
                {fmtDelta(delta)}
            </td>
            <td className={`${TD} text-right font-mono tabular-nums`}>{fmtMoney(shift.taux)}</td>
            <td className={`${TD} text-right font-mono tabular-nums`}>{fmtMoney(shift.couts)}</td>
            <td className={TD}>
                <ClauseChips clauses={shift.clauses} max={3} />
            </td>
        </tr>
    );
}

function BlockTime({block}) {
    if (!block.configured) {
        return (
            <span className="font-mono text-gray-gray300" title="Paire In/Out non configurée">
                ·
            </span>
        );
    }
    if (!block.filled) return <span className="font-mono text-gray-gray300">—</span>;
    return (
        <span className="font-mono tabular-nums text-gray-gray800 dark:text-gray-gray200">
            {fmtHHMM(block.inSec)}
            <span className="mx-0.5 text-gray-gray400">→</span>
            {fmtHHMM(block.outSec)}
        </span>
    );
}

// A 30-minute break is PAID (art. 8.01) and only a 60-minute one is deducted —
// by Airtable, in `heures_reelles`. Showing the duration next to the start time
// is what makes the Δ column explicable.
function Meals({shift}) {
    const parts = [];
    if (shift.diner !== null) parts.push(`Dîner ${fmtHHMM(shift.diner)}${shift.dureeDiner ? ` (${shift.dureeDiner})` : ''}`);
    if (shift.souper !== null) parts.push(`Souper ${fmtHHMM(shift.souper)}${shift.dureeSouper ? ` (${shift.dureeSouper})` : ''}`);
    if (!parts.length) return <span className="text-gray-gray300">—</span>;
    return <span className="text-[10px] leading-tight">{parts.join(' · ')}</span>;
}
