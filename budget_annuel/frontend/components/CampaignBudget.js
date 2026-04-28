import { fmtCurrency } from "../utils/format";

// Per-campagne mini-widget for the "Dépensé" column. Shows what's been spent
// relative to that campagne's (budget annuel + budget révisé) total, with a
// tricolor progress bar mirroring the AnnualBudget logic:
//   blue       = spent
//   dark blue  = probable (committed but not yet spent)
//   gray track = remaining
//   full red   = spent + probable > denominator (over budget)
export function CampaignBudget({ spent, probable, budget, revise, solde }) {
  const spentVal = spent ?? 0;
  const probableVal = probable ?? 0;
  const denom = (budget ?? 0) + (revise ?? 0);

  const spentPct = denom > 0 ? Math.max(0, spentVal / denom) * 100 : 0;
  const probablePct = denom > 0 ? Math.max(0, probableVal / denom) * 100 : 0;
  const visibleProbablePct = Math.min(
    probablePct,
    Math.max(0, 100 - spentPct),
  );
  const overBudget = denom > 0 && spentVal + probableVal > denom;

  return (
    <div className="bn-campaign-budget tabular-nums flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="bn-campaign-budget-amounts">
          <span className="bn-campaign-budget-spent">
            {fmtCurrency(spentVal)}
          </span>
          <span className="bn-campaign-budget-sep text-gray-gray500 dark:text-gray-gray400 mx-1">
            /
          </span>
          <span className="bn-campaign-budget-denom text-gray-gray500 dark:text-gray-gray400">
            {fmtCurrency(denom)}
          </span>
        </div>
        <div className="bn-campaign-budget-progress mt-1 h-1.5 w-full rounded-full bg-gray-gray100 dark:bg-gray-gray700 overflow-hidden flex">
          {overBudget ? (
            <div
              className="bn-campaign-budget-progress-fill h-full bg-red-red transition-all"
              style={{ width: "100%" }}
            />
          ) : (
            <>
              <div
                className="bn-campaign-budget-progress-spent h-full bg-blue-blue transition-all"
                style={{ width: `${spentPct}%` }}
              />
              <div
                className="bn-campaign-budget-progress-probable h-full bg-blue-blueDark1 transition-all"
                style={{ width: `${visibleProbablePct}%` }}
              />
            </>
          )}
        </div>
      </div>
      {solde != null && (
        <span className="bn-campaign-budget-solde inline-flex items-baseline px-1.5 py-0 rounded bg-blue-blueLight3 dark:bg-gray-gray700 text-xs tabular-nums whitespace-nowrap">
          <span className="text-[9px] uppercase tracking-wider dark:text-gray-gray400 mr-1">
            Solde:
          </span>
          <span className="dark:text-gray-gray100 font-medium">
            {fmtCurrency(solde)}
          </span>
        </span>
      )}
    </div>
  );
}
