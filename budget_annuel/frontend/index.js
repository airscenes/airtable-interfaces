import { useState, useRef, useEffect, useMemo } from "react";
import {
  initializeBlock,
  useBase,
  useRecords,
  expandRecord,
} from "@airtable/blocks/interface/ui";
import "./style.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// fr-FR thousands/decimals, with a leading "$" sign — matches the spec screenshot.
const fmtCurrency = (v) => {
  const parsed = typeof v === "number" ? v : Number(v);
  const n = v == null || isNaN(parsed) ? 0 : parsed;
  const formatted = n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${formatted}`;
};

const findField = (table, name) =>
    table?.fields?.find(
    (f) => f?.name?.toLowerCase() === name.toLowerCase(),
  ) || null;

// ─── Icons ───────────────────────────────────────────────────────────────────

const ChevronDown = ({ className = "" }) => (
  <svg
    className={className}
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M4 6l4 4 4-4"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ChevronRight = ({ className = "" }) => (
  <svg
    className={className}
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M6 4l4 4-4 4"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ─── Year Dropdown Widget ────────────────────────────────────────────────────

function YearDropdown({ options = [], value = null, onChange, label = "Toutes les années" }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const select = (v) => {
    if (typeof onChange === "function") onChange(v);
    setOpen(false);
  };

  return (
    <div className="bn-year-dropdown relative inline-block" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="bn-year-dropdown-button inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-gray200 dark:border-gray-gray600 bg-white dark:bg-gray-gray700 hover:bg-gray-gray50 dark:hover:bg-gray-gray800 text-sm text-gray-gray700 dark:text-gray-gray200 transition-colors"
      >
        <span className="bn-year-dropdown-label">{value || label}</span>
        <ChevronDown className="bn-year-dropdown-caret text-gray-gray500 dark:text-gray-gray400" />
      </button>

      {open && (
        <div className="bn-year-dropdown-menu absolute left-0 top-full mt-1 z-20 min-w-[160px] rounded-md border border-gray-gray200 dark:border-gray-gray600 bg-white dark:bg-gray-gray700 shadow-lg py-1">
          <button
            type="button"
            onClick={() => select(null)}
            className={`bn-year-dropdown-item bn-year-dropdown-item-reset block w-full text-left px-3 py-1.5 text-sm ${
              value == null
                ? "bn-year-dropdown-item-active bg-blue-blueLight3 text-blue-blue"
                : "text-gray-gray700 dark:text-gray-gray200 hover:bg-gray-gray50 dark:hover:bg-gray-gray800"
            }`}
          >
            Toutes les années
          </button>

          {options.length === 0 ? (
            <div className="bn-year-dropdown-empty px-3 py-1.5 text-sm text-gray-gray400">
              Aucune année
            </div>
          ) : (
            options.map((opt) => {
              const name = typeof opt === "string" ? opt : opt?.name;
              if (!name) return null;
              const active = value === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => select(name)}
                  className={`bn-year-dropdown-item block w-full text-left px-3 py-1.5 text-sm ${
                    active
                      ? "bn-year-dropdown-item-active bg-blue-blueLight3 text-blue-blue"
                      : "text-gray-gray700 dark:text-gray-gray200 hover:bg-gray-gray50 dark:hover:bg-gray-gray800"
                  }`}
                >
                  {name}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Campagnes List ──────────────────────────────────────────────────────────
//
// Flat list (one level) of Campagnes_META records matching the selected year.
// 4 columns: Name (clickable → expandRecord), spend_budget, Budget, solde.
//
// CSS hooks:
//   .bn-list                   — wrapper
//   .bn-list-head              — header row
//   .bn-list-head-cell         — header cell
//   .bn-list-body              — body wrapper
//   .bn-list-row               — one data row
//   .bn-list-cell              — any data cell
//   .bn-list-cell-name         — Name cell (link-styled)
//   .bn-list-cell-spend-budget
//   .bn-list-cell-budget
//   .bn-list-cell-solde
//   .bn-list-empty             — empty state

const LIST_COLS = [
  { key: "chevron",      label: "",                 size: "24px",               align: "center"},
  { key: "name",         label: "Nom",              size: "minmax(250px, 3fr)", align: "left"  },
  { key: "spend_budget", label: "Budget dépensé",   size: "minmax(120px, 1fr)", align: "right" },
  { key: "budget",       label: "Budget Annuel",    size: "minmax(120px, 1fr)", align: "right" },
  { key: "solde",        label: "Solde",            size: "minmax(120px, 1fr)", align: "right" },
  { key: "Probable",     label: "Probable",         size: "minmax(120px, 1fr)", align: "right" },
  { key: "annee",        label: "Année",            size: "minmax(120px, 1fr)", align: "left"  },
  { key: "spend_media",  label: "Média dépensé",    size: "minmax(120px, 1fr)", align: "right" },
  { key: "spend_prod",   label: "Prod dépensée",    size: "minmax(120px, 1fr)", align: "right" },
];

const GRID_TEMPLATE = LIST_COLS.map((c) => c.size).join(" ");

function ProbableCell({ record, table, field }) {
  const current = field ? record.getCellValue(field) : null;
  const rawString = current == null ? "" : String(current).replace(".", ",");
  const [draft, setDraft] = useState(rawString);
  const [focused, setFocused] = useState(false);

  // Keep the input in sync when the record updates from outside (and we're not editing).
  useEffect(() => {
    if (!focused) setDraft(rawString);
  }, [rawString, focused]);

  if (!field || !table) {
    return <span className="text-gray-gray400">—</span>;
  }

  const revert = () => setDraft(rawString);

  const save = async () => {
    const trimmed = draft.trim().replace(",", ".");
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && isNaN(parsed)) {
      revert();
      return;
    }
    if (parsed === current) return;
    try {
      await table.updateRecordAsync(record, { [field.id]: parsed });
    } catch (e) {
      console.error("Failed to update Probable:", e);
      revert();
    }
  };

  const displayValue = focused
    ? draft
    : current == null || current === ""
      ? ""
      : fmtCurrency(current);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          revert();
          e.currentTarget.blur();
        }
      }}
      placeholder="-"
      className="w-full text-right px-2 py-0.5 rounded border border-transparent hover:border-gray-gray200 dark:hover:border-gray-gray600 focus:border-blue-blue focus:bg-white dark:focus:bg-gray-gray700 bg-transparent text-sm tabular-nums outline-none"
    />
  );
}

function CampagnesList({ records, campagnesTable, nameField, spendBudgetField, budgetField, soldeField, probableField, spendMediaField, spendProdField, yearByCampagneId }) {
  if (!records || records.length === 0) {
    return (
      <div className="bn-list-empty py-10 text-center text-sm text-gray-gray400">
        Aucune campagne.
      </div>
    );
  }

  return (
    <div className="bn-list overflow-x-auto">
      <div
        className="bn-list-head grid items-center h-8 text-xs font-medium text-gray-gray500 dark:text-gray-gray400 border-b border-gray-gray100 dark:border-gray-gray600"
        style={{ gridTemplateColumns: GRID_TEMPLATE }}
      >
        {LIST_COLS.map((col) => (
          <div
            key={col.key}
            className={`bn-list-head-cell bn-list-head-cell-${col.key} px-3 min-w-0 truncate`}
            style={{ textAlign: col.align }}
          >
            {col.label}
          </div>
        ))}
      </div>

      <div className="bn-list-body">
        {records.map((r) => {
          const name = nameField ? r.getCellValueAsString(nameField) : "";
          const spendBudget = spendBudgetField ? r.getCellValue(spendBudgetField) : null;
          const budget = budgetField ? r.getCellValue(budgetField) : null;
          const solde = soldeField ? r.getCellValue(soldeField) : null;
          const spendMedia = spendMediaField ? r.getCellValue(spendMediaField) : null;
          const spendProd = spendProdField ? r.getCellValue(spendProdField) : null;
          const annee = yearByCampagneId?.get(r.id) || "";
          return (
            <div
              key={r.id}
              className="bn-list-row grid items-center min-h-[36px] text-sm text-gray-gray800 dark:text-gray-gray100 border-b border-gray-gray100 dark:border-gray-gray600 hover:bg-gray-gray25 dark:hover:bg-gray-gray800 transition-colors"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
            >
              <button
                type="button"
                onClick={() => { developCampaine() }}
                className="bn-list-cell bn-list-cell-chevron flex items-center justify-center p-0 bg-transparent border-none cursor-pointer text-gray-gray500 hover:text-gray-gray800 dark:text-gray-gray400 dark:hover:text-gray-gray100"
                aria-label="Développer la campagne"
              >
                <ChevronRight />
              </button>
              <button
                type="button"
                onClick={() => expandRecord(r)}
                className="bn-list-cell bn-list-cell-name px-3 min-w-0 text-left truncate font-medium text-blue-blue hover:text-blue-blueDark1 hover:underline bg-transparent border-none cursor-pointer"
                title="Ouvrir la campagne"
              >
                {name || "—"}
              </button>
              <div className="bn-list-cell bn-list-cell-spend-budget px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(spendBudget)}
              </div>
              <div className="bn-list-cell bn-list-cell-budget px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(budget)}
              </div>
              <div className="bn-list-cell bn-list-cell-solde px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(solde)}
              </div>
              <div className="bn-list-cell bn-list-cell-probable px-3 min-w-0 tabular-nums text-right">
                <ProbableCell record={r} table={campagnesTable} field={probableField} />
              </div>
              <div className="bn-list-cell bn-list-cell-annee px-3 min-w-0 truncate">
                {annee || "—"}
              </div>
              <div className="bn-list-cell bn-list-cell-spend-media px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(spendMedia)}
              </div>
              <div className="bn-list-cell bn-list-cell-spend-prod px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(spendProd)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const base = useBase();
  const yearsTable = base?.tables?.find(
    (t) => t?.name?.toLowerCase() === "budget_annuel",
  ) || null;
  const campagnesTable = base?.tables?.find(
    (t) => t?.name?.toLowerCase() === "campagnes_meta",
  ) || null;

  // Guard at the boundary: useRecords crashes on null tables. If the
  // budget_annuel table can't be found, render the widget with no options.
  if (!yearsTable || !yearsTable.id) {
    return (
      <div className="bn-app p-4 min-h-screen bg-white dark:bg-gray-gray800">
        <YearDropdown options={[]} value={null} onChange={() => {}} />
      </div>
    );
  }

  return <AppInner yearsTable={yearsTable} campagnesTable={campagnesTable} />;
}

function AppInner({ yearsTable, campagnesTable }) {
  const [year, setYear] = useState(null);

  // Records — useRecords always needs a real table, so Campagnes_META falls
  // back to yearsTable when missing and we discard the result afterwards.
  const yearRecords = useRecords(yearsTable);
  const campagneRecordsRaw = useRecords(campagnesTable || yearsTable);
  const campagneRecords = campagnesTable ? campagneRecordsRaw : null;

  // Fields on budget_annuel
  const yearField =
    findField(yearsTable, "années") || findField(yearsTable, "annees");
  const campagnesLinkField =
    findField(yearsTable, "campagnes_meta") ||
    yearsTable.fields?.find((f) =>
      f?.name?.toLowerCase().includes("campagne"),
    ) ||
    null;

  // Fields on Campagnes_META
  const nameField = findField(campagnesTable, "name");
  const spendBudgetField = findField(campagnesTable, "spend_budget");
  const budgetField = findField(campagnesTable, "budget");
  const soldeField = findField(campagnesTable, "solde");
  const probableField = findField(campagnesTable, "Probable");
  const spendMediaField = findField(campagnesTable, "spend_media");
  const spendProdField = findField(campagnesTable, "spend_prod");

  

  // Dropdown options
  const options = useMemo(() => {
    if (!yearRecords || !yearField) return [];
    const seen = new Set();
    const out = [];
    for (const r of yearRecords) {
      const name = r.getCellValueAsString(yearField);
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    return out.sort((a, b) => b.localeCompare(a));
  }, [yearRecords, yearField]);

  // Reverse lookup: campagneId → year string. Same source as the filter.
  // If a campagne is linked from multiple years, the first match wins.
  const yearByCampagneId = useMemo(() => {
    const map = new Map();
    if (!yearRecords || !yearField || !campagnesLinkField) return map;
    for (const y of yearRecords) {
      const yearName = y.getCellValueAsString(yearField);
      if (!yearName) continue;
      const links = y.getCellValue(campagnesLinkField);
      if (!Array.isArray(links)) continue;
      for (const l of links) {
        if (l?.id && !map.has(l.id)) map.set(l.id, yearName);
      }
    }
    return map;
  }, [yearRecords, yearField, campagnesLinkField]);

  // Campagne ids allowed by the selected year (null = no filter → show all).
  const allowedIds = useMemo(() => {
    if (!year || !yearRecords || !yearField || !campagnesLinkField) return null;
    const rec = yearRecords.find(
      (r) => r.getCellValueAsString(yearField) === year,
    );
    if (!rec) return new Set();
    const links = rec.getCellValue(campagnesLinkField);
    if (!Array.isArray(links)) return new Set();
    return new Set(links.map((l) => l?.id).filter(Boolean));
  }, [year, yearRecords, yearField, campagnesLinkField]);

  const visibleCampagnes = useMemo(() => {
    if (!campagneRecords) return [];
    if (!allowedIds) return campagneRecords;
    return campagneRecords.filter((r) => allowedIds.has(r.id));
  }, [campagneRecords, allowedIds]);

  return (
    <div className="bn-app p-4 min-h-screen bg-white dark:bg-gray-gray800 space-y-4">
      <YearDropdown options={options} value={year} onChange={setYear} />
      <CampagnesList
        records={visibleCampagnes}
        campagnesTable={campagnesTable}
        nameField={nameField}
        spendBudgetField={spendBudgetField}
        budgetField={budgetField}
        soldeField={soldeField}
        probableField={probableField}
        spendMediaField={spendMediaField}
        spendProdField={spendProdField}
        yearByCampagneId={yearByCampagneId}
      />
    </div>
  );
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

initializeBlock({ interface: () => <App /> });
