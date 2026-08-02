// Formatting shared by the on-screen sheet and the emailed PDF.

// French long date, e.g. "dimanche 10 mai 2026".
export function fmtDateFr(ms) {
    return new Intl.DateTimeFormat('fr-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(new Date(ms));
}

// `YYYY-MM-DD` in local time — the day the user picked, not a UTC shift of it.
export function isoDate(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
