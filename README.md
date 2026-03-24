# Airtable Interface Extensions

Custom extensions for Airtable Interfaces.

## Extensions

| Extension | Description |
|-----------|-------------|
| `graphique_dual_axes/` | Dual-axis bar charts for ad campaign performance analysis. 3 charts: Reach (Coverage/CPM), Traffic (Page Views/CPC), Engagement (Impressions/CTR). Features: global campaign filter, global bloc multiselect filter, per-chart multiselect filters, strict null/zero exclusion, grouped custom properties by chart. |
| `routage/` | Event routing grid. Displays a weekly schedule matrix (AM/PM/SOIR/NUIT × 7 days) with event assignments, active day markers, event-day highlighting (cyan), color-coded totals, and filters by site/canal/week. |
| `sales-chart/` | Sales dashboard with Supabase integration. Shows cumulative ticket sales and revenue charts per show. Spectacles sorted by total tickets sold (highest first). Initial rep filter: Statut=Confirmé, Site Web=En ligne, Date≥today. Date presets (24h/3m/6m/1y/YTD), city/venue filters. Supabase cache auto-invalidates daily; manual ↺ refresh button available. |
| `artist_report/` | Artist report extension for viewing artist-related data. |
| `venues_map/` | Venues map extension for displaying venue locations. |
| `approve_invoices/` | Invoice approval page. Two-level accordion list (Factures > Dépenses) with KPIs, configurable action button (approve checkbox or push date), exclude toggle, and native record detail via `expandRecord`. |

## Prerequisites

- Node.js
- `@airtable/blocks-cli` installed globally:
  ```bash
  npm install -g @airtable/blocks-cli
  ```

## Development

1. Navigate to the extension folder:
   ```bash
   cd graphique_dual_axes/
   ```

2. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```

3. Start the dev server:
   ```bash
   block run
   ```

4. In Airtable, the extension loads automatically from `https://localhost:9000`. Accept the self-signed certificate in Chrome (Advanced > Proceed to localhost).

## Publishing

```bash
cd <extension>/
block release
```

The extension is immediately available in production on Airtable.

## Conventions

- **Date format**: Always use `YYYY-MM-DD` (ISO 8601) for dates — in UI inputs, API payloads, display, and storage. Never use locale-dependent formats like `MM/DD/YYYY` or `DD/MM/YYYY`.

## Creating a New Extension

1. In Airtable: Interface > Add extension > Build a custom extension
2. Copy the generated `blockId`
3. Create a new folder in this repo with the standard structure (see `CLAUDE.md`)
4. Configure `.block/remote.json` with the `blockId`
5. Develop, test with `block run`, publish with `block release`
