# CLAUDE.md

## Project

This repo contains **custom Airtable Interface Extensions**. Each subfolder is an independent extension with its own `block.json`, `package.json` and source code in `frontend/`.

## Tech Stack

- **SDK**: `@airtable/blocks/interface/ui` and `@airtable/blocks/interface/models` (NOT `@airtable/blocks/ui`)
- **CLI**: `@airtable/blocks-cli` (installed globally)
- **Bundler**: managed by the SDK, entrypoint = `frontend/index.js`
- **Styling**: Tailwind CSS (included via `style.css`), dark mode support with `dark:` prefixes
- **Libraries**: recharts for charts, @phosphor-icons/react for icons, supabase-js for external data, @react-pdf/renderer for generating PDFs client-side (`occupancy_report`)
- **Calling external webhooks**: an extension can `fetch` a third-party endpoint directly when that endpoint sends permissive CORS headers (Make does: `Access-Control-Allow-Origin: *`). Post `FormData` with no custom headers to stay a CORS "simple request" and skip the preflight entirely. No proxy/server needed — see `occupancy_report`'s `sendReport`
- **Excel templates**: `excelTemplate.js` (identical copies in `artist_report/frontend/` and `project_event_report/frontend/` — keep them in sync) fills a template by tags (`${scalar}`, one-row blocks `${prefix.field}` repeated per record, grouped `sections` mixing header and item rows, `dropPrefixes` rows removed), never by row number; it unshares shared formulas (else ExcelJS throws "Shared Formula master must exist…"), re-points formulas after row insertion or removal and rebuilds merges. Reuse it for any new template-based export. `cloneWorksheet(wb, src, name)` copies a template sheet into another tab of the same workbook (logo included); `copyWorksheet(src, dstWb, name)` copies a filled sheet into another workbook (ExcelJS has no cross-workbook copy): it maps `merges`→`mergeCells`, re-applies cell styles lost on merged cells and re-registers images
- **artist_report modes & periods**: custom property `mode` = `canal` (one canal) or `artiste` (Artistes → Projets → Canaux: grouped report with a code-built Sommaire sheet + one sheet per canal, and multi-canal clôture; the Sommaire inserts one column per ayant-droit after "Net (à partager)", keyed by the linked Organisme id, in order of first appearance). Periods come from `buildPeriod` (month or half-year); `computeCanalPeriod` is the single source for statut (open / closed / partial), entries, soldes and totals — both modes use it
- **artist_report soldes & paiements**: the solde is global per canal. `computeCanalPeriod` splits dépenses on the `paiementsComptes` comptes (e.g. `52xx`, `5200-5299`) into `existingPaiements`, placed in a period by invoice date like any entry. `net` = revenus − dépenses of the period (only this is split between ayants-droits, `max(net, 0) × part`); `soldeFermeture` = solde précédent + net − paiements, written as-is on the État at clôture (positive balances carry until paid), État Paiement = sum of the period's 52xx (linked via the Dépenses link)
- **Royalty sources**: `get_royalties_summary` returns Believe only unless `p_sources` is passed (`believe` / `bandcamp` / `propagande`); rows are matched by ISRC, else by catalog number (`p_catalogs`, sent raw, normalized server-side; such rows have `isrc = null` and `catalog_key` set). The catalog number is the canal's `numero_canal` field. The RPC returns no platform / country / sales-type columns. `document_upload` sends `report_type` (+ `period` `YYYY-MM` for Propagande, whose `.xls` has no date) to `request-upload-url`
- **artist_report royalties**: `fetchBelieveByMonth` stays Believe-only (no `p_sources`); `fetchCatalogSourcesByMonth` fetches Bandcamp + Propagande (ISRCs + `catalogField`) in a separate call and pre-fills the `bandcampColumn` / `propagandeColumn` grid columns, only when the label exists in `revenusColumnsJson`
- **Per-base token**: one token per Airtable base (`airtable_interface_tokens`, frontend repo). `sales-chart` / `event_page` read sales with it (`salesApiUrl` + `salesApiToken` → `/api/airtable/sales-report`); `artist_report` (royalties + Shopify) and `royalties-chart` (royalties) read with the same token (`royaltiesApiUrl` + `royaltiesApiToken` → `POST /api/airtable/royalties`, `{ summary: "royalties" | "shopify", … }`), the server resolving the client whose `clients.airtable_id` is the token's base. Token empty = legacy anon key path (`supabaseAnonKey` + `clientId`), kept until every base has its token
- **artist_report optional per-client settings**: `canauxFilterField` + `canauxFilterDefault` add a select-field dropdown filter (`useChoiceFilter` / `ChoiceFilter`) on the canal cards and the artist's canal list. Empty = feature off
- **UI Patterns**: custom multiselect dropdowns with checkboxes (no external component library), custom `<select>` dropdowns with SVG arrow
- **Select colors**: `getFieldChoices(field, base)` traverses `base.tables` to resolve single-select option colors for both direct SINGLE_SELECT fields and MULTIPLE_LOOKUP_VALUES fields; `SelectBadge` renders colored pills using `AIRTABLE_COLORS` map (30 Airtable color names → `{bg, text}`)
- **Number formatting**: `fmtNumber(v)` and `fmtCurrency(v)` helpers using `fr-FR` locale + ` $` suffix
- **Progress bars**: use inline `backgroundColor` style for dynamic colors (e.g. red/orange/green thresholds)
- **React**: v19 with new JSX transform (no `import React` needed)
- **Date formatting**: always use `YYYY-MM-DD` (ISO 8601) format for dates everywhere — UI inputs, API payloads, and display. Parse ISO date strings directly (split `-`) instead of `new Date(isoString)` to avoid UTC→local timezone shift (off-by-one day bug in UTC-N timezones)
- **Recharts cursor alignment**: use `dataKey="date"` (ISO string, unique) on XAxis, not `dataKey="dateLabel"` (formatted string, potentially non-unique across years); add `labelFormatter` to Tooltip
- **Supabase cache**: keyed by `${mode}_${ids}_${today}_${refreshKey}` — auto-invalidates daily; ↺ button clears cache and increments refreshKey

