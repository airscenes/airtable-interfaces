// A rule-separated strip, not a row of cards: these are one reading of one
// period, so they belong to a single object rather than six floating tiles.
export function KpiRow({items}) {
    const shown = items.filter(Boolean);
    if (!shown.length) return null;

    return (
        <div className="flex flex-wrap rounded border border-gray-gray200 bg-gray-gray25 dark:border-gray-gray600 dark:bg-gray-gray800">
            {shown.map((k, i) => (
                <div
                    key={k.label}
                    className={
                        'min-w-0 flex-1 px-3 py-1.5 ' +
                        (i > 0 ? 'border-l border-gray-gray200 dark:border-gray-gray600' : '')
                    }
                    style={{flexBasis: 120}}
                >
                    <div
                        className="truncate font-mono text-[10px] uppercase tracking-wider text-gray-gray500 dark:text-gray-gray400"
                        title={k.label}
                    >
                        {k.label}
                    </div>
                    <div
                        className={
                            'font-mono text-lg font-semibold leading-tight tabular-nums ' +
                            (k.tone === 'alert'
                                ? 'text-red-red'
                                : k.tone === 'warn'
                                  ? 'text-orange-orange'
                                  : 'text-gray-gray900 dark:text-gray-gray100')
                        }
                    >
                        {k.value}
                        {k.unit && (
                            <span className="ml-0.5 text-xs font-normal text-gray-gray500 dark:text-gray-gray400">
                                {k.unit}
                            </span>
                        )}
                    </div>
                    {k.hint && (
                        <div className="truncate text-[10px] text-gray-gray500 dark:text-gray-gray400" title={k.hint}>
                            {k.hint}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
