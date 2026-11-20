// Ayant-droit invoices built from the États de compte (closed periods). Pure
// functions: no Airtable writes here.
//
// Each État dated in the period with a positive solde (Solde soumis) owes every payable
// ayant-droit of its canal: solde × part / sum of the payable parts (= the report's
// Total dû). One facture per Organisme × period, one Dépense line per État (compte
// 5201, or 5202 for a canal whose code is -SD). The facture is linked to its États
// (État « Factures » field): an État is invoiced for an Organisme once one of its
// linked factures belongs to that Organisme.
import { linkedIds, parseIsoParts, isoFromParts } from "./canalPeriod";

export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Factures of a period are recognised by their number: "AD-2026-H2-…" / "AD-2026-07-…".
export const periodPrefix = (period) => `AD-${period.key}-`;

const slug = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  .toUpperCase()
  .slice(0, 24);

// Unique among `taken` (a second facture for the same Organisme and period gets "-2").
export function invoiceNumero(period, nom, taken) {
  const base = `${periodPrefix(period)}${slug(nom) || "AYANT"}`;
  let n = base;
  for (let i = 2; taken.has(n); i++) n = `${base}-${i}`;
  taken.add(n);
  return n;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function etatDate(rec, cfg) {
  const raw = rec.getCellValue(cfg.etatsDateField);
  return isoFromParts(parseIsoParts(raw || rec.getCellValueAsString(cfg.etatsDateField)));
}

// First linked record id of a link cell (or of a lookup through a link).
export function firstLinkedId(rec, field) {
  if (!rec || !field) return null;
  const v = rec.getCellValue(field);
  const first = Array.isArray(v) ? v[0] : null;
  return first?.id || first?.value?.id || first?.linkedRecordId || null;
}

// Ayants-droits by canal: canalId → [{ orgId, nom, part, nonPayable }].
export function ayantsByCanal(ayantsRecords, cfg) {
  const m = new Map();
  for (const rec of ayantsRecords || []) {
    const np = cfg.ayantsNonPayableField ? rec.getCellValue(cfg.ayantsNonPayableField) : null;
    const a = {
      orgId: firstLinkedId(rec, cfg.ayantsNomField),
      nom: rec.getCellValueAsString(cfg.ayantsNomField) || "(organisme manquant)",
      part: Number(rec.getCellValue(cfg.ayantsPartField)) || 0,
      nonPayable: Array.isArray(np) ? np.some((v) => !!(v && typeof v === "object" ? v.value : v)) : !!np,
    };
    for (const canalId of linkedIds(rec, cfg.ayantsCanalLinkField)) {
      if (!m.has(canalId)) m.set(canalId, []);
      m.get(canalId).push(a);
    }
  }
  return m;
}

// What each Organisme is owed from the period's États not yet invoiced to it.
//   candidates  [{ orgId, nom, lines: [{ etatId, etatDate, canalId, canalName, sd, solde, part, montant }], total }]
//   unlinked    ayants-droits whose name isn't an Organisme link (can't be invoiced)
export function buildCandidates({ cfg, period, etatsRecords, ayants, canalById, orgByFactureId }) {
  const byOrg = new Map();
  const unlinked = [];
  for (const etat of etatsRecords || []) {
    const date = etatDate(etat, cfg);
    if (!date || date < period.start || date > period.end) continue;
    const solde = Number(etat.getCellValue(cfg.etatsFermetureField)) || 0;
    if (solde <= 0.005) continue;
    const canalId = linkedIds(etat, cfg.etatsCanalLinkField)[0];
    if (!canalId) continue;
    const canal = canalById.get(canalId) || { name: "?", sd: false };
    const payables = (ayants.get(canalId) || []).filter((a) => !a.nonPayable && a.part > 0);
    const payablePart = payables.reduce((s, a) => s + a.part, 0);
    if (payablePart <= 0) continue;
    const invoiced = new Set(
      linkedIds(etat, cfg.etatsFacturesLinkField).map((fid) => orgByFactureId.get(fid)).filter(Boolean),
    );
    for (const a of payables) {
      if (!a.orgId) { unlinked.push({ canalName: canal.name, nom: a.nom }); continue; }
      if (invoiced.has(a.orgId)) continue;
      const montant = round2((solde * a.part) / payablePart);
      if (montant <= 0) continue;
      if (!byOrg.has(a.orgId)) byOrg.set(a.orgId, { orgId: a.orgId, nom: a.nom, lines: [], total: 0 });
      const org = byOrg.get(a.orgId);
      org.lines.push({ etatId: etat.id, etatDate: date, canalId, canalName: canal.name, sd: canal.sd, solde, part: a.part, montant });
      org.total = round2(org.total + montant);
    }
  }
  const candidates = [...byOrg.values()]
    .map((o) => ({ ...o, lines: o.lines.sort((x, y) => x.canalName.localeCompare(y.canalName, "fr") || x.etatDate.localeCompare(y.etatDate)) }))
    .sort((x, y) => x.nom.localeCompare(y.nom, "fr"));
  return { candidates, unlinked };
}

// Fields of a new facture.
export function factureFields({ cfg, numero, candidate, date }) {
  const f = {};
  const set = (field, value) => { if (field && !field.isComputed) f[field.id] = value; };
  set(cfg.facturesNumeroField, numero);
  set(cfg.facturesOrganismeField, [{ id: candidate.orgId }]);
  set(cfg.facturesDateField, date);
  if (cfg.statutCreeValue) set(cfg.facturesStatutField, { name: cfg.statutCreeValue });
  // Always "Dépenses" (an ayant-droit invoice is an expense), even if the setting is blank.
  set(cfg.facturesCategorieField, { name: (cfg.facturesCategorieValue || "").trim() || "Dépenses" });
  return f;
}

// Fields of one Dépense line of a facture (one per État).
export function ligneFields({ cfg, candidate, line, factureId, compteId, date }) {
  const f = {};
  const set = (field, value) => { if (field && !field.isComputed) f[field.id] = value; };
  set(cfg.depensesCanalLinkField, [{ id: line.canalId }]);
  if (compteId) set(cfg.depensesCategorieField, [{ id: compteId }]);
  set(cfg.depensesMontantField, round2(line.montant));
  set(cfg.depensesDateWriteField, date);
  set(cfg.depensesFactureLinkField, [{ id: factureId }]);
  set(cfg.depensesNotesField, `Ayant-droit ${candidate.nom} — état de compte du ${line.etatDate}`);
  return f;
}
