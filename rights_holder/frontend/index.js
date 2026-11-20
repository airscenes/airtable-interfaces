import { useState, useMemo, useRef, useCallback, useEffect, Fragment } from "react";
import {
  initializeBlock,
  useRecords,
  useCustomProperties,
  expandRecord,
} from "@airtable/blocks/interface/ui";
import { FieldType } from "@airtable/blocks/interface/models";
import { pdf } from "@react-pdf/renderer";
import {
  MONTHS_FR, buildPeriod, defaultPeriodSelection, linkedIds,
  useComptes, compteIdByCode, compteIdsByPattern,
} from "./canalPeriod";
import {
  buildCandidates, ayantsByCanal, firstLinkedId, etatDate,
  factureFields, ligneFields, invoiceNumero, periodPrefix, todayIso, round2,
} from "./invoices";
import { InvoicePdf } from "./invoicePdf";
import "./style.css";

// Ayant-droit invoices (« Paiements aux ayants-droits »). From the États de compte of a
// period (closed in artist_report), creates one expense facture per Organisme with one
// Dépense line per État (solde × part), lists the period's factures with their
// Facturé / Payé tags (from Statut) and downloads each one as a PDF.

const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const fmtPct = (v) => `${((Number(v) || 0) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
const safeFileName = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, "_");

// --- Custom properties ---

// Field pickers bind to the table chosen in the settings (`current`), else to a guess
// by name. defaultValue is only set when a field is found (undefined breaks the SDK).
const TABLE_KEYS = ["canauxTable", "depensesTable", "ayantsTable", "etatsTable", "comptesTable", "facturesTable"];

function getCustomProperties(base, current = {}) {
  const tables = base.tables;
  const findTable = (...keywords) =>
    tables.find((t) => keywords.some((k) => t.name.toLowerCase().includes(k.toLowerCase())));
  const exact = (name) => tables.find((t) => t.name.toLowerCase() === name.toLowerCase());
  const fld = (table, ...names) => {
    if (!table) return undefined;
    for (const n of names) {
      const f = table.fields.find((x) => x.name.toLowerCase() === n.toLowerCase());
      if (f) return f;
    }
    return undefined;
  };
  const anyField = () => true;

  const canauxGuess = exact("canaux") || findTable("canal", "canaux") || tables[0];
  const depensesGuess = exact("dépenses") || findTable("depense", "dépense") || tables[0];
  const ayantsGuess = findTable("ayant") || tables[0];
  const etatsGuess = exact("états de compte") || findTable("état", "etat") || tables[0];
  const comptesGuess = exact("comptes") || findTable("compte") || tables[0];
  const facturesGuess = exact("factures") || findTable("facture") || tables[0];
  const canauxTable = current.canauxTable || canauxGuess;
  const depensesTable = current.depensesTable || depensesGuess;
  const ayantsTable = current.ayantsTable || ayantsGuess;
  const etatsTable = current.etatsTable || etatsGuess;
  const comptesTable = current.comptesTable || comptesGuess;
  const facturesTable = current.facturesTable || facturesGuess;
  const tableProp = (key, label, guess) => {
    const p = { key, label, type: "table" };
    if (guess) p.defaultValue = guess;
    return p;
  };

  const isSingleSelect = (f) => f.config?.type === FieldType.SINGLE_SELECT;
  const selectField = (key, label, table, ...defaults) => ({ ...field(key, label, table, ...defaults), shouldFieldBeAllowed: isSingleSelect });
  function field(key, label, table, ...defaults) {
    const p = { key, label, type: "field", table, shouldFieldBeAllowed: anyField };
    const d = fld(table, ...defaults);
    if (d) p.defaultValue = d;
    return p;
  }
  const text = (key, label, defaultValue = "") => ({ key, label, type: "string", defaultValue });

  return [
    // --- États de compte (périodes clôturées) ---
    tableProp("etatsTable", "Table des États de compte", etatsGuess),
    field("etatsCanalLinkField", "Lien Canal (États de compte)", etatsTable, "Canal"),
    field("etatsDateField", "Champ Date (États de compte)", etatsTable, "Date de l'état de compte"),
    field("etatsFermetureField", "Champ Solde fermeture (États de compte) — montant à partager", etatsTable, "Solde soumis"),
    field("etatsFacturesLinkField", "Lien Factures (États de compte) — marque l'état comme facturé", etatsTable, "Factures"),

    // --- Ayants-droits ---
    tableProp("ayantsTable", "Table des Ayants-droits", ayantsGuess),
    field("ayantsCanalLinkField", "Lien Canal (Ayants-droits)", ayantsTable, "Canaux"),
    field("ayantsNomField", "Lien Organismes (Ayants-droits)", ayantsTable, "Organismes"),
    field("ayantsPartField", "Champ Part % (Ayants-droits)", ayantsTable, "parts"),
    field("ayantsNonPayableField", "Case Non payable (Ayants-droits)", ayantsTable, "non_payable"),

    // --- Canaux ---
    tableProp("canauxTable", "Table des Canaux", canauxGuess),
    field("canalCodeField", "Champ code du canal (Canaux) — ex. code_canal", canauxTable, "code_canal"),
    text("codeSDValue", "Code canal qui utilise le compte SD (ex. -SD)", "-SD"),

    // --- Factures ---
    tableProp("facturesTable", "Table des Factures", facturesGuess),
    field("facturesNumeroField", "Champ Numéro de facture (Factures)", facturesTable, "Numéro de facture"),
    field("facturesOrganismeField", "Lien Organismes (Factures)", facturesTable, "Organismes"),
    field("facturesDateField", "Champ Date de la facture (Factures)", facturesTable, "Date de la facture"),
    field("facturesTotalField", "Champ Total (Factures, rollup des lignes)", facturesTable, "Total net"),
    selectField("facturesStatutField", "Champ Statut (Factures, single select)", facturesTable, "Statut"),
    text("statutCreeValue", "Statut à la création", "En attente / Soumission"),
    text("statutFactureValue", "Statut une fois le PDF généré (Facturé)", "À payer"),
    text("statutPayeValue", "Statut d'une facture payée", "Payée"),
    selectField("facturesCategorieField", "Champ Catégorie de factures (Factures, single select) — reçoit « Dépenses »", facturesTable, "Catégorie de factures"),
    text("facturesCategorieValue", "Catégorie des factures créées", "Dépenses"),
    field("facturesAttachmentField", "Champ pièce jointe Facture (Factures, optionnel)", facturesTable, "Facture"),
    field("facturesAdresseField", "Champ adresse de l'organisme (Factures, optionnel, pour le PDF)", facturesTable, "Adresse de l'organisme"),

    // --- Dépenses (lignes des factures) ---
    tableProp("depensesTable", "Table des Dépenses", depensesGuess),
    field("depensesCanalLinkField", "Lien Canal (Dépenses)", depensesTable, "Canaux"),
    field("depensesCategorieField", "Lien Comptes (Dépenses)", depensesTable, "Comptes"),
    field("depensesMontantField", "Champ Montant (Dépenses)", depensesTable, "Montant"),
    field("depensesDateWriteField", "Champ Date de facture (Dépenses) — date du jour écrite sur les lignes", depensesTable, "Date de facture"),
    field("depensesFactureLinkField", "Lien Factures (Dépenses)", depensesTable, "Factures"),
    field("depensesNotesField", "Champ Notes (Dépenses, optionnel)", depensesTable, "Notes"),

    // --- Comptes ---
    tableProp("comptesTable", "Table des Comptes", comptesGuess),
    field("comptesNumeroField", "Champ numero_compte (Comptes)", comptesTable, "numero_compte"),
    text("compteAyant", "No de compte des factures d'ayants-droits", "5201"),
    text("compteAyantSD", "No de compte des factures d'ayants-droits (canal SD)", "5202"),
    text("paiementsComptes", "Comptes de paiement d'artist_report (même valeur, ex. 52xx) — vérification seulement", ""),

    // --- PDF ---
    text("emetteurNom", "PDF — nom de l'émetteur (ex. le label)", ""),
    text("emetteurAdresse", "PDF — adresse de l'émetteur", ""),
  ];
}

const REQUIRED = [
  ["etatsTable", "Table des États de compte"], ["etatsCanalLinkField", "Lien Canal (États de compte)"],
  ["etatsDateField", "Date (États de compte)"], ["etatsFermetureField", "Solde fermeture (États de compte)"],
  ["etatsFacturesLinkField", "Lien Factures (États de compte)"],
  ["ayantsTable", "Table des Ayants-droits"], ["ayantsCanalLinkField", "Lien Canal (Ayants-droits)"],
  ["ayantsNomField", "Lien Organismes (Ayants-droits)"], ["ayantsPartField", "Part % (Ayants-droits)"],
  ["canauxTable", "Table des Canaux"],
  ["facturesTable", "Table des Factures"], ["facturesNumeroField", "Numéro de facture (Factures)"],
  ["facturesOrganismeField", "Lien Organismes (Factures)"], ["facturesCategorieField", "Catégorie de factures (Factures)"],
  ["depensesTable", "Table des Dépenses"], ["depensesCanalLinkField", "Lien Canal (Dépenses)"],
  ["depensesCategorieField", "Lien Comptes (Dépenses)"], ["depensesMontantField", "Montant (Dépenses)"],
  ["depensesFactureLinkField", "Lien Factures (Dépenses)"],
  ["comptesTable", "Table des Comptes"],
];

// --- Small UI pieces ---

function SegmentedButtons({ options, value, onChange }) {
  return (
    <div className="flex border border-gray-gray200 dark:border-gray-gray600 rounded overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-base ${
            value === o.value
              ? "bg-blue-blue text-white"
              : "bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SelectWithArrow({ value, onChange, children }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="appearance-none bg-white dark:bg-gray-gray700 border border-gray-gray200
                   dark:border-gray-gray600 rounded px-3 py-1.5 pr-8 text-base
                   text-gray-gray700 dark:text-gray-gray100"
      >
        {children}
      </select>
      <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-gray500" viewBox="0 0 20 20" fill="currentColor">
        <path d="M5.5 7.5l4.5 4.5 4.5-4.5z" />
      </svg>
    </div>
  );
}

function PeriodPicker({ value, onChange }) {
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now - 4; y <= now + 1; y++) years.push(y);
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <SegmentedButtons
        options={[{ value: "month", label: "Mois" }, { value: "half", label: "Semestre" }]}
        value={value.granularity}
        onChange={(granularity) => set({ granularity })}
      />
      <label className="flex items-center gap-2 text-base">
        <span className="text-gray-gray600 dark:text-gray-gray300">Année</span>
        <SelectWithArrow value={value.year} onChange={(year) => set({ year })}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </SelectWithArrow>
      </label>
      {value.granularity === "month" ? (
        <SelectWithArrow value={value.month} onChange={(month) => set({ month })}>
          {MONTHS_FR.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </SelectWithArrow>
      ) : (
        <SegmentedButtons
          options={[{ value: "H1", label: "Janvier – Juin" }, { value: "H2", label: "Juillet – Décembre" }]}
          value={value.half}
          onChange={(half) => set({ half })}
        />
      )}
    </div>
  );
}

function Tag({ color, children }) {
  const classes = {
    green: "bg-green-greenLight2 text-green-greenDark1",
    orange: "bg-orange-orangeLight2 text-orange-orangeDark1",
    yellow: "bg-yellow-yellowLight2 text-yellow-yellowDark1",
    gray: "bg-gray-gray100 text-gray-gray600 dark:bg-gray-gray600 dark:text-gray-gray100",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-sm font-medium whitespace-nowrap ${classes[color] || classes.gray}`}>
      {children}
    </span>
  );
}

