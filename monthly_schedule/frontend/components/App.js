import {useMemo} from 'react';
import {useBase, useCustomProperties} from '@airtable/blocks/interface/ui';
import {getCustomProperties, readThreshold} from '../utils/customProperties';
import {buildDiagnostics} from '../utils/diagnostics';
import {buildPeriodModel} from '../utils/model';
import {useGrainData} from '../hooks/useGrainData';
import {usePeriod} from '../hooks/usePeriod';
import {
    DEFAULT_SEUIL_HEURES_SEMAINE,
    DEFAULT_SEUIL_HEURES_JOUR,
    DEFAULT_SEUIL_JOURS_CONSECUTIFS,
    DEFAULT_SEUIL_REPOS_HEURES,
    TAB_HOURS,
    TAB_PAY,
    TAB_DISPO,
} from '../constants';
import {Diagnostics} from './Diagnostics';
import {ConfigSummary} from './ConfigSummary';
import {PeriodBar} from './PeriodBar';
import {Tabs} from './Tabs';
import {ModelSummary} from './ModelSummary';
import {HoursTab} from './HoursTab';
import {PeriodApprovalBar} from './Approval';
import {useApproval} from '../hooks/useApproval';
import {Feedback} from '../hooks/useWriter';
import {WEEK_START_SUNDAY} from '../utils/dates';

// A mapped heures réelles field that yields no number is worse than an unmapped
// one: the weekly-total check skips those shifts without a word.
function heuresReellesDiagnostics(quality, field) {
    if (!field) return [];
    const label = `« ${field.name} » (${field.config?.type ?? 'type inconnu'})`;
    const items = [];
    if (quality.reellesUnreadable) {
        items.push({
            level: 'warn',
            tab: TAB_HOURS,
            title: `${quality.reellesUnreadable} quart(s) avec des heures réelles illisibles`,
            effect:
                `${label} affiche par exemple « ${quality.reellesUnreadableSample} », qui n’est pas un nombre ; ` +
                'la colonne Réelles et le contrôle du total hebdomadaire ignorent ces quarts.',
        });
    }
    if (quality.reellesEmpty) {
        items.push({
            level: 'warn',
            tab: TAB_HOURS,
            title: `${quality.reellesEmpty} quart(s) avec des heures payées mais aucune heure réelle`,
            effect:
                `${label} est vide sur ces quarts ; la colonne Réelles et le contrôle du total ` +
                'hebdomadaire les ignorent.',
        });
    }
    return items;
}

// The week convention is invisible when it is right and ruinous when it is
// wrong, so say which one is in force whenever it was not chosen explicitly,
// and flag rows that do not follow it.
function weekConventionDiagnostics(conv) {
    const dayName = conv.startDay === WEEK_START_SUNDAY ? 'dimanche' : 'lundi';
    const items = [];
    if (conv.source === 'default' && conv.total === 0) return items;
    if (conv.source === 'default') {
        items.push({
            level: 'warn',
            tab: TAB_HOURS,
            title: 'Début de semaine indéterminé',
            effect:
                `aucune date_semaine ne tombe un dimanche ou un lundi ; les semaines commencent le ${dayName} ` +
                'par défaut. Choisissez-le dans la propriété « Début de semaine ».',
        });
    }
    if (conv.offDay > 0) {
        items.push({
            level: 'warn',
            tab: TAB_HOURS,
            title: `${conv.offDay} ligne(s) heures_semaine dont date_semaine n’est pas un ${dayName}`,
            effect:
                `les semaines commencent le ${dayName} (${conv.source === 'forced' ? 'réglage' : 'détecté'}) ; ` +
                'ces lignes sont rattachées à la semaine qui contient leur date, ce qui peut les placer ' +
                'dans la mauvaise semaine si l’automatisation utilise une autre convention.',
        });
    }
    return items;
}

// Properties without which nothing can be drawn at all. Everything else
// degrades to a named diagnostic instead of an error.
const REQUIRED = [
    {key: 'shiftsTable', label: 'Table Équipe technique (quarts)'},
    {key: 'daysTable', label: 'Table Jours contact'},
    {key: 'weeksTable', label: 'Table Heures semaine'},
    {key: 'shiftContactLink', label: 'Quart — lien Contact'},
    {key: 'shiftDateField', label: 'Quart — date'},
    {key: 'shiftHeuresPayeesField', label: 'Quart — nombre d’heures (payées)'},
    {key: 'dayContactLink', label: 'Jour — lien Contact'},
    {key: 'dayDateField', label: 'Jour — date'},
    {key: 'weekContactLink', label: 'Semaine — lien Contact'},
    {key: 'weekDateSemaineField', label: 'Semaine — date de début de la semaine'},
];

// --- Config gate ---
//
// Runs only the configuration hooks and the guards. useRecords throws on an
// undefined table, so every record-reading hook lives in the loaded component
// below, which is mounted ONLY once the required tables resolved. That keeps
// the rules of hooks satisfied without ever calling useRecords on nothing.
export function App() {
    const base = useBase();
    const {customPropertyValueByKey: cp, errorState} = useCustomProperties(getCustomProperties);

    const missing = useMemo(
        () => (cp ? REQUIRED.filter((r) => !cp[r.key]) : REQUIRED),
        [cp],
    );

    if (errorState) {
        return (
            <Shell>
                <div className="rounded border border-red-red bg-red-redLight2 px-3 py-2 text-sm text-gray-gray900">
                    Erreur de configuration : {errorState.message || 'erreur inconnue'}
                </div>
            </Shell>
        );
    }

    if (missing.length) {
        return (
            <Shell>
                <ConfigCard missing={missing} />
            </Shell>
        );
    }

    return <AppLoaded base={base} cp={cp} />;
}

