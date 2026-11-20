// Period / solde logic shared by artist_report and rights_holder.
// Keep the two copies identical (artist_report/frontend/canalPeriod.js and
// rights_holder/frontend/canalPeriod.js).
import { useMemo, useRef } from "react";
import { useRecords } from "@airtable/blocks/interface/ui";

export const MONTHS_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

export function monthIsoDate(year, monthIdx) {
  const mm = String(monthIdx).padStart(2, "0");
  return `${year}-${mm}-01`;
}

export function parseIsoParts(value) {
  // Handle string ISO date, array (lookup), { value } wrapped, or FR format "28/02/2026"
  let iso = value;
  if (Array.isArray(iso)) iso = iso[0];
  if (iso && typeof iso === "object" && iso.value) iso = iso.value;
  if (!iso || typeof iso !== "string") return null;

  // FR locale: "28/02/2026" or "28/2/2026"
  if (iso.includes("/")) {
    const parts = iso.split("/").map((s) => parseInt(s, 10));
    if (parts.length === 3) {
      const [d, m, y] = parts;
      if (y && m && d) return { year: y, month: m, day: d };
    }
    return null;
  }

  // ISO: "2026-02-28" or "2026-02-28T..."
  const [y, m, d] = iso.slice(0, 10).split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  return { year: y, month: m, day: d };
}

