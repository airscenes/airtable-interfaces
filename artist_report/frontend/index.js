import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import {
  initializeBlock,
  useRecords,
  useCustomProperties,
} from "@airtable/blocks/interface/ui";
import ExcelJS from "exceljs";
import "./style.css";

// --- Helpers ---

const MONTHS_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

// Label of the Revenus grid column pre-filled from Shopify sales (Supabase).
const SHOPIFY_COLUMN = "Shopify";

const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $`;

function monthIsoDate(year, monthIdx) {
  const mm = String(monthIdx).padStart(2, "0");
  return `${year}-${mm}-01`;
}

function parseIsoParts(value) {
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

function isInPeriod(iso, year, half) {
  const p = parseIsoParts(iso);
  if (!p || p.year !== year) return false;
  return half === "H1" ? p.month <= 6 : p.month >= 7;
}

function getInitials(name) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

// --- Custom Properties Definition ---

function getCustomProperties(base) {
  const tables = base.tables;
  const findTable = (...keywords) =>
    tables.find((t) =>
      keywords.some((k) => t.name.toLowerCase().includes(k.toLowerCase())),
    );

  const canauxTable =
    findTable("canal", "canaux", "projet", "album", "spectacle") || tables[0];
  const revenusTable = findTable("revenu") || tables[1] || tables[0];
  const depensesTable =
    findTable("depense", "dépense") || tables[2] || tables[0];
  const oeuvresTable =
    findTable("oeuvre", "piste") || tables[0];

  const anyField = () => true;

  return [
    // --- Canaux ---
    { key: "canauxTable", label: "Table des Canaux (projets/albums)", type: "table" },
    { key: "canalImageField", label: "Champ image (Canaux)", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },
    { key: "canalSubtitleField", label: "Champ sous-titre carte (Canaux)", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },
    { key: "oeuvresLinkField", label: "Champ lien Oeuvres (Canaux)", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },

    // --- Oeuvres (pour récupérer les ISRCs) ---
    { key: "oeuvresTable", label: "Table des Oeuvres", type: "table" },
    { key: "isrcField", label: "Champ ISRC (Oeuvres)", type: "field", table: oeuvresTable, shouldFieldBeAllowed: anyField },

    // --- Revenus ---
    { key: "revenusTable", label: "Table des Revenus", type: "table" },
    { key: "revenusCanalLinkField", label: "Lien Canal (Revenus)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusDateField", label: "Champ Date (Revenus) — lecture/filtre", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusDateWriteField", label: "Champ Date (Revenus) — écriture (writable)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusMontantField", label: "Champ Montant (Revenus)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusCategorieField", label: "Champ Comptes (Revenus, single-select)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusEtatLinkField", label: "Lien État de compte (Revenus)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusNotesField", label: "Champ Notes (Revenus) — reçoit le label de colonne", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusDescriptionField", label: "Champ Description (Revenus, optionnel)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },

    // --- Dépenses ---
    { key: "depensesTable", label: "Table des Dépenses", type: "table" },
    { key: "depensesCanalLinkField", label: "Lien Canal (Dépenses)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesDateField", label: "Champ Date (Dépenses) — lecture/filtre", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesDateWriteField", label: "Champ Date (Dépenses) — écriture (writable)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesMontantField", label: "Champ Montant (Dépenses)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesCategorieField", label: "Champ Comptes (Dépenses, single-select)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesEtatLinkField", label: "Lien État de compte (Dépenses)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesFournisseurField", label: "Champ Fournisseur (Dépenses, lookup)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesNoFactureField", label: "Champ No facture (Dépenses)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesModePaiementField", label: "Champ Mode paiement (Dépenses)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesArtisteField", label: "Champ Artiste (Dépenses)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesNotesField", label: "Champ Notes (Dépenses) — reçoit le label de colonne", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },
    { key: "depensesDescriptionField", label: "Champ Description (Dépenses, optionnel)", type: "field", table: depensesTable, shouldFieldBeAllowed: anyField },

    // --- Comptes (pour les lignes ad-hoc) ---
    { key: "comptesTable", label: "Table des Comptes", type: "table" },
    { key: "comptesNumeroField", label: "Champ numero_compte (Comptes) — < 5000 = Revenu, ≥ 5000 = Dépense", type: "field", table: tables.find((t) => t.name.toLowerCase().includes("compte")) || tables[0], shouldFieldBeAllowed: anyField },

    // --- Template Excel ---
    { key: "templateAttachmentField", label: "Champ attachement Template Excel", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },

    // --- États de compte ---
    { key: "etatsTable", label: "Table des États de compte", type: "table" },

    // --- Colonnes des grilles (mapping label → record Compte) ---
    {
      key: "revenusColumnsJson",
      label: "Colonnes Revenus (JSON)",
      type: "string",
      defaultValue: "[]",
    },
    {
      key: "depensesColumnsJson",
      label: "Colonnes Dépenses (JSON)",
      type: "string",
      defaultValue: "[]",
    },

    // --- Royalties Supabase ---
    { key: "supabaseUrl", label: "Supabase URL", type: "string", defaultValue: "" },
    { key: "supabaseAnonKey", label: "Supabase Anon Key", type: "string", defaultValue: "" },
    { key: "clientId", label: "Client UUID (royalties)", type: "string", defaultValue: "" },
    { key: "royaltiesColumn", label: "Label colonne Royalties (dans JSON Revenus)", type: "string", defaultValue: "Believe" },
  ];
}

// --- UI: Canal card ---

function CanalCard({ name, subtitle, imageUrl, onClick }) {
  const initials = getInitials(name);
  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm overflow-hidden cursor-pointer
                 hover:shadow-md transition-shadow duration-200
                 border border-gray-gray100 dark:border-gray-gray600"
    >
      <div className="w-full" style={{ height: 160, overflow: "hidden" }}>
        {imageUrl ? (
          <img src={imageUrl} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div className="flex items-center justify-center h-full" style={{ backgroundColor: "#666" }}>
            <span className="text-white text-4xl font-display font-bold">{initials}</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="font-semibold text-sm text-gray-gray700 dark:text-gray-gray100 truncate">{name}</div>
        {subtitle && (
          <div className="text-xs text-gray-gray500 dark:text-gray-gray300 truncate mt-0.5">{subtitle}</div>
        )}
      </div>
    </div>
  );
}

// --- UI: Period picker ---

function PeriodPicker({ year, half, onChangeYear, onChangeHalf }) {
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now - 4; y <= now + 1; y++) years.push(y);

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-gray-gray600 dark:text-gray-gray300">Année</span>
        <div className="relative">
          <select
            value={year}
            onChange={(e) => onChangeYear(parseInt(e.target.value, 10))}
            className="appearance-none bg-white dark:bg-gray-gray700 border border-gray-gray200
                       dark:border-gray-gray600 rounded px-3 py-1.5 pr-8 text-sm
                       text-gray-gray700 dark:text-gray-gray100"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-gray500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.5 7.5l4.5 4.5 4.5-4.5z" />
          </svg>
        </div>
      </label>
      <div className="flex border border-gray-gray200 dark:border-gray-gray600 rounded overflow-hidden">
        <button
          onClick={() => onChangeHalf("H1")}
          className={`px-3 py-1.5 text-sm ${
            half === "H1"
              ? "bg-blue-blue text-white"
              : "bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100"
          }`}
        >
          Janvier – Juin
        </button>
        <button
          onClick={() => onChangeHalf("H2")}
          className={`px-3 py-1.5 text-sm ${
            half === "H2"
              ? "bg-blue-blue text-white"
              : "bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100"
          }`}
        >
          Juillet – Décembre
        </button>
      </div>
    </div>
  );
}

// Cell input: raw decimal while focused, formatted currency when blurred.
function CurrencyCellInput({ value, onChange, placeholder = "0" }) {
  const [focused, setFocused] = useState(false);
  const num = parseFloat(String(value || "").replace(",", "."));
  const hasValue = value !== "" && value != null && !isNaN(num);
  const display = focused || !hasValue ? value || "" : fmtCurrency(num);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-right bg-transparent text-gray-gray700 dark:text-gray-gray100
                 px-2 py-1 rounded border border-transparent
                 hover:border-gray-gray200 dark:hover:border-gray-gray600
                 focus:border-blue-blue focus:outline-none"
    />
  );
}

// --- UI: Editable grid (months × categories) ---

function EditableGrid({ title, choices, monthIndices, inputs, onChange, existing = {} }) {
  const colTotals = useMemo(() => {
    const totals = {};
    for (const c of choices) totals[c.id] = 0;
    for (const m of monthIndices) {
      const row = inputs[m] || {};
      const exRow = existing[m] || {};
      for (const c of choices) {
        const v = parseFloat(String(row[c.id] || "").replace(",", "."));
        if (!isNaN(v)) totals[c.id] += v;
        const ev = exRow[c.id];
        if (typeof ev === "number") totals[c.id] += ev;
      }
    }
    return totals;
  }, [inputs, existing, choices, monthIndices]);

  const grandTotal = Object.values(colTotals).reduce((s, v) => s + v, 0);

  // Compute consecutive group spans for the header (Physique / Numérique style)
  const groupSpans = useMemo(() => {
    const spans = [];
    for (const c of choices) {
      const last = spans[spans.length - 1];
      if (last && last.group === (c.group || null)) last.span += 1;
      else spans.push({ group: c.group || null, span: 1 });
    }
    return spans;
  }, [choices]);
  const hasGroups = groupSpans.some((g) => g.group);

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray100 mb-2">{title}</h3>
      {choices.length === 0 ? (
        <div className="text-base text-gray-gray500 italic p-3 border border-dashed border-gray-gray200 rounded">
          Aucune colonne configurée. Renseigne le JSON Colonnes Revenus / Dépenses.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-base border-collapse">
              <thead>
                {hasGroups && (
                  <tr className="bg-gray-gray50 dark:bg-gray-gray800">
                    <th className="p-2 border-b border-gray-gray200 dark:border-gray-gray600 sticky left-0 bg-gray-gray50 dark:bg-gray-gray800"></th>
                    {groupSpans.map((g, idx) => (
                      <th key={idx} colSpan={g.span} className="text-center p-2 border-b border-gray-gray200 dark:border-gray-gray600 font-display font-bold text-gray-gray700 dark:text-gray-gray100 underline whitespace-nowrap">
                        {g.group || ""}
                      </th>
                    ))}
                  </tr>
                )}
                <tr className="bg-gray-gray50 dark:bg-gray-gray800">
                  <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600 sticky left-0 bg-gray-gray50 dark:bg-gray-gray800">Mois</th>
                  {choices.map((c) => (
                    <th key={c.id} className="text-right p-2 border-b border-gray-gray200 dark:border-gray-gray600 font-medium text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthIndices.map((m) => (
                  <tr key={m} className="hover:bg-gray-gray50 dark:hover:bg-gray-gray800">
                    <td className="p-2 border-b border-gray-gray100 dark:border-gray-gray700 font-medium text-gray-gray600 dark:text-gray-gray200 sticky left-0 bg-white dark:bg-gray-gray700">
                      {MONTHS_FR[m - 1]}
                    </td>
                    {choices.map((c) => {
                      const exVal = existing[m] && existing[m][c.id];
                      const isSaved = typeof exVal === "number" && exVal !== 0;
                      return (
                        <td key={c.id} className="p-1 border-b border-gray-gray100 dark:border-gray-gray700">
                          {isSaved ? (
                            <div
                              className="flex items-center justify-end gap-1 px-2 py-1
                                         text-gray-gray600 dark:text-gray-gray200 whitespace-nowrap"
                              title="Déjà enregistré dans Airtable"
                            >
                              <span>{fmtCurrency(exVal)}</span>
                              <svg className="w-3.5 h-3.5 text-green-greenDark1 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M7.5 13.5L4 10l1.4-1.4 2.1 2.1 5.1-5.1L14 7z" />
                              </svg>
                            </div>
                          ) : (
                            <CurrencyCellInput
                              value={(inputs[m] && inputs[m][c.id]) || ""}
                              onChange={(val) => onChange(m, c.id, val)}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-gray-gray50 dark:bg-gray-gray800 font-semibold">
                  <td className="p-2 sticky left-0 bg-gray-gray50 dark:bg-gray-gray800">Total</td>
                  {choices.map((c) => (
                    <td key={c.id} className="p-2 text-right text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                      {fmtCurrency(colTotals[c.id])}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-right text-base text-gray-gray500 mt-1">
            Total période (saisi + enregistré) : {fmtCurrency(grandTotal)}
          </div>
        </>
      )}
    </div>
  );
}

// --- UI: Help badge ("?" pill that toggles a popover; closes on outside click) ---

function HelpBadge({ title, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        className={`w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center ${
          open
            ? "bg-blue-blue text-white"
            : "bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray200 hover:bg-gray-gray200"
        }`}
      >
        ?
      </button>
      {open && (
        <div
          className="absolute right-0 top-9 z-20 w-80 max-w-[calc(100vw-2rem)] p-4 rounded-lg shadow-lg
                     bg-white dark:bg-gray-gray700 border border-gray-gray200 dark:border-gray-gray600
                     text-sm text-gray-gray700 dark:text-gray-gray100 space-y-3"
        >
          <div className="font-semibold text-base">{title}</div>
          {children}
        </div>
      )}
    </div>
  );
}

// Display string of a link/lookup cell. getCellValueAsString CSV-quotes names
// containing commas ("5633 | Publicité Web (Facebook, etc.)"), so join names directly.
function getLinkNames(rec, field) {
  if (!field) return "";
  const v = rec.getCellValue(field);
  if (Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x.name === "string")) {
    return v.map((x) => x.name).join(", ");
  }
  return rec.getCellValueAsString(field);
}

// --- UI: Existing entries list ---

function ExistingEntriesList({ title, entries, dateField, montantField, categorieField, descriptionField, fournisseurField }) {
  // Expanded budget lines (compte names); all collapsed by default.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleGroup = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!entries || entries.length === 0) {
    return (
      <div className="mt-3 text-sm text-gray-gray500 italic">
        Aucune entrée existante non rapportée pour cette période.
      </div>
    );
  }
  const total = entries.reduce(
    (s, r) => s + (Number(r.getCellValue(montantField)) || 0),
    0,
  );

  // Sort entries chronologically (ascending) using the date field
  const dateSortKey = (rec) => {
    let v = rec.getCellValue(dateField);
    if (v == null) v = rec.getCellValueAsString(dateField);
    const p = parseIsoParts(v);
    if (!p) return Number.MAX_SAFE_INTEGER; // entries without a date go last
    return p.year * 10000 + p.month * 100 + p.day;
  };
  const sortedEntries = [...entries].sort((a, b) => dateSortKey(a) - dateSortKey(b));

  // Group by Comptes (catégorie), preserving chronological order within each group
  const groups = new Map();
  for (const r of sortedEntries) {
    const key = getLinkNames(r, categorieField) || "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, "fr"));
  const colCount = 2 + (fournisseurField ? 1 : 0) + (descriptionField ? 1 : 0);
  const allCollapsed = sortedGroups.every(([k]) => !expanded.has(k));

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-sm font-medium text-gray-gray600 dark:text-gray-gray300">
          {title} déjà saisis ({entries.length}) — total {fmtCurrency(total)}
        </div>
        <button
          onClick={() =>
            setExpanded(allCollapsed ? new Set(sortedGroups.map(([k]) => k)) : new Set())
          }
          className="text-sm text-blue-blue hover:underline"
        >
          {allCollapsed ? "Tout déplier" : "Tout replier"}
        </button>
      </div>
      <div className="border border-gray-gray100 dark:border-gray-gray600 rounded overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: 100 }} />
            {fournisseurField && <col />}
            {descriptionField && <col />}
            <col style={{ width: 130 }} />
          </colgroup>
          <thead className="bg-gray-gray50 dark:bg-gray-gray800">
            <tr>
              <th className="text-left p-2">Date</th>
              {fournisseurField && <th className="text-left p-2">Fournisseur</th>}
              {descriptionField && <th className="text-left p-2">Description</th>}
              <th className="text-right p-2">Montant</th>
            </tr>
          </thead>
          <tbody>
            {sortedGroups.map(([compte, rows]) => {
              const groupTotal = rows.reduce((s, r) => s + (Number(r.getCellValue(montantField)) || 0), 0);
              const isCollapsed = !expanded.has(compte);
              return (
                <Fragment key={compte}>
                  <tr
                    onClick={() => toggleGroup(compte)}
                    className="bg-gray-gray100 dark:bg-gray-gray800 border-t border-gray-gray200 dark:border-gray-gray600 cursor-pointer select-none hover:bg-gray-gray200 dark:hover:bg-gray-gray600"
                  >
                    <td colSpan={colCount - 1} className="p-2 font-semibold text-gray-gray700 dark:text-gray-gray100">
                      <span
                        className="inline-block w-4 text-gray-gray500 transition-transform"
                        style={{ transform: isCollapsed ? "rotate(-90deg)" : "none" }}
                      >
                        ▾
                      </span>
                      {compte} <span className="text-gray-gray500 font-normal">({rows.length})</span>
                    </td>
                    <td className="p-2 text-right font-semibold text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                      {fmtCurrency(groupTotal)}
                    </td>
                  </tr>
                  {!isCollapsed && rows.map((r) => {
                    let dateIso = r.getCellValue(dateField);
                    if (Array.isArray(dateIso)) dateIso = dateIso[0];
                    if (dateIso && typeof dateIso === "object" && dateIso.value) dateIso = dateIso.value;
                    if (dateIso == null) dateIso = r.getCellValueAsString(dateField);
                    const fournisseur = fournisseurField ? r.getCellValueAsString(fournisseurField) : "";
                    const desc = descriptionField ? r.getCellValueAsString(descriptionField) : "";
                    const m = Number(r.getCellValue(montantField)) || 0;
                    return (
                      <tr key={r.id} className="border-t border-gray-gray100 dark:border-gray-gray700">
                        <td className="p-2 text-gray-gray600 dark:text-gray-gray300 whitespace-nowrap">
                          {typeof dateIso === "string" ? dateIso.slice(0, 10) : ""}
                        </td>
                        {fournisseurField && (
                          <td className="p-2 text-gray-gray600 dark:text-gray-gray300">{fournisseur}</td>
                        )}
                        {descriptionField && (
                          <td className="p-2 text-gray-gray600 dark:text-gray-gray300">{desc}</td>
                        )}
                        <td className="p-2 text-right text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                          {fmtCurrency(m)}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Excel export — template-based export using ExcelJS — preserves logos/styles/formulas.
//
// Template layout (worksheet "Rapport"):
//   A1 (merged): "Revenus/Dépenses - {{nom_spectacle}} - {{periode}}"
//   B12:C17  Dépenses (Fabrication, Pub/Placement) × 6 mois
//   F12:J17  Revenus  (Propagande, Bandcamp Phys, Shopify, Believe, Bandcamp Num) × 6 mois
//   Row 24: headers Dépenses sur période
//   Row 25+: rows to insert (existing dépenses)
//   I34: Droits synchro / Autres single value (bumped after dep insertion)
//   I36-I38: Subventions (free entries area, bumped accordingly)
//   J47: {{nom_artiste}}
//
// Strategy:
//   - Replace {{tags}} everywhere
//   - Write top grids by direct cell access
//   - Insert (depCount-1) empty rows at row 26 to make room for all dépenses
//   - Fill rows 25 to 25+depCount-1 with existing dépenses
//   - Update G(26+depCount-1) SUM range
//   - Append free revenus rows in subventions area (single block)

function readDateForExport(rec, dateField, dateWriteField) {
  const tryRead = (f) => {
    if (!f) return null;
    let v = rec.getCellValue(f);
    if (v == null) v = rec.getCellValueAsString(f);
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === "object" && v.value) v = v.value;
    return v;
  };
  return tryRead(dateField) || tryRead(dateWriteField) || "";
}

const REV_COL_MAP = ["F", "H", "I", "J"];   // 4 revenus columns (G = Bandcamp physique, retiré)
const DEP_FIRST_ROW = 25;
const REV_LIST_ROW = 34;    // first row for existing revenus consolidated list

async function exportFromTemplate({
  templateUrl,
  canalName, year, half,
  monthIndices,
  revenusInputs, revenusChoices,
  existingDepenses,
  depensesDateField, depensesDateWriteField,
  depensesMontantField, depensesNotesField, depensesFournisseurField, depensesDescriptionField,
  depensesNoFactureField, depensesModePaiementField, depensesArtisteField,
  existingRevenus,
  revenusDateField, revenusDateWriteField,
  revenusMontantField, revenusCategorieField, revenusNotesField, revenusDescriptionField,
}) {
  const periodLabel = half === "H1" ? `JAN - JUIN ${year}` : `JUIL - DEC ${year}`;

  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error(`Téléchargement template échoué: ${res.status}`);
  const buf = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet("Rapport") || wb.worksheets[0];
  if (!ws) throw new Error("Feuille 'Rapport' introuvable dans le template");

  // 1. Replace tags everywhere
  const replaceTags = (s) =>
    s.replace(/\{\{nom_spectacle\}\}/g, canalName)
      .replace(/\{\{periode\}\}/g, periodLabel)
      .replace(/\{\{nom_artiste\}\}/g, canalName);
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string") cell.value = replaceTags(cell.value);
      else if (cell.value && typeof cell.value === "object" && typeof cell.value.text === "string") {
        cell.value = { ...cell.value, text: replaceTags(cell.value.text) };
      }
    });
  });

  // 2. Fill top grid — Revenus (F12:J17, G = Bandcamp physique retiré)
  for (let i = 0; i < 6 && i < monthIndices.length; i++) {
    const m = monthIndices[i];
    for (let j = 0; j < revenusChoices.length && j < REV_COL_MAP.length; j++) {
      const col = REV_COL_MAP[j];
      const choice = revenusChoices[j];
      const raw = (revenusInputs[m] && revenusInputs[m][choice.id]) || "";
      const v = parseFloat(String(raw).replace(",", "."));
      if (!isNaN(v) && v !== 0) ws.getCell(`${col}${12 + i}`).value = v;
    }
  }

  // 3. Insert dynamic rows for existing Dépenses (DÉPENSES SUR PÉRIODE)
  // duplicateRow preserves the source row's styles/format on each new copy.
  const depCount = existingDepenses.length;
  if (depCount > 1) {
    ws.duplicateRow(DEP_FIRST_ROW, depCount - 1, true);
  }

  // Fill data rows (25 .. 25 + depCount - 1)
  existingDepenses.forEach((rec, idx) => {
    const r = DEP_FIRST_ROW + idx;
    const date = readDateForExport(rec, depensesDateField, depensesDateWriteField);
    const noFacture = depensesNoFactureField ? rec.getCellValueAsString(depensesNoFactureField) : "";
    const modePaiement = depensesModePaiementField ? rec.getCellValueAsString(depensesModePaiementField) : "";
    const fournisseur = depensesFournisseurField ? rec.getCellValueAsString(depensesFournisseurField) : "";
    const notes = depensesNotesField ? rec.getCellValueAsString(depensesNotesField) : "";
    const artiste = depensesArtisteField ? rec.getCellValueAsString(depensesArtisteField) : "";
    const desc = depensesDescriptionField ? rec.getCellValueAsString(depensesDescriptionField) : "";
    const m = Number(rec.getCellValue(depensesMontantField)) || 0;
    // Columns: A No facture, B Date facture, C Mode paiement, D Fournisseur,
    //          E Poste budgétaire, F Artiste, G Montant, H Description
    ws.getCell(`A${r}`).value = noFacture || "";
    ws.getCell(`B${r}`).value = typeof date === "string" ? date.slice(0, 10) : "";
    ws.getCell(`C${r}`).value = modePaiement || "";
    ws.getCell(`D${r}`).value = fournisseur || "";
    ws.getCell(`E${r}`).value = notes || "";
    ws.getCell(`F${r}`).value = artiste || "";
    ws.getCell(`G${r}`).value = m;
    ws.getCell(`H${r}`).value = desc || "";
  });

  // (Formulas in the moved cells aren't auto-updated to span the new ranges,
  // so we compute every total in JS and write numeric values directly.)

  // 4. Insert existing Revenus list at REV_LIST_ROW (DROITS SYNCHRO area).
  // After dep insertion, this row has shifted by (depCount-1).
  const depOffset = Math.max(0, depCount - 1);
  const revListRow = REV_LIST_ROW + depOffset;
  const revCount = existingRevenus.length;
  if (revCount > 1) {
    ws.duplicateRow(revListRow, revCount - 1, true);
  }
  existingRevenus.forEach((rec, idx) => {
    const r = revListRow + idx;
    const date = readDateForExport(rec, revenusDateField, revenusDateWriteField);
    const cat = getLinkNames(rec, revenusCategorieField);
    const notes = revenusNotesField ? rec.getCellValueAsString(revenusNotesField) : "";
    const desc = revenusDescriptionField ? rec.getCellValueAsString(revenusDescriptionField) : "";
    const m = Number(rec.getCellValue(revenusMontantField)) || 0;
    const dateStr = typeof date === "string" ? date.slice(0, 10) : "";
    const label = notes || cat || desc || "Revenu";
    ws.getCell(`A${r}`).value = `${label}${dateStr ? " (" + dateStr + ")" : ""}${desc && desc !== label ? " — " + desc : ""}`;
    ws.getCell(`I${r}`).value = m;
  });

  // 5. Compute and write all totals as numeric values (no formulas).
  // Insertions break formula references; computing in JS is reliable.
  const revOffset = Math.max(0, revCount - 1);

  const gridColSum = (inputs, choiceId) => {
    let s = 0;
    for (const m of monthIndices) {
      const raw = (inputs[m] && inputs[m][choiceId]) || "";
      const v = parseFloat(String(raw).replace(",", "."));
      if (!isNaN(v)) s += v;
    }
    return s;
  };

  // Top grid monthly totals (row 18) — Revenus only
  const revColSums = [];
  REV_COL_MAP.forEach((col, idx) => {
    const choice = revenusChoices[idx];
    const s = choice ? gridColSum(revenusInputs, choice.id) : 0;
    revColSums.push(s);
    ws.getCell(`${col}18`).value = s;
  });

  const revGridTotal = revColSums.reduce((s, v) => s + v, 0);
  ws.getCell(`F20`).value = revGridTotal;

  // Existing dépenses sub-total (G26 area, shifted by depOffset)
  const depExistingTotal = existingDepenses.reduce(
    (s, r) => s + (Number(r.getCellValue(depensesMontantField)) || 0),
    0,
  );
  ws.getCell(`G${26 + depOffset}`).value = depExistingTotal;
  ws.getCell(`G${28 + depOffset}`).value = -depExistingTotal;

  // VENTES ALBUM (I32, shifted by depOffset)
  ws.getCell(`I${32 + depOffset}`).value = revGridTotal;

  // TOTAL REVENUS PÉRIODE (I39) and TOTAL period (I42), shifted by depOffset+revOffset
  const revExistingTotal = existingRevenus.reduce(
    (s, r) => s + (Number(r.getCellValue(revenusMontantField)) || 0),
    0,
  );
  const totalRevenusPeriode = revGridTotal + revExistingTotal;
  ws.getCell(`I${39 + depOffset + revOffset}`).value = totalRevenusPeriode;
  ws.getCell(`I${42 + depOffset + revOffset}`).value = totalRevenusPeriode - depExistingTotal;
  // I44 = I42 + I43 (solde précédent, kept as-is — usually 0 / N/A)
  // We leave I44 untouched if existing formula handles it; if not, we zero it.
  // (Most templates leave I44 with formula =I42+I43 — the recalc flag below handles it.)

  // 6. Force Excel to recalculate any remaining formulas when opening
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };

  // 7. Save and download
  const out = await wb.xlsx.writeBuffer();
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, "_");
  const periodFile = half === "H1" ? `Jan-Juin_${year}` : `Juil-Dec_${year}`;
  a.href = url;
  a.download = `Rapport_${safe(canalName)}_${periodFile}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Promise cache for Supabase calls: effect re-runs share the in-flight request instead
