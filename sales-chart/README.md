# sales-chart

Airtable Interface Extension — Sales dashboard for theatre spectacles.

## Features

- **Gallery view**: browse spectacles with cover images and search
- **Detail view** per spectacle:
  - Representations table with configurable columns (20 columns)
  - Sales trend chart (tickets sold, free tickets, revenue) fetched from Supabase
  - KPI cards (up to 6 configurable numeric fields from the Spectacles table)
  - Date range filter with presets (24h, 3m, 6m, 1 year, YTD, All)
  - City / venue filter dropdowns
  - "Show all" toggle (default: future + non-cancelled representations only)

## Table Columns (Representations)

| Column | Type | Notes |
|--------|------|-------|
| J. restants | any | Days remaining |
| Date | any | Representation date |
| Salle | any | Venue name |
| Ville | any | City |
| Capacite | number | Total capacity |
| Places bloq. | number | Blocked seats |
| Billets dispo | number | Available tickets |
| Total de billets vendus | number | |
| Total de billets gratuits | number | |
| Assistance à ce jour | number | |
| Taux de remplissage | percent | Displayed as color-coded progress bar (red/orange/green) |
| Revenus totaux de billetterie | currency | Formatted as fr-FR + $ |
| Statut rapport | single-select / lookup | Colored badge |
| Objectif revenus producteur | currency | |
| Mise à jour des ventes | any | |
| Priorisation Salles (SALLES) | single-select / lookup | Colored badge |
| Billetterie Salle | single-select / lookup | Colored badge |
| Note | any | |
| Statut | single-select / lookup | Colored badge |
| Site web | single-select / lookup | Colored badge |

All columns are configurable via the extension's custom properties panel.

## Configuration (Custom Properties)

| Key | Description |
|-----|-------------|
| `spectaclesTable` | Spectacles table |
| `imageField` | Attachment field for spectacle cover image |
| `representationsTable` | Representations table |
| `spectacleLinkField` | Link field to Spectacles (in Representations) |
| `repNameField` | Name/date field for the representation |
| `capacityField` | Total capacity numeric field |
| `revenuePotentialField` | Revenue potential numeric field |
| `col*` | 13 additional column fields (see table above) |
| `kpiField1–6` | Numeric KPI fields from the Spectacles table |
| `filterStatusField` | Status field used to exclude cancelled representations |
| `supabaseUrl` | Supabase project URL |
| `supabaseAnonKey` | Supabase anonymous key |

## Supabase

Queries the `sales_report` table with fields: `record_id`, `date`, `sold`, `free`, `total`.

## Number Formatting

- Numbers: `fr-FR` locale (space thousands separator)
- Currency: `fr-FR` + ` $` suffix
- Dates: `yyyy-mm-dd` text inputs

## Colored Single-Select Badges

Single-select and lookup-of-single-select fields render as colored pill badges using Airtable's native option colors. Lookup fields are resolved by traversing `base.tables` to find the source field's choices.
