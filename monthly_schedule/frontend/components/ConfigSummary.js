import {useState} from 'react';
import {getCustomProperties} from '../utils/customProperties';

// Every resolved property, with the field it points at and that field's type.
//
// This exists to make a *Données* panel mistake visible before a single number
// is drawn: a field that is not ticked Visible simply is not offered in the
// picker, and the only symptom downstream would be a column that quietly never
// appears. Reading the resolved list against the base is the fastest way to
// catch that.
export function ConfigSummary({base, cp}) {
    const [open, setOpen] = useState(true);

    const props = getCustomProperties(base);
    const tables = props.filter((p) => p.type === 'table');
    const fields = props.filter((p) => p.type === 'field');
    const scalars = props.filter((p) => p.type === 'enum' || p.type === 'string');

    const resolved = fields.filter((p) => cp[p.key]).length;

    return (
        <section className="rounded border border-gray-gray200 bg-white dark:border-gray-gray600 dark:bg-gray-gray700">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
            >
                <span className="text-sm leading-none text-gray-gray500">{open ? '▾' : '▸'}</span>
                <span className="font-display text-sm font-semibold text-gray-gray800 dark:text-gray-gray100">
                    Configuration résolue
                </span>
                <span className="text-xs text-gray-gray500 dark:text-gray-gray400">
                    {resolved} / {fields.length} champs · {tables.filter((p) => cp[p.key]).length} /{' '}
                    {tables.length} tables
                </span>
            </button>

            {open && (
                <div className="border-t border-gray-gray200 px-3 py-3 dark:border-gray-gray600">
                    <Group title="Tables">
                        {tables.map((p) => (
                            <Row
                                key={p.key}
                                label={p.label}
                                value={cp[p.key]?.name}
                                detail={cp[p.key] ? `${cp[p.key].fields.length} champs visibles` : null}
                            />
                        ))}
                    </Group>

                    <Group title="Champs">
                        {fields.map((p) => (
                            <Row
                                key={p.key}
                                label={p.label}
                                value={cp[p.key]?.name}
                                detail={cp[p.key] ? cp[p.key].config?.type : null}
                            />
                        ))}
                    </Group>

                    <Group title="Réglages">
                        {scalars.map((p) => (
                            <Row key={p.key} label={p.label} value={String(cp[p.key] ?? '')} />
                        ))}
                    </Group>
                </div>
            )}
        </section>
    );
}

function Group({title, children}) {
    return (
        <div className="mb-3 last:mb-0">
            <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-gray-gray500 dark:text-gray-gray400">
                {title}
            </h3>
            <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 md:grid-cols-2">{children}</div>
        </div>
    );
}

function Row({label, value, detail}) {
    const ok = Boolean(value);
    return (
        <div className="flex items-baseline gap-2 border-b border-gray-gray100 py-0.5 text-xs dark:border-gray-gray600">
            <span className="flex-1 truncate text-gray-gray600 dark:text-gray-gray300" title={label}>
                {label}
            </span>
            <span
                className={
                    'truncate font-mono ' +
                    (ok ? 'text-gray-gray800 dark:text-gray-gray100' : 'text-orange-orange')
                }
                title={value || 'non configuré'}
            >
                {value || 'non configuré'}
            </span>
            {detail && (
                <span className="shrink-0 font-mono text-[10px] text-gray-gray400">{detail}</span>
            )}
        </div>
    );
}
