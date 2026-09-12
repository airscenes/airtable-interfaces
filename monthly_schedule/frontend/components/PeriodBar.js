import {GRAIN_WEEK, GRAIN_MONTH} from '../constants';
import {shortDate} from '../utils/dates';

const NAV_BTN =
    'rounded border border-gray-gray300 bg-white px-2 py-1 text-sm leading-none text-gray-gray700 ' +
    'enabled:hover:border-blue-blue enabled:hover:text-blue-blue disabled:opacity-40 ' +
    'dark:border-gray-gray600 dark:bg-gray-gray800 dark:text-gray-gray200';

export function PeriodBar({period, grain, grainIsPinned, onGrain, onPrev, onNext, onToday, isToday, subtitle, right}) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1">
                <button type="button" className={NAV_BTN} onClick={onPrev} aria-label="Période précédente">
                    ◀
                </button>
                <button type="button" className={NAV_BTN} onClick={onNext} aria-label="Période suivante">
                    ▶
                </button>
            </div>

            <div className="min-w-0">
                <div className="font-display text-base font-semibold leading-tight text-gray-gray900 dark:text-gray-gray100">
                    {period.title}
                </div>
                <div className="text-[11px] leading-tight text-gray-gray500 dark:text-gray-gray400">
                    {grain === GRAIN_WEEK
                        ? `semaine du lundi ${shortDate(period.startIso)}`
                        : `${period.days.length} jours`}
                    {subtitle ? ` · ${subtitle}` : ''}
                </div>
            </div>

            {/* The grain follows the tab on Paie and 9.04 — those grains exist in
                Airtable as one row per week / per month, so there is nothing to
                choose. The control stays visible, disabled, saying which. */}
            <div
                className="inline-flex overflow-hidden rounded border border-gray-gray300 dark:border-gray-gray600"
                role="group"
                aria-label="Granularité"
                title={grainIsPinned ? 'Cet onglet impose sa granularité' : undefined}
            >
                {[
                    {key: GRAIN_WEEK, label: 'Semaine'},
                    {key: GRAIN_MONTH, label: 'Mois'},
                ].map((g) => (
                    <button
                        key={g.key}
                        type="button"
                        disabled={grainIsPinned}
                        onClick={() => onGrain(g.key)}
                        aria-pressed={grain === g.key}
                        className={
                            'px-3 py-1 text-xs disabled:cursor-default ' +
                            (grain === g.key
                                ? 'bg-blue-blue font-medium text-white'
                                : 'bg-white text-gray-gray700 hover:text-blue-blue disabled:opacity-40 dark:bg-gray-gray800 dark:text-gray-gray300')
                        }
                    >
                        {g.label}
                    </button>
                ))}
            </div>

            <button type="button" className={NAV_BTN} onClick={onToday} disabled={isToday}>
                Aujourd’hui
            </button>

            {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </div>
    );
}
