import { fmtCurrency } from "../utils/format";

// Generic budget summary card. Used for both:
//   - "Alloué / Budget Annuel"   (sumOfBudgets / annualBudget — blue bar)
//   - "Dépensé / Budget Révisé"  (sumOfSpent / sumOfRevise — green bar)
// progress: numerator / denominator, clamped at 0 and allowed to exceed 100 %.
// The progress track has overflow-hidden so the fill is visually capped at 100 %.
// Sticky positioning lives on the wrapper in index.js so both cards stick
// together as a single header band.
export function AnnualBudget({
  title,
  numerator,
  denominator,
  captionUnder = "du budget annuel alloué",
  captionOver = "— budget dépassé",
  remainingLabel = "restants",
  overspentLabel = "dépassés",
  fillColorClass = "bg-blue-blue",
  overFillColorClass = "bg-red-red",
}) {
  const ratio =
    denominator && numerator != null ? numerator / denominator : 0;
  const fillPercent = Math.max(0, ratio) * 100;
  const overBudget =
    denominator != null && numerator != null && numerator > denominator;
  const remaining =
    denominator != null && numerator != null ? denominator - numerator : null;

  return (
    <div
      className={`bn-annual-budget ${overBudget ? "bn-annual-budget--over" : ""} px-1 py-2`}
    >
      {title && (
        <div className="bn-annual-budget-title text-xs uppercase tracking-wider text-gray-gray500 dark:text-gray-gray400 mb-1">
          {title}
        </div>
      )}
      <div className="bn-annual-budget-amounts text-2xl font-semibold text-gray-gray900 dark:text-gray-gray100 tabular-nums">
        <span className="bn-annual-budget-numerator">
          {numerator != null ? fmtCurrency(numerator) : "—"}
        </span>
        <span className="bn-annual-budget-sep text-gray-gray500 dark:text-gray-gray400 mx-2">/</span>
        <span className="bn-annual-budget-denominator text-gray-gray500 dark:text-gray-gray400">
          {denominator != null ? fmtCurrency(denominator) : "—"}
        </span>
      </div>
      {remaining != null && (
        <div className="bn-annual-budget-remaining-row mt-1">
          <span
            className={`bn-annual-budget-remaining ${overBudget ? "bn-annual-budget-remaining--over" : ""} inline-flex items-center px-3 py-0.5 rounded-full text-sm font-sm`}
          >
            {overBudget
              ? `${fmtCurrency(-remaining)} ${overspentLabel}`
              : `${fmtCurrency(remaining)} ${remainingLabel}`}
          </span>
        </div>
      )}
      <div className="bn-annual-budget-caption mt-1 text-xs text-gray-gray500 dark:text-gray-gray400 tabular-nums">
        <b>{fillPercent.toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} %</b> {overBudget ? captionOver : captionUnder}
      </div>
      <div className="bn-annual-budget-progress mt-2 h-2 w-full rounded-full bg-gray-gray100 dark:bg-gray-gray700 overflow-hidden">
        <div
          className={`bn-annual-budget-progress-fill h-full rounded-full ${overBudget ? overFillColorClass : fillColorClass} transition-all`}
          style={{ width: `${fillPercent}%` }}
        />
      </div>
    </div>
  );
}
