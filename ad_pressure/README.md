# Ad Pressure — Airtable Interface Extension

Read-only matrix of how many ads run **at the same time**: markets (or campaigns, or ad sets) as
rows, **weeks as columns**, the count of simultaneously active ads in each cell. Built for
**Loto-Québec**, to answer: *how many ads will be live each week of the year, so we never exceed a
set number of messages in any one market?*

Cells above the configured ceiling are flagged in red.

## Why an extension and not a native view

The client first asked whether Airtable could do this natively. For **reading** a schedule, it can:
a Timeline view grouped by campaign shows the flights, and that view was built. For **counting**,
it cannot — and the gap is not cosmetic.

- A **date bucket** (Timeline, chart, pivot on a date) files a record under **one** week: the one
  its start date falls in. An ad running 28 September → 24 October is counted once, in late
  September, and disappears from the three weeks it is still running. The question is *how many are
  live this week*, which no single-date grouping can express.
- A **group count** in a Timeline reports how many records appear in the visible window, not how
  many overlap. Over a two-month block, twelve ads can show while never more than four run at once.
- Making it native would mean a `Semaines` table, a link field on `Contenu`, an automation to fill
  it and a backfill over every existing record — the pattern used in *Cahier de routage*. That
  works, but it writes to the client's base to answer a read-only question.

This extension computes the overlaps in memory at render time. **The base is never modified.**

## Configuration

All fields are set from the settings panel; defaults are auto-detected by name.

**Table Contenus** (`Contenu`)

- **Date de début de diffusion** / **Date de fin de diffusion** — the flight. A row with a start and
  no end is treated as a single day rather than dropped.
- **Date de repli** (`Date de publication`) — used when there is no start date. Organic content
  carries no flight, only a publication date; without this fallback the grid would silently drop
  roughly half the table.
- **Marché**, **Campagne** (`Campagnes_META`), **Ensemble de publicités** — the three row
  dimensions, switchable from the toolbar. Rows are grouped by the linked record's **name**, so the
  linked tables never need to be exposed to the extension.
- **Champ de filtre** (`Paid/Organique`) — optional. Populates a dropdown with the values actually
  present, to restrict the count to paid content.
- **Titre affiché au survol** (`Titre du contenu`) — optional, names the ads listed in the hover
  breakdown. Falls back to the primary field, which an interface extension can only read when that
  field is exposed.
- **Plafond de messages par marché** — optional, left empty on purpose. An invented number would
  look authoritative on screen. Until it is set, the grid counts without judging.

## Reading it

- **Weeks start on Monday**, because the blocks do. A Sunday anchor would put block boundaries
  inside a column instead of between two.
- **Blocks are derived, not hardcoded**: each opens on the Monday nearest the 1st of its opening
  month (April, June, September, November, January), over an April → March fiscal year. This
  reproduces the boundaries observed in the data — 1 September 2026 is a Tuesday, so block 3 opens
  Monday 31 August, which is exactly where that block's content starts. No yearly maintenance, and
  no dependency on the manually-filled `Bloc` field, which does not agree with the dates.
- **Rows are sorted by peak**, so the busiest market of the period sits on top.
- **Hovering a cell breaks the count down**: every ad live that week, with its flight dates. A count
  on its own invites the question *which ones?*, and answering it in the base means rebuilding the
  same overlap filter by hand. Long lists are capped at twelve with a remainder.
- **The ceiling only colours the market view** — that is the level it is defined at.
- **Excluded content is reported under the grid**, never silently dropped: rows with no date at all,
  and rows whose end precedes their start. Those are data-entry errors, and hiding them would
  misreport pressure in both directions.

## Known data caveats

Measured on the base on 2026-09-09, and worth re-checking before trusting a number:

| | |
|---|---|
| Content rows | 1 314 |
| Placeable on a timeline | 1 205 (514 with a start date, 691 more via publication date) |
| Paid rows | 493, of which 448 have both a start and an end |
| Linked to a campaign | 439 |
| Linked to an ad set | 276 — so the ad-set view carries a large *(non assigné)* row |
| Carrying a market | 417 |
| Known errors | 2 rows whose end precedes their start, 1 duplicate (`B2_PR_VanLife_Influence4`) |

## Not covered (pending a client decision)

**Overlapping markets.** `Province de Québec` is the most frequent market in the data, and an ad
targeting it reaches Montrealers — but it is counted in its own row, not in Montréal's. The market
count is therefore a count of *rows carrying that market*, not a measure of what a person in that
market actually sees, and it understates pressure in the large cities.

Fixing this means an expansion rule (does a provincial ad count against every city's ceiling?).
That is a business decision, not a technical one, and it determines whether the numbers mean
anything. Until it is answered, the grid is honest about what it counts and nothing more.

**`Géolocalisation` is not offered as a dimension.** It holds establishments rather than targeting
zones, and it carries duplication artefacts: four *Programmation des fêtes* rows all read
`Hôtel-Casino de Charlevoix` while their markets differ. `Marché` is the reliable field.

## Setup

1. In Airtable: Interface > Add extension > Build a custom extension.
2. Copy the generated `blockId` into `.block/remote.json` (it ships as `REPLACE_WITH_BLOCK_ID`).
3. Expose the `Contenu` table to the extension in the interface builder, with the fields above
   marked **Visible** — an interface extension sees nothing else, and a table it cannot see will
   not even appear in the settings dropdown.
4. `npm install --legacy-peer-deps`, then `block run` / `block release`.

Note that Airtable does **not** pre-fill a property added after the extension was first configured:
each one must be pointed at its field once, by hand.