function Total({ label, value }) {
  return (
    <div className="text-base text-gray-gray600 dark:text-gray-gray300">
      <span className="font-semibold text-gray-gray700 dark:text-gray-gray100">{label} :</span> {fmtCurrency(value)}
    </div>
  );
}

function ConfigPrompt({ missing }) {
  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-gray-gray50 dark:bg-gray-gray800">
      <div className="max-w-md text-gray-gray600 dark:text-gray-gray200">
        <p>Configure ces propriétés de l&apos;extension :</p>
        <ul className="list-disc ml-5 mt-2 text-base">
          {missing.map((m) => <li key={m}>{m}</li>)}
        </ul>
      </div>
    </div>
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const str = (rec, field) => (rec && field ? rec.getCellValueAsString(field) : "");
const num = (rec, field) => (rec && field ? Number(rec.getCellValue(field)) || 0 : 0);


// --- Create modal ---

function CreateModal({ period, candidates, unlinked, warnings, onCancel, onCreate, busy }) {
  const [checked, setChecked] = useState(() => new Set(candidates.map((c) => c.orgId)));
  const [open, setOpen] = useState(() => new Set());
  const toggle = (set, setter, id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };
  const selected = candidates.filter((c) => checked.has(c.orgId));
  const total = selected.reduce((s, c) => s + c.total, 0);

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-start justify-center p-4 overflow-auto">
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-xl w-full max-w-3xl mt-8">
        <div className="p-4 border-b border-gray-gray200 dark:border-gray-gray600">
          <h2 className="text-xl font-display font-bold text-gray-gray700 dark:text-gray-gray100">
            Créer les factures — {period.shortLabel}
          </h2>
          <p className="text-base text-gray-gray500 dark:text-gray-gray300 mt-1">
            États de compte de la période pas encore facturés : une facture par ayant-droit, une ligne par état de compte
            (solde × part). Date de la facture : aujourd&apos;hui.
          </p>
        </div>

        <div className="p-4 space-y-3 max-h-[60vh] overflow-auto">
          {warnings.map((w) => (
            <div key={w} className="text-base p-2 rounded bg-orange-orangeLight2 text-orange-orangeDark1">{w}</div>
          ))}
          {candidates.length === 0 && (
            <p className="text-base text-gray-gray500">Rien à facturer : aucun état de compte de la période avec un solde positif qui n&apos;est pas déjà facturé.</p>
          )}
          {candidates.length > 1 && (
            <label className="flex items-center gap-2 text-base">
              <input
                type="checkbox"
                checked={selected.length === candidates.length}
                onChange={() => setChecked(selected.length === candidates.length ? new Set() : new Set(candidates.map((c) => c.orgId)))}
              />
              Tout cocher
            </label>
          )}
          {candidates.map((c) => (
            <div key={c.orgId} className="border border-gray-gray200 dark:border-gray-gray600 rounded">
              <div className="flex items-center gap-3 p-2">
                <input type="checkbox" checked={checked.has(c.orgId)} onChange={() => toggle(checked, setChecked, c.orgId)} />
                <button className="flex-1 text-left text-base font-medium text-gray-gray700 dark:text-gray-gray100" onClick={() => toggle(open, setOpen, c.orgId)}>
                  {open.has(c.orgId) ? "▾" : "▸"} {c.nom}
                  <span className="ml-2 text-sm text-gray-gray400">{c.lines.length} état{c.lines.length > 1 ? "s" : ""} de compte</span>
                </button>
                <span className="text-base font-semibold">{fmtCurrency(c.total)}</span>
              </div>
              {open.has(c.orgId) && (
                <table className="w-full text-sm mb-2">
                  <tbody>
                    {c.lines.map((l) => (
                      <tr key={l.etatId} className="text-gray-gray600 dark:text-gray-gray300">
                        <td className="pl-10 py-1">{l.canalName}{l.sd ? " (SD)" : ""}</td>
                        <td>État du {l.etatDate}</td>
                        <td className="text-right">{fmtCurrency(l.solde)} × {fmtPct(l.part)}</td>
                        <td className="text-right pr-3">{fmtCurrency(l.montant)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          {unlinked.length > 0 && (
            <details className="text-base text-red-redDark1">
              <summary className="cursor-pointer">{unlinked.length} ayant(s)-droit(s) sans organisme lié (exclus)</summary>
              <ul className="list-disc ml-6 mt-1 text-sm">
                {unlinked.map((u, i) => <li key={i}>{u.canalName} — {u.nom}</li>)}
              </ul>
            </details>
          )}
        </div>

        <div className="p-4 border-t border-gray-gray200 dark:border-gray-gray600 flex items-center justify-between gap-3">
          <span className="text-base text-gray-gray600 dark:text-gray-gray300">
            {selected.length} facture{selected.length > 1 ? "s" : ""} · {fmtCurrency(total)}
          </span>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-base rounded border border-gray-gray200 dark:border-gray-gray600" onClick={onCancel} disabled={busy}>
              Annuler
            </button>
            <button
              className="px-3 py-1.5 text-base rounded bg-blue-blue text-white disabled:opacity-50"
              disabled={busy || selected.length === 0}
              onClick={() => onCreate(selected)}
            >
              {busy ? "Création…" : "Créer les factures"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main page ---

function RightsApp({ cfg }) {
  const {
    canauxTable, depensesTable, ayantsTable, etatsTable, facturesTable, comptesTable,
    comptesNumeroField, canalCodeField, codeSDValue, compteAyant, compteAyantSD, paiementsComptes,
    etatsCanalLinkField, etatsFacturesLinkField,
    depensesCanalLinkField, depensesCategorieField, depensesMontantField, depensesFactureLinkField,
    facturesNumeroField, facturesOrganismeField, facturesDateField, facturesTotalField,
    facturesStatutField, statutCreeValue, statutFactureValue, statutPayeValue, facturesAttachmentField,
    facturesAdresseField, emetteurNom, emetteurAdresse,
  } = cfg;

  const canauxRecords = useRecords(canauxTable);
  const depensesRecords = useRecords(depensesTable);
  const ayantsRecords = useRecords(ayantsTable);
  const etatsRecords = useRecords(etatsTable);
  const facturesRecords = useRecords(facturesTable);
  const comptes = useComptes(comptesTable, comptesNumeroField, null);

  const [periodSel, setPeriodSel] = useState(defaultPeriodSelection);
  const period = useMemo(() => buildPeriod(periodSel), [periodSel]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const paiementCompteIds = useMemo(() => compteIdsByPattern(comptes, paiementsComptes), [comptes, paiementsComptes]);
  const compteId = useMemo(() => compteIdByCode(comptes, compteAyant), [comptes, compteAyant]);
  const compteSDId = useMemo(() => compteIdByCode(comptes, compteAyantSD), [comptes, compteAyantSD]);

  const canalById = useMemo(() => new Map((canauxRecords || []).map((rec) => [rec.id, {
    name: rec.name,
    sd: !!canalCodeField && !!codeSDValue && str(rec, canalCodeField).trim() === codeSDValue.trim(),
  }])), [canauxRecords, canalCodeField, codeSDValue]);
  const ayants = useMemo(() => ayantsByCanal(ayantsRecords, cfg), [ayantsRecords, cfg]);
  const orgByFactureId = useMemo(
    () => new Map((facturesRecords || []).map((rec) => [rec.id, firstLinkedId(rec, facturesOrganismeField)])),
    [facturesRecords, facturesOrganismeField],
  );
  const etatById = useMemo(() => new Map((etatsRecords || []).map((rec) => [rec.id, rec])), [etatsRecords]);

  // Dépense lines of each facture.
  const linesByFacture = useMemo(() => {
    const m = new Map();
    for (const rec of depensesRecords || []) {
      for (const fid of linkedIds(rec, depensesFactureLinkField)) {
        if (!m.has(fid)) m.set(fid, []);
        m.get(fid).push(rec);
      }
    }
    return m;
  }, [depensesRecords, depensesFactureLinkField]);

  // États linked to each facture (État « Factures » field), for the line details.
  const etatsByFacture = useMemo(() => {
    const m = new Map();
    for (const rec of etatsRecords || []) {
      for (const fid of linkedIds(rec, etatsFacturesLinkField)) {
        if (!m.has(fid)) m.set(fid, []);
        m.get(fid).push(rec);
      }
    }
    return m;
  }, [etatsRecords, etatsFacturesLinkField]);

  // Factures of the period, recognised by their number prefix.
  const rows = useMemo(() => {
    const prefix = periodPrefix(period);
    return (facturesRecords || [])
      .filter((rec) => str(rec, facturesNumeroField).startsWith(prefix))
      .map((rec) => {
        const lines = linesByFacture.get(rec.id) || [];
        const statut = str(rec, facturesStatutField);
        const total = facturesTotalField ? num(rec, facturesTotalField) : lines.reduce((s, l) => s + num(l, depensesMontantField), 0);
        return {
          rec,
          numero: str(rec, facturesNumeroField),
          orgId: firstLinkedId(rec, facturesOrganismeField),
          organisme: str(rec, facturesOrganismeField),
          date: str(rec, facturesDateField),
          lines,
          canalIds: [...new Set(lines.flatMap((l) => linkedIds(l, depensesCanalLinkField)))],
          total,
          statut,
          // Everything comes from Statut: created → Facturé (PDF) → Payée.
          paye: !!statutPayeValue && statut === statutPayeValue,
          facture: !!statut && statut !== statutCreeValue,
          hasPdf: !!facturesAttachmentField && (rec.getCellValue(facturesAttachmentField) || []).length > 0,
        };
      })
      .sort((a, b) => a.organisme.localeCompare(b.organisme, "fr"));
  }, [period, facturesRecords, linesByFacture, facturesNumeroField, facturesStatutField, statutPayeValue,
    facturesTotalField, facturesOrganismeField, facturesDateField, facturesAttachmentField,
    depensesMontantField, depensesCanalLinkField, statutCreeValue]);

  const totals = useMemo(() => {
    const du = rows.reduce((s, r) => s + r.total, 0);
    const impaye = rows.reduce((s, r) => s + (r.paye ? 0 : r.total), 0);
    return { du, impaye, paye: du - impaye };
  }, [rows]);

  const calc = useMemo(() => (!showCreate ? null : buildCandidates({
    cfg, period, etatsRecords, ayants, canalById, orgByFactureId,
  })), [showCreate, cfg, period, etatsRecords, ayants, canalById, orgByFactureId]);

  const createWarnings = useMemo(() => {
    const w = [];
    if (!compteId) w.push(`Compte ${compteAyant} introuvable dans la table Comptes : les lignes seront créées sans compte.`);
    if (!compteSDId) w.push(`Compte ${compteAyantSD} (SD) introuvable dans la table Comptes.`);
    const notPaiement = [compteId, compteSDId].filter((id) => id && !paiementCompteIds.has(id));
    if (notPaiement.length) {
      w.push(`Les comptes ${compteAyant} / ${compteAyantSD} ne sont pas dans « Comptes de paiement » : dans artist_report, ces factures ne réduiront pas le solde du canal, et le prochain état de compte contiendra encore ce montant (il serait facturé deux fois).`);
    }
    return w;
  }, [compteId, compteSDId, compteAyant, compteAyantSD, paiementCompteIds]);

  const createInvoices = async (selected) => {
    setBusy(true);
    setMsg(null);
    try {
      const date = todayIso();
      const taken = new Set((facturesRecords || []).map((rec) => str(rec, facturesNumeroField)));
      let nLines = 0;
      for (let i = 0; i < selected.length; i += 50) {
        const chunk = selected.slice(i, i + 50);
        const ids = await facturesTable.createRecordsAsync(chunk.map((candidate) => ({
          fields: factureFields({ cfg, numero: invoiceNumero(period, candidate.nom, taken), candidate, date }),
        })));
        const lignes = chunk.flatMap((candidate, k) => candidate.lines.map((line) => ({
          fields: ligneFields({
            cfg, candidate, line, factureId: ids[k], date,
            compteId: line.sd ? compteSDId || compteId : compteId,
          }),
        })));
        for (let j = 0; j < lignes.length; j += 50) {
          await depensesTable.createRecordsAsync(lignes.slice(j, j + 50));
        }
        nLines += lignes.length;
        // Mark the États as invoiced: add the new factures to their « Factures » links.
        const add = new Map();
        chunk.forEach((candidate, k) => candidate.lines.forEach((line) => {
          if (!add.has(line.etatId)) add.set(line.etatId, []);
          add.get(line.etatId).push(ids[k]);
        }));
        const updates = [...add.entries()].map(([etatId, fids]) => {
          const existing = linkedIds(etatById.get(etatId), etatsFacturesLinkField);
          return { id: etatId, fields: { [etatsFacturesLinkField.id]: [...new Set([...existing, ...fids])].map((id) => ({ id })) } };
        });
        for (let j = 0; j < updates.length; j += 50) {
          await etatsTable.updateRecordsAsync(updates.slice(j, j + 50));
        }
      }
      setShowCreate(false);
      setMsg({ ok: true, text: `${selected.length} facture(s) créée(s), ${nLines} ligne(s) de dépenses.` });
    } catch (e) {
      setMsg({ ok: false, text: `Erreur à la création : ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  // PDF data of a facture row, from its Dépense lines.
  const pdfData = (row) => {
    const etats = etatsByFacture.get(row.rec.id) || [];
    const lines = row.lines.map((l) => {
      const canalId = linkedIds(l, depensesCanalLinkField)[0];
      const etat = etats.find((e) => linkedIds(e, etatsCanalLinkField).includes(canalId));
      const a = (ayants.get(canalId) || []).find((x) => x.orgId === row.orgId);
      return {
        canalName: canalById.get(canalId)?.name || str(l, depensesCanalLinkField),
        etatDate: etat ? etatDate(etat, cfg) : "",
        part: a ? a.part : null,
        montant: num(l, depensesMontantField),
      };
    }).sort((a, b) => a.canalName.localeCompare(b.canalName, "fr"));
    return {
      emetteurNom, emetteurAdresse,
      numero: row.numero,
      date: row.date || todayIso(),
      periodLabel: period.shortLabel,
      organisme: row.organisme,
      adresse: str(row.rec, facturesAdresseField),
      lines,
      total: round2(lines.reduce((s, l) => s + l.montant, 0)),
    };
  };
  const pdfName = (row) => `Facture_${safeFileName(row.organisme)}_${period.fileLabel}.pdf`;

  // Facturé: only moves forward from the creation status (never downgrades a paid one).
  const markFactured = async (list) => {
    if (!facturesStatutField || !statutFactureValue) return;
    const updates = list
      .filter((r) => !r.statut || r.statut === statutCreeValue)
      .map((r) => ({ id: r.rec.id, fields: { [facturesStatutField.id]: { name: statutFactureValue } } }));
    for (let j = 0; j < updates.length; j += 50) await facturesTable.updateRecordsAsync(updates.slice(j, j + 50));
  };

  // One facture → its PDF; several → one ZIP of PDFs (browsers block a burst of downloads).
  const downloadPdfs = async (list) => {
    if (!list.length) return;
    setBusy(true);
    setMsg(null);
    try {
      if (list.length === 1) {
        const blob = await pdf(<InvoicePdf data={pdfData(list[0])} />).toBlob();
        downloadBlob(blob, pdfName(list[0]));
      } else {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        const used = new Set();
        for (const row of list) {
          let name = pdfName(row);
          for (let i = 2; used.has(name); i++) name = pdfName(row).replace(/\.pdf$/, `_${i}.pdf`);
          used.add(name);
          zip.file(name, await pdf(<InvoicePdf data={pdfData(row)} />).toBlob());
        }
        downloadBlob(await zip.generateAsync({ type: "blob" }), `Factures_ayants-droits_${period.fileLabel}.zip`);
      }
      await markFactured(list);
      setSelectedIds(new Set());
      if (list.length > 1) setMsg({ ok: true, text: `${list.length} PDF générés (fichier ZIP).` });
    } catch (e) {
      setMsg({ ok: false, text: `Erreur PDF : ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const toggleIn = (set, setter, id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };
  const selectedRows = rows.filter((r) => selectedIds.has(r.rec.id));
  const allChecked = rows.length > 0 && selectedRows.length === rows.length;

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 text-gray-gray700 dark:text-gray-gray100">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <h1 className="text-3xl font-display font-bold">Paiements aux ayants-droits</h1>
        <div className="flex gap-2">
          <button
            className="px-3 py-1.5 text-base rounded border border-gray-gray200 dark:border-gray-gray600 bg-white dark:bg-gray-gray700 disabled:opacity-50"
            onClick={() => downloadPdfs(selectedRows)}
            disabled={busy || selectedRows.length === 0}
          >
            Générer les PDF{selectedRows.length ? ` (${selectedRows.length})` : ""}
          </button>
          <button
            className="px-3 py-1.5 text-base rounded bg-blue-blue text-white disabled:opacity-50"
            onClick={() => { setMsg(null); setShowCreate(true); }}
            disabled={busy}
          >
            Créer les factures…
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <PeriodPicker value={periodSel} onChange={(v) => { setPeriodSel(v); setExpanded(new Set()); setSelectedIds(new Set()); }} />
        <div className="flex gap-5 flex-wrap">
          <Total label="Total dû" value={totals.du} />
          <Total label="Total impayé" value={totals.impaye} />
          <Total label="Total payé" value={totals.paye} />
        </div>
      </div>

      {msg && (
        <div className={`mb-4 text-base p-2 rounded ${msg.ok ? "bg-green-greenLight2 text-green-greenDark1" : "bg-red-redLight2 text-red-redDark1"}`}>
          {msg.text}
        </div>
      )}

      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="bg-gray-gray700 text-white dark:bg-gray-gray900 text-left">
              <th className="p-2 w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  disabled={rows.length === 0}
                  onChange={() => setSelectedIds(allChecked ? new Set() : new Set(rows.map((r) => r.rec.id)))}
                />
              </th>
              <th className="p-2 w-6" />
              <th className="p-2">Période</th>
              <th className="p-2">Ayant-droit</th>
              <th className="p-2">Canaux</th>
              <th className="p-2 text-right">Montant</th>
              <th className="p-2">Statut</th>
              <th className="p-2">No facture</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-gray-gray400">Aucune facture d&apos;ayant-droit pour {period.shortLabel}.</td></tr>
            )}
            {rows.map((r) => {
              const isOpen = expanded.has(r.rec.id);
              const etats = etatsByFacture.get(r.rec.id) || [];
              return (
                <Fragment key={r.rec.id}>
                  <tr
                    className={`border-t border-gray-gray100 dark:border-gray-gray600 cursor-pointer ${r.paye ? "bg-green-greenLight3 dark:bg-green-greenDark1/20" : ""}`}
                    onClick={() => toggleIn(expanded, setExpanded, r.rec.id)}
                  >
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(r.rec.id)} onChange={() => toggleIn(selectedIds, setSelectedIds, r.rec.id)} />
                    </td>
                    <td className="p-2 text-gray-gray400">{isOpen ? "▾" : "▸"}</td>
                    <td className="p-2 whitespace-nowrap">{period.shortLabel}</td>
                    <td className="p-2 font-medium">{r.organisme || "—"}</td>
                    <td className="p-2 text-sm text-gray-gray500 dark:text-gray-gray300">
                      {r.canalIds.map((id) => canalById.get(id)?.name || "?").join(", ")}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap font-semibold">{fmtCurrency(r.total)}</td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1 items-start">
                        <Tag color={r.paye ? "green" : "orange"}>{r.paye ? "Payé" : "Non payé"}</Tag>
                        <Tag color={r.facture ? "green" : "orange"}>{r.facture ? "Facturé" : "Non facturé"}</Tag>
                      </div>
                    </td>
                    <td className="p-2 text-sm whitespace-nowrap">{r.numero}{r.hasPdf ? " 📎" : ""}</td>
                    <td className="p-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button className="text-blue-blue hover:underline" onClick={() => expandRecord(r.rec)}>Détails</button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-gray50 dark:bg-gray-gray800">
                      <td colSpan={2} />
                      <td colSpan={7} className="p-2">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-gray500 dark:text-gray-gray300">
                              <th className="p-1">Canal</th>
                              <th className="p-1">État de compte</th>
                              <th className="p-1">Compte</th>
                              <th className="p-1 text-right">Part</th>
                              <th className="p-1 text-right">Montant</th>
                              <th className="p-1" />
                            </tr>
                          </thead>
                          <tbody>
                            {r.lines.map((l) => {
                              const canalId = linkedIds(l, depensesCanalLinkField)[0];
                              const etat = etats.find((e) => linkedIds(e, etatsCanalLinkField).includes(canalId));
                              const a = (ayants.get(canalId) || []).find((x) => x.orgId === r.orgId);
                              return (
                                <tr key={l.id} className="border-t border-gray-gray100 dark:border-gray-gray600">
                                  <td className="p-1">{canalById.get(canalId)?.name || str(l, depensesCanalLinkField)}</td>
                                  <td className="p-1">
                                    {etat ? (
                                      <button className="text-blue-blue hover:underline" onClick={() => expandRecord(etat)}>
                                        {etatDate(etat, cfg)}
                                      </button>
                                    ) : "—"}
                                  </td>
                                  <td className="p-1">{str(l, depensesCategorieField)}</td>
                                  <td className="p-1 text-right">{a ? fmtPct(a.part) : ""}</td>
                                  <td className="p-1 text-right font-semibold">{fmtCurrency(num(l, depensesMontantField))}</td>
                                  <td className="p-1 text-right">
                                    <button className="text-blue-blue hover:underline" onClick={() => expandRecord(l)}>Ouvrir</button>
                                  </td>
                                </tr>
                              );
                            })}
                            {r.lines.length === 0 && (
                              <tr><td colSpan={6} className="p-1 text-gray-gray400">Aucune ligne de dépense liée.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && calc && (
        <CreateModal
          period={period}
          candidates={calc.candidates}
          unlinked={calc.unlinked}
          warnings={createWarnings}
          onCancel={() => setShowCreate(false)}
          onCreate={createInvoices}
          busy={busy}
        />
      )}
    </div>
  );
}

function App() {
  const valuesRef = useRef({});
  const [tableIds, setTableIds] = useState("");
  // Re-evaluated when a table selection changes, so its field pickers follow it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const getProps = useCallback((b) => getCustomProperties(b, valuesRef.current), [tableIds]);
  const { customPropertyValueByKey: cfg } = useCustomProperties(getProps);
  valuesRef.current = cfg || {};
  const ids = TABLE_KEYS.map((k) => cfg?.[k]?.id || "").join(",");
  useEffect(() => { if (ids !== tableIds) setTableIds(ids); }, [ids, tableIds]);
  const missing = REQUIRED.filter(([k]) => !cfg[k]).map(([, label]) => label);
  if (missing.length) return <ConfigPrompt missing={missing} />;
  return <RightsApp cfg={cfg} />;
}

initializeBlock({ interface: () => <App /> });