// of starting a new one, and a cancelled effect never throws a response away.
function cachedFetch(cache, key, fetcher) {
  if (!cache.has(key)) {
    const p = fetcher();
    cache.set(key, p);
    p.catch(() => cache.delete(key)); // let a failed call be retried
  }
  return cache.get(key);
}

async function postSupabaseRpc(supabaseUrl, anonKey, clientId, fn, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      "x-client-id": clientId,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase ${response.status} ${response.statusText}${detail ? " — " + detail.slice(0, 200) : ""}`);
  }
  return response.json();
}

// Read a Compte's numero from the configured field, fallback parses from name.
// Used to classify comptes: < 5000 = Revenu, >= 5000 = Dépense.
function getCompteCode(rec, numeroField) {
  if (numeroField) {
    const raw = rec.getCellValue(numeroField);
    const n = typeof raw === "number" ? raw : parseFloat(String(raw || ""));
    if (!isNaN(n)) return Math.trunc(n);
  }
  const m = String(rec.name || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// --- Saisies editor (Revenus or Dépenses, per-line) ---

// comptes: [{id, name, code}] (see comptesSeenRef in ReportInner)
function SaisiesEditor({ title, rows, onChange, comptes, monthIndices }) {
  const comptesByType = useMemo(() => {
    const revenu = [];
    const depense = [];
    for (const c of comptes) {
      if (c.code >= 4000 && c.code < 5000) revenu.push(c);
      else if (c.code >= 5000 && c.code < 6000) depense.push(c);
    }
    const cmp = (a, b) => (a.name || "").localeCompare(b.name || "", "fr");
    revenu.sort(cmp);
    depense.sort(cmp);
    return { revenu, depense };
  }, [comptes]);

  const addRow = () => onChange([...rows, { type: "revenu", compteId: "", notes: "", montant: "", month: monthIndices[0] }]);
  const updateRow = (idx, patch) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));

  const totals = rows.reduce(
    (acc, r) => {
      const v = parseFloat(String(r.montant || "").replace(",", "."));
      if (isNaN(v)) return acc;
      if (r.type === "depense") acc.depense += v;
      else acc.revenu += v;
      return acc;
    },
    { revenu: 0, depense: 0 },
  );

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray100 mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-base border-collapse table-fixed">
          <colgroup>
            <col style={{ width: 150 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 180 }} />
            <col />
            <col style={{ width: 130 }} />
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-gray50 dark:bg-gray-gray800">
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Type</th>
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Mois</th>
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Compte</th>
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Description</th>
              <th className="text-right p-2 border-b border-gray-gray200 dark:border-gray-gray600">Montant</th>
              <th className="p-2 border-b border-gray-gray200 dark:border-gray-gray600"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-center text-gray-gray500 italic">
                  Aucune ligne. Clique sur « + Ajouter » pour saisir.
                </td>
              </tr>
            )}
            {rows.map((r, idx) => (
              <tr key={idx} className="border-b border-gray-gray100 dark:border-gray-gray700">
                <td className="p-1">
                  <div className="inline-flex border border-gray-gray200 dark:border-gray-gray600 rounded overflow-hidden text-xs">
                    <button
                      onClick={() => updateRow(idx, { type: "revenu", compteId: "" })}
                      className={`px-2 py-1 w-16 text-center ${
                        r.type !== "depense"
                          ? "bg-green-greenDark1 text-white"
                          : "bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100"
                      }`}
                    >
                      Revenu
                    </button>
                    <button
                      onClick={() => updateRow(idx, { type: "depense", compteId: "" })}
                      className={`px-2 py-1 w-16 text-center ${
                        r.type === "depense"
                          ? "bg-red-redDark1 text-white"
                          : "bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100"
                      }`}
                    >
                      Dépense
                    </button>
                  </div>
                </td>
                <td className="p-1">
                  <select
                    value={r.month}
                    onChange={(e) => updateRow(idx, { month: parseInt(e.target.value, 10) })}
                    className="bg-white dark:bg-gray-gray700 border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 text-base"
                  >
                    {monthIndices.map((m) => <option key={m} value={m}>{MONTHS_FR[m - 1]}</option>)}
                  </select>
                </td>
                <td className="p-1">
                  <select
                    value={r.compteId}
                    onChange={(e) => updateRow(idx, { compteId: e.target.value })}
                    className="bg-white dark:bg-gray-gray700 border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 text-base w-full"
                  >
                    <option value="">— Choisir —</option>
                    {(r.type === "depense" ? comptesByType.depense : comptesByType.revenu).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="p-1">
                  <input
                    type="text"
                    value={r.notes}
                    onChange={(e) => updateRow(idx, { notes: e.target.value })}
                    placeholder="Description"
                    className="w-full bg-transparent text-gray-gray700 dark:text-gray-gray100 px-2 py-1 rounded border border-gray-gray200 dark:border-gray-gray600 focus:border-blue-blue focus:outline-none"
                  />
                </td>
                <td className="p-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={r.montant}
                    onChange={(e) => updateRow(idx, { montant: e.target.value })}
                    placeholder="0"
                    className="w-full text-right bg-transparent text-gray-gray700 dark:text-gray-gray100 px-2 py-1 rounded border border-gray-gray200 dark:border-gray-gray600 focus:border-blue-blue focus:outline-none"
                  />
                </td>
                <td className="p-1 text-center">
                  <button
                    onClick={() => removeRow(idx)}
                    className="text-red-red hover:text-red-redDark1 px-2 py-1"
                    title="Supprimer la ligne"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            <tr className="bg-gray-gray50 dark:bg-gray-gray800 font-semibold">
              <td colSpan={4} className="p-2">Totaux</td>
              <td className="p-2 text-right">
                <span className="text-green-greenDark1">+{fmtCurrency(totals.revenu)}</span>
                {" / "}
                <span className="text-red-redDark1">-{fmtCurrency(totals.depense)}</span>
              </td>
              <td className="p-2"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button
        onClick={addRow}
        className="mt-2 text-base text-blue-blue hover:underline"
      >
        + Ajouter une ligne
      </button>
    </div>
  );
}

// --- KPI tile ---

function KpiTile({ label, value, accent }) {
  const accentClasses = {
    green: "text-green-greenDark1",
    red: "text-red-redDark1",
    blue: "text-blue-blueDark1",
  };
  return (
    <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4">
      <div className="text-sm text-gray-gray500 dark:text-gray-gray300 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-display font-bold mt-1 ${accentClasses[accent] || "text-gray-gray700 dark:text-gray-gray100"}`}>
        {fmtCurrency(value)}
      </div>
    </div>
  );
}

