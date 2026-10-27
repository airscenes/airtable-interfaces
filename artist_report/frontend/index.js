import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import {
  initializeBlock,
  useRecords,
  useCustomProperties,
  expandRecord,
} from "@airtable/blocks/interface/ui";
import ExcelJS from "exceljs";
import { fillTemplate, fixOverlappingMerges, normalizeWorkbookForExcel, copyWorksheet } from "./excelTemplate";
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
    : `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

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

// "YYYY-MM-DD" from parseIsoParts output ("" when unparseable), for string comparisons.
function isoFromParts(p) {
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` : "";
}

const pad2 = (n) => String(n).padStart(2, "0");

// A reporting period: a half-year (H1/H2) or a single month, from the PeriodPicker
// selection { granularity: "half" | "month", year, half, month }. Bounds are ISO
// strings compared as strings (no Date objects, so no timezone shift).
//   start / end  first and last day, inclusive
//   next         first day after the period (exclusive bound)
//   prevStart    start of the previous period of the same granularity (rattrapages)
//   closeFrom    first day of the period's last month: an État de compte dated from
//                there on closes the period (older États are not always dated on the
//                last day, e.g. 2025-12-01 for July–December)
function buildPeriod({ granularity, year, half, month }) {
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

const defaultPeriodSelection = () => ({
  granularity: "half",
  year: new Date().getFullYear(),
  half: "H1",
  month: new Date().getMonth() + 1,
});

function isInPeriod(value, period) {
  const iso = isoFromParts(parseIsoParts(value));
  return !!iso && iso >= period.start && iso <= period.end;
}

// First non-empty value among the given date fields (read field, then write field).
function readEntryDate(rec, dateFields) {
  let d = null;
  for (const f of dateFields) {
    if (!f) continue;
    d = rec.getCellValue(f);
    if (d == null) d = rec.getCellValueAsString(f);
    if (d != null && d !== "") break;
  }
  return d;
}

const linksTo = (rec, field, id) => {
  if (!field || !id) return false;
  const v = rec.getCellValue(field);
  return Array.isArray(v) && v.some((l) => l.id === id);
};

const linkedIds = (rec, field) => {
  if (!rec || !field) return [];
  const v = rec.getCellValue(field);
  return Array.isArray(v) ? v.map((l) => l.id) : [];
};

// Case- and accent-insensitive search over a list of { name, subtitle }.
function filterBySearch(items, search) {
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const terms = fold(search).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((c) => {
    const haystack = fold(`${c.name} ${c.subtitle || ""}`);
    return terms.every((t) => haystack.includes(t));
  });
}

// Card image URL from an attachment field, a lookup of attachments (cell =
// [{ linkedRecordId, value }], value = one attachment or an array of them) or a
// text/URL/formula field holding a URL.
function getImageUrl(rec, field) {
  if (!rec || !field) return null;
  const v = rec.getCellValue(field);
  const items = Array.isArray(v)
    ? v.flatMap((x) => (x && typeof x === "object" && "linkedRecordId" in x ? x.value : x))
    : [v];
  for (const a of items) {
    if (a && typeof a === "object" && a.url) return a.thumbnails?.large?.url || a.url;
    if (typeof a === "string" && /^https?:\/\//.test(a.trim())) return a.trim();
  }
  return null;
}

const safeFileName = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, "_");

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
  const ayantsTable = findTable("ayant") || tables[0];
  const etatsTable = findTable("état", "etat") || tables[0];

  const anyField = () => true;

  const artistesTable = findTable("artiste") || tables[0];
  const projetsTable = findTable("projet") || tables[0];

  return [
    // --- Mode: Canal page (one canal at a time) or Artiste page (all canaux of an artist) ---
    {
      key: "mode",
      label: "Mode de la page",
      type: "enum",
      possibleValues: [
        { value: "canal", label: "Canal (un canal à la fois)" },
        { value: "artiste", label: "Artiste (tous les canaux d'un artiste)" },
      ],
      defaultValue: "canal",
    },

    // --- Artistes → Projets → Canaux (mode Artiste) ---
    { key: "artistesTable", label: "Table des Artistes (mode Artiste)", type: "table" },
    { key: "artistesImageField", label: "Champ image (Artistes, optionnel)", type: "field", table: artistesTable, shouldFieldBeAllowed: anyField },
    { key: "artistesProjetsLinkField", label: "Lien Projets (Artistes)", type: "field", table: artistesTable, shouldFieldBeAllowed: anyField },
    { key: "projetsTable", label: "Table des Projets (mode Artiste)", type: "table" },
    { key: "projetsCanauxLinkField", label: "Lien Canaux (Projets)", type: "field", table: projetsTable, shouldFieldBeAllowed: anyField },

    // --- Canaux ---
    { key: "canauxTable", label: "Table des Canaux (projets/albums)", type: "table" },
    { key: "canalImageField", label: "Champ image (Canaux)", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },
    { key: "canalSubtitleField", label: "Champ sous-titre carte (Canaux)", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },
    { key: "canauxFilterField", label: "Champ filtre (Canaux, single select, optionnel)", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },
    { key: "canauxFilterDefault", label: "Filtre Canaux — valeurs cochées par défaut (optionnel, ex. Actif,En cours)", type: "string", defaultValue: "" },
    { key: "oeuvresLinkField", label: "Champ lien Oeuvres (Canaux)", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },
    { key: "catalogField", label: "Champ numéro de catalogue (Canaux) — ventes Bandcamp/Propagande sans ISRC", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField, defaultValue: canauxTable.fields.find((f) => f.name === "numero_canal") },

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
    { key: "revenusNoFactureField", label: "Champ No facture (Revenus, optionnel)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusModePaiementField", label: "Champ Mode paiement (Revenus, optionnel)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusFournisseurField", label: "Champ Fournisseur / Payeur (Revenus, optionnel)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },
    { key: "revenusArtisteField", label: "Champ Artiste (Revenus, optionnel)", type: "field", table: revenusTable, shouldFieldBeAllowed: anyField },

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
    // Exact "Comptes" first: a partial match picks "categorie_compte" or "États de compte".
    { key: "comptesNumeroField", label: "Champ numero_compte (Comptes) — < 5000 = Revenu, ≥ 5000 = Dépense", type: "field", table: tables.find((t) => t.name.toLowerCase() === "comptes") || findTable("compte") || tables[0], shouldFieldBeAllowed: anyField },

    // --- Template Excel ---
    { key: "templateAttachmentField", label: "Champ attachement Template Excel", type: "field", table: canauxTable, shouldFieldBeAllowed: anyField },

    // --- Ayants-droits (section PARTAGE du rapport Excel) ---
    { key: "ayantsTable", label: "Table des Ayants-droits", type: "table" },
    { key: "ayantsCanalLinkField", label: "Lien Canal (Ayants-droits)", type: "field", table: ayantsTable, shouldFieldBeAllowed: anyField },
    { key: "ayantsNomField", label: "Champ Nom (Ayants-droits) — ex. lien Organismes", type: "field", table: ayantsTable, shouldFieldBeAllowed: anyField },
    { key: "ayantsPartField", label: "Champ Part % (Ayants-droits)", type: "field", table: ayantsTable, shouldFieldBeAllowed: anyField },

    // --- États de compte ---
    { key: "etatsTable", label: "Table des États de compte", type: "table" },
    { key: "etatsCanalLinkField", label: "Lien Canal (États de compte)", type: "field", table: etatsTable, shouldFieldBeAllowed: anyField },
    { key: "etatsDateField", label: "Champ Date (États de compte)", type: "field", table: etatsTable, shouldFieldBeAllowed: anyField },
    { key: "etatsOuvertureField", label: "Champ Solde d'ouverture (États de compte)", type: "field", table: etatsTable, shouldFieldBeAllowed: anyField },
    { key: "etatsFermetureField", label: "Champ Solde fermeture (États de compte)", type: "field", table: etatsTable, shouldFieldBeAllowed: anyField },
    { key: "etatsPaiementField", label: "Champ Paiement (États de compte)", type: "field", table: etatsTable, shouldFieldBeAllowed: anyField },
    { key: "etatsRevenusLinkField", label: "Lien Revenus (États de compte)", type: "field", table: etatsTable, shouldFieldBeAllowed: anyField },
    { key: "etatsDepensesLinkField", label: "Lien Dépenses (États de compte)", type: "field", table: etatsTable, shouldFieldBeAllowed: anyField },
    { key: "etatsArtisteLinkField", label: "Lien Artiste (États de compte, optionnel — rempli en mode Artiste)", type: "field", table: etatsTable, shouldFieldBeAllowed: anyField },
    { key: "soldeOuvertureCompte", label: "No de compte Solde d'ouverture (numero_compte, ex. 4000)", type: "string", defaultValue: "4000" },
    { key: "soldeReporteCompte", label: "No de compte Solde reporté (dépense, numero_compte, ex. 5000)", type: "string", defaultValue: "5000" },
    { key: "paiementsComptes", label: "Comptes de paiement (Dépenses, optionnel, ex. 52xx ou 5200-5299) — paiements du solde, datés par la facture", type: "string", defaultValue: "" },

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
    { key: "clientId", label: "Client UUID (Believe)", type: "string", defaultValue: "" },
    { key: "royaltiesColumn", label: "Label colonne Believe (dans JSON Revenus)", type: "string", defaultValue: "Believe" },
    { key: "bandcampColumn", label: "Label colonne Bandcamp (dans JSON Revenus)", type: "string", defaultValue: "Bandcamp" },
    { key: "propagandeColumn", label: "Label colonne Propagande (dans JSON Revenus)", type: "string", defaultValue: "Propagande" },
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

function SegmentedButtons({ options, value, onChange }) {
  return (
    <div className="flex border border-gray-gray200 dark:border-gray-gray600 rounded overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm ${
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
                   dark:border-gray-gray600 rounded px-3 py-1.5 pr-8 text-sm
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

// value = { granularity: "half" | "month", year, half: "H1" | "H2", month: 1–12 }
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
      <label className="flex items-center gap-2 text-sm">
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

// --- UI: Single-select filter (dropdown of checkboxes with colored pills) ---

const SELECT_COLORS = {
  blueBright:   { bg: "#2d7ff9", text: "#fff" },
  blueLight1:   { bg: "#9cc7ff", text: "#333" },
  blueLight2:   { bg: "#cfdfff", text: "#333" },
  cyanBright:   { bg: "#18bfff", text: "#fff" },
  cyanLight1:   { bg: "#77d1f3", text: "#333" },
  cyanLight2:   { bg: "#d0f0fd", text: "#333" },
  tealBright:   { bg: "#20d9d2", text: "#fff" },
  tealLight1:   { bg: "#72ddc3", text: "#333" },
  tealLight2:   { bg: "#c2f5e9", text: "#333" },
  greenBright:  { bg: "#20c933", text: "#fff" },
  greenLight1:  { bg: "#93e088", text: "#333" },
  greenLight2:  { bg: "#d1f7c4", text: "#333" },
  yellowBright: { bg: "#fcb400", text: "#333" },
  yellowLight1: { bg: "#ffd66e", text: "#333" },
  yellowLight2: { bg: "#ffeab6", text: "#333" },
  orangeBright: { bg: "#ff6f2c", text: "#fff" },
  orangeLight1: { bg: "#ffaa57", text: "#333" },
  orangeLight2: { bg: "#fee2d5", text: "#333" },
  redBright:    { bg: "#f82b60", text: "#fff" },
  redLight1:    { bg: "#ff9eb7", text: "#333" },
  redLight2:    { bg: "#ffdce5", text: "#333" },
  pinkBright:   { bg: "#ff08c2", text: "#fff" },
  pinkLight1:   { bg: "#f99de2", text: "#333" },
  pinkLight2:   { bg: "#ffdaf6", text: "#333" },
  purpleBright: { bg: "#8b46ff", text: "#fff" },
  purpleLight1: { bg: "#cdb0ff", text: "#333" },
  purpleLight2: { bg: "#ede2fe", text: "#333" },
  grayBright:   { bg: "#666666", text: "#fff" },
  gray:         { bg: "#aaaaaa", text: "#fff" },
};

// Option names of a single/multiple select cell, or of a lookup of one.
function selectNames(rec, field) {
  const v = rec.getCellValue(field);
  const items = Array.isArray(v)
    ? v.flatMap((x) => (x && typeof x === "object" && "linkedRecordId" in x ? x.value : x))
    : [v];
  return items
    .map((x) => (x && typeof x === "object" ? x.name : x))
    .filter((x) => x != null && x !== "")
    .map(String);
}

// Filter of records on a select field. `defaultRaw` = comma-separated names checked at
// start; nothing checked = no filter. Without a field every record matches.
function useChoiceFilter(field, defaultRaw, records) {
  const [selected, setSelected] = useState(
    () => new Set(String(defaultRaw || "").split(",").map((s) => s.trim()).filter(Boolean)),
  );
  // Choices in the field's order with their colors; for other field types, the values found.
  const choices = useMemo(() => {
    if (!field) return [];
    let opts = null;
    try {
      opts = field.config.options?.choices || field.config.options?.result?.options?.choices || null;
    } catch { /* field config unavailable */ }
    if (opts) return opts.map((c) => ({ name: c.name, color: c.color || null }));
    const names = new Set();
    for (const rec of records || []) for (const n of selectNames(rec, field)) names.add(n);
    return [...names].sort((a, b) => a.localeCompare(b, "fr")).map((name) => ({ name, color: null }));
  }, [field, records]);
  const matches = useMemo(
    () => (rec) => !field || selected.size === 0 || selectNames(rec, field).some((n) => selected.has(n)),
    [field, selected],
  );
  return { field, choices, selected, setSelected, matches };
}

function SelectPill({ name, color }) {
  const c = SELECT_COLORS[color];
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${c ? "" : "bg-gray-gray100 text-gray-gray700 dark:bg-gray-gray600 dark:text-gray-gray100"}`}
      style={c ? { backgroundColor: c.bg, color: c.text } : undefined}
    >
      {name}
    </span>
  );
}

function ChoiceFilter({ filter, small = false }) {
  const { field, choices, selected, setSelected } = filter;
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

  if (!field) return null;
  const toggle = (name) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });
  const label = selected.size === 0
    ? `${field.name} : tous`
    : selected.size === 1
    ? `${field.name} : ${[...selected][0]}`
    : `${field.name} : ${selected.size}`;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100 pl-3 pr-2 rounded border focus:outline-none whitespace-nowrap ${
          small ? "py-1.5 text-sm" : "py-2"
        } ${selected.size > 0 ? "border-blue-blue" : "border-gray-gray200 dark:border-gray-gray600"}`}
      >
        <span className="max-w-[12rem] truncate">{label}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" className="text-gray-gray400" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-20 min-w-[12rem] max-h-80 overflow-auto py-1 rounded-lg shadow-lg
                     bg-white dark:bg-gray-gray700 border border-gray-gray200 dark:border-gray-gray600 text-sm"
        >
          {choices.length === 0 && <div className="px-3 py-2 text-gray-gray500">Aucune option.</div>}
          {choices.map((c) => (
            <label
              key={c.name}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-gray50 dark:hover:bg-gray-gray600"
            >
              <input type="checkbox" checked={selected.has(c.name)} onChange={() => toggle(c.name)} />
              <SelectPill name={c.name} color={c.color} />
            </label>
          ))}
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="w-full text-left px-3 py-1.5 mt-1 border-t border-gray-gray100 dark:border-gray-gray600 text-blue-blue hover:bg-gray-gray50 dark:hover:bg-gray-gray600"
            >
              Tout afficher
            </button>
          )}
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

function ExistingEntriesList({ title, table, entries, dateField, montantField, categorieField, descriptionField, fournisseurField, noFactureField, periodStart }) {
  // Expanded budget lines (compte names); all collapsed by default.
  const [expanded, setExpanded] = useState(() => new Set());
  // Clicking an entry opens its record detail (side sheet, per the page's
  // record-detail setting) — only when the page allows expanding this table.
  const canOpen = !!table && table.hasPermissionToExpandRecords();
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
  const colCount = 2 + (noFactureField ? 1 : 0) + (fournisseurField ? 1 : 0) + (descriptionField ? 1 : 0);
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
            {noFactureField && <col style={{ width: 110 }} />}
            {fournisseurField && <col />}
            {descriptionField && <col />}
            <col style={{ width: 130 }} />
          </colgroup>
          <thead className="bg-gray-gray50 dark:bg-gray-gray800">
            <tr>
              <th className="text-left p-2">Date</th>
              {noFactureField && <th className="text-left p-2">No facture</th>}
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
                    const noFacture = noFactureField ? r.getCellValueAsString(noFactureField) : "";
                    const fournisseur = fournisseurField ? r.getCellValueAsString(fournisseurField) : "";
                    const desc = descriptionField ? r.getCellValueAsString(descriptionField) : "";
                    const m = Number(r.getCellValue(montantField)) || 0;
                    return (
                      <tr
                        key={r.id}
                        onClick={canOpen ? () => expandRecord(r) : undefined}
                        title={canOpen ? "Ouvrir la fiche" : undefined}
                        className={`border-t border-gray-gray100 dark:border-gray-gray700${
                          canOpen ? " cursor-pointer hover:bg-gray-gray50 dark:hover:bg-gray-gray600" : ""
                        }`}
                      >
                        <td className="p-2 text-gray-gray600 dark:text-gray-gray300 whitespace-nowrap">
                          {typeof dateIso === "string" ? dateIso.slice(0, 10) : ""}
                          {periodStart && isoFromParts(parseIsoParts(dateIso)) && isoFromParts(parseIsoParts(dateIso)) < periodStart && (
                            <span className="ml-1 px-1 rounded text-xs bg-orange-orangeLight2 text-orange-orangeDark1" title="Période antérieure jamais rapportée">
                              rattrapage
                            </span>
                          )}
                        </td>
                        {noFactureField && (
                          <td className="p-2 text-gray-gray600 dark:text-gray-gray300 truncate">{noFacture}</td>
                        )}
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

// --- Excel export — fills the canal's attached template (ExcelJS). Cells are
// located by the tags the template carries, never by row number: see
// excelTemplate.js for the mechanics (row repetition, formula re-pointing).
//
// Tags available to the template:
//   Scalars  ${nom_spectacle} ${nom_artiste} ${periode} ${annee}
//            ${total_revenus} ${total_depenses} ${net} (revenus − dépenses of the period)
//            ${total_a_spliter} (= net: only the period is split) ${solde_precedent}
//            ${total_paiements} (52xx payments dated in the period)
//            ${solde_fermeture} (solde précédent + net − paiements) ${deficit_reporte} (min(solde_fermeture, 0))
//            ${colonne.c1}…${colonne.cN}  Revenus grid column labels (revenusColumnsJson order)
//            ${m1.nom}…${m6.nom}          month names of the half-year
//            ${m1.c1}…${m6.cN}            grid amount for month i × column j, as shown on screen
//   One-row blocks (the row is repeated per record)
//            ${depense.no_facture|date|mode_paiement|fournisseur|poste|artiste|montant|description}
//            ${revenu.no_facture|date|mode_paiement|fournisseur|poste|artiste|montant|description}
//            ${paiement.no_facture|date|mode_paiement|fournisseur|poste|artiste|montant|description}
//            ${revenu.libelle|categorie}  saved revenus not in the grid (poste = notes, else categorie)
//            ${ayant_droit.nom|part|montant}  part = fraction (format the cell as %),
//                                             montant = max(net, 0) × part

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

// First attachment of the canal's template field: { url } or { error } (UI message).
function getTemplateUrl(canalRec, templateAttachmentField) {
  if (!templateAttachmentField) return { error: "champ Template Excel non configuré." };
  if (!canalRec) return { error: "canal introuvable." };
  const attachments = canalRec.getCellValue(templateAttachmentField);
  if (!Array.isArray(attachments) || attachments.length === 0) return { error: "aucun template attaché sur ce canal." };
  if (!attachments[0].url) return { error: "URL du template introuvable." };
  return { url: attachments[0].url };
}

// Fill one canal's template for a period. `revenus` / `depenses` / `paiements` are the
// entries listed in the report (grid and solde entries already left out); the grid comes
// from `revenusByCell` (saved) + `revenusInputs` (typed, canal page only).
// Returns the workbook and the totals written in it.
async function fillCanalReport({
  templateUrl, canalName, period, cfg,
  revenusChoices, revenusByCell, revenusInputs = {},
  revenus: existingRevenus, depenses: existingDepenses, paiements: existingPaiements = [],
  ayantsDroits, soldePrecedent,
}) {
  const {
    depensesDateField, depensesDateWriteField,
    depensesMontantField, depensesNotesField, depensesFournisseurField, depensesDescriptionField,
    depensesNoFactureField, depensesModePaiementField, depensesArtisteField,
    revenusDateField, revenusDateWriteField,
    revenusMontantField, revenusCategorieField, revenusNotesField, revenusDescriptionField,
    revenusNoFactureField, revenusModePaiementField, revenusFournisseurField, revenusArtisteField,
  } = cfg;

  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error(`Téléchargement template échoué: ${res.status}`);
  const buf = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await fixOverlappingMerges(buf));
  const ws = wb.getWorksheet("Rapport") || wb.worksheets[0];
  if (!ws) throw new Error("Feuille 'Rapport' introuvable dans le template");

  // A grid cell as shown on screen: saved amount (✓) + unsaved input, same sum
  // as EditableGrid's column totals.
  const gridCellValue = (m, choiceId) => {
    const raw = (revenusInputs[m] && revenusInputs[m][choiceId]) || "";
    const typed = parseFloat(String(raw).replace(",", "."));
    const saved = revenusByCell[m] && revenusByCell[m][choiceId];
    return (isNaN(typed) ? 0 : typed) + (typeof saved === "number" ? saved : 0);
  };

  const tags = {
    nom_spectacle: canalName,
    nom_artiste: canalName,
    periode: period.label,
    annee: String(period.year),
  };
  revenusChoices.forEach((c, j) => {
    tags[`colonne.c${j + 1}`] = c.name;
  });
  // Templates carry six month rows (half-year); a monthly period fills the first one
  // and blanks the others (an unknown tag would stay visible).
  let gridTotal = 0;
  for (let i = 0; i < Math.max(6, period.months.length); i++) {
    const m = period.months[i];
    tags[`m${i + 1}.nom`] = m ? MONTHS_FR[m - 1] : "";
    revenusChoices.forEach((c, j) => {
      const v = m ? gridCellValue(m, c.id) : 0;
      gridTotal += v;
      tags[`m${i + 1}.c${j + 1}`] = v || "";
    });
  }

  const str = (rec, f) => (f ? rec.getCellValueAsString(f) : "");
  const isoDate = (rec, f, fw) => {
    const d = readDateForExport(rec, f, fw);
    return typeof d === "string" ? d.slice(0, 10) : "";
  };
  const byDate = (a, b) => a.date.localeCompare(b.date);

  const depenseRow = (rec) => ({
    no_facture: str(rec, depensesNoFactureField),
    date: isoDate(rec, depensesDateField, depensesDateWriteField),
    mode_paiement: str(rec, depensesModePaiementField),
    fournisseur: str(rec, depensesFournisseurField),
    poste: str(rec, depensesNotesField),
    artiste: str(rec, depensesArtisteField),
    montant: Number(rec.getCellValue(depensesMontantField)) || 0,
    description: str(rec, depensesDescriptionField),
  });
  const depense = existingDepenses.map(depenseRow).sort(byDate);
  const paiement = existingPaiements.map(depenseRow).sort(byDate);

  const revenu = existingRevenus
    .map((rec) => {
      const date = isoDate(rec, revenusDateField, revenusDateWriteField);
      const categorie = getLinkNames(rec, revenusCategorieField);
      const notes = str(rec, revenusNotesField);
      const description = str(rec, revenusDescriptionField);
      const label = notes || categorie || description || "Revenu";
      return {
        libelle: `${label}${date ? ` (${date})` : ""}${description && description !== label ? ` — ${description}` : ""}`,
        no_facture: str(rec, revenusNoFactureField),
        date,
        mode_paiement: str(rec, revenusModePaiementField),
        fournisseur: str(rec, revenusFournisseurField),
        poste: notes || categorie,
        artiste: str(rec, revenusArtisteField),
        categorie,
        description,
        montant: Number(rec.getCellValue(revenusMontantField)) || 0,
      };
    })
    .sort(byDate);

  const totalDepenses = depense.reduce((s, d) => s + d.montant, 0);
  const totalRevenus = gridTotal + revenu.reduce((s, r) => s + r.montant, 0);
  const totalPaiements = paiement.reduce((s, p) => s + p.montant, 0);
  const net = totalRevenus - totalDepenses;
  // Only the period's net is split; the solde is global and carried until paid (52xx).
  const soldeFermeture = soldePrecedent + net - totalPaiements;
  tags.total_revenus = totalRevenus;
  tags.total_depenses = totalDepenses;
  tags.net = net;
  tags.total_a_spliter = net;
  tags.solde_precedent = soldePrecedent;
  tags.total_paiements = totalPaiements;
  tags.solde_fermeture = soldeFermeture;
  tags.deficit_reporte = Math.min(soldeFermeture, 0);

  // A period at a loss is not split: the loss stays in the solde.
  const ayant_droit = ayantsDroits.map((a) => ({ nom: a.nom, part: a.part, montant: Math.max(net, 0) * a.part }));

  // Month rows beyond the period (m2…m6 of a monthly report) are removed, not left empty.
  const dropPrefixes = Array.from({ length: Math.max(0, 6 - period.months.length) }, (_, i) => `m${period.months.length + i + 1}`);
  fillTemplate(ws, { tags, blocks: { depense, revenu, paiement, ayant_droit }, dropPrefixes });

  const parts = ayantsDroits.map((a, i) => ({ key: a.key, nom: a.nom, montant: ayant_droit[i].montant }));
  return { wb, ws, totals: { totalRevenus, totalDepenses, net, soldePrecedent, totalPaiements, soldeFermeture }, parts };
}

async function downloadWorkbook(wb, filename) {
  // Force Excel to recalculate the template's formulas when opening
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  normalizeWorkbookForExcel(wb);

  const out = await wb.xlsx.writeBuffer();
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Excel sheet name: max 31 chars, none of []:*?/\ and unique (case-insensitive).
function uniqueSheetName(raw, used) {
  const base = String(raw || "Canal").replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Canal";
  let name = base;
  for (let k = 2; used.has(name.toLowerCase()); k++) {
    const suffix = ` (${k})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

const CURRENCY_FMT = '#,##0.00 "$";-#,##0.00 "$"';

// Artist report: a "Sommaire" sheet (one row per canal + total), then each canal's
// filled template on its own sheet. `items` = [{ canalName, statusLabel, fillArgs }].
async function buildArtistWorkbook({ artistName, period, items }) {
  const out = new ExcelJS.Workbook();
  const sommaire = out.addWorksheet("Sommaire");
  const used = new Set(["sommaire"]);
  const rows = [];
  // One column per distinct ayant-droit (by Organisme id), in order of first appearance.
  const ayants = new Map();
  for (const item of items) {
    const { ws, totals, parts } = await fillCanalReport(item.fillArgs);
    copyWorksheet(ws, out, uniqueSheetName(item.canalName, used));
    const montants = new Map();
    for (const p of parts) {
      if (!ayants.has(p.key)) ayants.set(p.key, p.nom);
      montants.set(p.key, (montants.get(p.key) || 0) + p.montant);
    }
    rows.push({ canal: item.canalName, statut: item.statusLabel, ...totals, montants });
  }
  const ayantKeys = [...ayants.keys()];

  // Amount columns: Revenus, Dépenses, Net, one per ayant-droit, then the soldes.
  // A canal without a given ayant-droit leaves its cell empty (excluded from the total).
  const amountCols = [
    { header: "Revenus", width: 16, get: (r) => r.totalRevenus },
    { header: "Dépenses", width: 16, get: (r) => r.totalDepenses },
    { header: "Net (à partager)", width: 18, get: (r) => r.net },
    ...ayantKeys.map((key) => ({
      header: ayants.get(key), width: Math.min(Math.max(ayants.get(key).length * 0.6, 16), 24), get: (r) => (r.montants.has(key) ? r.montants.get(key) : null),
    })),
    { header: "Solde précédent", width: 18, get: (r) => r.soldePrecedent },
    { header: "Paiements", width: 16, get: (r) => r.totalPaiements },
    { header: "Solde fermeture", width: 16, get: (r) => r.soldeFermeture },
  ];

  sommaire.columns = [{ width: 42 }, { width: 22 }, ...amountCols.map((c) => ({ width: c.width }))];
  sommaire.getCell("A1").value = `Rapport — ${artistName}`;
  sommaire.getCell("A1").font = { bold: true, size: 14 };
  sommaire.getCell("A2").value = `Période : ${period.label}`;
  const header = ["Canal", "Statut", ...amountCols.map((c) => c.header)];
  const headerRow = sommaire.getRow(4);
  header.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
    cell.border = { bottom: { style: "thin" } };
    // Wrapped so long ayant-droit names stay readable in their column.
    cell.alignment = { horizontal: i >= 2 ? "right" : "left", vertical: "bottom", wrapText: true };
  });
  rows.forEach((r, k) => {
    const row = sommaire.getRow(5 + k);
    row.getCell(1).value = r.canal;
    row.getCell(2).value = r.statut;
    amountCols.forEach((c, i) => {
      const cell = row.getCell(3 + i);
      cell.value = c.get(r);
      cell.numFmt = CURRENCY_FMT;
    });
  });
  const totalRow = sommaire.getRow(5 + rows.length);
  totalRow.getCell(1).value = "Total";
  const last = 4 + rows.length;
  amountCols.forEach((c, i) => {
    const col = sommaire.getColumn(3 + i).letter;
    const cell = totalRow.getCell(3 + i);
    cell.value = rows.length
      ? { formula: `SUM(${col}5:${col}${last})`, result: rows.reduce((s, r) => s + (c.get(r) || 0), 0) }
      : 0;
    cell.numFmt = CURRENCY_FMT;
  });
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => { cell.border = { top: { style: "thin" } }; });

  return out;
}

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
function computeCanalPeriod({ canalId, period, cfg, records, revenusChoices, soldeCompteId, soldeReporteCompteId, paiementCompteIds }) {
  const {
    revenusCanalLinkField, revenusDateField, revenusDateWriteField, revenusMontantField,
    revenusCategorieField, revenusEtatLinkField, revenusNotesField,
    depensesCanalLinkField, depensesDateField, depensesDateWriteField, depensesMontantField,
    depensesCategorieField, depensesEtatLinkField,
    ayantsTable, ayantsCanalLinkField, ayantsNomField, ayantsPartField,
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
      return { key, nom, part: Number(rec.getCellValue(ayantsPartField)) || 0 };
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

  return {
    status, previousEtat, currentEtat, innerEtats, orphanCount,
    existingRevenus, existingDepenses, existingPaiements, revenusByCell, gridIds, ayantsDroits,
    // Entries listed in the Excel report (grid and solde entries are shown elsewhere).
    reportRevenus: existingRevenus.filter((r) => !gridIds.has(r.id) && !isSoldeEntry(r)),
    reportDepenses: existingDepenses.filter((r) => !isSoldeReporteEntry(r)),
    soldeEntriesTotal, soldeReporteEntriesTotal, soldeFermeturePrecedent, soldePrecedent,
    totalRevenus, totalDepenses, totalPaiements,
    // Net of the period: what the ayants-droits split. The solde is global: it carries
    // over (positive or not) until 52xx payments bring it down.
    net: totalRevenus - totalDepenses,
    soldeFermeture: totalRevenus - totalDepenses + soldePrecedent - totalPaiements,
  };
}

// Properties without which computeCanalPeriod silently reads nothing (each Interface
// page has its own extension settings: a new page starts unconfigured).
function missingCoreConfig(cfg) {
  const required = [
    ["revenusCanalLinkField", "Lien Canal (Revenus)"],
    ["revenusMontantField", "Champ Montant (Revenus)"],
    ["revenusEtatLinkField", "Lien État de compte (Revenus)"],
    ["depensesCanalLinkField", "Lien Canal (Dépenses)"],
    ["depensesMontantField", "Champ Montant (Dépenses)"],
    ["depensesEtatLinkField", "Lien État de compte (Dépenses)"],
  ];
  const missing = required.filter(([key]) => !cfg[key]).map(([, label]) => label);
  if (!cfg.revenusDateField && !cfg.revenusDateWriteField) missing.push("Champ Date (Revenus)");
  if (!cfg.depensesDateField && !cfg.depensesDateWriteField) missing.push("Champ Date (Dépenses)");
  return missing;
}

const etatsConfigured = (cfg) => !!(cfg.etatsTable && cfg.etatsCanalLinkField && cfg.etatsDateField
  && cfg.etatsOuvertureField && cfg.etatsPaiementField && cfg.etatsRevenusLinkField && cfg.etatsDepensesLinkField);

// Why a canal's period can't be closed (null = it can). Unsaved entries are checked by the caller.
function clotureBlockerFor(cfg, calc) {
  if (!etatsConfigured(cfg)) return "Configure les champs États de compte dans les propriétés de l'extension.";
  if (calc.status === "closed") return `Période déjà clôturée (état de compte du ${calc.currentEtat.date}).`;
  if (calc.status === "partial") {
    return `Période partiellement clôturée (état de compte du ${calc.innerEtats[0].date}) : clôture mois par mois.`;
  }
  if (calc.orphanCount > 0) {
    const n = calc.orphanCount;
    return `${n} entrée${n > 1 ? "s" : ""} d'une période antérieure non clôturée : clôture d'abord cette période.`;
  }
  return null;
}

// Fields of the État de compte closing `period` for a canal. Paiement = the 52xx payments
// dated in the period (usually 0: a balance is paid after its clôture). Solde fermeture =
// solde précédent + net − paiements, carried as the next period's solde précédent.
// `extraRevenuIds` = revenus created just before (Believe/Shopify amounts saved at clôture).
function buildEtatFields({ cfg, canalId, artisteId, period, calc, soldeFermeture, extraRevenuIds = [] }) {
  const round2 = (v) => Math.round(v * 100) / 100;
  const fields = {
    [cfg.etatsCanalLinkField.id]: [{ id: canalId }],
    [cfg.etatsDateField.id]: period.end,
    [cfg.etatsPaiementField.id]: round2(calc.totalPaiements),
    [cfg.etatsRevenusLinkField.id]: [...calc.existingRevenus.map((r) => r.id), ...extraRevenuIds].map((id) => ({ id })),
    [cfg.etatsDepensesLinkField.id]: [...calc.existingDepenses, ...calc.existingPaiements].map((r) => ({ id: r.id })),
  };
  // Solde d'ouverture may be computed in Airtable (formula/rollup): only set it when writable.
  if (!cfg.etatsOuvertureField.isComputed) fields[cfg.etatsOuvertureField.id] = round2(calc.soldeFermeturePrecedent);
  // Solde fermeture is frozen at clôture, so later edits to linked entries don't change
  // the next period's solde précédent.
  if (cfg.etatsFermetureField && !cfg.etatsFermetureField.isComputed) {
    fields[cfg.etatsFermetureField.id] = round2(soldeFermeture);
  }
  if (artisteId && cfg.etatsArtisteLinkField && !cfg.etatsArtisteLinkField.isComputed) {
    fields[cfg.etatsArtisteLinkField.id] = [{ id: artisteId }];
  }
  return fields;
}

// Comptes [{ id, name, code }] of the Comptes table. The interface page's search bar
// also filters useRecords, so typing e.g. a canal name there empties the Comptes list:
// every compte seen so far is kept, so a search can only hide comptes from useRecords,
// never from the dropdowns.
function useComptes(comptesTable, comptesNumeroField) {
  const comptesRecords = useRecords(comptesTable);
  const seenRef = useRef(new Map());
  return useMemo(() => {
    const seen = seenRef.current;
    for (const rec of comptesRecords || []) {
      const code = getCompteCode(rec, comptesNumeroField);
      // Skip records whose cell values aren't loaded yet rather than caching a null code.
      if (code == null) continue;
      seen.set(rec.id, { id: rec.id, name: rec.name, code });
    }
    return Array.from(seen.values());
  }, [comptesRecords, comptesNumeroField]);
}

function compteIdByCode(comptes, raw) {
  const code = parseInt(String(raw || "").trim(), 10);
  if (isNaN(code)) return null;
  const c = comptes.find((x) => x.code === code);
  return c ? c.id : null;
}

// Ids of the comptes whose code matches a compact list: "52xx" (x = any digit),
// "5200-5299" (inclusive range) or "5310", separated by commas or spaces.
function compteIdsByPattern(comptes, raw) {
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

// Grid columns from the JSON config. Supports both {label, compteId} and
// {compteId, labels: [...]} entries.
function parseColumnsConfig(revenusColumnsJson, depensesColumnsJson) {
  const parseOne = (raw) => {
    if (!raw || typeof raw !== "string") return { cols: [], error: null };
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { cols: [], error: null };
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
  return { revenus: r.cols, depenses: d.cols, error: r.error || d.error || null };
}

// Each grid column = { id (input key), name (header), compteId (link write), label (Notes write) }.
// The label is the id so 2 columns sharing the same compte still get separate cells.
const toRevenusChoices = (cols) =>
  cols.map((c) => ({ id: c.label, name: c.label, label: c.label, compteId: c.compteId, group: c.group }));

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

// --- Supabase sources of the Revenus grid ---
// Believe royalties (by the ISRCs of the canal's Oeuvres) and Shopify sales (Shopify
// project_id = Airtable canal record id), each as { month: amount } for the period.

async function fetchBelieveByMonth(cfg, isrcs, period) {
  const rows = await postSupabaseRpc(cfg.supabaseUrl, cfg.supabaseAnonKey, cfg.clientId, "get_royalties_summary", {
    p_client_id: cfg.clientId,
    p_isrcs: isrcs,
    p_from: period.start,
    p_to: period.end,
  });
  const byMonth = {};
  for (const row of rows || []) {
    const monthKey = (row.reporting_month || "").slice(0, 7); // YYYY-MM
    const m = parseInt(monthKey.split("-")[1], 10);
    if (!m || m < 1 || m > 12) continue;
    byMonth[m] = (byMonth[m] || 0) + (parseFloat(row.total_net_revenue) || 0);
  }
  return byMonth;
}

// Bandcamp / Propagande royalties, matched by ISRC then by catalog number for sales
// without one (all of Propagande, most Bandcamp albums). Kept apart from the Believe
// call above so Believe amounts are unchanged. Returns { bandcamp, propagande }, each
// { month: amount }.
const CATALOG_SOURCES = ["bandcamp", "propagande"];

async function fetchCatalogSourcesByMonth(cfg, isrcs, catalogs, period) {
  const rows = await postSupabaseRpc(cfg.supabaseUrl, cfg.supabaseAnonKey, cfg.clientId, "get_royalties_summary", {
    p_client_id: cfg.clientId,
    p_isrcs: isrcs,
    p_from: period.start,
    p_to: period.end,
    p_catalogs: catalogs.length > 0 ? catalogs : null,
    p_sources: CATALOG_SOURCES,
  });
  const out = { bandcamp: {}, propagande: {} };
  for (const row of rows || []) {
    const byMonth = out[row.source];
    if (!byMonth) continue;
    const m = parseInt((row.reporting_month || "").slice(5, 7), 10);
    if (!m || m < 1 || m > 12) continue;
    byMonth[m] = (byMonth[m] || 0) + (parseFloat(row.total_net_revenue) || 0);
  }
  return out;
}

async function fetchShopifyByMonth(cfg, canalId, period) {
  const rows = await postSupabaseRpc(cfg.supabaseUrl, cfg.supabaseAnonKey, cfg.clientId, "get_shopify_sales_summary", {
    p_client_id: cfg.clientId,
    p_project_ids: [canalId],
    p_from: period.start,
    // get_shopify_sales_summary uses order_date < p_to, so p_to is exclusive.
    p_to: period.next,
  });
  const byMonth = {};
  for (const row of rows || []) {
    // row.month is the first day of the month (YYYY-MM-DD)
    const m = parseInt(String(row.month || "").slice(5, 7), 10);
    if (!m || m < 1 || m > 12) continue;
    // Sum total_revenue across all product categories for the month.
    byMonth[m] = (byMonth[m] || 0) + (parseFloat(row.total_revenue) || 0);
  }
  return byMonth;
}

const supabaseConfigured = (cfg) => !!(cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.clientId);

// ISRCs of the canal's linked Oeuvres.
function canalIsrcs(canalRec, cfg, oeuvresRecords) {
  const { oeuvresTable, oeuvresLinkField, isrcField } = cfg;
  if (!canalRec || !oeuvresTable || !oeuvresLinkField || !isrcField || !oeuvresRecords) return [];
  const ids = new Set(linkedIds(canalRec, oeuvresLinkField));
  if (ids.size === 0) return [];
  return oeuvresRecords
    .filter((rec) => ids.has(rec.id))
    .map((rec) => rec.getCellValueAsString(isrcField))
    .filter(Boolean);
}

// Catalog numbers of the canal, sent raw (the server normalizes them). A lookup or
// multi-value cell renders as "A, B": one catalog per entry.
function canalCatalogs(canalRec, cfg) {
  if (!canalRec || !cfg.catalogField) return [];
  const raw = canalRec.getCellValueAsString(cfg.catalogField) || "";
  return [...new Set(raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))];
}

// Months of the period that already have a revenu on `compteId` for the canal in
// Airtable. Supabase amounts are not proposed for those months, so saving again
// can't create duplicates.
function monthsWithSavedCompte({ revenusRecords, cfg, canalId, compteId, period }) {
  const set = new Set();
  const { revenusCanalLinkField, revenusCategorieField, revenusDateField, revenusDateWriteField } = cfg;
  if (!compteId || !revenusRecords || !canalId || !revenusCanalLinkField || !revenusCategorieField) return set;
  for (const rec of revenusRecords) {
    if (!linksTo(rec, revenusCanalLinkField, canalId) || !linksTo(rec, revenusCategorieField, compteId)) continue;
    const d = readEntryDate(rec, [revenusDateField, revenusDateWriteField]);
    if (!isInPeriod(d, period)) continue;
    set.add(parseIsoParts(d).month);
  }
  return set;
}

// Supabase amounts not saved yet, as Revenus grid inputs { month: { columnLabel: "12.34" } }.
function pendingGridInputs({ believe, shopify, bandcamp, propagande, revenusRecords, cfg, canalId, period, revenusChoices }) {
  const inputs = {};
  const add = (byMonth, label) => {
    const col = revenusChoices.find((c) => c.label === label);
    if (!byMonth || !col) return;
    const saved = monthsWithSavedCompte({ revenusRecords, cfg, canalId, compteId: col.compteId, period });
    for (const m of period.months) {
      const total = byMonth[m];
      if (!total || saved.has(m)) continue;
      inputs[m] = { ...(inputs[m] || {}), [label]: total.toFixed(2) };
    }
  };
  add(believe, cfg.royaltiesColumn);
  add(shopify, SHOPIFY_COLUMN);
  add(bandcamp, cfg.bandcampColumn);
  add(propagande, cfg.propagandeColumn);
  return inputs;
}

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

// Revenu records for Revenus grid inputs: one per filled cell, dated on the 1st of its month.
function gridInputsToRecords({ inputs, columns, cfg, canalId, year }) {
  const {
    revenusDateWriteField: dateField, revenusMontantField: montantField, revenusCategorieField: categorieField,
    revenusCanalLinkField: canalLinkField, revenusNotesField: notesField,
  } = cfg;
  const out = [];
  if (!dateField || !montantField || !categorieField || !canalLinkField || !canalId) return out;
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
        [canalLinkField.id]: [{ id: canalId }],
      };
      if (notesField) fields[notesField.id] = label;
      out.push({ fields });
    }
  }
  return out;
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

function ConfigPrompt({ message }) {
  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-gray-gray50 dark:bg-gray-gray800">
      <div className="max-w-md text-center">
        <p className="text-gray-gray600 dark:text-gray-gray200">
          {message || (
            <>
              Veuillez configurer les tables et champs dans les propriétés de l&apos;extension
              (Canaux, Revenus, Dépenses, États de compte).
            </>
          )}
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

  if (customPropertyValueByKey.mode === "artiste") {
    const { artistesTable, artistesProjetsLinkField, projetsTable, projetsCanauxLinkField } = customPropertyValueByKey;
    if (!artistesTable || !artistesProjetsLinkField || !projetsTable || !projetsCanauxLinkField) {
      return (
        <ConfigPrompt message="Mode Artiste : configure la table Artistes (lien Projets) et la table Projets (lien Canaux) dans les propriétés de l'extension." />
      );
    }
    return <ArtistApp cfg={customPropertyValueByKey} />;
  }

  return <ReportInner cfg={customPropertyValueByKey} />;
}

// Canal page. In Artist mode it is opened on one canal (`fixedCanalId`) and its
// "← Retour" goes back to the artist (`onBack`).
function ReportInner({ cfg, fixedCanalId = null, onBack = null, artisteId = null, initialPeriod = null }) {
  const {
    canauxTable, canalImageField, canalSubtitleField,
    revenusTable, revenusCanalLinkField, revenusDateField, revenusDateWriteField, revenusMontantField,
    revenusCategorieField, revenusNotesField, revenusDescriptionField,
    depensesTable, depensesCanalLinkField, depensesDateField, depensesDateWriteField, depensesMontantField,
    depensesCategorieField, depensesFournisseurField, depensesNotesField, depensesDescriptionField,
    depensesNoFactureField,
    revenusColumnsJson, depensesColumnsJson,
    comptesTable, comptesNumeroField,
    templateAttachmentField,
    oeuvresTable,
    ayantsTable, etatsTable, soldeOuvertureCompte, soldeReporteCompte, paiementsComptes,
    canauxFilterField, canauxFilterDefault,
    supabaseUrl, supabaseAnonKey, clientId, royaltiesColumn, bandcampColumn, propagandeColumn,
  } = cfg;

  const canauxRecords = useRecords(canauxTable);
  const revenusRecords = useRecords(revenusTable);
  const depensesRecords = useRecords(depensesTable);
  const comptes = useComptes(comptesTable, comptesNumeroField);
  // useRecords crashes on null; fall back to a known table when not yet configured.
  const oeuvresRecords = useRecords(oeuvresTable || canauxTable);
  const ayantsRecords = useRecords(ayantsTable || canauxTable);
  const etatsRecords = useRecords(etatsTable || canauxTable);

  const columnsConfig = useMemo(
    () => parseColumnsConfig(revenusColumnsJson, depensesColumnsJson),
    [revenusColumnsJson, depensesColumnsJson],
  );

  const [selectedCanalId, setSelectedCanalId] = useState(fixedCanalId);
  const [periodSel, setPeriodSel] = useState(() => initialPeriod || defaultPeriodSelection());
  const period = useMemo(() => buildPeriod(periodSel), [periodSel]);
  const periodKey = period.key;
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
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const catalogCacheRef = useRef(new Map());

  useEffect(() => {
    setRevenusInputs({});
    setSaisies([]);
    setSavedMsg(null);
    setRoyaltiesError(null);
    setShopifyError(null);
    setCatalogError(null);
  }, [selectedCanalId, periodKey]);

  // compteId of a grid column (from revenusColumnsJson), for dup-detection.
  const compteOfColumn = (label) => {
    const col = (columnsConfig.revenus || []).find((c) => c.label === label);
    return col ? col.compteId : null;
  };
  // Months of the period already saved on the Believe / Shopify compte: not pre-filled
  // again, to prevent creating duplicates if the user clicks Save again.
  const monthsWithExistingRoyalty = useMemo(
    () => monthsWithSavedCompte({ revenusRecords, cfg, canalId: selectedCanalId, compteId: compteOfColumn(royaltiesColumn), period }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revenusRecords, cfg, selectedCanalId, columnsConfig, royaltiesColumn, period],
  );
  const monthsWithExistingShopify = useMemo(
    () => monthsWithSavedCompte({ revenusRecords, cfg, canalId: selectedCanalId, compteId: compteOfColumn(SHOPIFY_COLUMN), period }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revenusRecords, cfg, selectedCanalId, columnsConfig, period],
  );
  const monthsWithExistingBandcamp = useMemo(
    () => monthsWithSavedCompte({ revenusRecords, cfg, canalId: selectedCanalId, compteId: compteOfColumn(bandcampColumn), period }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revenusRecords, cfg, selectedCanalId, columnsConfig, bandcampColumn, period],
  );
  const monthsWithExistingPropagande = useMemo(
    () => monthsWithSavedCompte({ revenusRecords, cfg, canalId: selectedCanalId, compteId: compteOfColumn(propagandeColumn), period }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revenusRecords, cfg, selectedCanalId, columnsConfig, propagandeColumn, period],
  );

  const isrcList = useMemo(
    () => canalIsrcs((canauxRecords || []).find((r) => r.id === selectedCanalId), cfg, oeuvresTable ? oeuvresRecords : null),
    [selectedCanalId, canauxRecords, cfg, oeuvresTable, oeuvresRecords],
  );
  const catalogList = useMemo(
    () => canalCatalogs((canauxRecords || []).find((r) => r.id === selectedCanalId), cfg),
    [selectedCanalId, canauxRecords, cfg],
  );

  // Stable value keys for the fetch effects' deps (see the royalties effect).
  const isrcKey = isrcList.join(",");
  const catalogKey = catalogList.join(",");
  const existingRoyaltyMonthsKey = [...monthsWithExistingRoyalty].sort((a, b) => a - b).join(",");
  const existingShopifyMonthsKey = [...monthsWithExistingShopify].sort((a, b) => a - b).join(",");
  const existingBandcampMonthsKey = [...monthsWithExistingBandcamp].sort((a, b) => a - b).join(",");
  const existingPropagandeMonthsKey = [...monthsWithExistingPropagande].sort((a, b) => a - b).join(",");

  // Fetch royalties from Supabase for the selected period and pre-fill the Royalties column
  useEffect(() => {
    if (saving) return; // don't mutate revenusInputs while a save is in flight
    if (!supabaseUrl || !supabaseAnonKey || !clientId || !royaltiesColumn || isrcList.length === 0 || !selectedCanalId) {
      return;
    }
    const cacheKey = `${selectedCanalId}_${periodKey}_${isrcList.join(",")}_${royaltiesRefreshKey}`;
    let didCancel = false;

    const applyData = (byMonth) => {
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
    cachedFetch(royaltiesCacheRef.current, cacheKey, () => fetchBelieveByMonth(cfg, isrcList, period))
      .then((data) => { if (!didCancel) applyData(data); })
      .catch((err) => { if (!didCancel) setRoyaltiesError(err.message || String(err)); })
      .finally(() => { if (!didCancel) setRoyaltiesLoading(false); });

    return () => {
      didCancel = true;
      setRoyaltiesLoading(false);
    };
    // Deps are value keys, not the Set/array themselves: those are rebuilt on every
    // render (useRecords returns a new array), which used to cancel the request in a loop.
    // period / monthIndices derive from periodKey; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCanalId, periodKey, isrcKey, supabaseUrl, supabaseAnonKey, clientId, royaltiesColumn, royaltiesRefreshKey, existingRoyaltyMonthsKey]);

  // Fetch Shopify sales from Supabase for the selected period and pre-fill the Shopify column.
  // The Shopify project_id is the Airtable canal record id.
  useEffect(() => {
    if (saving) return; // don't mutate revenusInputs while a save is in flight
    if (!supabaseUrl || !supabaseAnonKey || !clientId || !selectedCanalId) {
      return;
    }
    const cacheKey = `${selectedCanalId}_${periodKey}_${shopifyRefreshKey}`;
    let didCancel = false;

    const applyData = (byMonth) => {
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
    cachedFetch(shopifyCacheRef.current, cacheKey, () => fetchShopifyByMonth(cfg, selectedCanalId, period))
      .then((data) => { if (!didCancel) applyData(data); })
      .catch((err) => { if (!didCancel) setShopifyError(err.message || String(err)); })
      .finally(() => { if (!didCancel) setShopifyLoading(false); });

    return () => {
      didCancel = true;
      setShopifyLoading(false);
    };
    // See the royalties effect for why the deps are value keys.
    // period / monthIndices derive from periodKey; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCanalId, periodKey, supabaseUrl, supabaseAnonKey, clientId, shopifyRefreshKey, existingShopifyMonthsKey]);

  // Fetch Bandcamp / Propagande royalties and pre-fill their columns. A column is
  // filled only when its label is in revenusColumnsJson (the defaults "Bandcamp" /
  // "Propagande" may not exist for every client).
  useEffect(() => {
    if (saving) return; // don't mutate revenusInputs while a save is in flight
    const targets = [
      { label: bandcampColumn, source: "bandcamp", existing: monthsWithExistingBandcamp },
      { label: propagandeColumn, source: "propagande", existing: monthsWithExistingPropagande },
    ].filter((t) => t.label && compteOfColumn(t.label));
    if (!supabaseUrl || !supabaseAnonKey || !clientId || !selectedCanalId || targets.length === 0
      || (isrcList.length === 0 && catalogList.length === 0)) {
      return;
    }
    const cacheKey = `${selectedCanalId}_${periodKey}_${isrcKey}_${catalogKey}_${catalogRefreshKey}`;
    let didCancel = false;

    const applyData = (bySource) => {
      setRevenusInputs((prev) => {
        const next = { ...prev };
        for (const t of targets) {
          const byMonth = bySource[t.source] || {};
          for (const m of monthIndices) {
            if (t.existing.has(m)) continue;
            const total = byMonth[m];
            if (total == null || total === 0) continue;
            next[m] = { ...(next[m] || {}), [t.label]: String(total.toFixed(2)) };
          }
        }
        return next;
      });
    };

    setCatalogLoading(true);
    setCatalogError(null);
    cachedFetch(catalogCacheRef.current, cacheKey, () => fetchCatalogSourcesByMonth(cfg, isrcList, catalogList, period))
      .then((data) => { if (!didCancel) applyData(data); })
      .catch((err) => { if (!didCancel) setCatalogError(err.message || String(err)); })
      .finally(() => { if (!didCancel) setCatalogLoading(false); });

    return () => {
      didCancel = true;
      setCatalogLoading(false);
    };
    // See the royalties effect for why the deps are value keys.
    // period / monthIndices derive from periodKey; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCanalId, periodKey, isrcKey, catalogKey, supabaseUrl, supabaseAnonKey, clientId, bandcampColumn, propagandeColumn,
    columnsConfig, catalogRefreshKey, existingBandcampMonthsKey, existingPropagandeMonthsKey]);

  const canaux = useMemo(() => {
    if (!canauxRecords) return [];
    return canauxRecords.map((rec) => {
      const imageUrl = getImageUrl(rec, canalImageField);
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
  const canalFilter = useChoiceFilter(canauxFilterField, canauxFilterDefault, canauxRecords);
  const filteredCanaux = useMemo(() => {
    const ok = new Set((canauxRecords || []).filter(canalFilter.matches).map((r) => r.id));
    return filterBySearch(canaux.filter((c) => ok.has(c.id)), canalSearch);
  }, [canaux, canauxRecords, canalFilter.matches, canalSearch]);

  const monthIndices = period.months;
  const periodStart = period.start;

  const revenusChoices = useMemo(() => toRevenusChoices(columnsConfig.revenus), [columnsConfig]);
  const soldeCompteId = useMemo(() => compteIdByCode(comptes, soldeOuvertureCompte), [comptes, soldeOuvertureCompte]);
  const soldeReporteCompteId = useMemo(() => compteIdByCode(comptes, soldeReporteCompte), [comptes, soldeReporteCompte]);
  const paiementCompteIds = useMemo(() => compteIdsByPattern(comptes, paiementsComptes), [comptes, paiementsComptes]);
  // Payments (52xx) are entered as invoices in Airtable: a saisie on one would show as a
  // dépense until saved.
  const saisieComptes = useMemo(
    () => comptes.filter((c) => !paiementCompteIds.has(c.id)),
    [comptes, paiementCompteIds],
  );

  // Saved data of the canal for the period (états, entries, grid, soldes): see computeCanalPeriod.
  const calc = useMemo(
    () => computeCanalPeriod({
      canalId: selectedCanalId,
      period,
      cfg,
      records: { revenus: revenusRecords, depenses: depensesRecords, etats: etatsTable ? etatsRecords : null, ayants: ayantsTable ? ayantsRecords : null },
      revenusChoices,
      soldeCompteId,
      soldeReporteCompteId,
      paiementCompteIds,
    }),
    [selectedCanalId, period, cfg, revenusRecords, depensesRecords, etatsTable, etatsRecords, ayantsTable, ayantsRecords, revenusChoices, soldeCompteId, soldeReporteCompteId, paiementCompteIds],
  );
  const { currentEtat, existingRevenus, existingDepenses, ayantsDroits } = calc;
  const existingRevenusByCell = calc.revenusByCell;

  const sumSaisies = (pred) => saisies
    .filter(pred)
    .reduce((s, r) => {
      const v = parseFloat(String(r.montant || "").replace(",", "."));
      return s + (isNaN(v) ? 0 : v);
    }, 0);

  // Unsaved saisies on the solde comptes count in Solde précédent too (see computeCanalPeriod).
  const soldeSaisiesTotal = sumSaisies((r) => r.type !== "depense" && soldeCompteId && r.compteId === soldeCompteId);
  const soldeReporteSaisiesTotal = sumSaisies((r) => r.type === "depense" && soldeReporteCompteId && r.compteId === soldeReporteCompteId);
  const soldePrecedent = calc.soldePrecedent + soldeSaisiesTotal - soldeReporteSaisiesTotal;

  const handleRevenusChange = (m, choiceId, val) => {
    setRevenusInputs((prev) => ({ ...prev, [m]: { ...(prev[m] || {}), [choiceId]: val } }));
  };

  // Build a record payload from a saisie row, for the target type's set of fields.
  const buildSaisieRecord = (r, dateField, montantField, categorieField, canalLinkField, notesField) => {
    const v = parseFloat(String(r.montant || "").replace(",", "."));
    if (!r.compteId || !r.month || isNaN(v) || v === 0) return null;
    if (!dateField || !montantField || !categorieField || !canalLinkField || !selectedCanalId) return null;
    const fields = {
      [dateField.id]: monthIsoDate(period.year, r.month),
      [montantField.id]: v,
      [categorieField.id]: [{ id: r.compteId }],
      [canalLinkField.id]: [{ id: selectedCanalId }],
    };
    if (notesField && r.notes) fields[notesField.id] = r.notes;
    return { fields };
  };

  // Each section saves independently: the Revenus grid and the Saisies lines.
  const gridRevenusToCreate = useMemo(
    () => gridInputsToRecords({ inputs: revenusInputs, columns: revenusChoices, cfg, canalId: selectedCanalId, year: period.year }),
    [revenusInputs, revenusChoices, cfg, selectedCanalId, period.year],
  );

  const saisiesRevenusToCreate = useMemo(() => {
    return saisies
      .filter((r) => r.type !== "depense")
      .map((r) => buildSaisieRecord(r, revenusDateWriteField, revenusMontantField, revenusCategorieField, revenusCanalLinkField, revenusNotesField))
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisies, period, selectedCanalId, revenusDateWriteField, revenusMontantField, revenusCategorieField, revenusCanalLinkField, revenusNotesField]);

  const saisiesDepensesToCreate = useMemo(() => {
    return saisies
      .filter((r) => r.type === "depense")
      .map((r) => buildSaisieRecord(r, depensesDateWriteField, depensesMontantField, depensesCategorieField, depensesCanalLinkField, depensesNotesField))
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisies, period, selectedCanalId, depensesDateWriteField, depensesMontantField, depensesCategorieField, depensesCanalLinkField, depensesNotesField]);

  // Save status per section: { scope: "grid" | "saisies", text }
  const [saveMsg, setSaveMsg] = useState(null);
  useEffect(() => setSaveMsg(null), [selectedCanalId, periodKey]);

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

  // Returns true once the file is downloaded (the clôture relies on it).
  const handleExport = async () => {
    if (!selectedCanal) return false;
    const canalRec = (canauxRecords || []).find((r) => r.id === selectedCanalId);
    const template = getTemplateUrl(canalRec, templateAttachmentField);
    if (template.error) {
      setSavedMsg(`Erreur : ${template.error}`);
      return false;
    }
    setSavedMsg("Génération du rapport…");
    try {
      const { wb } = await fillCanalReport({
        templateUrl: template.url,
        canalName: selectedCanal.name,
        period,
        cfg,
        revenusChoices,
        revenusByCell: existingRevenusByCell,
        revenusInputs,
        revenus: calc.reportRevenus,
        depenses: calc.reportDepenses,
        paiements: calc.existingPaiements,
        ayantsDroits,
        soldePrecedent,
      });
      await downloadWorkbook(wb, `Rapport_${safeFileName(selectedCanal.name)}_${period.fileLabel}.xlsx`);
      setSavedMsg("Rapport téléchargé.");
      return true;
    } catch (err) {
      console.error("Export failed:", err);
      setSavedMsg(`Erreur export : ${err.message || err}`);
      return false;
    }
  };

  // --- KPIs ---

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

  // Dépenses of the period: the solde reporté entries count in Solde précédent instead.
  const totalDepenses = calc.totalDepenses + saisiesTotals.depense - soldeReporteSaisiesTotal;

  // Revenus of the period: the opening-balance entries count in Solde précédent instead.
  const totalRevenus = calc.totalRevenus + sumInputs(revenusInputs) + saisiesTotals.revenu - soldeSaisiesTotal;
  const totalPaiements = calc.totalPaiements;
  const soldeFermeture = totalRevenus - totalDepenses + soldePrecedent - totalPaiements;

  // --- Clôture ---
  // Closing a period = downloading its report, then creating an État de compte linked to the
  // canal with every entry of the period (see buildEtatFields).
  const [clotureStep, setClotureStep] = useState(null); // null | "confirm" | "running"
  useEffect(() => setClotureStep(null), [selectedCanalId, periodKey]);

  const unsavedCount = gridRevenusToCreate.length + saisiesRevenusToCreate.length + saisiesDepensesToCreate.length;
  const clotureBlocker = clotureBlockerFor(cfg, calc)
    || (unsavedCount > 0 ? "Sauvegarde d'abord les entrées en cours." : null);

  const handleCloture = async () => {
    if (clotureBlocker || saving) return;
    setClotureStep("running");
    try {
      // Report first: once closed, the period's entries are linked to the État and leave this screen.
      const ok = await handleExport();
      if (!ok) return;
      await etatsTable.createRecordAsync(
        buildEtatFields({ cfg, canalId: selectedCanalId, artisteId, period, calc, soldeFermeture }),
      );
      setSavedMsg(`Période clôturée. Solde reporté : ${fmtCurrency(soldeFermeture)}.`);
    } catch (err) {
      console.error("Clôture failed:", err);
      setSavedMsg(`Erreur clôture : ${err.message || err}`);
    } finally {
      setClotureStep(null);
    }
  };

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
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <ChoiceFilter filter={canalFilter} />
            <div className="relative flex-1 sm:w-80">
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
        </div>
        {canaux.length === 0 ? (
          <div className="text-gray-gray500">Aucun canal disponible dans la table sélectionnée.</div>
        ) : filteredCanaux.length === 0 ? (
          <div className="text-gray-gray500">
            {canalSearch ? `Aucun canal ne correspond à « ${canalSearch} ».` : "Aucun canal ne correspond au filtre."}
          </div>
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
          onClick={() => (onBack ? onBack(periodSel) : setSelectedCanalId(null))}
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
          <PeriodPicker value={periodSel} onChange={setPeriodSel} />
          <div className="flex items-center gap-2 text-sm">
            {royaltiesLoading && (
              <span className="flex items-center gap-2 text-gray-gray500">
                <span className="inline-block w-3 h-3 border-2 border-blue-blue border-t-transparent rounded-full animate-spin"></span>
                Chargement Believe…
              </span>
            )}
            {royaltiesError && (
              <span className="text-red-redDark1">Erreur Believe : {royaltiesError}</span>
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
            {catalogLoading && (
              <span className="flex items-center gap-2 text-gray-gray500">
                <span className="inline-block w-3 h-3 border-2 border-blue-blue border-t-transparent rounded-full animate-spin"></span>
                Chargement Bandcamp/Propagande…
              </span>
            )}
            {catalogError && (
              <span className="text-red-redDark1">Erreur Bandcamp/Propagande : {catalogError}</span>
            )}
            <button
              onClick={() => {
                royaltiesCacheRef.current.clear();
                setRoyaltiesRefreshKey((k) => k + 1);
              }}
              title="Rafraîchir les données Believe (Supabase)"
              className="px-2 py-1 rounded text-sm bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray200 hover:bg-gray-gray200"
            >
              ↺ Believe
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
            <button
              onClick={() => {
                catalogCacheRef.current.clear();
                setCatalogRefreshKey((k) => k + 1);
              }}
              title="Rafraîchir les données Bandcamp et Propagande (Supabase)"
              className="px-2 py-1 rounded text-sm bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray200 hover:bg-gray-gray200"
            >
              ↺ Bandcamp/Propagande
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4 sm:sticky sm:top-0 sm:z-10 sm:py-2 bg-gray-gray50 dark:bg-gray-gray800">
        <KpiTile label="Total Revenus" value={totalRevenus} accent="green" />
        <KpiTile label="Total Dépenses" value={totalDepenses} accent="red" />
        <KpiTile label="Solde précédent" value={soldePrecedent} />
        <KpiTile label="Paiements" value={totalPaiements} />
        <KpiTile label="Solde fermeture" value={soldeFermeture} accent={soldeFermeture < 0 ? "red" : "blue"} />
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
          comptes={saisieComptes}
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
            <p><strong>4. Rafraîchir (↺ Believe / ↺ Shopify)</strong><br />
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
          table={revenusTable}
          entries={existingRevenus}
          dateField={revenusDateField}
          montantField={revenusMontantField}
          categorieField={revenusCategorieField}
          descriptionField={revenusDescriptionField}
          periodStart={periodStart}
        />
      </div>

      <h2 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mt-2 mb-3">
        Dépenses
      </h2>
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-6">
        <h3 className="text-base font-semibold text-gray-gray700 dark:text-gray-gray100 mb-2">
          {currentEtat
            ? `Rapportées dans l'état de compte du ${currentEtat.date}`
            : calc.status === "partial"
            ? "Rapportées dans les états de compte de la période"
            : "Existantes sur la période (non encore rapportées)"}
        </h3>
        <ExistingEntriesList
          title="Dépenses"
          table={depensesTable}
          entries={existingDepenses}
          dateField={depensesDateField}
          montantField={depensesMontantField}
          categorieField={depensesCategorieField}
          noFactureField={depensesNoFactureField}
          fournisseurField={depensesFournisseurField}
          descriptionField={depensesDescriptionField}
          periodStart={periodStart}
        />
      </div>

      {paiementCompteIds.size > 0 && (
        <>
          <h2 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100 mt-2 mb-3">
            Paiements
          </h2>
          <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-6">
            <h3 className="text-base font-semibold text-gray-gray700 dark:text-gray-gray100 mb-2">
              Paiements du solde datés dans la période
            </h3>
            <ExistingEntriesList
              title="Paiements"
              table={depensesTable}
              entries={calc.existingPaiements}
              dateField={depensesDateField}
              montantField={depensesMontantField}
              categorieField={depensesCategorieField}
              noFactureField={depensesNoFactureField}
              fournisseurField={depensesFournisseurField}
              descriptionField={depensesDescriptionField}
              periodStart={periodStart}
            />
          </div>
        </>
      )}

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
        {clotureStep === "confirm" ? (
          <>
            <span className="text-sm text-gray-gray600 dark:text-gray-gray200">
              Télécharger le rapport et clôturer {period.shortLabel} ?
            </span>
            <button
              onClick={() => setClotureStep(null)}
              className="px-3 py-2 rounded text-sm font-medium text-gray-gray600 dark:text-gray-gray200 hover:bg-gray-gray100 dark:hover:bg-gray-gray700"
            >
              Annuler
            </button>
            <button
              onClick={handleCloture}
              className="px-4 py-2 rounded text-sm font-medium bg-blue-blue text-white hover:bg-blue-blueDark1"
            >
              Confirmer
            </button>
          </>
        ) : (
          <button
            onClick={() => setClotureStep("confirm")}
            disabled={!!clotureBlocker || clotureStep === "running" || saving}
            title={clotureBlocker || ""}
            className={`px-4 py-2 rounded text-sm font-medium ${
              clotureBlocker || clotureStep === "running" || saving
                ? "bg-gray-gray200 text-gray-gray500 cursor-not-allowed"
                : "bg-blue-blue text-white hover:bg-blue-blueDark1"
            }`}
          >
            {clotureStep === "running" ? "Clôture…" : "Clôturer la période"}
          </button>
        )}
      </div>
    </div>
  );
}

// --- Artist page (mode "artiste") ---
// Lists the artists, then the canaux of one artist (Artistes → Projets → Canaux) for a
// period: tick canaux to download one grouped report and/or close their period.
// Works on saved entries only: Believe/Shopify amounts are saved from the canal page.

function statusLabel(calc) {
  if (calc.status === "closed") return `Clôturée (${calc.currentEtat.date})`;
  if (calc.status === "partial") return "Partiellement clôturée";
  return "Ouverte";
}

function StatusBadge({ calc }) {
  const cls = calc.status === "closed"
    ? "bg-gray-gray100 text-gray-gray600 dark:bg-gray-gray600 dark:text-gray-gray200"
    : calc.status === "partial"
    ? "bg-orange-orangeLight2 text-orange-orangeDark1"
    : "bg-green-greenLight2 text-green-greenDark1";
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${cls}`}>{statusLabel(calc)}</span>;
}

function ArtistApp({ cfg }) {
  const {
    artistesTable, artistesImageField, artistesProjetsLinkField, projetsTable, projetsCanauxLinkField,
    canauxTable, revenusTable, depensesTable, ayantsTable, etatsTable, comptesTable, comptesNumeroField,
    templateAttachmentField, revenusColumnsJson, depensesColumnsJson, soldeOuvertureCompte, soldeReporteCompte,
    paiementsComptes, canauxFilterField, canauxFilterDefault,
    oeuvresTable, supabaseUrl, supabaseAnonKey, clientId,
  } = cfg;

  const artistesRecords = useRecords(artistesTable);
  const projetsRecords = useRecords(projetsTable);
  const canauxRecords = useRecords(canauxTable);
  const revenusRecords = useRecords(revenusTable);
  const depensesRecords = useRecords(depensesTable);
  // useRecords crashes on null; fall back to a known table when not yet configured.
  const ayantsRecords = useRecords(ayantsTable || canauxTable);
  const etatsRecords = useRecords(etatsTable || canauxTable);
  const oeuvresRecords = useRecords(oeuvresTable || canauxTable);
  const comptes = useComptes(comptesTable, comptesNumeroField);

  const [selectedArtistId, setSelectedArtistId] = useState(null);
  const [openCanalId, setOpenCanalId] = useState(null);
  const [periodSel, setPeriodSel] = useState(defaultPeriodSelection);
  const period = useMemo(() => buildPeriod(periodSel), [periodSel]);
  const [search, setSearch] = useState("");
  const [canalSearch, setCanalSearch] = useState("");
  const [checked, setChecked] = useState(() => new Set());
  const [step, setStep] = useState(null); // null | "export" | "confirm" | "cloture"
  const [msg, setMsg] = useState(null);
  // Believe/Shopify per canal and period: { [supaEntryKey]: { believe, shopify } | { error } };
  // absent = loading. Keyed by period too, so a period change never reuses the previous one's amounts.
  const [supa, setSupa] = useState({});
  const [supaRefreshKey, setSupaRefreshKey] = useState(0);
  const supaCacheRef = useRef(new Map());

  const columnsConfig = useMemo(
    () => parseColumnsConfig(revenusColumnsJson, depensesColumnsJson),
    [revenusColumnsJson, depensesColumnsJson],
  );
  const revenusChoices = useMemo(() => toRevenusChoices(columnsConfig.revenus), [columnsConfig]);
  const soldeCompteId = useMemo(() => compteIdByCode(comptes, soldeOuvertureCompte), [comptes, soldeOuvertureCompte]);
  const soldeReporteCompteId = useMemo(() => compteIdByCode(comptes, soldeReporteCompte), [comptes, soldeReporteCompte]);
  const paiementCompteIds = useMemo(() => compteIdsByPattern(comptes, paiementsComptes), [comptes, paiementsComptes]);
  const canalFilter = useChoiceFilter(canauxFilterField, canauxFilterDefault, canauxRecords);
  const canalMatches = canalFilter.matches;
  const missingConfig = missingCoreConfig(cfg);
  // Without the Ayants-droits settings every canal would read as having none: no warning then.
  const ayantsConfigured = !!(ayantsTable && cfg.ayantsCanalLinkField && cfg.ayantsPartField);

  // Projets of each artist with their canal ids (Artistes → Projets → Canaux), sorted by
  // name. A canal linked to several projets of the artist is listed under the first one.
  const projetsByArtist = useMemo(() => {
    const projetsById = new Map((projetsRecords || []).map((r) => [r.id, r]));
    const out = new Map();
    for (const rec of artistesRecords || []) {
      const seen = new Set();
      const groups = linkedIds(rec, artistesProjetsLinkField)
        .map((pid) => projetsById.get(pid))
        .filter(Boolean)
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr"))
        .map((p) => ({
          id: p.id,
          name: p.name,
          canalIds: linkedIds(p, projetsCanauxLinkField).filter((cid) => !seen.has(cid) && seen.add(cid)),
        }))
        .filter((g) => g.canalIds.length > 0);
      out.set(rec.id, groups);
    }
    return out;
  }, [artistesRecords, projetsRecords, artistesProjetsLinkField, projetsCanauxLinkField]);

  // Only artists with at least one canal: the Artistes table also holds e.g. touring acts.
  const artists = useMemo(() => (artistesRecords || [])
    .map((rec) => {
      const imageUrl = getImageUrl(rec, artistesImageField);
      const n = (projetsByArtist.get(rec.id) || []).reduce((s, g) => s + g.canalIds.length, 0);
      return { id: rec.id, name: rec.name, subtitle: `${n} ${n > 1 ? "canaux" : "canal"}`, imageUrl, canalCount: n };
    })
    .filter((a) => a.canalCount > 0)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr")),
  [artistesRecords, artistesImageField, projetsByArtist]);
  const filteredArtists = useMemo(() => filterBySearch(artists, search), [artists, search]);
  const selectedArtist = artists.find((a) => a.id === selectedArtistId) || null;

  // The artist's canaux with their period computation, grouped by projet (projets and
  // canaux sorted by name). A canal the extension doesn't receive (page search bar, page
  // data filters, permissions) can't be read: it is only counted.
  const { rows: baseRows, hiddenCount } = useMemo(() => {
    if (!selectedArtistId) return { rows: [], hiddenCount: 0 };
    const canauxById = new Map((canauxRecords || []).map((r) => [r.id, r]));
    const groups = projetsByArtist.get(selectedArtistId) || [];
    const records = {
      revenus: revenusRecords,
      depenses: depensesRecords,
      etats: etatsTable ? etatsRecords : null,
      ayants: ayantsTable ? ayantsRecords : null,
    };
    let hidden = 0;
    const out = groups.flatMap((g) => {
      const recs = g.canalIds.map((id) => canauxById.get(id));
      hidden += recs.filter((rec) => !rec).length;
      return recs
        .filter((rec) => rec && canalMatches(rec))
        .map((rec) => ({
          id: rec.id,
          name: rec.name,
          // `subtitle` = projet name, so the canal search also matches projets.
          subtitle: g.name,
          projetId: g.id,
          isrcs: canalIsrcs(rec, cfg, oeuvresTable ? oeuvresRecords : null),
          catalogs: canalCatalogs(rec, cfg),
          template: getTemplateUrl(rec, templateAttachmentField),
          calc: computeCanalPeriod({ canalId: rec.id, period, cfg, records, revenusChoices, soldeCompteId, soldeReporteCompteId, paiementCompteIds }),
        }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr"));
    });
    return { rows: out, hiddenCount: hidden };
  }, [selectedArtistId, projetsByArtist, canauxRecords, revenusRecords, depensesRecords, etatsTable, etatsRecords,
    ayantsTable, ayantsRecords, oeuvresTable, oeuvresRecords, templateAttachmentField, period, cfg, revenusChoices,
    soldeCompteId, soldeReporteCompteId, paiementCompteIds, canalMatches]);

  // Believe/Shopify amounts (Supabase) of the open canaux, as on the canal page. Months
  // already saved in Airtable are left out (see pendingGridInputs).
  const supaOn = supabaseConfigured(cfg);
  const supaTargets = baseRows.filter((r) => r.calc.status === "open");
  const supaEntryKey = (canalId) => `${canalId}_${period.key}_${supaRefreshKey}`;
  const supaKey = supaTargets.map((r) => `${r.id}:${r.isrcs.join(",")}:${r.catalogs.join(",")}`).join("|");
  const catalogSourcesOn = !!(cfg.bandcampColumn || cfg.propagandeColumn);
  useEffect(() => {
    setSupa({});
    if (!supaOn || supaTargets.length === 0) return;
    let didCancel = false;
    for (const r of supaTargets) {
      const cacheKey = `${r.id}_${period.key}_${r.isrcs.join(",")}_${r.catalogs.join(",")}_${supaRefreshKey}`;
      cachedFetch(supaCacheRef.current, cacheKey, () => Promise.all([
        r.isrcs.length > 0 && cfg.royaltiesColumn ? fetchBelieveByMonth(cfg, r.isrcs, period) : null,
        fetchShopifyByMonth(cfg, r.id, period),
        (r.isrcs.length > 0 || r.catalogs.length > 0) && catalogSourcesOn
          ? fetchCatalogSourcesByMonth(cfg, r.isrcs, r.catalogs, period)
          : null,
      ]).then(([believe, shopify, catalogSources]) => ({ believe, shopify, ...(catalogSources || {}) })))
        .then((data) => { if (!didCancel) setSupa((prev) => ({ ...prev, [supaEntryKey(r.id)]: data })); })
        .catch((err) => { if (!didCancel) setSupa((prev) => ({ ...prev, [supaEntryKey(r.id)]: { error: err.message || String(err) } })); });
    }
    return () => { didCancel = true; };
    // Deps are value keys: baseRows is rebuilt on every records change (see the canal page's effects).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supaKey, period.key, supaOn, supabaseUrl, supabaseAnonKey, clientId, supaRefreshKey]);
  const supaLoading = supaOn && supaTargets.some((r) => !(supaEntryKey(r.id) in supa));

  // Rows with the unsaved Believe/Shopify amounts added to their totals.
  const rows = useMemo(() => baseRows.map((r) => {
    const data = r.calc.status === "open" ? supa[supaEntryKey(r.id)] : null;
    const pending = data && !data.error
      ? pendingGridInputs({ ...data, revenusRecords, cfg, canalId: r.id, period, revenusChoices })
      : {};
    const pendingTotal = sumInputs(pending);
    return {
      ...r,
      supaError: data && data.error ? data.error : null,
      pending,
      pendingTotal,
      totalRevenus: r.calc.totalRevenus + pendingTotal,
      totalDepenses: r.calc.totalDepenses,
      net: r.calc.net + pendingTotal,
      soldePrecedent: r.calc.soldePrecedent,
      totalPaiements: r.calc.totalPaiements,
      soldeFermeture: r.calc.soldeFermeture + pendingTotal,
    };
    // supaEntryKey derives from period and supaRefreshKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [baseRows, supa, revenusRecords, cfg, period, revenusChoices, supaRefreshKey]);

  // On a new artist or period, tick the open canaux that have an Excel template and
  // something for the period (not all at 0 $). Done once Believe/Shopify are loaded,
  // since they count too.
  const resetKey = `${selectedArtistId}_${period.key}`;
  const lastResetRef = useRef(null);
  const lastCheckRef = useRef(null);
  useEffect(() => {
    if (lastResetRef.current === resetKey) return;
    lastResetRef.current = resetKey;
    setChecked(new Set());
    setCanalSearch("");
    setStep(null);
    setMsg(null);
  }, [resetKey]);
  useEffect(() => {
    if (lastCheckRef.current === resetKey || supaLoading) return;
    lastCheckRef.current = resetKey;
    const hasAmounts = (r) => r.totalRevenus !== 0 || r.totalDepenses !== 0 || r.totalPaiements !== 0 || r.soldeFermeture !== 0;
    setChecked(new Set(rows.filter((r) => r.calc.status === "open" && !r.template.error && hasAmounts(r)).map((r) => r.id)));
  }, [resetKey, rows, supaLoading]);

  const selectedRows = rows.filter((r) => checked.has(r.id));
  const toggle = (id) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  // Check/uncheck several canaux at once (all shown, or one projet).
  const setMany = (ids, on) => setChecked((prev) => {
    const next = new Set(prev);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    return next;
  });
  // The search only hides rows: canaux checked and then hidden stay in the report.
  const visibleRows = useMemo(() => filterBySearch(rows, canalSearch), [rows, canalSearch]);
  const visibleGroups = useMemo(() => {
    const out = [];
    for (const r of visibleRows) {
      const last = out[out.length - 1];
      if (last && last.id === r.projetId) last.rows.push(r);
      else out.push({ id: r.projetId, name: r.subtitle, rows: [r] });
    }
    return out;
  }, [visibleRows]);
  const allChecked = visibleRows.length > 0 && visibleRows.every((r) => checked.has(r.id));

  const missingTemplate = selectedRows.filter((r) => r.template.error);
  const reportBlocker = selectedRows.length === 0
    ? "Coche au moins un canal."
    : supaLoading
    ? "Chargement Believe/Shopify…"
    : missingTemplate.length > 0
    ? `Pas de template Excel : ${missingTemplate.map((r) => r.name).join(", ")}.`
    : null;
  const rowClotureBlocker = (r) => clotureBlockerFor(cfg, r.calc)
    || (r.supaError ? `Erreur Believe/Shopify : ${r.supaError}` : null)
    || (r.pendingTotal !== 0 && !cfg.revenusDateWriteField
      ? "Configure le Champ Date (Revenus) — écriture pour sauvegarder les montants Believe/Shopify."
      : null);
  const clotureProblems = selectedRows
    .map((r) => ({ r, reason: rowClotureBlocker(r) }))
    .filter((p) => p.reason);
  const clotureBlocker = reportBlocker
    || (supaLoading ? "Chargement Believe/Shopify…" : null)
    || (clotureProblems.length > 0 ? clotureProblems.map((p) => `${p.r.name} — ${p.reason}`).join(" ") : null);

  const exportReport = async () => {
    setMsg("Génération du rapport…");
    try {
      const wb = await buildArtistWorkbook({
        artistName: selectedArtist.name,
        period,
        items: selectedRows.map((r) => ({
          canalName: r.name,
          statusLabel: statusLabel(r.calc),
          fillArgs: {
            templateUrl: r.template.url,
            canalName: r.name,
            period,
            cfg,
            revenusChoices,
            revenusByCell: r.calc.revenusByCell,
            revenusInputs: r.pending,
            revenus: r.calc.reportRevenus,
            depenses: r.calc.reportDepenses,
            paiements: r.calc.existingPaiements,
            ayantsDroits: r.calc.ayantsDroits,
            soldePrecedent: r.calc.soldePrecedent,
          },
        })),
      });
      await downloadWorkbook(wb, `Rapport_${safeFileName(selectedArtist.name)}_${period.fileLabel}.xlsx`);
      setMsg("Rapport téléchargé.");
      return true;
    } catch (err) {
      console.error("Artist export failed:", err);
      setMsg(`Erreur export : ${err.message || err}`);
      return false;
    }
  };

  const handleExport = async () => {
    if (reportBlocker || step) return;
    setStep("export");
    try {
      await exportReport();
    } finally {
      setStep(null);
    }
  };

  // Report first (nothing is closed if it fails), then for each ticked canal: save its
  // Believe/Shopify amounts as Revenus, and create its État de compte linking them.
  const handleCloture = async () => {
    if (clotureBlocker) return;
    setStep("cloture");
    let created = 0;
    try {
      const ok = await exportReport();
      if (!ok) return;
      for (const r of selectedRows) {
        const toCreate = gridInputsToRecords({ inputs: r.pending, columns: revenusChoices, cfg, canalId: r.id, year: period.year });
        const newIds = [];
        for (let i = 0; i < toCreate.length; i += 50) {
          newIds.push(...(await revenusTable.createRecordsAsync(toCreate.slice(i, i + 50))));
        }
        await etatsTable.createRecordAsync(buildEtatFields({
          cfg, canalId: r.id, artisteId: selectedArtistId, period, calc: r.calc,
          soldeFermeture: r.soldeFermeture, extraRevenuIds: newIds,
        }));
        created += 1;
      }
      // The saved months are no longer pending: refetch on the next look.
      supaCacheRef.current.clear();
      const soldes = selectedRows.reduce((s, r) => s + r.soldeFermeture, 0);
      setMsg(`Période clôturée pour ${created} ${created > 1 ? "canaux" : "canal"}. Soldes reportés : ${fmtCurrency(soldes)}.`);
    } catch (err) {
      console.error("Artist clôture failed:", err);
      setMsg(`Erreur clôture${created ? ` (${created} état${created > 1 ? "s" : ""} déjà créé${created > 1 ? "s" : ""})` : ""} : ${err.message || err}`);
    } finally {
      setStep(null);
    }
  };

  if (openCanalId) {
    return (
      <ReportInner
        key={openCanalId}
        cfg={cfg}
        fixedCanalId={openCanalId}
        artisteId={selectedArtistId}
        initialPeriod={periodSel}
        onBack={(sel) => {
          setOpenCanalId(null);
          if (sel) setPeriodSel(sel);
        }}
      />
    );
  }

  if (!selectedArtist) {
    return (
      <div className="min-h-screen bg-gray-gray50 dark:bg-gray-gray800 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100">
            Rapports artiste — Sélectionne un artiste
          </h1>
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un artiste…"
              autoFocus
              className="w-full bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100 pl-3 pr-8 py-2 rounded border border-gray-gray200 dark:border-gray-gray600 focus:border-blue-blue focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                title="Effacer"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-gray400 hover:text-gray-gray700 dark:hover:text-gray-gray100"
              >
                ×
              </button>
            )}
          </div>
        </div>
        {artists.length === 0 ? (
          <div className="text-gray-gray500">Aucun artiste lié à un canal (Artistes → Projets → Canaux).</div>
        ) : filteredArtists.length === 0 ? (
          <div className="text-gray-gray500">Aucun artiste ne correspond à « {search} ».</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredArtists.map((a) => (
              <CanalCard key={a.id} {...a} onClick={() => setSelectedArtistId(a.id)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const sumOf = (key) => selectedRows.reduce((s, r) => s + r[key], 0);
  const busy = !!step && step !== "confirm";

  return (
    <div className="min-h-screen bg-gray-gray50 dark:bg-gray-gray800 p-4 sm:p-6 pb-20">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={() => setSelectedArtistId(null)} className="text-sm text-blue-blue hover:underline">
          ← Retour
        </button>
        <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray100">
          {selectedArtist.name}
        </h1>
      </div>

      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <PeriodPicker value={periodSel} onChange={setPeriodSel} />
          {supaOn && (
            <div className="flex items-center gap-2 text-sm">
              {supaLoading && (
                <span className="flex items-center gap-2 text-gray-gray500">
                  <span className="inline-block w-3 h-3 border-2 border-blue-blue border-t-transparent rounded-full animate-spin"></span>
                  Chargement Believe/Shopify…
                </span>
              )}
              <button
                onClick={() => {
                  supaCacheRef.current.clear();
                  setSupaRefreshKey((k) => k + 1);
                }}
                title="Rafraîchir les données Believe et Shopify (Supabase)"
                className="px-2 py-1 rounded text-sm bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray200 hover:bg-gray-gray200"
              >
                ↺ Believe / Shopify
              </button>
            </div>
          )}
        </div>
      </div>

      {columnsConfig.error && (
        <div className="bg-red-redLight2 text-red-redDark1 rounded-lg p-3 mb-4 text-sm">
          Erreur dans la Configuration des colonnes (JSON) : {columnsConfig.error}
        </div>
      )}
      {missingConfig.length > 0 && (
        <div className="bg-red-redLight2 text-red-redDark1 rounded-lg p-3 mb-4 text-sm">
          Propriétés de l&apos;extension non configurées sur cette page (les montants restent à 0) :{" "}
          {missingConfig.join(", ")}.
        </div>
      )}

      {/* Totals of the ticked canaux; pinned while scrolling like the canal page's KPIs. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4 sm:sticky sm:top-0 sm:z-10 sm:py-2 bg-gray-gray50 dark:bg-gray-gray800">
        <KpiTile label="Total Revenus" value={sumOf("totalRevenus")} accent="green" />
        <KpiTile label="Total Dépenses" value={sumOf("totalDepenses")} accent="red" />
        <KpiTile label="Solde précédent" value={sumOf("soldePrecedent")} />
        <KpiTile label="Paiements" value={sumOf("totalPaiements")} />
        <KpiTile
          label="Solde fermeture"
          value={sumOf("soldeFermeture")}
          accent={sumOf("soldeFermeture") < 0 ? "red" : "blue"}
        />
      </div>
      <div className="-mt-2 mb-4 text-xs text-gray-gray500">
        Totaux des {selectedRows.length} {selectedRows.length > 1 ? "canaux cochés" : "canal coché"}
        {supaLoading ? " — chargement Believe/Shopify…" : ""}
      </div>

      <div className="relative bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray100">
            Canaux — {period.shortLabel}
          </h2>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <ChoiceFilter filter={canalFilter} small />
            <div className="relative flex-1 sm:w-72">
              <input
                type="text"
                value={canalSearch}
                onChange={(e) => setCanalSearch(e.target.value)}
                placeholder="Rechercher un canal ou un projet…"
                className="w-full bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100 pl-3 pr-8 py-1.5 text-sm rounded border border-gray-gray200 dark:border-gray-gray600 focus:border-blue-blue focus:outline-none"
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
            <HelpBadge title="Comment ça marche">
              <p><strong>1. Cocher</strong><br />
                Coche les canaux à inclure. Les canaux dont la période est ouverte sont cochés par défaut.</p>
              <p><strong>2. Générer le rapport</strong><br />
                Télécharge un seul fichier Excel : un onglet Sommaire, puis l&apos;état de compte de chaque canal coché
                (rempli avec le template du canal).</p>
              <p><strong>3. Fermer la période</strong><br />
                Télécharge le rapport, puis crée un état de compte par canal coché, comme le bouton « Clôturer la
                période » d&apos;un canal. Seules les périodes ouvertes peuvent être fermées.</p>
              <p><strong>Believe et Shopify</strong><br />
                Les montants Believe et Shopify des mois pas encore sauvegardés sont lus dans Supabase et comptés dans
                les totaux et le rapport. La fermeture de la période les enregistre comme
                Revenus, puis les lie à l&apos;état de compte.</p>
              <p><strong>Recherche</strong><br />
                La recherche filtre l&apos;affichage par canal ou par projet. Un canal coché puis masqué par la
                recherche reste inclus dans le rapport et la fermeture.</p>
            </HelpBadge>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="text-sm text-gray-gray500 italic">Aucun canal visible pour cet artiste.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-gray50 dark:bg-gray-gray800">
                <tr>
                  <th className="p-2 w-8 text-left">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={() => setMany(visibleRows.map((r) => r.id), !allChecked)}
                      title={canalSearch ? "Cocher les canaux affichés" : "Tout cocher"}
                    />
                  </th>
                  <th className="p-2 text-left">Canal</th>
                  <th className="p-2 text-left">Statut</th>
                  <th className="p-2 text-right">Revenus</th>
                  <th className="p-2 text-right">Dépenses</th>
                  <th className="p-2 text-right whitespace-nowrap">Solde précédent</th>
                  <th className="p-2 text-right">Paiements</th>
                  <th className="p-2 text-right whitespace-nowrap">Solde fermeture</th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-3 text-center text-gray-gray500 italic">
                      {canalSearch ? `Aucun canal ne correspond à « ${canalSearch} ».` : "Aucun canal ne correspond au filtre."}
                    </td>
                  </tr>
                )}
                {visibleGroups.map((g) => {
                  const groupChecked = g.rows.every((r) => checked.has(r.id));
                  const groupTotal = g.rows.reduce((s, r) => s + r.soldeFermeture, 0);
                  return (
                    <Fragment key={g.id}>
                      <tr className="border-t border-gray-gray200 dark:border-gray-gray600 bg-gray-gray100 dark:bg-gray-gray800">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={groupChecked}
                            onChange={() => setMany(g.rows.map((r) => r.id), !groupChecked)}
                            title="Cocher les canaux du projet"
                          />
                        </td>
                        <td className="p-2 font-semibold text-gray-gray700 dark:text-gray-gray100" colSpan={6}>
                          {g.name} <span className="text-gray-gray500 font-normal">({g.rows.length})</span>
                        </td>
                        <td className="p-2 text-right whitespace-nowrap font-semibold text-gray-gray700 dark:text-gray-gray100">
                          {fmtCurrency(groupTotal)}
                        </td>
                      </tr>
                      {g.rows.map((r) => {
                        const empty = r.calc.existingRevenus.length === 0 && r.calc.existingDepenses.length === 0
                          && r.calc.existingPaiements.length === 0 && r.pendingTotal === 0;
                        const reason = r.calc.status === "open" ? rowClotureBlocker(r) : null;
                        return (
                          <tr key={r.id} className="border-t border-gray-gray100 dark:border-gray-gray600 hover:bg-gray-gray50 dark:hover:bg-gray-gray800">
                            <td className="p-2 align-top">
                              <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} />
                            </td>
                            <td className="p-2 align-top">
                              <button
                                onClick={() => setOpenCanalId(r.id)}
                                title="Ouvrir la page du canal"
                                className="pl-4 text-left font-medium text-blue-blue hover:underline"
                              >
                                {r.name}
                              </button>
                              {r.template.error && <div className="text-xs text-red-redDark1">Pas de template Excel</div>}
                              {ayantsConfigured && r.calc.ayantsDroits.length === 0 && (
                                <div className="text-xs text-orange-orangeDark1">Aucun ayant droit</div>
                              )}
                              {empty && <div className="text-xs text-gray-gray500">Aucune entrée sauvegardée</div>}
                              {reason && <div className="text-xs text-orange-orangeDark1">{reason}</div>}
                            </td>
                            <td className="p-2 align-top"><StatusBadge calc={r.calc} /></td>
                            <td className="p-2 align-top text-right whitespace-nowrap text-green-greenDark1">{fmtCurrency(r.totalRevenus)}</td>
                            <td className="p-2 align-top text-right whitespace-nowrap text-red-redDark1">{fmtCurrency(r.totalDepenses)}</td>
                            <td className="p-2 align-top text-right whitespace-nowrap">{fmtCurrency(r.soldePrecedent)}</td>
                            <td className="p-2 align-top text-right whitespace-nowrap">{fmtCurrency(r.totalPaiements)}</td>
                            <td className={`p-2 align-top text-right whitespace-nowrap font-semibold ${r.soldeFermeture < 0 ? "text-red-redDark1" : "text-blue-blueDark1"}`}>
                              {fmtCurrency(r.soldeFermeture)}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                <tr className="border-t border-gray-gray200 dark:border-gray-gray600 bg-gray-gray50 dark:bg-gray-gray800 font-semibold">
                  <td className="p-2"></td>
                  <td className="p-2" colSpan={2}>Total des canaux cochés ({selectedRows.length})</td>
                  <td className="p-2 text-right whitespace-nowrap">{fmtCurrency(sumOf("totalRevenus"))}</td>
                  <td className="p-2 text-right whitespace-nowrap">{fmtCurrency(sumOf("totalDepenses"))}</td>
                  <td className="p-2 text-right whitespace-nowrap">{fmtCurrency(sumOf("soldePrecedent"))}</td>
                  <td className="p-2 text-right whitespace-nowrap">{fmtCurrency(sumOf("totalPaiements"))}</td>
                  <td className="p-2 text-right whitespace-nowrap">{fmtCurrency(sumOf("soldeFermeture"))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {hiddenCount > 0 && (
          <div className="mt-2 text-xs text-gray-gray500">
            {hiddenCount} {hiddenCount > 1 ? "canaux" : "canal"} lié{hiddenCount > 1 ? "s" : ""} à cet artiste non visible{hiddenCount > 1 ? "s" : ""} par l&apos;extension.
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 sticky bottom-0 bg-gray-gray50 dark:bg-gray-gray800 py-3 flex-wrap">
        {msg && <span className="text-sm text-gray-gray600 dark:text-gray-gray200">{msg}</span>}
        <button
          onClick={handleExport}
          disabled={!!reportBlocker || busy}
          title={reportBlocker || ""}
          className={`px-4 py-2 rounded text-sm font-medium border ${
            reportBlocker || busy
              ? "bg-gray-gray200 text-gray-gray500 border-gray-gray200 cursor-not-allowed"
              : "bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray100 border-gray-gray200 dark:border-gray-gray600 hover:bg-gray-gray50 dark:hover:bg-gray-gray800"
          }`}
        >
          {step === "export" ? "Génération…" : `Générer le rapport (${selectedRows.length})`}
        </button>
        {step === "confirm" ? (
          <>
            <span className="text-sm text-gray-gray600 dark:text-gray-gray200">
              Télécharger le rapport et clôturer {period.shortLabel} pour {selectedRows.length} {selectedRows.length > 1 ? "canaux" : "canal"} ?
            </span>
            <button
              onClick={() => setStep(null)}
              className="px-3 py-2 rounded text-sm font-medium text-gray-gray600 dark:text-gray-gray200 hover:bg-gray-gray100 dark:hover:bg-gray-gray700"
            >
              Annuler
            </button>
            <button
              onClick={handleCloture}
              className="px-4 py-2 rounded text-sm font-medium bg-blue-blue text-white hover:bg-blue-blueDark1"
            >
              Confirmer
            </button>
          </>
        ) : (
          <button
            onClick={() => setStep("confirm")}
            disabled={!!clotureBlocker || busy}
            title={clotureBlocker || ""}
            className={`px-4 py-2 rounded text-sm font-medium ${
              clotureBlocker || busy
                ? "bg-gray-gray200 text-gray-gray500 cursor-not-allowed"
                : "bg-blue-blue text-white hover:bg-blue-blueDark1"
            }`}
          >
            {step === "cloture" ? "Clôture…" : `Fermer la période (${selectedRows.length})`}
          </button>
        )}
      </div>
      {selectedRows.length > 0 && clotureBlocker && !reportBlocker && (
        <div className="text-right text-xs text-orange-orangeDark1">
          Fermeture impossible : {clotureProblems.map((p) => p.r.name).join(", ")} (voir le statut et le détail de chaque canal).
        </div>
      )}
    </div>
  );
}

initializeBlock({ interface: () => <RoyaltyReportApp /> });
