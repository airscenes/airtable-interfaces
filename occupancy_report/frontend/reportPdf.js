import {Document, Page, Text, View, StyleSheet} from '@react-pdf/renderer';
import {fmtDateFr} from './format';

// ============================================================================
// The emailed PDF.
// ----------------------------------------------------------------------------
// Input is a plain `reportData` object, built at send time from the same
// `venues` / `readValue` the on-screen sheet already uses:
//
//   {dayMs, venues: [{venue, general: [{label, value}], events: [{id, title,
//    fields: [{label, value}]}]}]}
//
// Nothing here reads Airtable: the caller has already resolved every field
// through the custom properties, so the screen and the PDF cannot disagree on
// content. They deliberately disagree on presentation — the screen is a
// timeline plus a rich detail pane, this is flat text meant to be read in an
// inbox.
//
// Empty values print as "—" rather than being dropped: the production sheet is
// a checklist, and a blank "Portes" is itself information.
// ============================================================================

// Only the built-in Helvetica is used: it covers French accents through WinAnsi
// encoding, so no font has to be registered or fetched at runtime.
const styles = StyleSheet.create({
    page: {paddingVertical: 40, paddingHorizontal: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#111827'},
    title: {fontFamily: 'Helvetica-Bold', fontSize: 18, color: '#13324b'},
    subtitle: {fontSize: 11, color: '#6b7280', marginTop: 3},
    venue: {marginTop: 18},
    venueName: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 13,
        color: '#13324b',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        paddingBottom: 3,
    },
    eventTitle: {fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 10, marginBottom: 3},
    row: {marginTop: 2, lineHeight: 1.4},
    label: {fontFamily: 'Helvetica-Bold', color: '#6b7280'},
    empty: {color: '#9ca3af'},
    summary: {marginTop: 12, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: '#f3f4f6', borderRadius: 3},
    summaryCount: {fontFamily: 'Helvetica-Bold', fontSize: 11, color: '#13324b'},
    summaryVenues: {fontSize: 9, color: '#6b7280', marginTop: 3},
});

// French plural: 0 and 1 stay singular, 2+ takes the -s.
function plural(n, word) {
    return `${n} ${word}${n > 1 ? 's' : ''}`;
}

// The at-a-glance line, so the report answers "how busy is the day, and where?"
// before anyone scrolls into the per-event detail.
function Summary({venues}) {
    const totalEvents = venues.reduce((n, v) => n + v.events.length, 0);
    return (
        <View style={styles.summary}>
            <Text style={styles.summaryCount}>
                {plural(totalEvents, 'événement')} · {plural(venues.length, 'salle')}
            </Text>
            <Text style={styles.summaryVenues}>
                {venues.map((v) => `${v.venue} (${v.events.length})`).join('   ·   ')}
            </Text>
        </View>
    );
}

function PdfRow({pair}) {
    return (
        <Text style={styles.row}>
            <Text style={styles.label}>{pair.label} : </Text>
            {pair.value ? <Text>{pair.value}</Text> : <Text style={styles.empty}>—</Text>}
        </Text>
    );
}

export function ReportPdf({data}) {
    const dateLabel = fmtDateFr(data.dayMs);
    return (
        <Document title={`Rapport pré-événement — ${dateLabel}`}>
            <Page size="LETTER" style={styles.page}>
                <Text style={styles.title}>Rapport pré-événement</Text>
                <Text style={styles.subtitle}>Journée du {dateLabel}</Text>

                <Summary venues={data.venues} />

                {data.venues.map((venue) => (
                    // Left wrappable on purpose: a venue with many events must be
                    // able to break across pages rather than overflow one.
                    <View key={venue.venue} style={styles.venue}>
                        <Text style={styles.venueName}>{venue.venue.toUpperCase()}</Text>
                        {venue.general.map((pair) => (
                            <PdfRow key={pair.label} pair={pair} />
                        ))}
                        {venue.events.map((event) => (
                            <View key={event.id}>
                                {event.title ? <Text style={styles.eventTitle}>{event.title}</Text> : null}
                                {event.fields.map((pair) => (
                                    <PdfRow key={pair.label} pair={pair} />
                                ))}
                            </View>
                        ))}
                    </View>
                ))}
            </Page>
        </Document>
    );
}
