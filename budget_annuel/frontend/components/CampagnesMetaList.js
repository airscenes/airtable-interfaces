import { useState, useEffect } from "react";
import { expandRecord } from "@airtable/blocks/interface/ui";
import { fmtCurrency } from "../utils/format";
import { CampagnesSubList } from "./CampagnesSubList";
import { LIST_COLS, GRID_TEMPLATE } from "./listColumns";


{/*Design des chevrons*/}
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

// Flat list (one level) of Campagnes_META records matching the selected year.
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

// `extraUpdates(parsed)` returns additional `{ fieldId: value }` pairs to write
// in the same transaction — used to keep a sibling field in sync (e.g. write
// Ratio Budget when budget changes).
function EditableCurrencyCell({ record, table, field, extraUpdates }) {
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
    const updates = { [field.id]: parsed };
    if (extraUpdates) Object.assign(updates, extraUpdates(parsed));
    try {
      await table.updateRecordAsync(record, updates);
    } catch (e) {
      console.error(`Failed to update ${field.name}:`, e);
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
      className="editable w-full text-right px-2 py-0.5 rounded border border-transparent hover:border-gray-gray200 dark:hover:border-gray-gray600 focus:border-blue-blue focus:bg-white dark:focus:bg-gray-gray700 bg-transparent text-sm tabular-nums outline-none"
    />
  );
}

// Two-way bound percent cell:
//   - Display is computed live from `sourceField` (budget) / `factor`
//     (annualBudget) — when budget changes elsewhere, this cell re-renders.
//   - On save, writes the decimal to its own `field` AND back-propagates
//     decimal × factor to `sourceField` in the same transaction.
function EditablePercentageCell({ record, table, field, sourceField, factor }) {
  const sourceValue = sourceField ? record.getCellValue(sourceField) : null;
  const current =
    sourceValue != null && factor ? sourceValue / factor : null;
  const draftFromCurrent =
    current == null ? "" : String(current * 100).replace(".", ",");
  const [draft, setDraft] = useState(draftFromCurrent);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(draftFromCurrent);
  }, [draftFromCurrent, focused]);

  if (!field || !table || !sourceField || !factor) {
    return <span className="text-gray-gray400">—</span>;
  }

  const revert = () => setDraft(draftFromCurrent);

  const save = async () => {
    const trimmed = draft.trim().replace("%", "").replace(",", ".");
    let decimal;
    if (trimmed === "") {
      decimal = null;
    } else {
      const parsed = Number(trimmed);
      if (isNaN(parsed)) {
        revert();
        return;
      }
      decimal = parsed / 100;
    }
    if (decimal === current) return;
    const updates = {
      [field.id]: decimal,
      [sourceField.id]: decimal == null ? null : decimal * factor,
    };
    try {
      await table.updateRecordAsync(record, updates);
    } catch (e) {
      console.error(`Failed to update ${field.name}:`, e);
      revert();
    }
  };

  const displayValue = focused
    ? draft
    : current == null
      ? ""
      : `${(current * 100).toLocaleString("fr-FR", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })} %`;

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
      className="editable w-full text-right px-2 py-0.5 rounded border border-transparent hover:border-gray-gray200 dark:hover:border-gray-gray600 focus:border-blue-blue focus:bg-white dark:focus:bg-gray-gray700 bg-transparent text-sm tabular-nums outline-none"
    />
  );
}

export function CampagnesMetaList({
  records,
  campagnesTable,
  nameField,
  spendBudgetField,
  budgetField,
  percentField,
  budgetReviseField,
  soldeField,
  probableField,
  spendMediaField,
  spendProdField,
  yearByCampagneId,
  budgetsByCampagneMetaId,
  budgetNameField,
  budgetSpendTotalField,
  budgetSpendMediaField,
  budgetSpendProdField,
  annualBudget,
}) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
          const solde = soldeField ? r.getCellValue(soldeField) : null;
          const spendMedia = spendMediaField ? r.getCellValue(spendMediaField) : null;
          const spendProd = spendProdField ? r.getCellValue(spendProdField) : null;
          const annee = yearByCampagneId?.get(r.id) || "";
          const expanded = expandedIds.has(r.id);
          const childBudgets = budgetsByCampagneMetaId?.get(r.id) || [];
          return (
            <div key={r.id} className="bn-list-group">
            <div
              className="bn-list-row grid items-center min-h-[36px] text-sm text-gray-gray800 dark:text-gray-gray100 border-b border-gray-gray100 dark:border-gray-gray600 hover:bg-gray-gray25 dark:hover:bg-gray-gray800 transition-colors"
              style={{ gridTemplateColumns: GRID_TEMPLATE }}
            >
              {/*Chevrons près des campagnes meta*/}
              <button
                type="button"
                onClick={() => toggleExpanded(r.id)}
                className="bn-list-cell bn-list-cell-chevron flex items-center justify-center p-0 bg-transparent border-none cursor-pointer text-gray-gray500 hover:text-gray-gray800 dark:text-gray-gray400 dark:hover:text-gray-gray100"
                aria-label={expanded ? "Replier la campagne" : "Déplier la campagne"}
                aria-expanded={expanded}
              >
                <ChevronRight className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>

              {/*Campagnes meta clicables (expandRecord)*/}
              <button
                type="button"
                onClick={() => expandRecord(r)}
                className="bn-list-cell bn-list-cell-name px-3 min-w-0 text-left truncate font-medium text-blue-blue hover:text-blue-blueDark1 hover:underline bg-transparent border-none cursor-pointer"
                title={name || "—"}
              >
                {name || "—"}
              </button>
              <div className="bn-list-cell bn-list-cell-spend-budget px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(spendBudget)}
              </div>
              <div className="bn-list-cell bn-list-cell-budget px-3 min-w-0 tabular-nums text-right">
                <EditableCurrencyCell
                  record={r}
                  table={campagnesTable}
                  field={budgetField}
                  extraUpdates={
                    percentField && annualBudget
                      ? (b) => ({
                          [percentField.id]: b == null ? null : b / annualBudget,
                        })
                      : undefined
                  }
                />
              </div>
              <div className="bn-list-cell bn-list-cell-percent px-3 min-w-0 tabular-nums text-right">
                <EditablePercentageCell
                  record={r}
                  table={campagnesTable}
                  field={percentField}
                  sourceField={budgetField}
                  factor={annualBudget}
                />
              </div>
              <div className="bn-list-cell bn-list-cell-budget-revise px-3 min-w-0 tabular-nums text-right">
                <EditableCurrencyCell
                  record={r}
                  table={campagnesTable}
                  field={budgetReviseField}
                />
              </div>
              <div className="bn-list-cell bn-list-cell-solde px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(solde)}
              </div>
              <div className="bn-list-cell bn-list-cell-probable px-3 min-w-0 tabular-nums text-right">
                <EditableCurrencyCell record={r} table={campagnesTable} field={probableField} />
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
            {expanded && (
              <CampagnesSubList
                budgets={childBudgets}
                nameField={budgetNameField}
                spendTotalField={budgetSpendTotalField}
                spendMediaField={budgetSpendMediaField}
                spendProdField={budgetSpendProdField}
              />
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
