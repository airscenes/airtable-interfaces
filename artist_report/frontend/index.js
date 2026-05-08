import { useState, useMemo, useEffect, Fragment } from "react";
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

  const anyField = () => true;

  return [
    // --- Canaux ---
    { key: "canauxTable", label: "Table des Canaux (projets/albums)", type: "table" },
    { key: "canalImageField", label: "Champ image (Canaux)", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },
    { key: "canalSubtitleField", label: "Champ sous-titre carte (Canaux)", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },

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
    { key: "categoriesTable", label: "Table des Catégories (liée à Comptes via le champ « Catégories »)", type: "table" },

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

// --- UI: Editable grid (months × categories) ---

function EditableGrid({ title, choices, monthIndices, inputs, onChange }) {
  const colTotals = useMemo(() => {
    const totals = {};
    for (const c of choices) totals[c.id] = 0;
    for (const m of monthIndices) {
      const row = inputs[m] || {};
      for (const c of choices) {
        const v = parseFloat(String(row[c.id] || "").replace(",", "."));
        if (!isNaN(v)) totals[c.id] += v;
      }
    }
    return totals;
  }, [inputs, choices, monthIndices]);

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
                    {choices.map((c) => (
                      <td key={c.id} className="p-1 border-b border-gray-gray100 dark:border-gray-gray700">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={(inputs[m] && inputs[m][c.id]) || ""}
                          onChange={(e) => onChange(m, c.id, e.target.value)}
                          placeholder="0"
                          className="w-full text-right bg-transparent text-gray-gray700 dark:text-gray-gray100
                                     px-2 py-1 rounded border border-transparent
                                     hover:border-gray-gray200 dark:hover:border-gray-gray600
                                     focus:border-blue-blue focus:outline-none"
                        />
                      </td>
                    ))}
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
            Total saisi : {fmtCurrency(grandTotal)}
          </div>
        </>
      )}
    </div>
  );
}

// --- UI: Existing entries list ---

