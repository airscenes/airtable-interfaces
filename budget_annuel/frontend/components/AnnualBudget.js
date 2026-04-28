import { fmtCurrency } from "../utils/format";

// Top-line widget for the selected year. Shows:
//   - Title:        DÉPENSÉ / ANNUEL + RÉVISÉ
//   - Fraction:     sumOfSpent / (annualBudget + sumOfRevise), denominator
//                   rendered as "$annuel + $révisé"
//   - Pill:         (denominator − numerator) restants, or "X $ dépassés" if over
//   - Caption:      sumOfBudgets / annualBudget, "% du budget annuel alloué"
//                   — separate metric from the bar
//   - Progress bar: tricolor — blue = sumOfSpent, dark blue = sumProbable,
//                   gray remainder = what's still available. Goes full red if
//                   sumOfSpent overflows the denominator.
export function AnnualBudget({
  sumOfSpent,
  sumProbable,
  annualBudget,
  sumOfRevise,
  sumOfBudgets,
}) {
  const annual = annualBudget ?? 0;
  const revise = sumOfRevise ?? 0;
  const denominator = annual + revise;

  const spentPct =
    denominator > 0 && sumOfSpent != null
      ? Math.max(0, sumOfSpent / denominator) * 100
      : 0;
  const probablePct =
    denominator > 0 && sumProbable != null
      ? Math.max(0, sumProbable / denominator) * 100
      : 0;
  // Probable is clamped to whatever space remains after the spent segment,
  // so the two fills never visually exceed the track.
  const visibleProbablePct = Math.min(
    probablePct,
    Math.max(0, 100 - spentPct),
  );

  const totalCommitted = (sumOfSpent ?? 0) + (sumProbable ?? 0);
  const overBudget = denominator > 0 && totalCommitted > denominator;
  const remaining =
    denominator > 0 ? denominator - totalCommitted : null;

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
      <div className="bn-annual-budget-amounts flex items-center flex-wrap gap-3 text-2xl font-semibold text-gray-gray900 dark:text-gray-gray100 tabular-nums">
        <div>
          <span className="bn-annual-budget-numerator">
            {sumOfSpent != null ? fmtCurrency(sumOfSpent) : "—"}
          </span>
          <span className="bn-annual-budget-sep text-gray-gray500 dark:text-gray-gray400 mx-2">/</span>
          <span className="bn-annual-budget-denominator text-gray-gray500 dark:text-gray-gray400">
            {fmtCurrency(annual)}
            <span className="mx-2">+</span>
            {fmtCurrency(revise)}
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
        <b>{allocatedPercent.toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} %</b> du budget annuel alloué
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
              className="bn-annual-budget-progress-spent h-full bg-blue-blue transition-all"
              style={{ width: `${spentPct}%` }}
            />
            <div
              className="bn-annual-budget-progress-probable h-full bg-blue-blueDark1 transition-all"
              style={{ width: `${visibleProbablePct}%` }}
            />
          </>
        )}
      </div>
    </div>
  );
}
