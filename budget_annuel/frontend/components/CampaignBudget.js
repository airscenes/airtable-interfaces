import { fmtCurrency } from "../utils/format";

// Per-campagne mini-widget for the "Dépensé" column. Shows what's been spent
// relative to that campagne's (budget annuel + budget révisé) total, with a
// tricolor progress bar mirroring the AnnualBudget logic:
//   blue       = spent
//   dark blue  = probable (committed but not yet spent)
//   gray track = remaining
//   full red   = spent + probable > denominator (over budget)
export function CampaignBudget({ spent, probable, budget, revise }) {
  const spentVal = spent ?? 0;
  const probableVal = probable ?? 0;
  // `revise` is the campagne's *revised* total budget, not a variation on top
  // of `budget`. The effective budget is whichever is larger — the revised
  // budget only enlarges the denominator when it exceeds the original budget.
  const denom = Math.max(budget ?? 0, revise ?? 0);

  const spentPct = denom > 0 ? Math.max(0, spentVal / denom) * 100 : 0;
  const probablePct = denom > 0 ? Math.max(0, probableVal / denom) * 100 : 0;
  // `probable` is the *total* expected amount, not an increment on top of
  // spent. The probable segment is only the part that exceeds spent — when
  // probable is below spent there's nothing extra to show.
  const visibleProbablePct = Math.max(0, probablePct - spentPct);
  const overBudget = denom > 0 && Math.max(spentVal, probableVal) > denom;

  // Solde = (budget annuel + révisé) − dépensé. Computed locally so it always
  // reflects the current props (the Airtable `solde` field can lag behind
  // edits because of formula recomputation delays).
  const solde = denom - spentVal;

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
                className="bn-campaign-budget-progress-spent h-full transition-all"
                style={{ width: `${spentPct}%` }}
              />
              <div
                className="bn-campaign-budget-progress-probable h-full transition-all"
                style={{ width: `${visibleProbablePct}%` }}
              />
            </>
          )}
        </div>
      </div>
      {denom > 0 && (
        <span
          className={`bn-campaign-budget-solde ${solde < 0 ? "bn-campaign-budget-solde--negative" : ""} inline-flex items-baseline px-1.5 py-0 text-xs tabular-nums whitespace-nowrap`}
        >
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
