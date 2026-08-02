import {Document, Page, Text, View, Image, StyleSheet} from '@react-pdf/renderer';

// ============================================================================
// The emailed post-event report PDF — one document per day, one section per
// event. Each event's content comes straight from the portal's `texte_soumis`
// (already parsed into {label, value} blocks), so the PDF matches what the
// gérant submitted.
//
//   {dateFr, events: [{identifiant, blocks: [{label, value}]}]}
//
// Built-in Helvetica only (covers French accents via WinAnsi). Empty values
// print as "—".
// ============================================================================

const NAVY = '#13324b';

const styles = StyleSheet.create({
    page: {paddingVertical: 40, paddingHorizontal: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#111827'},
    title: {fontFamily: 'Helvetica-Bold', fontSize: 20, color: NAVY, textAlign: 'center'},
    subtitle: {fontSize: 11, color: '#6b7280', textAlign: 'center', marginTop: 3, marginBottom: 6},

    eventHeader: {
        fontFamily: 'Helvetica-Bold',
        fontSize: 13,
        color: NAVY,
        textTransform: 'uppercase',
        borderBottomWidth: 1.5,
        borderBottomColor: NAVY,
        paddingBottom: 3,
        marginTop: 18,
        marginBottom: 6,
    },
    label: {fontFamily: 'Helvetica-Bold', fontSize: 10, color: NAVY, marginTop: 8},
    value: {fontSize: 10, lineHeight: 1.4, marginTop: 1},
    empty: {color: '#9ca3af'},
    imagesLabel: {fontFamily: 'Helvetica-Bold', fontSize: 10, color: NAVY, marginTop: 10},
    image: {marginTop: 6, width: 280, objectFit: 'contain'},
});

export function ReportPdf({data}) {
    return (
        <Document title={`Rapport post-événement — ${data.dateFr}`}>
            <Page size="LETTER" style={styles.page}>
                <Text style={styles.title}>RAPPORT POST-ÉVÉNEMENT</Text>
                <Text style={styles.subtitle}>Journée du {data.dateFr}</Text>

                {data.events.map((event, i) => (
                    // One event per page (the first stays with the header).
                    <View key={event.identifiant + i} break={i > 0}>
                        <Text style={styles.eventHeader}>{event.identifiant || 'Événement'}</Text>
                        {event.submitted ? (
                            event.blocks.map((b, j) => (
                                <View key={j} wrap={false}>
                                    {b.label ? <Text style={styles.label}>{b.label}</Text> : null}
                                    {b.value ? (
                                        <Text style={styles.value}>{b.value}</Text>
                                    ) : (
                                        <Text style={[styles.value, styles.empty]}>—</Text>
                                    )}
                                </View>
                            ))
                        ) : (
                            <Text style={[styles.value, styles.empty]}>Rapport non soumis.</Text>
                        )}
                        {event.images && event.images.length > 0 ? (
                            <View wrap={false}>
                                <Text style={styles.imagesLabel}>Pièces jointes</Text>
                                {event.images.map((src, k) => (
                                    <Image key={k} src={src} style={styles.image} />
                                ))}
                            </View>
                        ) : null}
                    </View>
                ))}
            </Page>
        </Document>
    );
}
