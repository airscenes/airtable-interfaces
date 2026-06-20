# Schedule Grid — Airtable Interface Extension

A custom Airtable Interface Extension that displays records as a schedule grid (timetable).
Built for the **Espace Saint-Denis** schedule board.

## Configuration

All fields are configured from the extension settings panel (nothing is hardcoded). Sensible
defaults are auto-detected by field name.

**Table Événements**

- **Libellé événement** — text shown in the "Événements" row (default `identifiant_court`).
- **Date événement** — date used to place the event in the right day column (default
  `Date de l'événement`).

**Table Équipe accueil (quarts)**

- **Nom du contact** — host name (default `nom_contact`); empty → cell highlighted yellow.
- **Catégorie** — staff role grouping the rows (default `Rôles`: Placiers / Placiers seniors /
  Merch).
- **Date du quart** — day the shift belongs to (default `date_courte`).
- **Montage / Show call / Démontage — In/Out** — three optional work shifts, each an In + Out
  duration. The cell shows the smallest In to the largest Out across the filled shifts
  (e.g. `12:30 - 17:15`).

## Development

```bash
cd schedule_grid/
npm install --legacy-peer-deps
block run
```

## Publishing

```bash
cd schedule_grid/
block release
```

## Stack

- `@airtable/blocks/interface/ui` + `@airtable/blocks/interface/models`
- React 19 (new JSX transform)
- Tailwind CSS with Airtable design tokens (`style.css` + `tailwind.config.js`)
