// Column definitions for the events table and its CSV export, in display order.
// `configKey` names the custom property gating the column: a field mapping for
// data columns, or the `showWeeklyColumns` toggle for the weekly deltas
// (computed from Supabase). A column whose property is empty/false is hidden.
// `type` drives both the cell rendering and the CSV formatting:
//   text | num | currency | select | pct | weekSold | weekRevenue
// `width` overrides the per-type default width (users can still resize).
const WEEK_TITLE = "Dernière semaine complète (lundi → lundi)";

export const REP_COLUMNS = [
  { key: "colJoursRestants", label: "J. restants", type: "text", configKey: "colJoursRestants", width: 90 },
  { key: "colDateRep", label: "Date", type: "text", configKey: "colDateRep", width: 150 },
  { key: "colSalle", label: "Salle", type: "text", configKey: "colSalle", width: 150 },
  { key: "colVille", label: "Ville", type: "text", configKey: "colVille" },
  { key: "colCapacite", label: "Capacite", type: "num", configKey: "capacityField" },
  { key: "colPlacesBloques", label: "Places bloq.", csvLabel: "Places bloquees", type: "num", configKey: "colPlacesBloques" },
  { key: "colBilletsDispo", label: "Billets dispo", type: "num", configKey: "colBilletsDispo" },
  { key: "colTotalBilletsVendus", label: "Total vendus", type: "num", configKey: "colTotalBilletsVendus" },
  { key: "colTotalBilletsGratuits", label: "Total gratuits", type: "num", configKey: "colTotalBilletsGratuits", width: 110 },
  { key: "weekSold", label: "Vendus (sem.)", type: "weekSold", configKey: "showWeeklyColumns", title: WEEK_TITLE },
  { key: "weekRevenue", label: "Revenus (sem.)", type: "weekRevenue", configKey: "showWeeklyColumns", title: WEEK_TITLE },
  { key: "colAssistance", label: "Assistance", type: "num", configKey: "colAssistance" },
  { key: "colTauxRemplissage", label: "Taux remplissage", csvLabel: "Taux remplissage (%)", type: "pct", configKey: "colTauxRemplissage" },
  { key: "colRevenus", label: "Revenus billetterie", type: "currency", configKey: "colRevenus", width: 150 },
  { key: "colStatutRapport", label: "Statut rapport", type: "select", configKey: "colStatutRapport" },
  { key: "colObjectifRevenus", label: "Objectif revenus", type: "currency", configKey: "colObjectifRevenus", width: 130 },
  { key: "colMiseAJour", label: "Mise a jour", type: "select", configKey: "colMiseAJour" },
  { key: "colPriorisation", label: "Priorisation", type: "select", configKey: "colPriorisation" },
  { key: "colBilleterieSalle", label: "Billetterie Salle", type: "select", configKey: "colBilleterieSalle" },
  { key: "colNote", label: "Note", type: "select", configKey: "colNote" },
  { key: "colStatut", label: "Statut", type: "select", configKey: "colStatut" },
  { key: "colSiteWeb", label: "Site web", type: "select", configKey: "colSiteWeb" },
];

// Columns enabled by the custom properties `cp` (field mapped / toggle on).
export function visibleRepColumns(cp) {
  return REP_COLUMNS.filter((c) => !!cp[c.configKey]);
}

const DEFAULT_WIDTH_BY_TYPE = {
  text: 120,
  num: 100,
  currency: 120,
  select: 140,
  pct: 140,
  weekSold: 110,
  weekRevenue: 120,
  spectacle: 200,
};

// Width a column starts at before the user resizes it.
export const colDefaultWidth = (c) => c.width || DEFAULT_WIDTH_BY_TYPE[c.type] || 110;
