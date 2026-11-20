import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

// Ayant-droit invoice. Input is plain data resolved by the caller:
//   { emetteurNom, emetteurAdresse, numero, date, periodLabel, organisme, adresse,
//     lines: [{ canalName, etatDate, part, montant }], total }
// Built-in Helvetica only: it covers French accents (WinAnsi), no font to fetch.

const fmt = (v) => `${(Number(v) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const fmtPct = (v) => `${((Number(v) || 0) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

const styles = StyleSheet.create({
  page: { paddingVertical: 44, paddingHorizontal: 48, fontFamily: "Helvetica", fontSize: 10, color: "#111827" },
  header: { flexDirection: "row", justifyContent: "space-between" },
  emetteur: { fontFamily: "Helvetica-Bold", fontSize: 13, color: "#13324b" },
  muted: { color: "#6b7280", marginTop: 2, lineHeight: 1.4 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 20, color: "#13324b", textAlign: "right" },
  meta: { textAlign: "right", marginTop: 3 },
  block: { marginTop: 28 },
  label: { fontFamily: "Helvetica-Bold", fontSize: 9, color: "#6b7280", marginBottom: 3 },
  dest: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  table: { marginTop: 24 },
  th: { flexDirection: "row", backgroundColor: "#13324b", color: "#ffffff", fontFamily: "Helvetica-Bold", paddingVertical: 6, paddingHorizontal: 8 },
  tr: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  cCanal: { flex: 1 },
  cPart: { width: 70, textAlign: "right" },
  cMontant: { width: 100, textAlign: "right" },
  total: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10, paddingHorizontal: 8 },
  totalLabel: { fontFamily: "Helvetica-Bold", fontSize: 12, marginRight: 16 },
  totalValue: { fontFamily: "Helvetica-Bold", fontSize: 12, width: 100, textAlign: "right" },
});

export function InvoicePdf({ data }) {
  return (
    <Document title={`Facture ${data.numero}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            {data.emetteurNom ? <Text style={styles.emetteur}>{data.emetteurNom}</Text> : null}
            {data.emetteurAdresse ? <Text style={styles.muted}>{data.emetteurAdresse}</Text> : null}
          </View>
          <View>
            <Text style={styles.title}>FACTURE</Text>
            <Text style={styles.meta}>No {data.numero}</Text>
            <Text style={styles.meta}>Date : {data.date}</Text>
            <Text style={styles.meta}>Période : {data.periodLabel}</Text>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>AYANT-DROIT</Text>
          <Text style={styles.dest}>{data.organisme}</Text>
          {data.adresse ? <Text style={styles.muted}>{data.adresse}</Text> : null}
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cCanal}>Canal</Text>
            <Text style={styles.cPart}>Part</Text>
            <Text style={styles.cMontant}>Montant</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={styles.cCanal}>{l.canalName}{l.etatDate ? `  (état du ${l.etatDate})` : ""}</Text>
              <Text style={styles.cPart}>{l.part == null ? "" : fmtPct(l.part)}</Text>
              <Text style={styles.cMontant}>{fmt(l.montant)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.total}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>{fmt(data.total)}</Text>
        </View>
      </Page>
    </Document>
  );
}
