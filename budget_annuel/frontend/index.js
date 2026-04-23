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

// ─── Year Dropdown Widget ────────────────────────────────────────────────────

function YearDropdown({ options = [], value = null, onChange, label = "Toute les années" }) {
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
  { key: "name",         label: "Nom",              width: "46%", align: "left"  },
  { key: "spend_budget", label: "Budget dépensé",   width: "18%", align: "right" },
  { key: "budget",       label: "Budget Annuel",    width: "18%", align: "right" },
  { key: "solde",        label: "Solde",            width: "18%", align: "right" },
  { key: "Probable",     label: "Probable",         width: "18%", align: "right" },
];

function CampagnesList({ records, nameField, spendBudgetField, budgetField, soldeField, probableField }) {
  if (!records || records.length === 0) {
    return (
      <div className="bn-list-empty py-10 text-center text-sm text-gray-gray400">
        Aucune campagne.
      </div>
    );
  }

  return (
    <div className="bn-list">
      <div className="bn-list-head flex items-center h-8 text-xs font-medium text-gray-gray500 dark:text-gray-gray400 border-b border-gray-gray100 dark:border-gray-gray600">
        {LIST_COLS.map((col) => (
          <div
            key={col.key}
            className={`bn-list-head-cell bn-list-head-cell-${col.key} px-3`}
            style={{ width: col.width, textAlign: col.align }}
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
          const probable = probableField ? r.getCellValue(probableField) : null;
          return (
            <div
              key={r.id}
              className="bn-list-row flex items-center min-h-[36px] text-sm text-gray-gray800 dark:text-gray-gray100 border-b border-gray-gray100 dark:border-gray-gray600 hover:bg-gray-gray25 dark:hover:bg-gray-gray800 transition-colors"
            >
              <button
                type="button"
                onClick={() => expandRecord(r)}
                className="bn-list-cell bn-list-cell-name px-3 text-left truncate font-medium text-blue-blue hover:text-blue-blueDark1 hover:underline bg-transparent border-none cursor-pointer"
                style={{ width: LIST_COLS[0].width }}
                title="Ouvrir la campagne"
              >
                {name || "—"}
              </button>
              <div
                className="bn-list-cell bn-list-cell-spend-budget px-3 tabular-nums"
                style={{ width: LIST_COLS[1].width, textAlign: "right" }}
              >
                {fmtCurrency(spendBudget)}
              </div>
              <div
                className="bn-list-cell bn-list-cell-budget px-3 tabular-nums"
                style={{ width: LIST_COLS[2].width, textAlign: "right" }}
              >
                {fmtCurrency(budget)}
              </div>
              <div
                className="bn-list-cell bn-list-cell-solde px-3 tabular-nums"
                style={{ width: LIST_COLS[3].width, textAlign: "right" }}
              >
                {fmtCurrency(solde)}
              </div>
              <div
                className="bn-list-cell bn-list-cell-probable px-3 tabular-nums"
                style={{ width: LIST_COLS[4].width, textAlign: "right" }}
              >
                {fmtCurrency(probable)}
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

    console.log("campagne table", campagnesTable);
  // Fields on Campagnes_META
  const nameField = findField(campagnesTable, "name");
    console.log("spend_budget exists?", campagnesTable?.fields?.some(f => f.name === "spend_budget"));
  const spendBudgetField = findField(campagnesTable, "spend_budget");
  const budgetField = findField(campagnesTable, "budget");
  const soldeField = findField(campagnesTable, "solde");
  const probableField = findField(campagnesTable, "Probable");

  

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
        nameField={nameField}
        spendBudgetField={spendBudgetField}
        budgetField={budgetField}
        soldeField={soldeField}
        probableField={probableField}
      />
    </div>
  );
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

initializeBlock({ interface: () => <App /> });
