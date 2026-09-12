// Parse the `clauses_appliquees` text fields into displayable chips.
//
// Airtable's scripts decide which clauses apply and write them into a plain text
// field. The exact wording is theirs and may change, so we look for article
// numbers rather than matching whole sentences: "4.03 B", "4.03B", "art. 4.03 B"
// and "majoration 4.03 B — plus de 12 h" all yield the same code.

import {CLAUSE_INFO, SEVERITY_ORDER} from '../constants';

// An article number, optionally followed by a sub-letter: 4.01, 4.03 A, 11.04.
const CLAUSE_RE = /\b(\d{1,2}\.\d{2})\s*([AB])?\b/gi;

export function normalizeClauseCode(number, letter) {
    return letter ? `${number}${letter.toUpperCase()}` : number;
}

// "4.02 heures de nuit; 4.03 B" -> [{code, label, severity}], deduped, most
// severe first. Text with no recognizable article yields a single chip carrying
// the raw text, so an unexpected wording is still shown rather than swallowed.
export function parseClauses(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return [];

    const seen = new Map();
    let m;
    CLAUSE_RE.lastIndex = 0;
    while ((m = CLAUSE_RE.exec(raw)) !== null) {
        const code = normalizeClauseCode(m[1], m[2]);
        if (seen.has(code)) continue;
        const info = CLAUSE_INFO[code];
        seen.set(code, {
            code,
            label: info?.label ?? '',
            severity: info?.severity ?? 'info',
            known: Boolean(info),
        });
    }

    if (!seen.size) {
        return [{code: '', label: raw, severity: 'info', known: false}];
    }

    return Array.from(seen.values()).sort(
        (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.code.localeCompare(b.code),
    );
}

// Merge several clause lists (a day's own clauses plus those of its shifts),
// keeping one entry per code.
export function mergeClauses(...lists) {
    const seen = new Map();
    for (const list of lists) {
        for (const c of list ?? []) {
            const key = c.code || c.label;
            if (!seen.has(key)) seen.set(key, c);
        }
    }
    return Array.from(seen.values()).sort(
        (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.code.localeCompare(b.code),
    );
}

export function highestSeverity(clauses) {
    let best = 'none';
    for (const c of clauses ?? []) {
        if (SEVERITY_ORDER[c.severity] > SEVERITY_ORDER[best]) best = c.severity;
    }
    return best;
}

// Count clause hits by code across a list of clause lists — feeds the "clauses
// déclenchées" KPI and the per-person flags.
export function countClauses(lists) {
    const counts = {};
    for (const list of lists) {
        for (const c of list ?? []) {
            if (!c.code) continue;
            counts[c.code] = (counts[c.code] ?? 0) + 1;
        }
    }
    return counts;
}
