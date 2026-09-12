import {TABS} from '../constants';

export function Tabs({active, onChange, badges = {}}) {
    return (
        <div className="flex gap-0.5 border-b border-gray-gray200 dark:border-gray-gray600" role="tablist">
            {TABS.map((t) => {
                const selected = t.key === active;
                const badge = badges[t.key];
                return (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => onChange(t.key)}
                        className={
                            '-mb-px border-b-2 px-3 pb-2 pt-1.5 font-display text-sm font-semibold ' +
                            (selected
                                ? 'border-blue-blue text-blue-blue'
                                : 'border-transparent text-gray-gray500 hover:text-gray-gray800 dark:text-gray-gray400 dark:hover:text-gray-gray200')
                        }
                    >
                        {t.label}
                        {badge ? (
                            <span
                                className={
                                    'ml-1.5 font-mono text-[10px] font-normal ' +
                                    (badge.alert ? 'text-orange-orange' : 'text-gray-gray400')
                                }
                            >
                                {badge.text}
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