// "YYYY-MM-DD" from parseIsoParts output ("" when unparseable), for string comparisons.
export function isoFromParts(p) {
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` : "";
}

export const pad2 = (n) => String(n).padStart(2, "0");

// A reporting period: a half-year (H1/H2) or a single month, from the PeriodPicker
// selection { granularity: "half" | "month", year, half, month }. Bounds are ISO
// strings compared as strings (no Date objects, so no timezone shift).
//   start / end  first and last day, inclusive
//   next         first day after the period (exclusive bound)
//   prevStart    start of the previous period of the same granularity (rattrapages)
//   closeFrom    first day of the period's last month: an État de compte dated from
//                there on closes the period (older États are not always dated on the
//                last day, e.g. 2025-12-01 for July–December)
export function buildPeriod({ granularity, year, half, month }) {
  if (granularity === "month") {
    const lastDay = new Date(year, month, 0).getDate();
    const [py, pm] = month === 1 ? [year - 1, 12] : [year, month - 1];
    const [ny, nm] = month === 12 ? [year + 1, 1] : [year, month + 1];
    return {
      key: `${year}-${pad2(month)}`,
      year,
      months: [month],
      start: `${year}-${pad2(month)}-01`,
      end: `${year}-${pad2(month)}-${pad2(lastDay)}`,
      next: `${ny}-${pad2(nm)}-01`,
      prevStart: `${py}-${pad2(pm)}-01`,
      closeFrom: `${year}-${pad2(month)}-01`,
      label: `${MONTHS_FR[month - 1].toUpperCase()} ${year}`,
      shortLabel: `${MONTHS_FR[month - 1].toLowerCase()} ${year}`,
      fileLabel: `${year}-${pad2(month)}`,
    };
  }
  const h1 = half !== "H2";
  return {
    key: `${year}-${h1 ? "H1" : "H2"}`,
    year,
    months: h1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12],
    start: h1 ? `${year}-01-01` : `${year}-07-01`,
    end: h1 ? `${year}-06-30` : `${year}-12-31`,
    next: h1 ? `${year}-07-01` : `${year + 1}-01-01`,
    prevStart: h1 ? `${year - 1}-07-01` : `${year}-01-01`,
    closeFrom: h1 ? `${year}-06-01` : `${year}-12-01`,
    label: h1 ? `JAN - JUIN ${year}` : `JUIL - DEC ${year}`,
    shortLabel: h1 ? `janv.–juin ${year}` : `juil.–déc. ${year}`,
    fileLabel: h1 ? `Jan-Juin_${year}` : `Juil-Dec_${year}`,
  };
}

export const defaultPeriodSelection = () => ({
  granularity: "half",
  year: new Date().getFullYear(),
  half: "H1",
  month: new Date().getMonth() + 1,
});

export function isInPeriod(value, period) {
  const iso = isoFromParts(parseIsoParts(value));
  return !!iso && iso >= period.start && iso <= period.end;
}

// First non-empty value among the given date fields (read field, then write field).
export function readEntryDate(rec, dateFields) {
  let d = null;
  for (const f of dateFields) {
    if (!f) continue;
    d = rec.getCellValue(f);
    if (d == null) d = rec.getCellValueAsString(f);
    if (d != null && d !== "") break;
  }
  return d;
}

export const linksTo = (rec, field, id) => {
  if (!field || !id) return false;
  const v = rec.getCellValue(field);
  return Array.isArray(v) && v.some((l) => l.id === id);
};

export const linkedIds = (rec, field) => {
  if (!rec || !field) return [];
  const v = rec.getCellValue(field);
  return Array.isArray(v) ? v.map((l) => l.id) : [];
};


// --- Per-canal period computation (saved Airtable data only) ---
// Shared by the canal page (which adds its unsaved grid/saisies on top) and the
// artist page (saved entries only).
//
// The canal's États de compte split its timeline: each État covers the days after
// the previous État up to its own date. For the period:
//   closed   no État falls inside the period before its last month, and one is dated
//            from period.closeFrom on: that État covers the whole period
//   partial  an État is dated inside the period before its last month (e.g. a monthly
//            État within a half-year): the period can only be closed month by month
//   open     no État dated on or after the period start
// Open period: unlinked entries of the period, plus rattrapages (older unlinked
// entries) when the previous État closed the period right before this one.
// Solde after a period's net (before 52xx payments). A loss is carried in full; a profit
// first recoups a carried deficit in full, then only the payable ayants-droits' share of
// the rest is added: the non-payable ones (e.g. the producer) are never paid in 52xx, so
// their share would pile up in the solde.
export function soldeApresNet(soldePrecedent, net, producteurPart) {
  if (net <= 0) return soldePrecedent + net;
  const recoup = Math.min(net, Math.max(-soldePrecedent, 0));
  return soldePrecedent + recoup + (net - recoup) * (1 - producteurPart);
}

// What the ayants-droits split: the period's profit left after recouping a carried deficit.
export const netAPartager = (soldePrecedent, net) => Math.max(net - Math.max(-soldePrecedent, 0), 0);

export const producteurPartOf = (ayantsDroits) => ayantsDroits.reduce((s, a) => s + (a.nonPayable ? a.part : 0), 0);

export function computeCanalPeriod({ canalId, period, cfg, records, revenusChoices, soldeCompteId, soldeReporteCompteId, paiementCompteIds }) {
  const {
    revenusCanalLinkField, revenusDateField, revenusDateWriteField, revenusMontantField,
    revenusCategorieField, revenusEtatLinkField, revenusNotesField,
    depensesCanalLinkField, depensesDateField, depensesDateWriteField, depensesMontantField,
    depensesCategorieField, depensesEtatLinkField,
    ayantsTable, ayantsCanalLinkField, ayantsNomField, ayantsPartField, ayantsNonPayableField,
    etatsTable, etatsCanalLinkField, etatsDateField, etatsFermetureField,
  } = cfg;

  const etats = !etatsTable || !etatsCanalLinkField || !etatsDateField || !records.etats ? [] : records.etats
    .filter((rec) => linksTo(rec, etatsCanalLinkField, canalId))
    // Raw value is ISO; the string form follows the field's display format (e.g. 30/06/2026).
    .map((rec) => {
      const raw = rec.getCellValue(etatsDateField);
      return { rec, date: isoFromParts(parseIsoParts(raw || rec.getCellValueAsString(etatsDateField))) };
    })
    .filter((e) => e.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  let previousEtat = null;
  for (const e of etats) if (e.date < period.start) previousEtat = e;
  const innerEtats = etats.filter((e) => e.date >= period.start && e.date < period.closeFrom);
  const currentEtat = innerEtats.length ? null : etats.find((e) => e.date >= period.closeFrom) || null;
  const status = innerEtats.length ? "partial" : currentEtat ? "closed" : "open";
  // Closed/partial: entries linked to the État(s) of the period are shown as reported.
  const reportedEtatIds = new Set(
    (status === "partial" ? etats.filter((e) => e.date >= period.start && e.date <= period.end) : currentEtat ? [currentEtat] : [])
      .map((e) => e.rec.id),
  );
  // An État dated after the period (e.g. a half-year État seen from one of its months)
  // also holds other periods' entries: keep the ones dated in this period.
  const currentEtatInside = !!currentEtat && currentEtat.date <= period.end;
  const acceptsRattrapages = status === "open" && !!previousEtat && previousEtat.date >= period.prevStart;

  // Unlinked entries dated between the previous État and the period that this period
  // doesn't pull in: an earlier period is still open, so closing this one would skip them.
  let orphanCount = 0;
  const filterEntries = (recs, canalLinkField, etatLinkField, dateFields) => {
    if (!recs || !canalId || !canalLinkField || !etatLinkField || !dateFields.some(Boolean)) return [];
    return recs.filter((rec) => {
      if (!linksTo(rec, canalLinkField, canalId)) return false;
      const etat = linkedIds(rec, etatLinkField);
      const d = readEntryDate(rec, dateFields);
      if (status !== "open") {
        if (!etat.some((id) => reportedEtatIds.has(id))) return false;
        return status === "partial" || currentEtatInside || isInPeriod(d, period);
      }
      if (etat.length > 0) return false;
      if (isInPeriod(d, period)) return true;
      const iso = isoFromParts(parseIsoParts(d));
      if (!iso || iso >= period.start) return false;
      if (acceptsRattrapages) return true;
      if (previousEtat && iso > previousEtat.date) orphanCount += 1;
      return false;
    });
  };

  const revenusDateFields = [revenusDateField, revenusDateWriteField];
  const existingRevenus = filterEntries(records.revenus, revenusCanalLinkField, revenusEtatLinkField, revenusDateFields);
  // Dépenses on the paiement comptes (e.g. 52xx) are payments of the canal's balance,
  // placed in a period by their invoice date like any entry: they lower the solde de
  // fermeture but aren't dépenses of the period (not in the net that is split).
  const isPaiement = (rec) => !!paiementCompteIds?.size
    && linkedIds(rec, depensesCategorieField).some((id) => paiementCompteIds.has(id));
  const allDepenses = filterEntries(records.depenses, depensesCanalLinkField, depensesEtatLinkField, [depensesDateField, depensesDateWriteField]);
  const existingDepenses = allDepenses.filter((rec) => !isPaiement(rec));
  const existingPaiements = allDepenses.filter(isPaiement);

  // Map saved revenus onto grid cells: { month: { colId: amount } }. A record matches a
  // column by its Notes label, falling back to its Compte link. `gridIds` = records
  // placed in the grid, kept out of the report's "autres revenus" list (else counted twice).
  const revenusByCell = {};
  const gridIds = new Set();
  if (revenusMontantField && revenusCategorieField && revenusChoices.length > 0) {
    for (const rec of existingRevenus) {
      const d = readEntryDate(rec, revenusDateFields);
      const parts = parseIsoParts(d);
      if (!parts || !isInPeriod(d, period)) continue;
      const cat = rec.getCellValue(revenusCategorieField);
      const compteId = Array.isArray(cat) && cat[0] ? cat[0].id : null;
      const notes = revenusNotesField ? rec.getCellValueAsString(revenusNotesField) : "";
      let col = revenusChoices.find((c) => c.label === notes && c.compteId === compteId);
      if (!col) col = revenusChoices.find((c) => c.label === notes);
      if (!col) col = revenusChoices.find((c) => c.compteId === compteId);
      if (!col) continue;
      const amt = Number(rec.getCellValue(revenusMontantField)) || 0;
      if (!revenusByCell[parts.month]) revenusByCell[parts.month] = {};
      revenusByCell[parts.month][col.id] = (revenusByCell[parts.month][col.id] || 0) + amt;
      gridIds.add(rec.id);
    }
  }

  // Ayants-droits of the canal, for the PARTAGE section of the Excel report.
  // `part` is the fraction stored by the percent field (0.5 = 50 %).
  const ayantsDroits = !ayantsTable || !ayantsCanalLinkField || !ayantsPartField || !records.ayants ? [] : records.ayants
    .filter((rec) => linksTo(rec, ayantsCanalLinkField, canalId))
    // A row left blank (no name, no part) is ignored rather than shown under its record id.
    .filter((rec) => !ayantsNomField || rec.getCellValueAsString(ayantsNomField) || Number(rec.getCellValue(ayantsPartField)))
    .map((rec) => {
      const nom = (ayantsNomField ? rec.getCellValueAsString(ayantsNomField) || "(organisme manquant)" : rec.name) || "";
      // `key` identifies the same ayant-droit across canaux (artist Sommaire columns):
      // the linked Organisme's id when the name field is a link (or a lookup through
      // the link), else the name itself.
      const linked = ayantsNomField ? rec.getCellValue(ayantsNomField) : null;
      const first = Array.isArray(linked) ? linked[0] : null;
      const id = first?.id || first?.value?.id || first?.linkedRecordId;
      const key = id || `name:${nom.trim()}`;
      // Checkbox, or a lookup of one (array of values, possibly wrapped in { value }).
      const np = ayantsNonPayableField ? rec.getCellValue(ayantsNonPayableField) : null;
      const nonPayable = Array.isArray(np) ? np.some((v) => !!(v && typeof v === "object" ? v.value : v)) : !!np;
      return { key, nom, part: Number(rec.getCellValue(ayantsPartField)) || 0, nonPayable };
    });

  const sum = (recs, f) => (!f ? 0 : recs.reduce((s, r) => s + (Number(r.getCellValue(f)) || 0), 0));
  // Revenus on the "Solde d'ouverture" compte (4000) add to Solde précédent;
  // dépenses on the "Solde reporté" compte (5000) subtract from it.
  const isSoldeEntry = (rec) => !!soldeCompteId && linksTo(rec, revenusCategorieField, soldeCompteId);
  const isSoldeReporteEntry = (rec) => !!soldeReporteCompteId && linksTo(rec, depensesCategorieField, soldeReporteCompteId);
  const soldeEntriesTotal = sum(existingRevenus.filter(isSoldeEntry), revenusMontantField);
  const soldeReporteEntriesTotal = sum(existingDepenses.filter(isSoldeReporteEntry), depensesMontantField);
  const soldeFermeturePrecedent = previousEtat && etatsFermetureField
    ? Number(previousEtat.rec.getCellValue(etatsFermetureField)) || 0
    : 0;
  const soldePrecedent = soldeFermeturePrecedent + soldeEntriesTotal - soldeReporteEntriesTotal;
  const totalRevenus = sum(existingRevenus, revenusMontantField) - soldeEntriesTotal;
  const totalDepenses = sum(existingDepenses, depensesMontantField) - soldeReporteEntriesTotal;
  const totalPaiements = sum(existingPaiements, depensesMontantField);
  const producteurPart = producteurPartOf(ayantsDroits);
  const net = totalRevenus - totalDepenses;

  return {
    status, previousEtat, currentEtat, innerEtats, orphanCount,
    existingRevenus, existingDepenses, existingPaiements, revenusByCell, gridIds, ayantsDroits,
    // Entries listed in the Excel report (grid and solde entries are shown elsewhere).
    reportRevenus: existingRevenus.filter((r) => !gridIds.has(r.id) && !isSoldeEntry(r)),
    reportDepenses: existingDepenses.filter((r) => !isSoldeReporteEntry(r)),
    soldeEntriesTotal, soldeReporteEntriesTotal, soldeFermeturePrecedent, soldePrecedent,
    totalRevenus, totalDepenses, totalPaiements, producteurPart,
    // Net of the period: what the ayants-droits split. The solde is global: it carries
    // over (positive or not) until 52xx payments bring it down.
    net,
    soldeFermeture: soldeApresNet(soldePrecedent, net, producteurPart) - totalPaiements,
  };
}


// Comptes [{ id, name, code, identifiant }] of the Comptes table. The interface page's search bar
// also filters useRecords, so typing e.g. a canal name there empties the Comptes list:
// every compte seen so far is kept, so a search can only hide comptes from useRecords,
// never from the dropdowns.
export function useComptes(comptesTable, comptesNumeroField, comptesIdentifiantField) {
  const comptesRecords = useRecords(comptesTable);
  const seenRef = useRef(new Map());
  return useMemo(() => {
    const seen = seenRef.current;
    for (const rec of comptesRecords || []) {
      const code = getCompteCode(rec, comptesNumeroField);
      // Skip records whose cell values aren't loaded yet rather than caching a null code.
      if (code == null) continue;
      const identifiant = comptesIdentifiantField ? rec.getCellValueAsString(comptesIdentifiantField) : "";
      seen.set(rec.id, { id: rec.id, name: rec.name, code, identifiant });
    }
    return Array.from(seen.values());
  }, [comptesRecords, comptesNumeroField, comptesIdentifiantField]);
}

export function compteIdByCode(comptes, raw) {
  const code = parseInt(String(raw || "").trim(), 10);
  if (isNaN(code)) return null;
  const c = comptes.find((x) => x.code === code);
  return c ? c.id : null;
}

// Ids of the comptes whose code matches a compact list: "52xx" (x = any digit),
// "5200-5299" (inclusive range) or "5310", separated by commas or spaces.
export function compteIdsByPattern(comptes, raw) {
  const tests = String(raw || "")
    .toLowerCase()
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((p) => {
      const range = p.match(/^(\d+)-(\d+)$/);
      if (range) return (code) => code >= Number(range[1]) && code <= Number(range[2]);
      if (!/^[\dx]+$/.test(p)) return null;
      const re = new RegExp(`^${p.replace(/x/g, "\\d")}$`);
      return (code) => re.test(String(code));
    })
    .filter(Boolean);
  if (tests.length === 0) return new Set();
  return new Set(comptes.filter((c) => tests.some((t) => t(c.code))).map((c) => c.id));
}


// Read a Compte's numero from the configured field, fallback parses from name.
// Used to classify comptes: < 5000 = Revenu, >= 5000 = Dépense.
export function getCompteCode(rec, numeroField) {
  if (numeroField) {
    const raw = rec.getCellValue(numeroField);
    const n = typeof raw === "number" ? raw : parseFloat(String(raw || ""));
    if (!isNaN(n)) return Math.trunc(n);
  }
  const m = String(rec.name || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}


// Total dû per payable ayant-droit at the end of a period: its share of the period's
// net to split + its share of the solde reporté (soldeFermeture − aPartager × payable
// part, prorated to the payable parts). Sums to soldeFermeture when it is positive.
// Also returns soldeReporte (the template's report.montant).
export function computeDues({ ayantsDroits, aPartager, soldeFermeture }) {
  const payables = ayantsDroits.filter((a) => !a.nonPayable);
  const payablePart = payables.reduce((s, a) => s + a.part, 0);
  const soldeReporte = soldeFermeture - aPartager * payablePart;
  const shareOf = (a) => (payablePart > 0 ? a.part / payablePart : 0);
  const report = soldeReporte > 0.005
    ? payables.map((a) => ({ ayant: a, montant: soldeReporte * shareOf(a) }))
    : [];
  const dues = payables.map((a) => ({
    ayant: a, montant: aPartager * a.part + Math.max(soldeReporte, 0) * shareOf(a),
  }));
  return { payables, soldeReporte, report, dues };
}
