import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import {
  initializeBlock,
  useRecords,
  useCustomProperties,
} from "@airtable/blocks/interface/ui";
import "./style.css";

// --- Helpers ---

const MONTHS_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $`;

function monthIsoDate(year, monthIdx) {
  const mm = String(monthIdx).padStart(2, "0");
  return `${year}-${mm}-01`;
}

function parseIsoParts(value) {
  let iso = value;
  if (Array.isArray(iso)) iso = iso[0];
  if (iso && typeof iso === "object" && iso.value) iso = iso.value;
  if (!iso || typeof iso !== "string") return null;
  if (iso.includes("/")) {
    const parts = iso.split("/").map((s) => parseInt(s, 10));
    if (parts.length === 3) {
      const [d, m, y] = parts;
      if (y && m && d) return { year: y, month: m, day: d };
    }
    return null;
  }
  const [y, m, d] = iso.slice(0, 10).split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  return { year: y, month: m, day: d };
}

function isInPeriod(iso, year, month) {
  const p = parseIsoParts(iso);
  if (!p || p.year !== year) return false;
  return p.month === month;
}

function getInitials(name) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

// Resolve a single linked record (by id) from a "link to record" cell value.
function resolveLinkedId(rec, linkField) {
  if (!linkField) return null;
  const v = rec.getCellValue(linkField);
  if (!Array.isArray(v) || v.length === 0) return null;
  return v[0].id;
}

function resolveLinkedIds(rec, linkField) {
  if (!linkField) return [];
  const v = rec.getCellValue(linkField);
  if (!Array.isArray(v)) return [];
  return v.map((l) => l.id);
}

// --- Custom Properties Definition ---

function getCustomProperties(base) {
  const tables = base.tables;
  const findTable = (...keywords) =>
    tables.find((t) =>
      keywords.some((k) => t.name.toLowerCase().includes(k.toLowerCase())),
    );

  const spectaclesTable = findTable("spectacle") || tables[0];
  const projetsTable = findTable("projet") || tables[0];
  const evenementsTable = findTable("événement", "evenement", "event") || tables[0];
  const revenusTable = findTable("revenu") || tables[0];
  const facturesTable = findTable("facture") || tables[0];

  const anyField = () => true;

  return [
    // --- Spectacles (entrée) ---
    { key: "spectaclesTable", label: "Table des Spectacles", type: "table" },
    { key: "spectacleImageField", label: "Champ image (Spectacles)", type: "field", table: spectaclesTable, shouldFieldBeAllowed: anyField },
    { key: "spectacleSubtitleField", label: "Champ sous-titre carte (Spectacles)", type: "field", table: spectaclesTable, shouldFieldBeAllowed: anyField },
    { key: "templateAttachmentField", label: "Champ attachement Template Excel (Spectacles)", type: "field", table: spectaclesTable, shouldFieldBeAllowed: anyField },

    // --- Projets ---
    { key: "projetsTable", label: "Table des Projets", type: "table" },
    { key: "projetSpectacleLinkField", label: "Lien Spectacle (Projets)", type: "field", table: projetsTable, shouldFieldBeAllowed: anyField },

    // --- Événements ---
    { key: "evenementsTable", label: "Table des Événements", type: "table" },
    { key: "evenementProjetLinkField", label: "Lien Projet (Événements)", type: "field", table: evenementsTable, shouldFieldBeAllowed: anyField },
    { key: "evenementDateField", label: "Champ Date (Événements) — pour tri/filtre", type: "field", table: evenementsTable, shouldFieldBeAllowed: anyField },
    { key: "evenementCachetField", label: "Champ Cachet (Événements) — revenu", type: "field", table: evenementsTable, shouldFieldBeAllowed: anyField },
    { key: "evenementRemiseField", label: "Champ Remise (Événements) — revenu", type: "field", table: evenementsTable, shouldFieldBeAllowed: anyField },
    { key: "evenementCommissionField", label: "Champ Commission (Événements) — dépense", type: "field", table: evenementsTable, shouldFieldBeAllowed: anyField },
    {
      key: "evenementLabelsCsv",
      label: "Libellés colonnes Événements (CSV, séparés par virgule)",
      type: "string",
      defaultValue: "",
    },
    {
      key: "evenementFieldsCsv",
      label: "Noms de champs Événements (CSV, séparés par virgule, dans le même ordre)",
      type: "string",
      defaultValue: "",
    },

    // --- Revenus (items de facture) ---
    { key: "revenusTable", label: "Table des Revenus (items de facture)", type: "table" },
    { key: "revenusFactureLinkField", label: "Lien Facture (Revenus)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusDateField", label: "Champ Date (Revenus) — utilisé pour filtre et affichage", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusMontantField", label: "Champ Montant (Revenus)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusCategorieField", label: "Champ Catégorie/Compte (Revenus, single-select)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusDescriptionField", label: "Champ Description (Revenus, optionnel)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusTaxesField", label: "Champ Taxes (Revenus, single-select)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    {
      key: "revenusCategorieIgnoreJson",
      label: "Catégories Revenus à ignorer (JSON: [\"option name\", ...])",
      type: "string",
      defaultValue: "[]",
    },

    // --- Factures (dépenses) ---
    { key: "facturesTable", label: "Table des Factures (dépenses)", type: "table" },
    { key: "factureProjetLinkField", label: "Lien Projet (Factures)", type: "field", table: facturesTable, shouldFieldBeAllowed: anyField },
    { key: "factureSpectacleLinkField", label: "Lien Spectacle (Factures) — utilisé pour les saisies", type: "field", table: facturesTable, shouldFieldBeAllowed: anyField },
    { key: "factureDateWriteField", label: "Champ Date (Factures) — écriture", type: "field", table: facturesTable, shouldFieldBeAllowed: anyField },
    { key: "factureDescriptionField", label: "Champ Description (Factures, optionnel)", type: "field", table: facturesTable, shouldFieldBeAllowed: anyField },

    // --- États de compte ---
    { key: "etatsTable", label: "Table des États de compte", type: "table" },
    { key: "etatSpectacleLinkField", label: "Lien Spectacle (États de compte)", type: "field", table: tables.find((t) => t.name.toLowerCase().includes("état") || t.name.toLowerCase().includes("etat")) || tables[0], shouldFieldBeAllowed: anyField },
    { key: "etatDateField", label: "Champ Date (États de compte) — mois", type: "field", table: tables.find((t) => t.name.toLowerCase().includes("état") || t.name.toLowerCase().includes("etat")) || tables[0], shouldFieldBeAllowed: anyField },
    { key: "etatAttachmentField", label: "Champ Attachement (États de compte)", type: "field", table: tables.find((t) => t.name.toLowerCase().includes("état") || t.name.toLowerCase().includes("etat")) || tables[0], shouldFieldBeAllowed: anyField },
    { key: "etatTotalRevenusField", label: "Champ Total Revenus (États de compte)", type: "field", table: tables.find((t) => t.name.toLowerCase().includes("état") || t.name.toLowerCase().includes("etat")) || tables[0], shouldFieldBeAllowed: anyField },
    { key: "etatTotalDepensesField", label: "Champ Total Dépenses (États de compte)", type: "field", table: tables.find((t) => t.name.toLowerCase().includes("état") || t.name.toLowerCase().includes("etat")) || tables[0], shouldFieldBeAllowed: anyField },
    { key: "etatEvenementsLinkField", label: "Lien Événements (États de compte) — audit trail", type: "field", table: tables.find((t) => t.name.toLowerCase().includes("état") || t.name.toLowerCase().includes("etat")) || tables[0], shouldFieldBeAllowed: anyField },
    { key: "etatRevenusLinkField", label: "Lien Revenus (États de compte) — audit trail", type: "field", table: tables.find((t) => t.name.toLowerCase().includes("état") || t.name.toLowerCase().includes("etat")) || tables[0], shouldFieldBeAllowed: anyField },
  ];
}

// --- UI: Spectacle card ---

function SpectacleCard({ name, subtitle, imageUrl, onClick }) {
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

// --- UI: Period picker (Année + Mois) ---

function PeriodPicker({ year, month, onChangeYear, onChangeMonth }) {
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now - 4; y <= now + 1; y++) years.push(y);

  const selectClass =
    "appearance-none bg-white dark:bg-gray-gray700 border border-gray-gray200 " +
    "dark:border-gray-gray600 rounded px-3 py-1.5 pr-8 text-sm " +
    "text-gray-gray700 dark:text-gray-gray100";

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-gray-gray600 dark:text-gray-gray300">Année</span>
        <div className="relative">
          <select
            value={year}
            onChange={(e) => onChangeYear(parseInt(e.target.value, 10))}
            className={selectClass}
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-gray500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.5 7.5l4.5 4.5 4.5-4.5z" />
          </svg>
        </div>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-gray-gray600 dark:text-gray-gray300">Mois</span>
        <div className="relative">
          <select
            value={month}
            onChange={(e) => onChangeMonth(parseInt(e.target.value, 10))}
            className={selectClass}
          >
            {MONTHS_FR.map((name, idx) => (
              <option key={idx + 1} value={idx + 1}>{name}</option>
            ))}
          </select>
          <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-gray500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.5 7.5l4.5 4.5 4.5-4.5z" />
          </svg>
        </div>
      </label>
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

// --- UI: Saisies editor (Revenu = Revenus row; Dépense = Facture + 1 Revenus item) ---

function SaisiesEditor({ title, rows, onChange, revenusCategories, taxesChoices, monthName, defaultDate }) {
  const addRow = () => onChange([
    ...rows,
    { type: "revenu", categorieId: "", description: "", montant: "", taxes: "", date: defaultDate },
  ]);
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
      <h3 className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray100 mb-2">
        {title} <span className="text-sm font-normal text-gray-gray500">({monthName})</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-base border-collapse table-fixed">
          <colgroup>
            <col style={{ width: 150 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 180 }} />
            <col />
            <col style={{ width: 110 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-gray50 dark:bg-gray-gray800">
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Type</th>
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Date</th>
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Catégorie</th>
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Description</th>
              <th className="text-right p-2 border-b border-gray-gray200 dark:border-gray-gray600">Taxes</th>
              <th className="text-right p-2 border-b border-gray-gray200 dark:border-gray-gray600">Montant</th>
              <th className="p-2 border-b border-gray-gray200 dark:border-gray-gray600"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-center text-gray-gray500 italic">
                  Aucune ligne. Clique sur « + Ajouter » pour saisir.
                </td>
              </tr>
            )}
            {rows.map((r, idx) => {
              const options = revenusCategories;
              return (
                <tr key={idx} className="border-b border-gray-gray100 dark:border-gray-gray700">
                  <td className="p-1">
                    <div className="inline-flex border border-gray-gray200 dark:border-gray-gray600 rounded overflow-hidden text-xs">
                      <button
                        onClick={() => updateRow(idx, { type: "revenu", categorieId: "" })}
                        className={`px-2 py-1 w-16 text-center ${
                          r.type !== "depense"
                            ? "bg-green-greenDark1 text-white"
                            : "bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100"
                        }`}
                      >
                        Revenu
                      </button>
                      <button
                        onClick={() => updateRow(idx, { type: "depense", categorieId: "" })}
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
                    <input
                      type="date"
                      value={r.date || ""}
                      onChange={(e) => updateRow(idx, { date: e.target.value })}
                      className="w-full bg-transparent text-gray-gray700 dark:text-gray-gray100 px-2 py-1 rounded border border-gray-gray200 dark:border-gray-gray600 focus:border-blue-blue focus:outline-none"
                    />
                  </td>
                  <td className="p-1">
                    <select
                      value={r.categorieId}
                      onChange={(e) => updateRow(idx, { categorieId: e.target.value })}
                      className="bg-white dark:bg-gray-gray700 border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 text-base w-full"
                    >
                      <option value="">— Choisir —</option>
                      {options.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1">
                    <input
                      type="text"
                      value={r.description}
                      onChange={(e) => updateRow(idx, { description: e.target.value })}
                      placeholder="Description"
                      className="w-full bg-transparent text-gray-gray700 dark:text-gray-gray100 px-2 py-1 rounded border border-gray-gray200 dark:border-gray-gray600 focus:border-blue-blue focus:outline-none"
                    />
                  </td>
                  <td className="p-1">
                    <select
                      value={r.taxes || ""}
                      onChange={(e) => updateRow(idx, { taxes: e.target.value })}
                      className="bg-white dark:bg-gray-gray700 border border-gray-gray200 dark:border-gray-gray600 rounded px-2 py-1 text-base w-full"
                    >
                      <option value="">—</option>
                      {(taxesChoices || []).map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.name}</option>
                      ))}
                    </select>
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
              );
            })}
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

// --- UI: Événements liés au projet ---
//
// JSON format: [{"label": "Date", "fieldName": "Date événement"}, {"label": "Lieu", "fieldName": "Venue"}, ...]
// Champs absents (vides) sur un événement sont masqués pour cette ligne.

function EvenementsList({ evenements, evenementsTable, fieldsConfig, dateField }) {
  const sorted = useMemo(() => {
    if (!dateField) return evenements;
    const key = (rec) => {
      const v = rec.getCellValue(dateField);
      const p = parseIsoParts(v);
      return p ? p.year * 10000 + p.month * 100 + p.day : 0;
    };
    return [...evenements].sort((a, b) => key(a) - key(b));
  }, [evenements, dateField]);

  if (!sorted || sorted.length === 0) {
    return (
      <div className="text-sm text-gray-gray500 italic">
        Aucun événement lié à ce projet (non rapporté).
      </div>
    );
  }

  if (!fieldsConfig || fieldsConfig.length === 0) {
    return (
      <div className="text-sm text-gray-gray500 italic">
        Configurer le JSON « Champs à afficher pour les Événements » pour voir les colonnes.
      </div>
    );
  }

  // Resolve field objects from names (once per render).
  const fieldObjs = fieldsConfig.map((cfg) => {
    if (!evenementsTable) return { ...cfg, field: null };
    const field = evenementsTable.fields.find((f) => f.name === cfg.fieldName);
    return { ...cfg, field };
  });

  // Show every configured column whose field resolves in the table, even if all values are empty.
  const visibleCols = fieldObjs.filter((c) => !!c.field);

  if (visibleCols.length === 0) {
    return (
      <div className="text-sm text-gray-gray500 italic">
        Aucun champ d&apos;événement non vide à afficher. Vérifie que les champs sont
        « Visibles » dans la section Données des paramètres de l&apos;extension.
      </div>
    );
  }

  // For each column, sum values that are actually numbers. Strings (including date strings like
  // "2026-05-15", which parseFloat would mis-read as 2026) are skipped. A column is "numeric" only
  // when at least one row yields a real Number — those columns get a total in the footer.
  const columnTotals = visibleCols.map((c) => {
    let sum = 0;
    let hasAny = false;
    for (const rec of sorted) {
      const raw = rec.getCellValue(c.field);
      if (typeof raw === "number" && !isNaN(raw)) {
        sum += raw;
        hasAny = true;
      }
    }
    return hasAny ? sum : null;
  });
  const hasAnyTotal = columnTotals.some((t) => t !== null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-gray-gray50 dark:bg-gray-gray800">
          <tr>
            {visibleCols.map((c) => (
              <th key={c.fieldName} className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600 font-medium text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((rec) => (
            <tr key={rec.id} className="border-b border-gray-gray100 dark:border-gray-gray700 hover:bg-gray-gray50 dark:hover:bg-gray-gray800">
              {visibleCols.map((c) => {
                const v = rec.getCellValueAsString(c.field);
                return (
                  <td key={c.fieldName} className="p-2 text-gray-gray700 dark:text-gray-gray100 align-top">
                    {v || ""}
                  </td>
                );
              })}
            </tr>
          ))}
          {hasAnyTotal && (
            <tr className="bg-gray-gray50 dark:bg-gray-gray800 font-semibold border-t border-gray-gray200 dark:border-gray-gray600">
              {visibleCols.map((c, idx) => (
                <td key={c.fieldName} className="p-2 text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                  {columnTotals[idx] !== null ? fmtCurrency(columnTotals[idx]) : (idx === 0 ? `Total (${sorted.length})` : "")}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- UI: Revenus groupés par catégorie ---

// `revenusFactureDates` is a Map(revenuId → ISO date) computed by the parent from the linked Facture.
function RevenusByCategory({ revenus, montantField, categorieField, descriptionField, revenusFactureDates, groupByCategory = true, totalLabel = "Total" }) {
  const groups = useMemo(() => {
    if (!groupByCategory) return null;
    const map = new Map();
    for (const r of revenus) {
      const key = categorieField ? r.getCellValueAsString(categorieField) || "—" : "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "fr"));
  }, [revenus, categorieField, groupByCategory]);

  if (!revenus || revenus.length === 0) {
    return (
      <div className="text-sm text-gray-gray500 italic">
        Aucune entrée pour cette période.
      </div>
    );
  }

  const grandTotal = revenus.reduce((s, r) => s + (Number(r.getCellValue(montantField)) || 0), 0);

  const rowFor = (r) => {
    const dateIso = revenusFactureDates.get(r.id) || "";
    const desc = descriptionField ? r.getCellValueAsString(descriptionField) : "";
    const cat = categorieField ? r.getCellValueAsString(categorieField) : "";
    const m = Number(r.getCellValue(montantField)) || 0;
    return { id: r.id, dateIso, desc, cat, m };
  };

  return (
    <div className="border border-gray-gray100 dark:border-gray-gray600 rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-gray50 dark:bg-gray-gray800">
          <tr>
            <th className="text-left p-2">Date</th>
            {!groupByCategory && categorieField && <th className="text-left p-2">Catégorie</th>}
            <th className="text-left p-2">Description</th>
            <th className="text-right p-2" style={{ width: 130 }}>Montant</th>
          </tr>
        </thead>
        <tbody>
          {groupByCategory ? (
            groups.map(([cat, rows]) => {
              const groupTotal = rows.reduce((s, r) => s + (Number(r.getCellValue(montantField)) || 0), 0);
              return (
                <Fragment key={cat}>
                  <tr className="bg-gray-gray100 dark:bg-gray-gray800 border-t border-gray-gray200 dark:border-gray-gray600">
                    <td colSpan={2} className="p-2 font-semibold text-gray-gray700 dark:text-gray-gray100">
                      {cat} <span className="text-gray-gray500 font-normal">({rows.length})</span>
                    </td>
                    <td className="p-2 text-right font-semibold text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                      {fmtCurrency(groupTotal)}
                    </td>
                  </tr>
                  {rows.map((r) => {
                    const row = rowFor(r);
                    return (
                      <tr key={row.id} className="border-t border-gray-gray100 dark:border-gray-gray700">
                        <td className="p-2 text-gray-gray600 dark:text-gray-gray300 whitespace-nowrap">
                          {typeof row.dateIso === "string" ? row.dateIso.slice(0, 10) : ""}
                        </td>
                        <td className="p-2 text-gray-gray600 dark:text-gray-gray300">{row.desc}</td>
                        <td className="p-2 text-right text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                          {fmtCurrency(row.m)}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })
          ) : (
            [...revenus]
              .map(rowFor)
              .sort((a, b) => (a.dateIso || "").localeCompare(b.dateIso || ""))
              .map((row) => (
                <tr key={row.id} className="border-t border-gray-gray100 dark:border-gray-gray700">
                  <td className="p-2 text-gray-gray600 dark:text-gray-gray300 whitespace-nowrap">
                    {typeof row.dateIso === "string" ? row.dateIso.slice(0, 10) : ""}
                  </td>
                  {categorieField && (
                    <td className="p-2 text-gray-gray600 dark:text-gray-gray300">{row.cat}</td>
                  )}
                  <td className="p-2 text-gray-gray600 dark:text-gray-gray300">{row.desc}</td>
                  <td className="p-2 text-right text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                    {fmtCurrency(row.m)}
                  </td>
                </tr>
              ))
          )}
          <tr className="bg-gray-gray50 dark:bg-gray-gray800 font-semibold border-t border-gray-gray200 dark:border-gray-gray600">
            <td colSpan={!groupByCategory && categorieField ? 3 : 2} className="p-2">{totalLabel}</td>
            <td className="p-2 text-right whitespace-nowrap">{fmtCurrency(grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// --- UI: État de compte upload (drag/drop, base64 data URL → Airtable attachment) ---

const ETAT_MAX_BYTES = 5 * 1024 * 1024;

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function EtatDeCompteUpload({
  etatsTable,
  etatsRecords,
  spectacleId,
  spectacleName,
  year,
  month,
  etatSpectacleLinkField,
  etatDateField,
  etatAttachmentField,
  etatTotalRevenusField,
  etatTotalDepensesField,
  etatEvenementsLinkField,
  etatRevenusLinkField,
  evenementIds,
  revenusIds,
  kpis,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Find the existing État de compte for this spectacle + this month.
  const existing = useMemo(() => {
    if (!etatsRecords || !spectacleId || !etatSpectacleLinkField || !etatDateField) return null;
    return etatsRecords.find((rec) => {
      const links = resolveLinkedIds(rec, etatSpectacleLinkField);
      if (!links.includes(spectacleId)) return false;
      const d = rec.getCellValue(etatDateField);
      const p = parseIsoParts(d);
      return p && p.year === year && p.month === month;
    }) || null;
  }, [etatsRecords, spectacleId, etatSpectacleLinkField, etatDateField, year, month]);

  const existingAttachment = existing && etatAttachmentField
    ? (() => {
        const v = existing.getCellValue(etatAttachmentField);
        return Array.isArray(v) && v.length > 0 ? v[0] : null;
      })()
    : null;

  const upload = async (file) => {
    if (!file || busy) return;
    setError(null);
    if (file.size > ETAT_MAX_BYTES) {
      setError(`Fichier trop volumineux (${formatBytes(file.size)}). Maximum : ${formatBytes(ETAT_MAX_BYTES)}.`);
      return;
    }
    if (file.size === 0) {
      setError("Fichier vide.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readFileAsDataURL(file);
      const isoDate = monthIsoDate(year, month);
      const fields = {};
      if (etatAttachmentField) fields[etatAttachmentField.id] = [{ url: dataUrl, filename: file.name }];
      if (etatDateField) fields[etatDateField.id] = isoDate;
      if (etatSpectacleLinkField) fields[etatSpectacleLinkField.id] = [{ id: spectacleId }];
      if (etatTotalRevenusField) fields[etatTotalRevenusField.id] = kpis.revenus;
      if (etatTotalDepensesField) fields[etatTotalDepensesField.id] = kpis.depenses;
      if (etatEvenementsLinkField && Array.isArray(evenementIds)) {
        fields[etatEvenementsLinkField.id] = evenementIds.map((id) => ({ id }));
      }
      if (etatRevenusLinkField && Array.isArray(revenusIds)) {
        fields[etatRevenusLinkField.id] = revenusIds.map((id) => ({ id }));
      }

      if (existing) {
        await etatsTable.updateRecordsAsync([{ id: existing.id, fields }]);
      } else {
        await etatsTable.createRecordsAsync([{ fields }]);
      }
    } catch (err) {
      console.error("État de compte upload failed:", err);
      setError(`Erreur : ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !busy && fileInputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-blue bg-blue-blueLight3 dark:bg-gray-gray600"
            : "border-gray-gray200 dark:border-gray-gray600 bg-white dark:bg-gray-gray700 hover:border-blue-blueLight1"
        } ${busy ? "opacity-60 cursor-wait" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={(e) => upload(e.target.files?.[0])}
        />
        {busy ? (
          <div className="text-sm text-gray-gray600 dark:text-gray-gray200">Upload en cours…</div>
        ) : existingAttachment ? (
          <div>
            <div className="text-sm font-semibold text-gray-gray700 dark:text-gray-gray200">
              {existingAttachment.filename}
            </div>
            <div className="text-xs text-gray-gray500 mt-1">
              État de compte enregistré pour {MONTHS_FR[month - 1]} {year} · {spectacleName}
            </div>
            <div className="mt-2 flex items-center justify-center gap-3 text-xs">
              <a
                href={existingAttachment.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-blue hover:underline"
              >
                Télécharger
              </a>
              <span className="text-gray-gray400">·</span>
              <span className="text-blue-blue">Cliquer ou glisser un fichier pour remplacer</span>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm font-semibold text-gray-gray600 dark:text-gray-gray300">
              Glissez un état de compte ici, ou cliquez pour sélectionner
            </div>
            <div className="text-xs text-gray-gray400 mt-2">
              Aucun état pour {MONTHS_FR[month - 1]} {year} · Max {formatBytes(ETAT_MAX_BYTES)}
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className="mt-2 rounded bg-red-redLight3 dark:bg-red-redDusty/20 border border-red-redLight2 p-2 text-sm text-red-redDark1 dark:text-red-redLight1">
          {error}
        </div>
      )}
    </div>
  );
}

