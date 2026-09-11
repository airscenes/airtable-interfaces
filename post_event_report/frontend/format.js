// Formatting shared by the on-screen list and the emailed PDF.

// French long date, e.g. "dimanche 10 mai 2026". Accepts an ms timestamp.
export function fmtDateFr(ms) {
    return new Intl.DateTimeFormat('fr-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(new Date(ms));
}

// `YYYY-MM-DD` in local time — the day itself, not a UTC shift of it.
export function isoDate(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Short French date-time for display, e.g. "10 mai 2026, 14:05". Empty on bad input.
export function fmtDateTimeShortFr(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('fr-CA', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(d);
}

// Local day-start ms from a date/date-time value (the event's calendar day).
export function dayMsFromValue(value) {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) {
        const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
        return null;
    }
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

// Parse the portal's `texte_soumis` markdown into {label, value} blocks.
// Shape: "**Label**\nValue\n\n**Label**\nValue…". A block with no bold header
// falls back to {label: '', value: block}.
export function parseTexteSoumis(texte) {
    if (!texte) return [];
    return String(texte)
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => {
            const nl = block.indexOf('\n');
            const head = (nl >= 0 ? block.slice(0, nl) : block).trim();
            const boldMatch = head.match(/^\*\*(.+)\*\*$/);
            if (boldMatch) {
                return {label: boldMatch[1].trim(), value: nl >= 0 ? block.slice(nl + 1).trim() : ''};
            }
            return {label: '', value: block};
        });
}
