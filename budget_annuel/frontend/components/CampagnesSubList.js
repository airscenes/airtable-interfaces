import { expandRecord } from "@airtable/blocks/interface/ui";
import { fmtCurrency } from "../utils/format";

// Unfolds below a Campagnes_META row when its chevron is clicked.
// Each row is a Budget record (the join between Campagne and Campagnes_META) —
// spend values are properties of the Budget, not of the Campagne alone.
// Click the name to open the Budget record.

const SUB_LIST_COLS = [
  { key: "spacer",      label: "",            size: "32px",               align: "center" },
  { key: "name",        label: "Campagne",    size: "minmax(250px, 3fr)", align: "left"   },
  { key: "spend_total", label: "Total dépensé", size: "minmax(120px, 1fr)", align: "right"  },
  { key: "spend_media", label: "Média",       size: "minmax(120px, 1fr)", align: "right"  },
  { key: "spend_prod",  label: "Prod",        size: "minmax(120px, 1fr)", align: "right"  },
];

const SUB_GRID_TEMPLATE = SUB_LIST_COLS.map((c) => c.size).join(" ");

export function CampagnesSubList({ budgets, nameField, spendTotalField, spendMediaField, spendProdField }) {
  if (!budgets || budgets.length === 0) {
    return (
      <div className="bn-sublist-empty py-2 pl-10 text-xs italic text-gray-gray400">
        Aucune campagne liée.
      </div>
    );
  }

  return (
    <div className="bn-sublist bg-gray-gray25 dark:bg-gray-gray900 border-b border-gray-gray100 dark:border-gray-gray600">
      <div
        className="bn-sublist-head grid items-center h-7 text-xs font-medium text-gray-gray500 dark:text-gray-gray400 border-b border-gray-gray100 dark:border-gray-gray700"
        style={{ gridTemplateColumns: SUB_GRID_TEMPLATE }}
      >
        {SUB_LIST_COLS.map((col) => (
          <div
            key={col.key}
            className={`bn-sublist-head-cell bn-sublist-head-cell-${col.key} px-3 min-w-0 truncate`}
            style={{ textAlign: col.align }}
          >
            {col.label}
          </div>
        ))}
      </div>

      <div className="bn-sublist-body">
        {budgets.map((b) => {
          const name = nameField ? b.getCellValueAsString(nameField) : "";
          const spendTotal = spendTotalField ? b.getCellValue(spendTotalField) : null;
          const spendMedia = spendMediaField ? b.getCellValue(spendMediaField) : null;
          const spendProd = spendProdField ? b.getCellValue(spendProdField) : null;
          return (
            <div
              key={b.id}
              className="bn-sublist-row grid items-center min-h-[32px] text-sm text-gray-gray800 dark:text-gray-gray100 border-b border-gray-gray100 dark:border-gray-gray700 hover:bg-gray-gray50 dark:hover:bg-gray-gray800 transition-colors"
              style={{ gridTemplateColumns: SUB_GRID_TEMPLATE }}
            >
              <div className="bn-sublist-cell bn-sublist-cell-spacer" />
              <button
                type="button"
                onClick={() => expandRecord(b)}
                className="bn-sublist-cell bn-sublist-cell-name px-3 min-w-0 text-left truncate text-blue-blue hover:text-blue-blueDark1 hover:underline bg-transparent border-none cursor-pointer"
                title="Ouvrir le budget"
              >
                {name || "—"}
              </button>
              <div className="bn-sublist-cell bn-sublist-cell-spend-total px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(spendTotal)}
              </div>
              <div className="bn-sublist-cell bn-sublist-cell-spend-media px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(spendMedia)}
              </div>
              <div className="bn-sublist-cell bn-sublist-cell-spend-prod px-3 min-w-0 tabular-nums text-right">
                {fmtCurrency(spendProd)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