// --- Excel export (template-based, generic placeholders) ---
//
// Replaces tags in template: {{nom_spectacle}}, {{periode}}, {{annee}}, {{mois}},
// {{total_revenus}}, {{total_depenses}}, {{solde}}.
// More structured fills (per-row tables) can be added once the new template format is finalized.

async function exportFromTemplate({ templateUrl, spectacleName, year, month, totals }) {
  const { default: ExcelJS } = await import("exceljs");
  const periodLabel = `${MONTHS_FR[month - 1]} ${year}`;
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error(`Téléchargement template échoué: ${res.status}`);
  const buf = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet("Rapport") || wb.worksheets[0];
  if (!ws) throw new Error("Aucune feuille dans le template");

  const replacements = {
    nom_spectacle: spectacleName,
    periode: periodLabel,
    annee: String(year),
    mois: MONTHS_FR[month - 1],
    total_revenus: fmtCurrency(totals.revenus),
    total_depenses: fmtCurrency(totals.depenses),
    solde: fmtCurrency(totals.solde),
  };
  const replaceTags = (s) => {
    let out = s;
    for (const [k, v] of Object.entries(replacements)) {
      out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
    }
    return out;
  };
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string") cell.value = replaceTags(cell.value);
      else if (cell.value && typeof cell.value === "object" && typeof cell.value.text === "string") {
        cell.value = { ...cell.value, text: replaceTags(cell.value.text) };
      }
    });
  });

  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };

  const out = await wb.xlsx.writeBuffer();
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, "_");
  a.href = url;
  a.download = `Rapport_${safe(spectacleName)}_${year}-${String(month).padStart(2, "0")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Config prompt ---

function ConfigPrompt() {
  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-gray-gray50 dark:bg-gray-gray800">
      <div className="max-w-md text-center">
        <p className="text-gray-gray600 dark:text-gray-gray200">
          Veuillez configurer les tables et champs dans les propriétés de l&apos;extension
          (Spectacles, Projets, Événements, Revenus, Factures).
        </p>
      </div>
    </div>
  );
}

// --- Helpers: extract single-select options ---

function getSelectOptions(field, ignoreList) {
  if (!field) return [];
  const opts = field.options?.choices || [];
  const ignoreSet = new Set((ignoreList || []).map((s) => String(s).toLowerCase()));
  return opts
    .filter((o) => !ignoreSet.has(String(o.name).toLowerCase()))
    .map((o) => ({ id: o.id, name: o.name }));
}

// --- Helper: extract an ISO date string from a date cell value (handles wrappers/arrays). ---
function readDateIso(rec, ...fields) {
  for (const f of fields) {
    if (!f) continue;
    let v = rec.getCellValue(f);
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === "object" && v.value) v = v.value;
    if (v == null || v === "") v = rec.getCellValueAsString(f);
    if (v && typeof v === "string") return v;
  }
  return null;
}

// --- Main App ---

function ProjectReportApp() {
  const { customPropertyValueByKey } = useCustomProperties(getCustomProperties);
  const { spectaclesTable, projetsTable, evenementsTable, revenusTable, facturesTable } = customPropertyValueByKey;

  if (!spectaclesTable || !projetsTable || !evenementsTable || !revenusTable || !facturesTable) {
    return <ConfigPrompt />;
  }
  return <ReportInner cfg={customPropertyValueByKey} />;
}

function ReportInner({ cfg }) {
  const {
    spectaclesTable, spectacleImageField, spectacleSubtitleField, templateAttachmentField,
    projetsTable, projetSpectacleLinkField,
    evenementsTable, evenementProjetLinkField, evenementDateField, evenementCachetField, evenementRemiseField, evenementCommissionField, evenementLabelsCsv, evenementFieldsCsv,
    revenusTable, revenusFactureLinkField, revenusDateField, revenusMontantField, revenusCategorieField, revenusDescriptionField, revenusTaxesField,
    revenusCategorieIgnoreJson,
    facturesTable, factureProjetLinkField, factureSpectacleLinkField, factureDateWriteField,
    factureDescriptionField,
    etatsTable, etatSpectacleLinkField, etatDateField, etatAttachmentField,
    etatTotalRevenusField, etatTotalDepensesField,
    etatEvenementsLinkField, etatRevenusLinkField,
  } = cfg;

  const spectaclesRecords = useRecords(spectaclesTable);
  const projetsRecords = useRecords(projetsTable);
  const evenementsRecords = useRecords(evenementsTable);
  const revenusRecords = useRecords(revenusTable);
  const facturesRecords = useRecords(facturesTable);
  const etatsRecords = useRecords(etatsTable || facturesTable);

  const [selectedSpectacleId, setSelectedSpectacleId] = useState(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [saisies, setSaisies] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);

  useEffect(() => {
    setSaisies([]);
    setSavedMsg(null);
  }, [selectedSpectacleId, year, month]);

  // Zip two CSV custom properties (labels + field names) into [{label, fieldName}, ...].
  // Length-limit workaround for Airtable's string custom property: splitting across two
  // shorter inputs avoids the cap a single JSON value hits.
  const evenementFieldsConfig = useMemo(() => {
    const labels = (evenementLabelsCsv || "").split(",").map((s) => s.trim()).filter(Boolean);
    const fields = (evenementFieldsCsv || "").split(",").map((s) => s.trim()).filter(Boolean);
    const n = Math.min(labels.length, fields.length);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ label: labels[i], fieldName: fields[i] });
    return out;
  }, [evenementLabelsCsv, evenementFieldsCsv]);

  const revenusCategorieIgnore = useMemo(() => {
    try {
      const parsed = JSON.parse(revenusCategorieIgnoreJson || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [revenusCategorieIgnoreJson]);

  // Build Spectacle cards
  const spectacles = useMemo(() => {
    if (!spectaclesRecords) return [];
    return spectaclesRecords.map((rec) => {
      let imageUrl = null;
      if (spectacleImageField) {
        const att = rec.getCellValue(spectacleImageField);
        if (Array.isArray(att) && att.length > 0) {
          imageUrl = att[0].thumbnails?.large?.url || att[0].url;
        }
      }
      const subtitle = spectacleSubtitleField ? rec.getCellValueAsString(spectacleSubtitleField) : "";
      return { id: rec.id, name: rec.name, subtitle, imageUrl };
    });
  }, [spectaclesRecords, spectacleImageField, spectacleSubtitleField]);

  const selectedSpectacle = useMemo(
    () => spectacles.find((s) => s.id === selectedSpectacleId) || null,
    [spectacles, selectedSpectacleId],
  );

  // --- Cascade: Spectacle → Projets ---

  const spectacleProjets = useMemo(() => {
    if (!projetsRecords || !selectedSpectacleId || !projetSpectacleLinkField) return [];
    return projetsRecords.filter((rec) =>
      resolveLinkedIds(rec, projetSpectacleLinkField).includes(selectedSpectacleId),
    );
  }, [projetsRecords, selectedSpectacleId, projetSpectacleLinkField]);

  const spectacleProjetIds = useMemo(
    () => new Set(spectacleProjets.map((p) => p.id)),
    [spectacleProjets],
  );

  // --- Cascade: Projets → Événements (filtered by month) ---

  const spectacleEvenements = useMemo(() => {
    if (!evenementsRecords || !evenementProjetLinkField || spectacleProjetIds.size === 0) return [];
    return evenementsRecords.filter((rec) => {
      const projetLinks = resolveLinkedIds(rec, evenementProjetLinkField);
      if (!projetLinks.some((id) => spectacleProjetIds.has(id))) return false;
      if (evenementDateField) {
        const d = readDateIso(rec, evenementDateField);
        if (!isInPeriod(d, year, month)) return false;
      }
      return true;
    });
  }, [evenementsRecords, evenementProjetLinkField, evenementDateField, spectacleProjetIds, year, month]);

  // --- Cascade: Projets → Factures (filtered by month) ---

  // A Facture belongs to the spectacle if either:
  //   - it is linked directly to the spectacle via factureSpectacleLinkField (new flow), OR
  //   - it is linked to one of the spectacle's projets via factureProjetLinkField (legacy data)
  const factureBelongsToSpectacle = (rec) => {
    if (factureSpectacleLinkField) {
      const spectacleLinks = resolveLinkedIds(rec, factureSpectacleLinkField);
      if (spectacleLinks.includes(selectedSpectacleId)) return true;
    }
    if (factureProjetLinkField && spectacleProjetIds.size > 0) {
      const projetLinks = resolveLinkedIds(rec, factureProjetLinkField);
      if (projetLinks.some((id) => spectacleProjetIds.has(id))) return true;
    }
    return false;
  };

  const facturesById = useMemo(() => {
    const map = new Map();
    if (!facturesRecords) return map;
    for (const rec of facturesRecords) map.set(rec.id, rec);
    return map;
  }, [facturesRecords]);

  // --- Cascade: Factures → Revenus (the Revenu carries its own date) ---

  // Full list of revenus belonging to the spectacle for the current period — no category filter.
  // Used by the KPI totals so they reflect the real sums.
  const spectacleRevenusAll = useMemo(() => {
    if (!revenusRecords || !revenusFactureLinkField || !selectedSpectacleId) return [];
    return revenusRecords.filter((rec) => {
      const factureId = resolveLinkedId(rec, revenusFactureLinkField);
      if (!factureId) return false;
      const facture = facturesById.get(factureId);
      if (!facture) return false;
      if (!factureBelongsToSpectacle(facture)) return false;
      if (revenusDateField) {
        const d = readDateIso(rec, revenusDateField);
        if (!isInPeriod(d, year, month)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenusRecords, revenusFactureLinkField, revenusDateField, factureProjetLinkField, factureSpectacleLinkField, facturesById, spectacleProjetIds, selectedSpectacleId, year, month]);

  // Display-only filter: hide categories listed in revenusCategorieIgnore (already shown in the
  // Événements table). The KPIs continue to use spectacleRevenusAll so totals stay accurate.
  const spectacleRevenusVisible = useMemo(() => {
    const ignoreSet = new Set((revenusCategorieIgnore || []).map((s) => String(s).toLowerCase()));
    if (ignoreSet.size === 0 || !revenusCategorieField) return spectacleRevenusAll;
    return spectacleRevenusAll.filter((rec) => {
      const cat = rec.getCellValueAsString(revenusCategorieField);
      return !cat || !ignoreSet.has(cat.toLowerCase());
    });
  }, [spectacleRevenusAll, revenusCategorieField, revenusCategorieIgnore]);

  // Split visible Revenus into income (montant >= 0) and expense (montant < 0) for the two lists.
  const spectacleRevenus = useMemo(
    () => revenusMontantField
      ? spectacleRevenusVisible.filter((r) => (Number(r.getCellValue(revenusMontantField)) || 0) >= 0)
      : spectacleRevenusVisible,
    [spectacleRevenusVisible, revenusMontantField],
  );
  const spectacleDepenses = useMemo(
    () => revenusMontantField
      ? spectacleRevenusVisible.filter((r) => (Number(r.getCellValue(revenusMontantField)) || 0) < 0)
      : [],
    [spectacleRevenusVisible, revenusMontantField],
  );

  // Map (revenuId → ISO date) read directly from the Revenu record, for display in RevenusByCategory.
  const revenusFactureDates = useMemo(() => {
    const map = new Map();
    if (!revenusDateField) return map;
    for (const rec of spectacleRevenusVisible) {
      const d = readDateIso(rec, revenusDateField);
      map.set(rec.id, typeof d === "string" ? d.slice(0, 10) : "");
    }
    return map;
  }, [spectacleRevenusVisible, revenusDateField]);

  // --- Categories ---

  const revenusCategories = useMemo(
    () => getSelectOptions(revenusCategorieField, revenusCategorieIgnore),
    [revenusCategorieField, revenusCategorieIgnore],
  );
  const taxesChoices = useMemo(
    () => getSelectOptions(revenusTaxesField, []),
    [revenusTaxesField],
  );

  // --- KPIs ---
  //
  // Revenus KPI = sum(Cachet + Remise) over events of the period
  //             + visible Revenus with montant > 0 (categories not ignored)
  //             + saisies "revenu"
  // Dépenses KPI = sum(Commission) over events of the period
  //             + visible Revenus with montant < 0 (absolute)
  //             + saisies "depense"

  const sumField = (records, field) => {
    if (!field) return 0;
    return records.reduce((s, r) => s + (Number(r.getCellValue(field)) || 0), 0);
  };

  const eventCachetTotal = useMemo(
    () => sumField(spectacleEvenements, evenementCachetField),
    [spectacleEvenements, evenementCachetField],
  );
  const eventRemiseTotal = useMemo(
    () => sumField(spectacleEvenements, evenementRemiseField),
    [spectacleEvenements, evenementRemiseField],
  );
  const eventCommissionTotal = useMemo(
    () => sumField(spectacleEvenements, evenementCommissionField),
    [spectacleEvenements, evenementCommissionField],
  );

  const totalRevenus = useMemo(() => {
    const fromEvents = eventCachetTotal + eventRemiseTotal;
    const fromVisible = revenusMontantField
      ? spectacleRevenusVisible.reduce((s, r) => {
          const v = Number(r.getCellValue(revenusMontantField)) || 0;
          return v > 0 ? s + v : s;
        }, 0)
      : 0;
    const saisi = saisies
      .filter((r) => r.type !== "depense")
      .reduce((s, r) => {
        const v = parseFloat(String(r.montant || "").replace(",", "."));
        return s + (isNaN(v) ? 0 : v);
      }, 0);
    return fromEvents + fromVisible + saisi;
  }, [eventCachetTotal, eventRemiseTotal, spectacleRevenusVisible, revenusMontantField, saisies]);

  const totalDepenses = useMemo(() => {
    const fromEvents = Math.abs(eventCommissionTotal);
    const fromVisible = revenusMontantField
      ? spectacleRevenusVisible.reduce((s, r) => {
          const v = Number(r.getCellValue(revenusMontantField)) || 0;
          return v < 0 ? s + Math.abs(v) : s;
        }, 0)
      : 0;
    const saisi = saisies
      .filter((r) => r.type === "depense")
      .reduce((s, r) => {
        const v = parseFloat(String(r.montant || "").replace(",", "."));
        return s + (isNaN(v) ? 0 : v);
      }, 0);
    return fromEvents + fromVisible + saisi;
  }, [eventCommissionTotal, spectacleRevenusVisible, revenusMontantField, saisies]);

  // --- Save (create 1 Facture + 1 Revenu item per saisie row) ---

  const handleSave = async () => {
    if (saving) return;
    const validRows = saisies.filter((r) => {
      const v = parseFloat(String(r.montant || "").replace(",", "."));
      return r.categorieId && !isNaN(v) && v !== 0;
    });
    if (validRows.length === 0) {
      setSavedMsg("Aucune ligne valide à sauvegarder (catégorie + montant requis).");
      return;
    }
    if (!selectedSpectacleId) {
      setSavedMsg("Aucun spectacle sélectionné.");
      return;
    }
    setSaving(true);
    setSavedMsg(null);
    try {
      const fallbackDate = monthIsoDate(year, month);
      let created = 0;
      for (const row of validRows) {
        const rawV = Math.abs(parseFloat(String(row.montant).replace(",", ".")));
        // Dépense type stores the amount as negative on the Revenu (Dépenses = revenus négatifs).
        const v = row.type === "depense" ? -rawV : rawV;
        const factureFields = {};
        if (factureDateWriteField) factureFields[factureDateWriteField.id] = row.date || fallbackDate;
        if (factureSpectacleLinkField) factureFields[factureSpectacleLinkField.id] = [{ id: selectedSpectacleId }];
        if (factureDescriptionField && row.description) factureFields[factureDescriptionField.id] = row.description;
        const [factureId] = await facturesTable.createRecordsAsync([{ fields: factureFields }]);

        const revenuFields = {};
        if (revenusFactureLinkField) revenuFields[revenusFactureLinkField.id] = [{ id: factureId }];
        // Date is intentionally NOT written to the Revenu — revenusDateField is typically a lookup
        // from the linked Facture and is read-only. The date is set on the Facture only.
        if (revenusMontantField) revenuFields[revenusMontantField.id] = v;
        if (revenusDescriptionField && row.description) revenuFields[revenusDescriptionField.id] = row.description;
        if (revenusCategorieField && row.categorieId) {
          revenuFields[revenusCategorieField.id] = { id: row.categorieId };
        }
        if (revenusTaxesField && row.taxes) {
          revenuFields[revenusTaxesField.id] = { id: row.taxes };
        }
        await revenusTable.createRecordsAsync([{ fields: revenuFields }]);
        created += 1;
      }
      setSaisies([]);
      setSavedMsg(`${created} saisie${created > 1 ? "s" : ""} sauvegardée${created > 1 ? "s" : ""}.`);
    } catch (err) {
      console.error("Save failed:", err);
      setSavedMsg(`Erreur : ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  // --- Export ---

  const handleExport = async () => {
    if (!selectedSpectacle) return;
    if (!templateAttachmentField) {
      setSavedMsg("Erreur : champ Template Excel non configuré.");
      return;
    }
    const spectacleRec = (spectaclesRecords || []).find((r) => r.id === selectedSpectacleId);
    const attachments = spectacleRec ? spectacleRec.getCellValue(templateAttachmentField) : null;
    if (!Array.isArray(attachments) || attachments.length === 0) {
      setSavedMsg("Erreur : aucun template attaché sur ce spectacle.");
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
        spectacleName: selectedSpectacle.name,
        year, month,
        totals: {
          revenus: totalRevenus,
          depenses: totalDepenses,
          solde: totalRevenus - totalDepenses,
        },
      });
      setSavedMsg("Rapport téléchargé.");
    } catch (err) {
      console.error("Export failed:", err);
      setSavedMsg(`Erreur export : ${err.message || err}`);
    }
  };

  // --- Render ---

  if (!selectedSpectacle) {
    return (
      <div className="min-h-screen bg-gray-gray50 dark:bg-gray-gray800 p-4 sm:p-6">
        <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mb-4">
          Rapports — Sélectionne un spectacle
        </h1>
        {spectacles.length === 0 ? (
          <div className="text-gray-gray500">Aucun spectacle disponible.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {spectacles.map((s) => (
              <SpectacleCard key={s.id} {...s} onClick={() => setSelectedSpectacleId(s.id)} />
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
          onClick={() => setSelectedSpectacleId(null)}
          className="text-sm text-blue-blue hover:underline"
        >
          ← Retour
        </button>
        <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100">
          {selectedSpectacle.name}
        </h1>
      </div>

      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4">
        <PeriodPicker year={year} month={month} onChangeYear={setYear} onChangeMonth={setMonth} />
      </div>

      <h2 className="text-4xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mb-4 text-center">
        {MONTHS_FR[month - 1]} {year}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <KpiTile label="Total Revenus" value={totalRevenus} accent="green" />
        <KpiTile label="Total Dépenses" value={totalDepenses} accent="red" />
        <KpiTile label="Solde" value={totalRevenus - totalDepenses} accent="blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2 bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4">
          <SaisiesEditor
            title="Saisies à la volée"
            rows={saisies}
            onChange={setSaisies}
            revenusCategories={revenusCategories}
            taxesChoices={taxesChoices}
            monthName={`${MONTHS_FR[month - 1]} ${year}`}
            defaultDate={monthIsoDate(year, month)}
          />
        </div>
        {etatsTable && (
          <div className="lg:col-span-1">
            <EtatDeCompteUpload
              etatsTable={etatsTable}
              etatsRecords={etatsRecords}
              spectacleId={selectedSpectacleId}
              spectacleName={selectedSpectacle.name}
              year={year}
              month={month}
              etatSpectacleLinkField={etatSpectacleLinkField}
              etatDateField={etatDateField}
              etatAttachmentField={etatAttachmentField}
              etatTotalRevenusField={etatTotalRevenusField}
              etatTotalDepensesField={etatTotalDepensesField}
              etatEvenementsLinkField={etatEvenementsLinkField}
              etatRevenusLinkField={etatRevenusLinkField}
              evenementIds={spectacleEvenements.map((r) => r.id)}
              revenusIds={spectacleRevenusAll.map((r) => r.id)}
              kpis={{ revenus: totalRevenus, depenses: totalDepenses, solde: totalRevenus - totalDepenses }}
            />
          </div>
        )}
      </div>

      <h2 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mt-2 mb-3">
        Événements
      </h2>
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4">
        <EvenementsList
          evenements={spectacleEvenements}
          evenementsTable={evenementsTable}
          fieldsConfig={evenementFieldsConfig}
          dateField={evenementDateField}
        />
      </div>

      <h2 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mt-2 mb-3">
        Revenus (par catégorie)
      </h2>
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4">
        <RevenusByCategory
          revenus={spectacleRevenus}
          montantField={revenusMontantField}
          categorieField={revenusCategorieField}
          descriptionField={revenusDescriptionField}
          revenusFactureDates={revenusFactureDates}
          totalLabel="Total revenus"
        />
      </div>

      <h2 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mt-2 mb-3">
        Dépenses
      </h2>
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-6">
        <RevenusByCategory
          revenus={spectacleDepenses}
          montantField={revenusMontantField}
          categorieField={revenusCategorieField}
          descriptionField={revenusDescriptionField}
          revenusFactureDates={revenusFactureDates}
          groupByCategory={false}
          totalLabel="Total dépenses"
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
        <button
          onClick={handleSave}
          disabled={saisies.length === 0 || saving}
          className={`px-4 py-2 rounded text-sm font-medium ${
            saisies.length === 0 || saving
              ? "bg-gray-gray200 text-gray-gray500 cursor-not-allowed"
              : "bg-blue-blue text-white hover:bg-blue-blueDark1"
          }`}
        >
          {saving
            ? "Sauvegarde…"
            : saisies.length === 0
            ? "Aucune saisie"
            : `Sauvegarder ${saisies.length} saisie${saisies.length > 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}

initializeBlock({ interface: () => <ProjectReportApp /> });