function ExistingEntriesList({ title, entries, dateField, montantField, categorieField, descriptionField, fournisseurField }) {
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

  // Group by Comptes (catégorie)
  const groups = new Map();
  for (const r of entries) {
    const key = categorieField ? r.getCellValueAsString(categorieField) || "—" : "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, "fr"));
  const colCount = 2 + (fournisseurField ? 1 : 0) + (descriptionField ? 1 : 0);

  return (
    <div className="mt-3">
      <div className="text-sm font-medium text-gray-gray600 dark:text-gray-gray300 mb-1">
        {title} déjà saisis ({entries.length}) — total {fmtCurrency(total)}
      </div>
      <div className="border border-gray-gray100 dark:border-gray-gray600 rounded overflow-hidden">
        <table className="w-full text-sm">
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
              return (
                <Fragment key={compte}>
                  <tr className="bg-gray-gray100 dark:bg-gray-gray800 border-t border-gray-gray200 dark:border-gray-gray600">
                    <td colSpan={colCount - 1} className="p-2 font-semibold text-gray-gray700 dark:text-gray-gray100">
                      {compte} <span className="text-gray-gray500 font-normal">({rows.length})</span>
                    </td>
                    <td className="p-2 text-right font-semibold text-gray-gray700 dark:text-gray-gray100 whitespace-nowrap">
                      {fmtCurrency(groupTotal)}
                    </td>
                  </tr>
                  {rows.map((r) => {
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
    const cat = revenusCategorieField ? rec.getCellValueAsString(revenusCategorieField) : "";
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

// --- Free entries editor (Subventions / Droits synchro) ---

function FreeEntriesEditor({ title, rows, onChange, comptesRecords, monthIndices }) {
  const addRow = () => onChange([...rows, { compteId: "", notes: "", montant: "", month: monthIndices[0] }]);
  const updateRow = (idx, patch) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));

  const total = rows.reduce((s, r) => {
    const v = parseFloat(String(r.montant || "").replace(",", "."));
    return s + (isNaN(v) ? 0 : v);
  }, 0);

  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray100 mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-base border-collapse">
          <thead>
            <tr className="bg-gray-gray50 dark:bg-gray-gray800">
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Mois</th>
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Compte</th>
              <th className="text-left p-2 border-b border-gray-gray200 dark:border-gray-gray600">Description</th>
              <th className="text-right p-2 border-b border-gray-gray200 dark:border-gray-gray600">Montant</th>
              <th className="p-2 border-b border-gray-gray200 dark:border-gray-gray600 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-3 text-center text-gray-gray500 italic">
                  Aucune ligne. Clique sur « + Ajouter » pour saisir.
                </td>
              </tr>
            )}
            {rows.map((r, idx) => (
              <tr key={idx} className="border-b border-gray-gray100 dark:border-gray-gray700">
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
                    {(comptesRecords || []).map((rec) => (
                      <option key={rec.id} value={rec.id}>{rec.name}</option>
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
              <td colSpan={3} className="p-2">Total</td>
              <td className="p-2 text-right">{fmtCurrency(total)}</td>
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
    comptesTable, categoriesTable,
    templateAttachmentField,
  } = cfg;

  const canauxRecords = useRecords(canauxTable);
  const revenusRecords = useRecords(revenusTable);
  const depensesRecords = useRecords(depensesTable);
  const comptesRecords = useRecords(comptesTable);
  // useRecords crashes on null; fall back to a known table when not yet configured.
  const categoriesRecords = useRecords(categoriesTable || canauxTable);

  // Subventions/Droits: only Comptes whose "Catégories" linked records include
  // "Synchronisation" or "Subventions". Linked-record cells return [{id}] only,
  // so resolve names via the linked Catégories table records.
  const filteredComptesRecords = useMemo(() => {
    if (!comptesRecords) return [];
    const norm = (s) => (s || "").normalize("NFC").toLowerCase();
    const catField = comptesTable && comptesTable.fields.find((f) => norm(f.name) === norm("Catégories"));
    if (!catField || !categoriesTable || !categoriesRecords) return comptesRecords;
    const wantedIds = new Set(
      categoriesRecords
        .filter((r) => r.name === "Synchronisation" || r.name === "Subventions")
        .map((r) => r.id),
    );
    if (wantedIds.size === 0) return [];
    return comptesRecords
      .filter((rec) => {
        const v = rec.getCellValue(catField);
        if (!Array.isArray(v)) return false;
        return v.some((item) => item && wantedIds.has(item.id));
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr"));
  }, [comptesRecords, comptesTable, categoriesTable, categoriesRecords]);

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
  const [freeRevenus, setFreeRevenus] = useState([]); // [{compteId, notes, montant, month}]
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);

  useEffect(() => {
    setRevenusInputs({});
    setFreeRevenus([]);
    setSavedMsg(null);
  }, [selectedCanalId, year, half]);

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
    () => columnsConfig.revenus.map((c) => ({ id: c.label, name: c.label, compteId: c.compteId, group: c.group })),
    [columnsConfig],
  );

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

  const collectFreeRecords = (rows, dateField, montantField, categorieField, canalLinkField, notesField) => {
    const out = [];
    if (!dateField || !montantField || !categorieField || !canalLinkField || !selectedCanalId) return out;
    for (const r of rows) {
      const v = parseFloat(String(r.montant || "").replace(",", "."));
      if (!r.compteId || !r.month || isNaN(v) || v === 0) continue;
      const fields = {
        [dateField.id]: monthIsoDate(year, r.month),
        [montantField.id]: v,
        [categorieField.id]: [{ id: r.compteId }],
        [canalLinkField.id]: [{ id: selectedCanalId }],
      };
      if (notesField && r.notes) fields[notesField.id] = r.notes;
      out.push({ fields });
    }
    return out;
  };

  const newRevenusToCreate = useMemo(
    () => [
      ...collectRecords(revenusInputs, revenusChoices, revenusDateWriteField, revenusMontantField, revenusCategorieField, revenusCanalLinkField, revenusNotesField),
      ...collectFreeRecords(freeRevenus, revenusDateWriteField, revenusMontantField, revenusCategorieField, revenusCanalLinkField, revenusNotesField),
    ],
    [revenusInputs, freeRevenus, revenusChoices, year, selectedCanalId, revenusDateWriteField, revenusMontantField, revenusCategorieField, revenusCanalLinkField, revenusNotesField],
  );
  const totalToCreate = newRevenusToCreate.length;

  const handleSave = async () => {
    if (totalToCreate === 0 || saving) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      for (let i = 0; i < newRevenusToCreate.length; i += 50) {
        await revenusTable.createRecordsAsync(newRevenusToCreate.slice(i, i + 50));
      }
      setRevenusInputs({});
      setSavedMsg(`${totalToCreate} entrée${totalToCreate > 1 ? "s" : ""} sauvegardée${totalToCreate > 1 ? "s" : ""}.`);
    } catch (err) {
      console.error("Save failed:", err);
      setSavedMsg(`Erreur : ${err.message || err}`);
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

  const totalDepenses = useMemo(() => {
    return depensesMontantField
      ? existingDepenses.reduce((s, r) => s + (Number(r.getCellValue(depensesMontantField)) || 0), 0)
      : 0;
  }, [existingDepenses, depensesMontantField]);

  const totalRevenus = useMemo(() => {
    const existing = revenusMontantField
      ? existingRevenus.reduce((s, r) => s + (Number(r.getCellValue(revenusMontantField)) || 0), 0)
      : 0;
    const free = freeRevenus.reduce((s, r) => {
      const v = parseFloat(String(r.montant || "").replace(",", "."));
      return s + (isNaN(v) ? 0 : v);
    }, 0);
    return existing + sumInputs(revenusInputs) + free;
  }, [existingRevenus, revenusInputs, freeRevenus, revenusMontantField]);

  // --- Render ---

  if (!selectedCanal) {
    return (
      <div className="min-h-screen bg-gray-gray50 dark:bg-gray-gray800 p-4 sm:p-6">
        <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mb-4">
          Rapports — Sélectionne un spectacle
        </h1>
        {canaux.length === 0 ? (
          <div className="text-gray-gray500">Aucun canal disponible dans la table sélectionnée.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {canaux.map((c) => (
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
        <PeriodPicker year={year} half={half} onChangeYear={setYear} onChangeHalf={setHalf} />
      </div>

      {columnsConfig.error && (
        <div className="bg-red-redLight2 text-red-redDark1 rounded-lg p-3 mb-4 text-sm">
          Erreur dans la Configuration des colonnes (JSON) : {columnsConfig.error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <KpiTile label="Total Revenus" value={totalRevenus} accent="green" />
        <KpiTile label="Total Dépenses" value={totalDepenses} accent="red" />
        <KpiTile label="Solde" value={totalRevenus - totalDepenses} accent="blue" />
      </div>

      <h2 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mt-2 mb-3">
        Revenus ventes albums
      </h2>
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4">
        <EditableGrid
          title="Saisie"
          choices={revenusChoices}
          monthIndices={monthIndices}
          inputs={revenusInputs}
          onChange={handleRevenusChange}
        />
        <FreeEntriesEditor
          title="Subventions / Droits synchro / Autres"
          rows={freeRevenus}
          onChange={setFreeRevenus}
          comptesRecords={filteredComptesRecords}
          monthIndices={monthIndices}
        />
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
        <button
          onClick={handleSave}
          disabled={totalToCreate === 0 || saving}
          className={`px-4 py-2 rounded text-sm font-medium ${
            totalToCreate === 0 || saving
              ? "bg-gray-gray200 text-gray-gray500 cursor-not-allowed"
              : "bg-blue-blue text-white hover:bg-blue-blueDark1"
          }`}
        >
          {saving
            ? "Sauvegarde…"
            : totalToCreate === 0
            ? "Aucune entrée à sauvegarder"
            : `Sauvegarder ${totalToCreate} entrée${totalToCreate > 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}

initializeBlock({ interface: () => <RoyaltyReportApp /> });
