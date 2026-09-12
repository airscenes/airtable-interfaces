// Clause pills. Colour is never the only signal: the article number is always
// printed, so the chip still reads when the colour does not (print, colour
// vision, a washed-out screen).
const CHIP = 'inline-block rounded-sm border px-1 py-px font-mono text-[10px] leading-4 whitespace-nowrap';

const BY_SEVERITY = {
    alert: 'border-red-red bg-red-redLight2 text-gray-gray900',
    warn: 'border-yellow-yellow bg-yellow-yellowLight2 text-gray-gray900',
    info: 'border-blue-blueLight1 bg-blue-blueLight3 text-gray-gray900',
};

export function ClauseChip({clause}) {
    const cls = BY_SEVERITY[clause.severity] ?? BY_SEVERITY.info;
    const title = clause.label ? `${clause.code || 'Clause'} — ${clause.label}` : clause.code;
    return (
        <span className={`${CHIP} ${cls}`} title={title}>
            {clause.code || clause.label}
        </span>
    );
}

// `max` keeps a long list from pushing a row's numbers off screen; the overflow
// count is hoverable so nothing is actually lost.
export function ClauseChips({clauses, max = 4}) {
    if (!clauses?.length) return null;
    const shown = clauses.slice(0, max);
    const rest = clauses.slice(max);
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {shown.map((c, i) => (
                <ClauseChip key={c.code || i} clause={c} />
            ))}
            {rest.length > 0 && (
                <span
                    className="font-mono text-[10px] text-gray-gray500 dark:text-gray-gray400"
                    title={rest.map((c) => `${c.code} ${c.label}`).join('\n')}
                >
                    +{rest.length}
                </span>
            )}
        </span>
    );
}

// A coloured pill for a select value (salle, statut), styled inline because the
// colour comes from Airtable at runtime and Tailwind cannot express it.
export function SelectBadge({text, color, title}) {
    if (!text) return null;
    return (
        <span
            title={title || text}
            style={{
                backgroundColor: color?.bg ?? '#e5e9f0',
                color: color?.text ?? '#333',
                padding: '1px 7px',
                borderRadius: 9999,
                fontSize: 10,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                display: 'inline-block',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            }}
        >
            {text}
        </span>
    );
}
