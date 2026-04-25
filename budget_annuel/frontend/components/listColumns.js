// Shared column layout for CampagnesMetaList (parent) and CampagnesSubList (children).
// Both grids use the same template so sub-list cells line up with the parent's columns.

export const LIST_COLS = [
  { key: "chevron",      label: "",                 size: "32px",               align: "center" },
  { key: "name",         label: "Nom",              size: "minmax(250px, 3fr)", align: "left"   },
  { key: "spend_budget", label: "Budget dépensé",   size: "minmax(120px, 1fr)", align: "right"  },
  { key: "budget",       label: "Budget Annuel",    size: "minmax(120px, 1fr)", align: "right"  },
  { key: "solde",        label: "Solde",            size: "minmax(120px, 1fr)", align: "right"  },
  { key: "probable",     label: "Probable",         size: "minmax(120px, 1fr)", align: "right"  },
  { key: "annee",        label: "Année",            size: "minmax(120px, 1fr)", align: "left"   },
  { key: "spend_media",  label: "Média dépensé",    size: "minmax(120px, 1fr)", align: "right"  },
  { key: "spend_prod",   label: "Prod dépensée",    size: "minmax(120px, 1fr)", align: "right"  },
];

export const GRID_TEMPLATE = LIST_COLS.map((c) => c.size).join(" ");
