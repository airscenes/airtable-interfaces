# Rapport d'occupation journalier — Espace Saint-Denis

Airtable Interface Extension that produces a **daily occupancy report**, one page per day,
modeled on the printed "Fiche de production" production sheet.

For the selected day, every venue ("salle") that hosts at least one event is rendered as a
numbered section with the production-sheet fields (artist, contact, configuration, tickets,
schedule, bar/security staffing, merch, message, etc.). **Venues with no event that day are
omitted entirely.** Only mapped fields that actually have a value are printed, so show-style and
Trattoria/corporate-style events naturally render different subsets of the sheet.

## Configuration (custom properties)

Set these in the Interface settings panel:

- **Required**: events table, `Date` field, `Salle / Espace` field.
- **Title**: `Titre de l'événement` (defaults to the events table primary field) — rendered as the
  heading of each event block.
- **Linked teams**: two staff sources, each = table + link field on events + `Rôle` and name fields.
  - `equipe_technique` → **Directeur technique** (name) and **Placiers** / **Sécurité** (counts).
  - `equipe_accueil` → **Gérant·e de salle** (name).
  Members are matched by `rôle`.
- **Optional event fields** (auto-detected from field names, override as needed): Artiste, Contact,
  Configuration, Billets vendus, Portes, Début, Durée (incl. duration lookups), Entracte, Première
  partie, Bars, Personnel bars, Marchandise préposé/TPV, Relocalisation, Photo & vidéo, Message
  d'accueil, Vestiaire, Client, Responsable Molière, Nombre de personnes, Type d'événement, Mentions
  spéciales/Notes.

Every production-sheet field is shown, even when empty. Each venue gets a stable color (header band +
left border) so venues are easy to tell apart; section order is fixed to Théâtre St-Denis →
La Trattoria → Studio Cabaret (others follow alphabetically). The toolbar has ‹ / › day-navigation
arrows, a day picker and an **Aujourd'hui** shortcut. Time fields are normalized to `19h30`. A
**Imprimer** button triggers the browser print dialog; the toolbar is hidden in print output.

## Development

```bash
npm install --legacy-peer-deps
block run        # loads at https://localhost:9000
```

```bash
npm run typecheck
npm run lint
block release    # publish
```

## Next step

Built as a standalone extension first; the intended follow-up is to wire it to the same
`Événements` data used by `schedule_grid`.
