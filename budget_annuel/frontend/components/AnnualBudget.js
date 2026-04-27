import { fmtCurrency } from "../utils/format";

// Top-line widget showing how much of the year's annual budget is allocated
// across the visible Campagnes_META.
//   numerator:   sum of `budget` over the visible campagnes
//   denominator: "Budget Annuel Total" on the matching year record
//   progress:    sumOfBudgets / annualBudget — clamped at 0; can exceed 100 %
//                when sumOfBudgets > annualBudget. The progress track uses
//                overflow-hidden so the fill is visually capped at 100 %.
export function AnnualBudget({ year, annualBudget, sumOfBudgets }) {
  const ratio =
    annualBudget && sumOfBudgets != null ? sumOfBudgets / annualBudget : 0;
  const fillPercent = Math.max(0, ratio) * 100;
  const overBudget =
    annualBudget != null && sumOfBudgets != null && sumOfBudgets > annualBudget;
  const remaining =
    annualBudget != null && sumOfBudgets != null
      ? annualBudget - sumOfBudgets
      : null;

  return (
    <div className={`bn-annual-budget ${overBudget ? "bn-annual-budget--over" : ""} sticky top-0 z-10 bg-white dark:bg-gray-gray800 px-1 py-2 border-b border-gray-gray100 dark:border-gray-gray700`}>
      <div className="bn-annual-budget-amounts flex items-center flex-wrap gap-3 text-2xl font-semibold text-gray-gray900 dark:text-gray-gray100 tabular-nums">
        <div>
          <span className="bn-annual-budget-numerator">
            {sumOfBudgets != null ? fmtCurrency(sumOfBudgets) : "—"}
          </span>
          <span className="bn-annual-budget-sep text-gray-gray500 dark:text-gray-gray400 mx-2">/</span>
          <span className="bn-annual-budget-denominator text-gray-gray500 dark:text-gray-gray400">
            {annualBudget != null ? fmtCurrency(annualBudget) : "—"}
          </span>
        </div>
        {remaining != null && (
          <span
            className={`bn-annual-budget-remaining ${overBudget ? "bn-annual-budget-remaining--over" : ""} inline-flex items-center px-3 py-0.5 rounded-full text-sm font-sm`}
          >
            {overBudget
              ? `${fmtCurrency(-remaining)} dépassés`
              : `${fmtCurrency(remaining)} restants`}
          </span>
        )}
      </div>
      <div className="bn-annual-budget-caption mt-1 text-xs text-gray-gray500 dark:text-gray-gray400 tabular-nums">
        <b>{fillPercent.toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} %</b> {overBudget ? "— budget dépassé" : "du budget annuel alloué"}
      </div>
      <div className="bn-annual-budget-progress mt-2 h-2 w-full rounded-full bg-gray-gray100 dark:bg-gray-gray700 overflow-hidden">
        <div
          className={`bn-annual-budget-progress-fill h-full rounded-full ${overBudget ? "bg-red-red" : "bg-blue-blue"} transition-all`}
          style={{ width: `${fillPercent}%` }}
        />
      </div>
    </div>
  );
}
