import {useEffect, useState} from 'react';
import {shortDate} from '../utils/dates';

// Payroll approval controls: one bar for the whole period, one compact control
// in a technician's detail panel. Both read the same thing — the heures_semaine
// rows of the period — and write through useApproval.
//
// Approving over an anomaly is allowed, never silent: a mismatched weekly total
// or a missing heures_semaine row turns the click into a two-step confirmation
// that names the problem. Payroll is sometimes run knowing a line is off; it
// should never be run without knowing.

const BTN =
    'rounded border px-2.5 py-1 text-xs font-medium leading-none disabled:cursor-default disabled:opacity-50';
const BTN_PRIMARY = `${BTN} border-green-green bg-green-green text-white enabled:hover:opacity-90`;
const BTN_DANGER = `${BTN} border-red-red bg-red-red text-white enabled:hover:opacity-90`;
const BTN_QUIET =
    `${BTN} border-gray-gray300 bg-white text-gray-gray700 enabled:hover:border-blue-blue enabled:hover:text-blue-blue ` +
    'dark:border-gray-gray600 dark:bg-gray-gray800 dark:text-gray-gray200';

// "2026-09-14 10:32", in the viewer's timezone.
export function fmtApprovedAt(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// What approving these people's period would touch, and what should give pause.
function summarize(entries) {
    const rows = entries.flatMap((p) => p.weeks.filter(Boolean));
    const approved = rows.filter((w) => w.approved);
    return {
        rows,
        approved,
        pending: rows.filter((w) => !w.approved),
        withoutWeekRow: entries.filter((p) => p.flags.hasMissingWeekRow),
        withMismatch: entries.filter((p) => p.flags.hasWeekMismatch),
    };
}

function warningsOf(s) {
    const out = [];
    if (s.withMismatch.length) {
        out.push(
            `total hebdomadaire en désaccord avec les heures réelles des quarts (${s.withMismatch.map((p) => p.person.name).join(', ')})`,
        );
    }
    if (s.withoutWeekRow.length) {
        out.push(
            `semaine travaillée sans ligne heures_semaine, donc impossible à approuver ` +
            `(${s.withoutWeekRow.map((p) => p.person.name).join(', ')})`,
        );
    }
    return out;
}

// --- Period bar ----------------------------------------------------------------

export function PeriodApprovalBar({model, approval, cp}) {
    const [confirming, setConfirming] = useState(null);
    const periodKey = model.period.key;

    // A pending confirmation belongs to the period it was asked about.
    useEffect(() => setConfirming(null), [periodKey]);

    if (!approval.available) return null;

    const s = summarize(model.people);
    const warnings = warningsOf(s);
    if (!s.rows.length && !s.withoutWeekRow.length) return null;

    const allApproved = s.rows.length > 0 && s.pending.length === 0;
    const spills = model.period.weekKeys.length > 1;

    const run = async (kind) => {
        setConfirming(null);
        if (kind === 'approve') await approval.approve(s.pending);
        else await approval.withdraw(s.approved);
    };

    return (
        <section
            className={
                'flex flex-col gap-2 rounded border px-3 py-2 text-xs ' +
                (allApproved
                    ? 'border-green-green bg-green-greenLight2 text-gray-gray900'
                    : 'border-gray-gray200 bg-white dark:border-gray-gray600 dark:bg-gray-gray700')
            }
        >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-display text-sm font-semibold">Approbation de la paie</span>
                <span className="font-mono tabular-nums">
                    {s.approved.length} / {s.rows.length} ligne(s) heures_semaine approuvée(s)
                </span>
                {spills && (
                    <span className="text-gray-gray500 dark:text-gray-gray400">
                        · inclut les semaines entières qui débordent du mois (
                        {model.period.weekKeys.map(shortDate).join(', ')})
                    </span>
                )}
                {!cp.weekApprovedByField && (
                    <span className="text-orange-orange">
                        · « Paie — approuvée par » non configuré : l’auteur ne sera pas enregistré
                    </span>
                )}

                <span className="ml-auto flex flex-wrap items-center gap-2">
                    {s.pending.length > 0 && confirming !== 'approve' && (
                        <button
                            type="button"
                            className={BTN_PRIMARY}
                            disabled={approval.saving}
                            onClick={() => (warnings.length ? setConfirming('approve') : run('approve'))}
                        >
                            {approval.saving ? 'Enregistrement…' : `Approuver ${s.pending.length} ligne(s)`}
                        </button>
                    )}
                    {s.approved.length > 0 && confirming !== 'withdraw' && (
                        <button
                            type="button"
                            className={BTN_QUIET}
                            disabled={approval.saving}
                            onClick={() => setConfirming('withdraw')}
                        >
                            Retirer l’approbation
                        </button>
                    )}
                </span>
            </div>

            {confirming === 'approve' && (
                <Confirm
                    tone="warn"
                    text={`Approuver malgré : ${warnings.join(' ; ')} ?`}
                    confirmLabel={`Approuver quand même ${s.pending.length} ligne(s)`}
                    onConfirm={() => run('approve')}
                    onCancel={() => setConfirming(null)}
                    saving={approval.saving}
                />
            )}
            {confirming === 'withdraw' && (
                <Confirm
                    tone="danger"
                    text={`Retirer l’approbation de ${s.approved.length} ligne(s) heures_semaine ? La date et l’auteur seront effacés.`}
                    confirmLabel="Retirer l’approbation"
                    onConfirm={() => run('withdraw')}
                    onCancel={() => setConfirming(null)}
                    saving={approval.saving}
                />
            )}
        </section>
    );
}

// --- Per-person control ----------------------------------------------------------

export function PersonApproval({entry, approval}) {
    const [confirming, setConfirming] = useState(null);
    const personId = entry.person.id;

    useEffect(() => setConfirming(null), [personId]);

    if (!approval.available) return null;

    const s = summarize([entry]);
    const warnings = warningsOf(s);

    if (!s.rows.length) {
        return entry.flags.hasMissingWeekRow ? (
            <span className="text-[13px] text-red-red">Aucune ligne heures_semaine à approuver</span>
        ) : null;
    }

    const run = async (kind) => {
        setConfirming(null);
        if (kind === 'approve') await approval.approve(s.pending);
        else await approval.withdraw(s.approved);
    };

    const last = s.approved[s.approved.length - 1];

    return (
        <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap items-center justify-end gap-2 text-[13px]">
                {s.approved.length > 0 && (
                    <span
                        className="rounded-sm bg-green-greenLight2 px-1.5 py-0.5 text-gray-gray900"
                        title={s.approved
                            .map((w) => `${shortDate(w.weekKey)} : ${fmtApprovedAt(w.approvedAt)}${w.approvedBy ? ` par ${w.approvedBy}` : ''}`)
                            .join('\n')}
                    >
                        ✓ {s.pending.length ? `${s.approved.length}/${s.rows.length} approuvée(s)` : 'Paie approuvée'}
                        {' '}· {fmtApprovedAt(last.approvedAt)}
                        {last.approvedBy ? ` · ${last.approvedBy}` : ''}
                    </span>
                )}
                {s.pending.length > 0 && !confirming && (
                    <button
                        type="button"
                        className={BTN_PRIMARY}
                        disabled={approval.saving}
                        onClick={() => (warnings.length ? setConfirming('approve') : run('approve'))}
                    >
                        {approval.saving ? 'Enregistrement…' : 'Approuver la paie'}
                    </button>
                )}
                {s.approved.length > 0 && !confirming && (
                    <button
                        type="button"
                        className={BTN_QUIET}
                        disabled={approval.saving}
                        onClick={() => setConfirming('withdraw')}
                    >
                        Retirer
                    </button>
                )}
            </div>
            {confirming === 'approve' && (
                <Confirm
                    tone="warn"
                    text={`Approuver malgré : ${warnings.join(' ; ')} ?`}
                    confirmLabel="Approuver quand même"
                    onConfirm={() => run('approve')}
                    onCancel={() => setConfirming(null)}
                    saving={approval.saving}
                />
            )}
            {confirming === 'withdraw' && (
                <Confirm
                    tone="danger"
                    text="Retirer l’approbation de cette période ?"
                    confirmLabel="Retirer"
                    onConfirm={() => run('withdraw')}
                    onCancel={() => setConfirming(null)}
                    saving={approval.saving}
                />
            )}
        </div>
    );
}

function Confirm({tone, text, confirmLabel, onConfirm, onCancel, saving}) {
    return (
        <div
            className={
                'flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-xs text-gray-gray900 ' +
                (tone === 'danger' ? 'border-red-red bg-red-redLight2' : 'border-orange-orange bg-orange-orangeLight2')
            }
            role="alertdialog"
        >
            <span className="flex-1">{text}</span>
            <button
                type="button"
                className={tone === 'danger' ? BTN_DANGER : BTN_PRIMARY}
                disabled={saving}
                onClick={onConfirm}
            >
                {confirmLabel}
            </button>
            <button type="button" className={BTN_QUIET} disabled={saving} onClick={onCancel}>
                Annuler
            </button>
        </div>
    );
}
