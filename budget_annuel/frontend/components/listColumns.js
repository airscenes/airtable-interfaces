// Shared column layout for CampagnesMetaList (parent) and CampagnesSubList (children).
// Both grids use the same template so sub-list cells line up with the parent's columns.

// Fixed pixel widths so the header grid, parent rows, and sub-list rows all
// resolve to identical column tracks. With minmax + fr, each grid computed
// columns independently from its own content, which caused header/row drift
// — and sub-pixel rounding made it worse at non-integer zoom levels.
export const LIST_COLS = [
  { key: "chevron",      label: "",                 size: "32px",  align: "center" },
  { key: "name",         label: "Campagne Meta",    size: "260px", align: "left"   },
  { key: "spend_budget", label: "Budget Dépensé",   size: "140px", align: "right"  },
  { key: "budget",       label: "Budget Annuel",    size: "140px", align: "right"  },
  { key: "percent",      label: "% Annuel",         size: "100px", align: "right"  },
  { key: "solde",        label: "Solde",            size: "140px", align: "right"  },
  { key: "probable",     label: "Probable",         size: "140px", align: "right"  },
  { key: "annee",        label: "Année",            size: "120px", align: "left"   },
  { key: "spend_media",  label: "Média Dépensé",    size: "140px", align: "right"  },
  { key: "spend_prod",   label: "Prod Dépensée",    size: "140px", align: "right"  },
];

export const GRID_TEMPLATE = LIST_COLS.map((c) => c.size).join(" ");
