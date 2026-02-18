# Airtable Interface Extensions

Custom extensions for Airtable Interfaces.

## Extensions

| Extension | Description |
|-----------|-------------|
| `graphique_dual_axes/` | Dual-axis charts (bars + lines) for ad campaign performance analysis. 3 charts: Reach (Coverage/CPM), Traffic (Page Views/CPC), Engagement (Impressions/CTR). Includes a campaign filter dropdown. |

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

## Creating a New Extension

1. In Airtable: Interface > Add extension > Build a custom extension
2. Copy the generated `blockId`
3. Create a new folder in this repo with the standard structure (see `CLAUDE.md`)
4. Configure `.block/remote.json` with the `blockId`
5. Develop, test with `block run`, publish with `block release`