// --- Config prompt ---

function ConfigPrompt() {
  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-gray-gray50 dark:bg-gray-gray800">
      <div className="max-w-md text-center">
        <p className="text-gray-gray600 dark:text-gray-gray200">
          Veuillez configurer les tables et champs dans les propriétés de l&apos;extension
          (Canaux, Revenus, Dépenses, États de compte).
        </p>
      </div>
    </div>
  );
}

// --- Main App ---

function RoyaltyReportApp() {
  const { customPropertyValueByKey } = useCustomProperties(getCustomProperties);

  const canauxTable = customPropertyValueByKey.canauxTable;
  const revenusTable = customPropertyValueByKey.revenusTable;
  const depensesTable = customPropertyValueByKey.depensesTable;

  if (!canauxTable || !revenusTable || !depensesTable) {
    return <ConfigPrompt />;
  }

  return <ReportInner cfg={customPropertyValueByKey} />;
}

function ReportInner({ cfg }) {
  const {
    canauxTable, canalImageField, canalSubtitleField,
    revenusTable, revenusCanalLinkField, revenusDateField, revenusDateWriteField, revenusMontantField,
    revenusCategorieField, revenusEtatLinkField, revenusNotesField, revenusDescriptionField,
    depensesTable, depensesCanalLinkField, depensesDateField, depensesDateWriteField, depensesMontantField,
    depensesCategorieField, depensesEtatLinkField, depensesFournisseurField, depensesNotesField, depensesDescriptionField,
    depensesNoFactureField, depensesModePaiementField, depensesArtisteField,
    revenusColumnsJson, depensesColumnsJson,
    comptesTable, comptesNumeroField,
    templateAttachmentField,
    oeuvresTable, oeuvresLinkField, isrcField,
    supabaseUrl, supabaseAnonKey, clientId, royaltiesColumn,
  } = cfg;

  const canauxRecords = useRecords(canauxTable);
  const revenusRecords = useRecords(revenusTable);
  const depensesRecords = useRecords(depensesTable);
  const comptesRecords = useRecords(comptesTable);

  // The interface page's search bar also filters useRecords, so typing e.g. a canal
  // name there empties the Comptes list. Accumulate every compte seen so far so a
  // search can only hide comptes from useRecords, never from the dropdown.
  const comptesSeenRef = useRef(new Map());
  const comptes = useMemo(() => {
    const seen = comptesSeenRef.current;
    for (const rec of comptesRecords || []) {
      const code = getCompteCode(rec, comptesNumeroField);
      // Skip records whose cell values aren't loaded yet rather than caching a null code.
      if (code == null) continue;
      seen.set(rec.id, { id: rec.id, name: rec.name, code });
    }
    return Array.from(seen.values());
  }, [comptesRecords, comptesNumeroField]);
  // useRecords crashes on null; fall back to a known table when not yet configured.
  const oeuvresRecords = useRecords(oeuvresTable || canauxTable);

  const columnsConfig = useMemo(() => {
    const parseOne = (raw) => {
      if (!raw || typeof raw !== "string") return { cols: [], error: null };
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return { cols: [], error: null };
        // Flatten: support both {label, compteId} and {compteId, labels: [...]}
        const cols = [];
        for (const entry of parsed) {
          if (entry && Array.isArray(entry.labels)) {
            for (const label of entry.labels) {
              cols.push({ label, compteId: entry.compteId, group: entry.group || null });
            }
          } else if (entry && entry.label) {
            cols.push({ label: entry.label, compteId: entry.compteId, group: entry.group || null });
          }
        }
        return { cols, error: null };
      } catch (e) {
        return { cols: [], error: e.message };
      }
    };
    const r = parseOne(revenusColumnsJson);
    const d = parseOne(depensesColumnsJson);
    return {
      revenus: r.cols,
      depenses: d.cols,
      error: r.error || d.error || null,
    };
  }, [revenusColumnsJson, depensesColumnsJson]);

  const [selectedCanalId, setSelectedCanalId] = useState(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [half, setHalf] = useState("H1");
  const [revenusInputs, setRevenusInputs] = useState({});
  const [saisies, setSaisies] = useState([]); // [{type: "revenu"|"depense", compteId, notes, montant, month}]
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);
  const [royaltiesLoading, setRoyaltiesLoading] = useState(false);
  const [royaltiesError, setRoyaltiesError] = useState(null);
  const [royaltiesRefreshKey, setRoyaltiesRefreshKey] = useState(0);
  const royaltiesCacheRef = useRef(new Map());
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError, setShopifyError] = useState(null);
  const [shopifyRefreshKey, setShopifyRefreshKey] = useState(0);
  const shopifyCacheRef = useRef(new Map());

  useEffect(() => {
    setRevenusInputs({});
    setSaisies([]);
    setSavedMsg(null);
    setRoyaltiesError(null);
    setShopifyError(null);
  }, [selectedCanalId, year, half]);

  // Resolve the compteId of the Royalties column (from revenusColumnsJson) for dup-detection
  const royaltiesCompteId = useMemo(() => {
    const col = (columnsConfig.revenus || []).find((c) => c.label === royaltiesColumn);
    return col ? col.compteId : null;
  }, [columnsConfig, royaltiesColumn]);

  // Months of the current period that already have a Royalties revenu record in Airtable.
  // We skip pre-filling those months to prevent creating duplicates if the user clicks Save again.
  const monthsWithExistingRoyalty = useMemo(() => {
    const set = new Set();
    if (!royaltiesCompteId || !revenusRecords || !selectedCanalId || !revenusCanalLinkField || !revenusCategorieField) return set;
    const dateFields = [revenusDateField, revenusDateWriteField].filter(Boolean);
    for (const rec of revenusRecords) {
      const links = rec.getCellValue(revenusCanalLinkField);
      if (!Array.isArray(links) || !links.some((l) => l.id === selectedCanalId)) continue;
      const cat = rec.getCellValue(revenusCategorieField);
      if (!Array.isArray(cat) || !cat.some((c) => c.id === royaltiesCompteId)) continue;
      let d = null;
      for (const f of dateFields) {
        d = rec.getCellValue(f);
        if (d == null) d = rec.getCellValueAsString(f);
        if (d != null && d !== "") break;
      }
      const parts = parseIsoParts(d);
      if (!parts || parts.year !== year) continue;
      if (half === "H1" && parts.month > 6) continue;
      if (half === "H2" && parts.month < 7) continue;
      set.add(parts.month);
    }
    return set;
  }, [revenusRecords, royaltiesCompteId, selectedCanalId, revenusCanalLinkField, revenusCategorieField, revenusDateField, revenusDateWriteField, year, half]);

  // Resolve the compteId of the Shopify column (from revenusColumnsJson) for dup-detection
  const shopifyCompteId = useMemo(() => {
    const col = (columnsConfig.revenus || []).find((c) => c.label === SHOPIFY_COLUMN);
    return col ? col.compteId : null;
  }, [columnsConfig]);

  // Months of the current period that already have a Shopify revenu record in Airtable.
  // We skip pre-filling those months to prevent creating duplicates if the user clicks Save again.
  const monthsWithExistingShopify = useMemo(() => {
    const set = new Set();
    if (!shopifyCompteId || !revenusRecords || !selectedCanalId || !revenusCanalLinkField || !revenusCategorieField) return set;
    const dateFields = [revenusDateField, revenusDateWriteField].filter(Boolean);
    for (const rec of revenusRecords) {
      const links = rec.getCellValue(revenusCanalLinkField);
      if (!Array.isArray(links) || !links.some((l) => l.id === selectedCanalId)) continue;
      const cat = rec.getCellValue(revenusCategorieField);
      if (!Array.isArray(cat) || !cat.some((c) => c.id === shopifyCompteId)) continue;
      let d = null;
      for (const f of dateFields) {
        d = rec.getCellValue(f);
        if (d == null) d = rec.getCellValueAsString(f);
        if (d != null && d !== "") break;
      }
      const parts = parseIsoParts(d);
      if (!parts || parts.year !== year) continue;
      if (half === "H1" && parts.month > 6) continue;
      if (half === "H2" && parts.month < 7) continue;
      set.add(parts.month);
    }
    return set;
  }, [revenusRecords, shopifyCompteId, selectedCanalId, revenusCanalLinkField, revenusCategorieField, revenusDateField, revenusDateWriteField, year, half]);

  // Extract ISRCs from the selected canal's linked Oeuvres
  const isrcList = useMemo(() => {
    if (!selectedCanalId || !canauxRecords || !oeuvresLinkField || !oeuvresRecords || !isrcField) return [];
    const canalRec = canauxRecords.find((r) => r.id === selectedCanalId);
    if (!canalRec) return [];
    const links = canalRec.getCellValue(oeuvresLinkField);
    if (!Array.isArray(links) || links.length === 0) return [];
    const linkedIds = new Set(links.map((l) => l.id));
    const out = [];
    for (const rec of oeuvresRecords) {
      if (!linkedIds.has(rec.id)) continue;
      const isrc = rec.getCellValueAsString(isrcField);
      if (isrc) out.push(isrc);
    }
    return out;
  }, [selectedCanalId, canauxRecords, oeuvresLinkField, oeuvresRecords, isrcField]);

  // Stable value keys for the fetch effects' deps (see the royalties effect).
  const isrcKey = isrcList.join(",");
  const existingRoyaltyMonthsKey = [...monthsWithExistingRoyalty].sort((a, b) => a - b).join(",");
  const existingShopifyMonthsKey = [...monthsWithExistingShopify].sort((a, b) => a - b).join(",");

  // Fetch royalties from Supabase for the selected period and pre-fill the Royalties column
  useEffect(() => {
    if (saving) return; // don't mutate revenusInputs while a save is in flight
    if (!supabaseUrl || !supabaseAnonKey || !clientId || !royaltiesColumn || isrcList.length === 0 || !selectedCanalId) {
      return;
    }
    const dateFrom = half === "H1" ? `${year}-01-01` : `${year}-07-01`;
    const dateTo = half === "H1" ? `${year}-06-30` : `${year}-12-31`;
    const cacheKey = `${selectedCanalId}_${year}_${half}_${isrcList.join(",")}_${royaltiesRefreshKey}`;
    let didCancel = false;

    const applyData = (rows) => {
      const byMonth = {};
      for (const row of rows || []) {
        const monthKey = (row.reporting_month || "").slice(0, 7); // YYYY-MM
        const m = parseInt(monthKey.split("-")[1], 10);
        if (!m || m < 1 || m > 12) continue;
        const rev = parseFloat(row.total_net_revenue) || 0;
        byMonth[m] = (byMonth[m] || 0) + rev;
      }
      setRevenusInputs((prev) => {
        const next = { ...prev };
        for (const m of monthIndices) {
          if (monthsWithExistingRoyalty.has(m)) continue;
          const total = byMonth[m];
          if (total == null || total === 0) continue;
          const row = { ...(next[m] || {}) };
          row[royaltiesColumn] = String(total.toFixed(2));
          next[m] = row;
        }
        return next;
      });
    };

    setRoyaltiesLoading(true);
    setRoyaltiesError(null);
    cachedFetch(royaltiesCacheRef.current, cacheKey, () =>
      postSupabaseRpc(supabaseUrl, supabaseAnonKey, clientId, "get_royalties_summary", {
        p_client_id: clientId,
        p_isrcs: isrcList,
        p_from: dateFrom,
        p_to: dateTo,
      }),
    )
      .then((data) => { if (!didCancel) applyData(data); })
      .catch((err) => { if (!didCancel) setRoyaltiesError(err.message || String(err)); })
      .finally(() => { if (!didCancel) setRoyaltiesLoading(false); });

    return () => {
      didCancel = true;
      setRoyaltiesLoading(false);
    };
    // Deps are value keys, not the Set/array themselves: those are rebuilt on every
    // render (useRecords returns a new array), which used to cancel the request in a loop.
    // monthIndices derived from half; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCanalId, year, half, isrcKey, supabaseUrl, supabaseAnonKey, clientId, royaltiesColumn, royaltiesRefreshKey, existingRoyaltyMonthsKey]);

  // Fetch Shopify sales from Supabase for the selected period and pre-fill the Shopify column.
  // The Shopify project_id is the Airtable canal record id.
  useEffect(() => {
    if (saving) return; // don't mutate revenusInputs while a save is in flight
    if (!supabaseUrl || !supabaseAnonKey || !clientId || !selectedCanalId) {
      return;
    }
    const dateFrom = half === "H1" ? `${year}-01-01` : `${year}-07-01`;
    // get_shopify_sales_summary uses order_date < p_to, so p_to is exclusive.
    const dateTo = half === "H1" ? `${year}-07-01` : `${year + 1}-01-01`;
    const cacheKey = `${selectedCanalId}_${year}_${half}_${shopifyRefreshKey}`;
    let didCancel = false;

    const applyData = (rows) => {
      const byMonth = {};
      for (const row of rows || []) {
        // row.month is the first day of the month (YYYY-MM-DD)
        const m = parseInt(String(row.month || "").slice(5, 7), 10);
        if (!m || m < 1 || m > 12) continue;
        // Sum total_revenue across all product categories for the month.
        byMonth[m] = (byMonth[m] || 0) + (parseFloat(row.total_revenue) || 0);
      }
      setRevenusInputs((prev) => {
        const next = { ...prev };
        for (const m of monthIndices) {
          if (monthsWithExistingShopify.has(m)) continue;
          const total = byMonth[m];
          if (total == null || total === 0) continue;
          const row = { ...(next[m] || {}) };
          row[SHOPIFY_COLUMN] = String(total.toFixed(2));
          next[m] = row;
        }
        return next;
      });
    };

    setShopifyLoading(true);
    setShopifyError(null);
    cachedFetch(shopifyCacheRef.current, cacheKey, () =>
      postSupabaseRpc(supabaseUrl, supabaseAnonKey, clientId, "get_shopify_sales_summary", {
        p_client_id: clientId,
        p_project_ids: [selectedCanalId],
        p_from: dateFrom,
        p_to: dateTo,
      }),
    )
      .then((data) => { if (!didCancel) applyData(data); })
      .catch((err) => { if (!didCancel) setShopifyError(err.message || String(err)); })
      .finally(() => { if (!didCancel) setShopifyLoading(false); });

    return () => {
      didCancel = true;
      setShopifyLoading(false);
    };
    // See the royalties effect for why the deps are value keys.
    // monthIndices derived from half; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCanalId, year, half, supabaseUrl, supabaseAnonKey, clientId, shopifyRefreshKey, existingShopifyMonthsKey]);

  const canaux = useMemo(() => {
    if (!canauxRecords) return [];
    return canauxRecords.map((rec) => {
      let imageUrl = null;
      if (canalImageField) {
        const att = rec.getCellValue(canalImageField);
        if (Array.isArray(att) && att.length > 0) {
          imageUrl = att[0].thumbnails?.large?.url || att[0].url;
        }
      }
      const subtitle = canalSubtitleField ? rec.getCellValueAsString(canalSubtitleField) : "";
      return { id: rec.id, name: rec.name, subtitle, imageUrl };
    });
  }, [canauxRecords, canalImageField, canalSubtitleField]);

  const selectedCanal = useMemo(
    () => canaux.find((c) => c.id === selectedCanalId) || null,
    [canaux, selectedCanalId],
  );

  // In-app canal search (replaces the interface page's search bar, which also
  // filters the Comptes/Revenus/Dépenses tables). Case- and accent-insensitive.
  const [canalSearch, setCanalSearch] = useState("");
  const filteredCanaux = useMemo(() => {
    const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const terms = fold(canalSearch).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return canaux;
    return canaux.filter((c) => {
      const haystack = fold(`${c.name} ${c.subtitle}`);
      return terms.every((t) => haystack.includes(t));
    });
  }, [canaux, canalSearch]);

  const monthIndices = half === "H1" ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];

  const filterEntries = (records, canalLinkField, etatLinkField, dateField, dateWriteField) => {
    const dateFields = [dateField, dateWriteField].filter(Boolean);
    if (!records || !selectedCanalId || !canalLinkField || !etatLinkField || dateFields.length === 0) return [];
    return records.filter((rec) => {
      const links = rec.getCellValue(canalLinkField);
      if (!Array.isArray(links) || !links.some((l) => l.id === selectedCanalId)) return false;
      const etat = rec.getCellValue(etatLinkField);
      if (Array.isArray(etat) && etat.length > 0) return false;
      // Try each available date field, take the first non-empty
      let d = null;
      for (const f of dateFields) {
        d = rec.getCellValue(f);
        if (d == null) d = rec.getCellValueAsString(f);
        if (d != null && d !== "") break;
      }
      if (!isInPeriod(d, year, half)) return false;
      return true;
    });
  };

  const existingRevenus = useMemo(
    () => filterEntries(revenusRecords, revenusCanalLinkField, revenusEtatLinkField, revenusDateField, revenusDateWriteField),
    [revenusRecords, selectedCanalId, year, half, revenusCanalLinkField, revenusEtatLinkField, revenusDateField, revenusDateWriteField],
  );
  const existingDepenses = useMemo(
    () => filterEntries(depensesRecords, depensesCanalLinkField, depensesEtatLinkField, depensesDateField, depensesDateWriteField),
    [depensesRecords, selectedCanalId, year, half, depensesCanalLinkField, depensesEtatLinkField, depensesDateField, depensesDateWriteField],
  );

  // Each grid column = { id (used as input key), name (column header), compteId (for link write), label (Notes write) }
  // We use the label as the unique id so 2 columns sharing the same compte still get separate cells.
  const revenusChoices = useMemo(
    () => columnsConfig.revenus.map((c) => ({ id: c.label, name: c.label, label: c.label, compteId: c.compteId, group: c.group })),
    [columnsConfig],
  );

  // Map existing (already-saved) revenus records onto grid cells: { month: { colId: amount } }.
  // A record matches a column by its Notes label, falling back to its Compte link.
  // This lets the grid display saved values without re-including them in the records to create.
  const existingRevenusByCell = useMemo(() => {
    const map = {};
    if (!revenusMontantField || !revenusCategorieField || revenusChoices.length === 0) return map;
    const dateFields = [revenusDateField, revenusDateWriteField].filter(Boolean);
    for (const rec of existingRevenus) {
      let d = null;
      for (const f of dateFields) {
        d = rec.getCellValue(f);
        if (d == null) d = rec.getCellValueAsString(f);
        if (d != null && d !== "") break;
      }
      const parts = parseIsoParts(d);
      if (!parts) continue;
      const cat = rec.getCellValue(revenusCategorieField);
      const compteId = Array.isArray(cat) && cat[0] ? cat[0].id : null;
      const notes = revenusNotesField ? rec.getCellValueAsString(revenusNotesField) : "";
      let col = revenusChoices.find((c) => c.label === notes && c.compteId === compteId);
      if (!col) col = revenusChoices.find((c) => c.label === notes);
      if (!col) col = revenusChoices.find((c) => c.compteId === compteId);
      if (!col) continue;
      const amt = Number(rec.getCellValue(revenusMontantField)) || 0;
      if (!map[parts.month]) map[parts.month] = {};
      map[parts.month][col.id] = (map[parts.month][col.id] || 0) + amt;
    }
    return map;
  }, [existingRevenus, revenusChoices, revenusMontantField, revenusCategorieField, revenusNotesField, revenusDateField, revenusDateWriteField]);

  const handleRevenusChange = (m, choiceId, val) => {
    setRevenusInputs((prev) => ({ ...prev, [m]: { ...(prev[m] || {}), [choiceId]: val } }));
  };

  const collectRecords = (inputs, columns, dateField, montantField, categorieField, canalLinkField, notesField, notesPrefix) => {
    const out = [];
    if (!dateField || !montantField || !categorieField || !canalLinkField || !selectedCanalId) return out;
    const byLabel = new Map(columns.map((c) => [c.id, c]));
    for (const [mStr, catMap] of Object.entries(inputs)) {
      const m = parseInt(mStr, 10);
      for (const [label, raw] of Object.entries(catMap)) {
        const v = parseFloat(String(raw).replace(",", "."));
        if (!raw || isNaN(v) || v === 0) continue;
        const col = byLabel.get(label);
        if (!col || !col.compteId) continue;
        const fields = {
          [dateField.id]: monthIsoDate(year, m),
          [montantField.id]: v,
          [categorieField.id]: [{ id: col.compteId }],
          [canalLinkField.id]: [{ id: selectedCanalId }],
        };
        if (notesField) fields[notesField.id] = notesPrefix ? `${notesPrefix}${label}` : label;
        out.push({ fields });
      }
    }
    return out;
  };

  // Build a record payload from a saisie row, for the target type's set of fields.
  const buildSaisieRecord = (r, dateField, montantField, categorieField, canalLinkField, notesField) => {
    const v = parseFloat(String(r.montant || "").replace(",", "."));
    if (!r.compteId || !r.month || isNaN(v) || v === 0) return null;
    if (!dateField || !montantField || !categorieField || !canalLinkField || !selectedCanalId) return null;
    const fields = {
      [dateField.id]: monthIsoDate(year, r.month),
      [montantField.id]: v,
      [categorieField.id]: [{ id: r.compteId }],
      [canalLinkField.id]: [{ id: selectedCanalId }],
    };
    if (notesField && r.notes) fields[notesField.id] = r.notes;
    return { fields };
  };

  // Each section saves independently: the Revenus grid and the Saisies lines.
  const gridRevenusToCreate = useMemo(
    () => collectRecords(revenusInputs, revenusChoices, revenusDateWriteField, revenusMontantField, revenusCategorieField, revenusCanalLinkField, revenusNotesField),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revenusInputs, revenusChoices, year, selectedCanalId, revenusDateWriteField, revenusMontantField, revenusCategorieField, revenusCanalLinkField, revenusNotesField],
  );

  const saisiesRevenusToCreate = useMemo(() => {
    return saisies
      .filter((r) => r.type !== "depense")
      .map((r) => buildSaisieRecord(r, revenusDateWriteField, revenusMontantField, revenusCategorieField, revenusCanalLinkField, revenusNotesField))
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisies, year, selectedCanalId, revenusDateWriteField, revenusMontantField, revenusCategorieField, revenusCanalLinkField, revenusNotesField]);

  const saisiesDepensesToCreate = useMemo(() => {
    return saisies
      .filter((r) => r.type === "depense")
      .map((r) => buildSaisieRecord(r, depensesDateWriteField, depensesMontantField, depensesCategorieField, depensesCanalLinkField, depensesNotesField))
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisies, year, selectedCanalId, depensesDateWriteField, depensesMontantField, depensesCategorieField, depensesCanalLinkField, depensesNotesField]);

  // Save status per section: { scope: "grid" | "saisies", text }
  const [saveMsg, setSaveMsg] = useState(null);
  useEffect(() => setSaveMsg(null), [selectedCanalId, year, half]);

  const saveRecords = async (scope, revenusToCreate, depensesToCreate, onDone) => {
    const count = revenusToCreate.length + depensesToCreate.length;
    if (count === 0 || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      for (let i = 0; i < revenusToCreate.length; i += 50) {
        await revenusTable.createRecordsAsync(revenusToCreate.slice(i, i + 50));
      }
      for (let i = 0; i < depensesToCreate.length; i += 50) {
        await depensesTable.createRecordsAsync(depensesToCreate.slice(i, i + 50));
      }
      onDone();
      setSaveMsg({ scope, text: `${count} entrée${count > 1 ? "s" : ""} sauvegardée${count > 1 ? "s" : ""}.` });
    } catch (err) {
      console.error("Save failed:", err);
      setSaveMsg({ scope, text: `Erreur : ${err.message || err}` });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!selectedCanal) return;
    if (!templateAttachmentField) {
      setSavedMsg("Erreur : champ Template Excel non configuré.");
      return;
    }
    const canalRec = (canauxRecords || []).find((r) => r.id === selectedCanalId);
    if (!canalRec) {
      setSavedMsg("Erreur : canal introuvable.");
      return;
    }
    const attachments = canalRec.getCellValue(templateAttachmentField);
    if (!Array.isArray(attachments) || attachments.length === 0) {
      setSavedMsg("Erreur : aucun template attaché sur ce canal.");
      return;
    }
    const templateUrl = attachments[0].url;
    if (!templateUrl) {
      setSavedMsg("Erreur : URL du template introuvable.");
      return;
    }
    setSavedMsg("Génération du rapport…");
    try {
      await exportFromTemplate({
        templateUrl,
        canalName: selectedCanal.name,
        year, half,
        monthIndices,
        revenusInputs, revenusChoices,
        existingDepenses,
        depensesDateField, depensesDateWriteField,
        depensesMontantField, depensesNotesField, depensesFournisseurField, depensesDescriptionField,
        depensesNoFactureField, depensesModePaiementField, depensesArtisteField,
        existingRevenus,
        revenusDateField, revenusDateWriteField,
        revenusMontantField, revenusCategorieField, revenusNotesField, revenusDescriptionField,
      });
      setSavedMsg("Rapport téléchargé.");
    } catch (err) {
      console.error("Export failed:", err);
      setSavedMsg(`Erreur export : ${err.message || err}`);
    }
  };

  // --- KPIs ---

  const sumInputs = (inputs) => {
    let total = 0;
    for (const catMap of Object.values(inputs)) {
      for (const raw of Object.values(catMap)) {
        const v = parseFloat(String(raw).replace(",", "."));
        if (!isNaN(v)) total += v;
      }
    }
    return total;
  };

  const saisiesTotals = useMemo(() => {
    const acc = { revenu: 0, depense: 0 };
    for (const r of saisies) {
      const v = parseFloat(String(r.montant || "").replace(",", "."));
      if (isNaN(v)) continue;
      if (r.type === "depense") acc.depense += v;
      else acc.revenu += v;
    }
    return acc;
  }, [saisies]);

  const totalDepenses = useMemo(() => {
    const existing = depensesMontantField
      ? existingDepenses.reduce((s, r) => s + (Number(r.getCellValue(depensesMontantField)) || 0), 0)
      : 0;
    return existing + saisiesTotals.depense;
  }, [existingDepenses, depensesMontantField, saisiesTotals]);

  const totalRevenus = useMemo(() => {
    const existing = revenusMontantField
      ? existingRevenus.reduce((s, r) => s + (Number(r.getCellValue(revenusMontantField)) || 0), 0)
      : 0;
    return existing + sumInputs(revenusInputs) + saisiesTotals.revenu;
  }, [existingRevenus, revenusInputs, saisiesTotals, revenusMontantField]);

  // --- Render ---

  // Save bar rendered at the bottom of a section's card; saves only that section.
  const renderSaveBar = (scope, count, onSave) => (
    <div className="flex items-center justify-end gap-3 mt-3">
      {saveMsg && saveMsg.scope === scope && (
        <span className="text-sm text-gray-gray600 dark:text-gray-gray200">{saveMsg.text}</span>
      )}
      <button
        onClick={onSave}
        disabled={count === 0 || saving}
        className={`px-4 py-2 rounded text-sm font-medium ${
          count === 0 || saving
            ? "bg-gray-gray200 text-gray-gray500 cursor-not-allowed"
            : "bg-blue-blue text-white hover:bg-blue-blueDark1"
        }`}
      >
        {saving
          ? "Sauvegarde…"
          : count === 0
          ? "Aucune entrée à sauvegarder"
          : `Sauvegarder ${count} entrée${count > 1 ? "s" : ""}`}
      </button>
    </div>
  );

  if (!selectedCanal) {
    return (
      <div className="min-h-screen bg-gray-gray50 dark:bg-gray-gray800 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100">
            Rapports — Sélectionne un enregistrement
          </h1>
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              value={canalSearch}
              onChange={(e) => setCanalSearch(e.target.value)}
              placeholder="Rechercher un canal…"
              autoFocus
              className="w-full bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100 pl-3 pr-8 py-2 rounded border border-gray-gray200 dark:border-gray-gray600 focus:border-blue-blue focus:outline-none"
            />
            {canalSearch && (
              <button
                onClick={() => setCanalSearch("")}
                title="Effacer"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-gray400 hover:text-gray-gray700 dark:hover:text-gray-gray100"
              >
                ×
              </button>
            )}
          </div>
        </div>
        {canaux.length === 0 ? (
          <div className="text-gray-gray500">Aucun canal disponible dans la table sélectionnée.</div>
        ) : filteredCanaux.length === 0 ? (
          <div className="text-gray-gray500">Aucun canal ne correspond à « {canalSearch} ».</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredCanaux.map((c) => (
              <CanalCard key={c.id} {...c} onClick={() => setSelectedCanalId(c.id)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-gray50 dark:bg-gray-gray800 p-4 sm:p-6 pb-20">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={() => setSelectedCanalId(null)}
          className="text-sm text-blue-blue hover:underline"
        >
          ← Retour
        </button>
        <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100">
          {selectedCanal.name}
        </h1>
      </div>

      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <PeriodPicker year={year} half={half} onChangeYear={setYear} onChangeHalf={setHalf} />
          <div className="flex items-center gap-2 text-sm">
            {royaltiesLoading && (
              <span className="flex items-center gap-2 text-gray-gray500">
                <span className="inline-block w-3 h-3 border-2 border-blue-blue border-t-transparent rounded-full animate-spin"></span>
                Chargement royalties…
              </span>
            )}
            {royaltiesError && (
              <span className="text-red-redDark1">Erreur royalties : {royaltiesError}</span>
            )}
            {shopifyLoading && (
              <span className="flex items-center gap-2 text-gray-gray500">
                <span className="inline-block w-3 h-3 border-2 border-blue-blue border-t-transparent rounded-full animate-spin"></span>
                Chargement Shopify…
              </span>
            )}
            {shopifyError && (
              <span className="text-red-redDark1">Erreur Shopify : {shopifyError}</span>
            )}
            <button
              onClick={() => {
                royaltiesCacheRef.current.clear();
                setRoyaltiesRefreshKey((k) => k + 1);
              }}
              title="Rafraîchir les royalties Supabase"
              className="px-2 py-1 rounded text-sm bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray200 hover:bg-gray-gray200"
            >
              ↺ Royalties
            </button>
            <button
              onClick={() => {
                shopifyCacheRef.current.clear();
                setShopifyRefreshKey((k) => k + 1);
              }}
              title="Rafraîchir les ventes Shopify Supabase"
              className="px-2 py-1 rounded text-sm bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray200 hover:bg-gray-gray200"
            >
              ↺ Shopify
            </button>
          </div>
        </div>
      </div>

      {columnsConfig.error && (
        <div className="bg-red-redLight2 text-red-redDark1 rounded-lg p-3 mb-4 text-sm">
          Erreur dans la Configuration des colonnes (JSON) : {columnsConfig.error}
        </div>
      )}

      {/* KPIs stay pinned while scrolling (sm+ only: stacked on mobile they'd eat the screen). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 sm:sticky sm:top-0 sm:z-10 sm:py-2 bg-gray-gray50 dark:bg-gray-gray800">
        <KpiTile label="Total Revenus" value={totalRevenus} accent="green" />
        <KpiTile label="Total Dépenses" value={totalDepenses} accent="red" />
        <KpiTile label="Solde" value={totalRevenus - totalDepenses} accent="blue" />
      </div>

      <div className="relative bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4">
        <div className="absolute top-3 right-3">
          <HelpBadge title="Comment ça marche">
            <p><strong>1. Ajouter une ligne</strong><br />
              Clique sur <strong>+ Ajouter une ligne</strong> pour saisir une entrée ponctuelle : une dépense,
              ou un revenu qui n&apos;a pas de colonne dans le tableau Revenus.</p>
            <p><strong>2. Remplir</strong><br />
              Choisis <strong>Revenu</strong> ou <strong>Dépense</strong>, le mois, puis le compte. La liste des
              comptes change selon le type choisi. Ajoute une description et le montant.</p>
            <p><strong>3. Sauvegarder</strong><br />
              Les lignes ne sont pas enregistrées tant que tu n&apos;as pas cliqué sur <strong>Sauvegarder</strong> en
              bas à droite de ce bloc. Une ligne sans compte ou sans montant est ignorée.</p>
            <p><strong>4. Après la sauvegarde</strong><br />
              Les lignes disparaissent de Saisies et apparaissent dans la liste « Existants » du Revenu ou de la
              Dépense correspondant.</p>
          </HelpBadge>
        </div>
        <SaisiesEditor
          title="Saisies"
          rows={saisies}
          onChange={setSaisies}
          comptes={comptes}
          monthIndices={monthIndices}
        />
        {renderSaveBar("saisies", saisiesRevenusToCreate.length + saisiesDepensesToCreate.length, () =>
          saveRecords("saisies", saisiesRevenusToCreate, saisiesDepensesToCreate, () => setSaisies([])),
        )}
      </div>

      <h2 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mt-2 mb-3">
        Revenus ventes albums
      </h2>
      <div className="relative bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4">
        <div className="absolute top-3 right-3">
          <HelpBadge title="Comment ça marche">
            <p><strong>1. Saisir</strong><br />
              Tape les montants dans les cellules vides. Les montants Royalties (Believe) et Shopify se
              remplissent automatiquement quand ils sont disponibles. Tu peux les corriger avant de sauvegarder.</p>
            <p><strong>2. Sauvegarder</strong><br />
              Rien n&apos;est enregistré tant que tu n&apos;as pas cliqué sur <strong>Sauvegarder</strong> en bas
              à droite. Chaque cellule remplie devient alors une entrée dans la table Revenus.</p>
            <p><strong>3. Le crochet ✓</strong><br />
              Un montant avec un ✓ est déjà enregistré dans Airtable. Il ne se modifie pas ici. Pour le changer,
              modifie ou supprime l&apos;entrée dans la table Revenus : le tableau se met à jour tout seul.</p>
            <p><strong>4. Rafraîchir (↺ Royalties / ↺ Shopify)</strong><br />
              Ces boutons vont chercher à nouveau les derniers chiffres, par exemple après l&apos;import d&apos;un
              nouveau rapport Believe. Seules les cellules sans ✓ sont mises à jour. Attention : une correction
              faite à la main et pas encore sauvegardée sera remplacée.</p>
          </HelpBadge>
        </div>
        <EditableGrid
          title="Saisie"
          choices={revenusChoices}
          monthIndices={monthIndices}
          inputs={revenusInputs}
          onChange={handleRevenusChange}
          existing={existingRevenusByCell}
        />
        {renderSaveBar("grid", gridRevenusToCreate.length, () =>
          saveRecords("grid", gridRevenusToCreate, [], () => setRevenusInputs({})),
        )}
      </div>
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-6">
        <h3 className="text-base font-semibold text-gray-gray700 dark:text-gray-gray100 mb-2">
          Existants sur la période (non encore rapportés)
        </h3>
        <ExistingEntriesList
          title="Revenus"
          entries={existingRevenus}
          dateField={revenusDateField}
          montantField={revenusMontantField}
          categorieField={revenusCategorieField}
          descriptionField={revenusDescriptionField}
        />
      </div>

      <h2 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mt-2 mb-3">
        Dépenses
      </h2>
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-6">
        <h3 className="text-base font-semibold text-gray-gray700 dark:text-gray-gray100 mb-2">
          Existantes sur la période (non encore rapportées)
        </h3>
        <ExistingEntriesList
          title="Dépenses"
          entries={existingDepenses}
          dateField={depensesDateField}
          montantField={depensesMontantField}
          categorieField={depensesCategorieField}
          fournisseurField={depensesFournisseurField}
          descriptionField={depensesDescriptionField}
        />
      </div>

      <div className="flex items-center justify-end gap-3 sticky bottom-0 bg-gray-gray50 dark:bg-gray-gray800 py-3">
        {savedMsg && (
          <span className="text-sm text-gray-gray600 dark:text-gray-gray200">{savedMsg}</span>
        )}
        <button
          onClick={handleExport}
          className="px-4 py-2 rounded text-sm font-medium bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100 border border-gray-gray200 dark:border-gray-gray600 hover:bg-gray-gray50 dark:hover:bg-gray-gray800"
        >
          Télécharger Excel
        </button>
      </div>
    </div>
  );
}

initializeBlock({ interface: () => <RoyaltyReportApp /> });
