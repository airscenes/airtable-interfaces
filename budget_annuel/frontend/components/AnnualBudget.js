import { fmtCurrency } from "../utils/format";

// Top-line widget for the selected year. Layout:
//   [TITLE]
//   [FRACTION]                        [Solde total: $X]
//                                     [Y % du budget annuel alloué]
//   [━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━]
//
//   - Fraction:    sumOfSpent / (annualBudget + sumOfRevise)
//                  annualBudget comes from the year record (Budget Annuel Total).
//                  sumOfRevise is the live sum of the per-campagne Révisé
//                  column; it's also written back to "Budget Révisé Total"
//                  on the year record so the two stay in sync.
//   - Solde total: denominator − sumOfSpent  (probable NOT subtracted)
//   - Caption:     sumOfBudgets / annualBudget, "% du budget annuel alloué"
//   - Bar:         tricolor — blue = sumOfSpent, dark blue = sumProbable,
//                  gray remainder = available. Full red if (spent + probable)
//                  exceeds the denominator (overBudget).
export function AnnualBudget({
  sumOfSpent,
  sumProbable,
  annualBudget,
  sumOfRevise,
  sumOfBudgets,
}) {
  const annual = annualBudget ?? 0;
  const revise = sumOfRevise ?? 0;
  // `revise` is the summed *revised* budgets, not a variation on top of the
  // annual budget. It only enlarges the denominator by the amount it exceeds
  // the annual budget — and the "+ …" is shown only when that excess exists.
  const extraRevise = Math.max(0, revise - annual);
  const denominator = annual + extraRevise;

  const spentPct =
    denominator > 0 && sumOfSpent != null
      ? Math.max(0, sumOfSpent / denominator) * 100
      : 0;
  const probablePct =
    denominator > 0 && sumProbable != null
      ? Math.max(0, sumProbable / denominator) * 100
      : 0;
  // Probable is the *total* expected amount, not an increment on top of
  // spent. The probable segment is only the part that exceeds spent — when
  // probable is below spent there's nothing extra to show.
  const visibleProbablePct = Math.max(0, probablePct - spentPct);

  // overBudget triggers when either spent or projected probable exceeds the
  // denominator — the bar's red state is about projected commitment.
  const overBudget =
    denominator > 0 &&
    Math.max(sumOfSpent ?? 0, sumProbable ?? 0) > denominator;

  // Solde total = what's left of the budget after spent. Probable is *not*
  // subtracted here — it's already visualized in the dark-blue bar segment.
  const remaining =
    denominator > 0 ? denominator - (sumOfSpent ?? 0) : null;

  const allocatedPercent =
    annual && sumOfBudgets != null
      ? Math.max(0, sumOfBudgets / annual) * 100
      : 0;

  return (
    <div
      className={`bn-annual-budget ${overBudget ? "bn-annual-budget--over" : ""} px-1 py-2`}
    >
      <div className="bn-annual-budget-title text-xs uppercase tracking-wider text-gray-gray500 dark:text-gray-gray400 mb-1">
        DÉPENSÉ / ANNUEL + RÉVISÉ
      </div>
      <div className="bn-annual-budget-infos flex items-end justify-between">
        <div className="flex-1 min-w-0">
          <div className="bn-annual-budget-amounts text-2xl font-semibold text-gray-gray900 dark:text-gray-gray100 tabular-nums">
            <span className="bn-annual-budget-numerator">
              {sumOfSpent != null ? fmtCurrency(sumOfSpent) : "—"}
            </span>
            <span className="bn-annual-budget-sep text-gray-gray500 dark:text-gray-gray400 mx-2">/</span>
            <span className="bn-annual-budget-denominator text-gray-gray500 dark:text-gray-gray400">
              {fmtCurrency(annual)}
              {extraRevise > 0 && (
                <>
                  <span className="mx-2">+</span>
                  {fmtCurrency(extraRevise)}
                </>
              )}
            </span>
          </div>
          <div className="bn-annual-budget-progress mt-2 h-2 w-full rounded-full bg-gray-gray100 dark:bg-gray-gray700 overflow-hidden flex">
            {overBudget ? (
              <div
                className="bn-annual-budget-progress-fill h-full bg-red-red transition-all"
                style={{ width: "100%" }}
              />
            ) : (
              <>
                <div
                  className="bn-annual-budget-progress-spent h-full transition-all"
                  style={{ width: `${spentPct}%` }}
                />
                <div
                  className="bn-annual-budget-progress-probable h-full transition-all"
                  style={{ width: `${visibleProbablePct}%` }}
                />
              </>
            )}
          </div>
        </div>
        <div className="bn-annual-budget-info text-right tabular-nums whitespace-nowrap leading-tight">
          {remaining != null && (
            <div className="bn-annual-budget-solde-total">
              <span
                className={`text-[16px] uppercase tracking-wider mr-1 ${remaining < 0 ? "text-red-red" : "text-gray-gray500 dark:text-gray-gray400"}`}
              >
                Solde:
              </span>
              <span
                className={`font-medium ${remaining < 0 ? "text-red-red" : "text-gray-gray900 dark:text-gray-gray100"}`}
              >
                {fmtCurrency(remaining)}
              </span>
            </div>
          )}
          <div className="bn-annual-budget-caption mt-0.5">
            <span
              className={`text-[16px] uppercase tracking-wider mr-1 ${allocatedPercent > 100 ? "text-red-red" : "text-gray-gray500 dark:text-gray-gray400"}`}
            >
              Budget annuel alloué:
            </span>
            <span
              className={`font-medium ${allocatedPercent > 100 ? "text-red-red" : "text-gray-gray900 dark:text-gray-gray100"}`}
            >
              {allocatedPercent.toLocaleString("fr-FR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} %
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