## Conventions

- **All documentation (README, CLAUDE.md) and code comments must be in English.** UI-facing strings (labels, error messages shown to end users) may remain in the target language (e.g. French).
- No TypeScript: extensions use `.js`
- `initializeBlock({interface: () => <Component />})` for the entrypoint
- Use `useCustomProperties` for configurable fields (never hardcode field names)
- Use `useRecords(table)` to read data
- Always check `field !== null` before `record.getCellValue(field)`
- `FieldType` imported from `@airtable/blocks/interface/models`
- No Airtable UI components (`Box`, `Button`, etc.): use HTML + Tailwind
- `--legacy-peer-deps` when installing npm packages (React 19 compat)

## Gotchas

- **Field visibility in custom extensions**: An extension only "sees" fields that are explicitly checked as **Visible** in the **Données** section of the extension settings (right-hand panel in the Interface editor). If `table.fields.find(f => f.name === "myField")` returns `undefined` while the field clearly exists in the underlying table, it's almost always because it hasn't been added to the visible fields list — not a typo, casing, or accent issue. Always check this panel first.
- **String-type custom property length limit**: The `type: "string"` custom property used for JSON config (e.g. `evenementFieldsJson`) has a hard character limit in Airtable's settings input. Keep config JSON compact: prefer short formats like `["fieldName1","fieldName2"]` (string entries default `label = fieldName`) over verbose `[{"label":"...","fieldName":"..."}]`. Support both formats in the parser when a list of fields is needed.

## Commands

```bash
# Local development (from the extension folder)
cd <extension>/
block run

# Publish an extension
cd <extension>/
block release

# Install a dependency
cd <extension>/
npm install <package> --legacy-peer-deps
```

## Extension Structure

```
<extension-name>/
  .block/remote.json    # blockId + baseId (generated by Airtable)
  block.json            # bundler config, entrypoint
  frontend/
    index.js            # main source code
    style.css           # Tailwind imports
  tailwind.config.js    # Airtable design tokens mapped
  package.json
```