// --- Loaded app ---
//
// Receives resolved grain tables, so its hooks are safe.
function AppLoaded({base, cp}) {
    const diagnostics = useMemo(() => buildDiagnostics(cp), [cp]);

    const thresholds = useMemo(
        () => ({
            heuresSemaine: readThreshold(cp.seuilHeuresSemaine, DEFAULT_SEUIL_HEURES_SEMAINE),
            heuresJour: readThreshold(cp.seuilHeuresJour, DEFAULT_SEUIL_HEURES_JOUR),
            joursConsecutifs: readThreshold(cp.seuilJoursConsecutifs, DEFAULT_SEUIL_JOURS_CONSECUTIFS),
            reposHeures: readThreshold(cp.seuilReposHeures, DEFAULT_SEUIL_REPOS_HEURES),
        }),
        [cp.seuilHeuresSemaine, cp.seuilHeuresJour, cp.seuilJoursConsecutifs, cp.seuilReposHeures],
    );

    // Data first: the week convention is learned from heures_semaine, and the
    // period cannot be cut into weeks before it is known.
    const data = useGrainData(base, cp);
    const nav = usePeriod({
        defaultTab: cp.defaultTab,
        defaultGrain: cp.defaultGrain,
        weekStartDay: data.weekConvention.startDay,
    });
    const approval = useApproval(cp);

    const allDiagnostics = useMemo(
        () => [
            ...diagnostics,
            ...weekConventionDiagnostics(data.weekConvention),
            ...heuresReellesDiagnostics(data.quality, cp.shiftHeuresReellesField),
        ],
        [diagnostics, data.weekConvention, data.quality, cp.shiftHeuresReellesField],
    );

    const model = useMemo(
        () => buildPeriodModel({period: nav.period, data, thresholds}),
        [nav.period, data, thresholds],
    );

    // A coarse capability check: it decides whether the affordance is shown at
    // all. The precise, field-aware check happens right before each write.
    const canExpandShifts = cp.shiftsTable.hasPermissionToExpandRecords();

    const badges = {
        [TAB_HOURS]: model.totals.anomalies
            ? {text: `${model.totals.anomalies} ⚠`, alert: true}
            : {text: String(model.totals.people)},
        [TAB_PAY]: {text: String(model.people.filter((p) => p.weeks.some(Boolean)).length)},
        [TAB_DISPO]: cp.monthsTable
            ? {text: String(model.people.filter((p) => p.month).length)}
            : null,
    };

    return (
        <Shell>
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="font-display text-lg font-bold text-gray-gray800 dark:text-gray-gray100">
                    Heures &amp; convention
                </h1>
                <p className="text-xs text-gray-gray500 dark:text-gray-gray400">
                    Lecture des grains calculés par Airtable — aucun calcul de convention n’est
                    refait ici.
                </p>
            </header>

            <PeriodBar
                period={nav.period}
                grain={nav.grain}
                grainIsPinned={nav.grainIsPinned}
                onGrain={nav.setGrain}
                onPrev={nav.goPrev}
                onNext={nav.goNext}
                onToday={nav.goToday}
                isToday={nav.isToday}
                subtitle={`${model.totals.people} technicien${model.totals.people > 1 ? 's' : ''}`}
            />

            <Tabs active={nav.tab} onChange={nav.setTab} badges={badges} />

            <Diagnostics items={allDiagnostics} />

            <Feedback feedback={approval.feedback} onClose={approval.clearFeedback} />

            {nav.tab === TAB_PAY && <PeriodApprovalBar model={model} approval={approval} cp={cp} />}

            {nav.tab === TAB_HOURS && (
                <HoursTab
                    model={model}
                    data={data}
                    cp={cp}
                    thresholds={thresholds}
                    nav={nav}
                    canExpandShifts={canExpandShifts}
                    approval={approval}
                />
            )}

            {nav.tab !== TAB_HOURS && <ModelSummary model={model} data={data} nav={nav} />}

            <ConfigSummary base={base} cp={cp} weekConvention={data.weekConvention} />
        </Shell>
    );
}

function Shell({children}) {
    return (
        <div className="min-h-screen bg-gray-gray50 p-4 text-gray-gray900 dark:bg-gray-gray800 dark:text-gray-gray100">
            <div className="flex flex-col gap-3">{children}</div>
        </div>
    );
}

function ConfigCard({missing}) {
    return (
        <div className="mx-auto mt-10 max-w-xl rounded-lg border border-gray-gray200 bg-white p-6 shadow-sm dark:border-gray-gray600 dark:bg-gray-gray700">
            <h2 className="font-display text-base font-semibold text-gray-gray800 dark:text-gray-gray100">
                Configuration requise
            </h2>
            <p className="mt-1 text-sm text-gray-gray600 dark:text-gray-gray300">
                Ouvrez le panneau des propriétés de l’extension et renseignez :
            </p>
            <ul className="ml-5 mt-3 list-disc space-y-1 text-sm text-gray-gray700 dark:text-gray-gray200">
                {missing.map((m) => (
                    <li key={m.key}>{m.label}</li>
                ))}
            </ul>
            <p className="mt-4 border-t border-gray-gray200 pt-3 text-xs text-gray-gray500 dark:border-gray-gray600 dark:text-gray-gray400">
                Si un champ n’apparaît pas dans la liste déroulante, il n’est probablement pas coché
                <span className="font-medium"> Visible </span>
                dans la section <span className="font-medium">Données</span> des réglages de
                l’extension : le SDK ne le voit pas du tout.
            </p>
        </div>
    );
}
