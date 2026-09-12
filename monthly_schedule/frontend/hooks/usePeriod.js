// The period context every tab shares.
//
// Two pieces of state, no more: an anchor date ("you are here") and the grain
// the user picked on the Heures tab. The active tab then COERCES the grain —
// Paie can only read a week (heures_semaine is one row per week) and 9.04 only
// a month (dispo_mois is one row per month) — while the Heures preference is
// remembered and restored on return.
//
// Switching tabs never moves the anchor. That is the whole reason for one shared
// context instead of three local ones: from a week on Heures, the Paie tab shows
// that same week's payroll and the 9.04 tab the month containing it.

import {useCallback, useMemo, useState} from 'react';
import {buildPeriod, shiftAnchor, todayIso, weekKeyOf, monthKeyOf} from '../utils/dates';
import {GRAIN_BY_TAB, GRAIN_WEEK, GRAIN_MONTH, TAB_HOURS} from '../constants';

export function usePeriod({defaultTab, defaultGrain}) {
    const [tab, setTab] = useState(defaultTab || TAB_HOURS);
    const [grainPref, setGrainPref] = useState(defaultGrain || GRAIN_WEEK);
    const [anchorIso, setAnchorIso] = useState(todayIso);

    const grain = GRAIN_BY_TAB[tab] ?? grainPref;
    const period = useMemo(() => buildPeriod(anchorIso, grain), [anchorIso, grain]);

    const goPrev = useCallback(
        () => setAnchorIso((a) => shiftAnchor(a, grain, -1)),
        [grain],
    );
    const goNext = useCallback(
        () => setAnchorIso((a) => shiftAnchor(a, grain, 1)),
        [grain],
    );
    const goToday = useCallback(() => setAnchorIso(todayIso()), []);

    // Jump to a specific week or month — used by the empty state's "go to the
    // nearest period that has data" shortcut, and by a row click that changes tab.
    const goToWeek = useCallback((weekKey) => {
        if (weekKey) setAnchorIso(weekKey);
    }, []);
    const goToMonth = useCallback((monthKey) => {
        if (monthKey) setAnchorIso(`${monthKey}-01`);
    }, []);

    // Changing the grain keeps the anchor, so week -> month lands on the month
    // containing that week, and month -> week on the week containing the anchor.
    const setGrain = useCallback((next) => setGrainPref(next), []);

    const isToday = useMemo(() => {
        const now = todayIso();
        return grain === GRAIN_WEEK ? weekKeyOf(now) === period.key : monthKeyOf(now) === period.key;
    }, [grain, period.key]);

    return {
        tab, setTab,
        grain, grainPref, setGrain,
        grainIsPinned: GRAIN_BY_TAB[tab] != null,
        period, anchorIso,
        goPrev, goNext, goToday, goToWeek, goToMonth,
        isToday,
        GRAIN_WEEK, GRAIN_MONTH,
    };
}
