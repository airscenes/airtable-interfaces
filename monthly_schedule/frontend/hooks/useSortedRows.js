// Click-to-sort. Nothing in this repo had one, so this is deliberately the
// dumbest thing that works: a sort key, a direction, and a comparator table
// supplied by the caller.
//
// Two rules that matter on a payroll screen:
//  - names compare with Intl.Collator('fr') so accents sort where a French
//    reader expects them (Étienne next to Etienne, not after Z);
//  - null always sorts LAST, in both directions. A missing value is not a small
//    value, and burying the rows that have no data under the ones that do is
//    the wrong default when the missing rows are the anomaly.

import {useCallback, useMemo, useState} from 'react';

const collator = new Intl.Collator('fr', {sensitivity: 'base', numeric: true});

export function compareText(a, b) {
    return collator.compare(String(a ?? ''), String(b ?? ''));
}

export function compareNumber(a, b) {
    const aNull = a === null || a === undefined || Number.isNaN(a);
    const bNull = b === null || b === undefined || Number.isNaN(b);
    if (aNull && bNull) return 0;
    if (aNull) return 1; // nulls last, whatever the direction
    if (bNull) return -1;
    return a - b;
}

export function useSortedRows(rows, comparators, initialKey, initialDir = 'asc') {
    const [sortKey, setSortKey] = useState(initialKey);
    const [dir, setDir] = useState(initialDir);

    const toggle = useCallback(
        (key) => {
            if (key === sortKey) {
                setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
            } else {
                setSortKey(key);
                // Text reads naturally ascending; a number column is almost
                // always asked for "biggest first" on first click.
                setDir(comparators[key]?.numeric ? 'desc' : 'asc');
            }
        },
        [sortKey, comparators],
    );

    const sorted = useMemo(() => {
        const cmp = comparators[sortKey];
        if (!cmp) return rows;
        const sign = dir === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            const base = cmp.compare(a, b);
            // A null is pinned last by its comparator; do not let the direction
            // flip it back to the top.
            if (cmp.numeric) {
                const av = cmp.value?.(a);
                const bv = cmp.value?.(b);
                const aNull = av === null || av === undefined || Number.isNaN(av);
                const bNull = bv === null || bv === undefined || Number.isNaN(bv);
                if (aNull !== bNull) return aNull ? 1 : -1;
            }
            return base * sign;
        });
    }, [rows, comparators, sortKey, dir]);

    return {sorted, sortKey, dir, toggle};
}

// A sort indicator that also says what a click will do.
export function SortArrow({active, dir}) {
    if (!active) return <span className="ml-1 text-gray-gray300">↕</span>;
    return <span className="ml-1 text-blue-blue">{dir === 'asc' ? '↑' : '↓'}</span>;
}
