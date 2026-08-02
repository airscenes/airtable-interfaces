# Rapport d'occupation journalier — Espace Saint-Denis

Airtable Interface Extension that produces a **daily occupancy report**, modeled on the printed
"Fiche de production" production sheet.

For the selected day, the extension shows a **two-pane view**: a Google-calendar-style timeline on
the left (venues as columns, events positioned by start time, height from duration) and the selected
event's production sheet on the right. **Venues with no event that day are omitted entirely.**
Show-style and Trattoria/corporate-style events map different subsets of the sheet, so each
naturally fills the fields that apply to it.

The day can be **printed** (one event per page, one venue per page) or **emailed as a PDF** — see
[Envoi](#envoi).

## Configuration (custom properties)

Set these in the Interface settings panel:

- **Required**: events table, `Date` field, `Salle / Espace` field.
- **Linked teams**: two staff sources, each = table + link field on events + `Rôle` and name fields.
  - `equipe_technique` → **Directeur technique** (name) and **Sécurité** (count).
  - `equipe_accueil` → **Gérant·e de salle** (name) and **Placiers** (count).
  Members are matched by `rôle`.
- **Optional event fields** (auto-detected from field names, override as needed): Artiste, Contact,
  Configuration, Billets vendus, Portes, Début, Durée (incl. duration lookups), Entracte, Première
  partie, Bars, Personnel bars, Marchandise préposé/TPV, Relocalisation, Photo & vidéo, Message
  d'accueil, Vestiaire, Client, Responsable Molière, Nombre de personnes, Type d'événement, Mentions
  spéciales/Notes.
- **Mode de diffusion** + **Modes de diffusion à masquer** (comma-separated) — optional, and
  **empty by default**, so nothing is filtered out. Corporate/Trattoria events are part of the sheet
  by design; set e.g. `Location` to drop rentals the Espace does not staff. Matching is case- and
  accent-insensitive. Same pattern as `schedule_grid`.
- **Envoi** (see below): contacts table, `Courriel` field, the "destinataire" checkbox field, and
  the Make webhook URL + token.

Every production-sheet field is shown, even when empty — the sheet is a checklist, and a blank
"Portes" is itself information. Each venue gets a stable color; venue order is fixed to Théâtre
St-Denis → La Trattoria → Studio Cabaret (others follow alphabetically). The toolbar has ‹ / ›
day-navigation arrows, a day picker and an **Aujourd'hui** shortcut. Time fields are normalized to
`19h30`. The toolbar is hidden in print output.

## Envoi

**Envoyer par courriel** renders the day as a plain-text PDF and POSTs it to a **Make** webhook,
which sends the mail. There is no server in the loop: the extension already holds the resolved data,
and Make answers `Access-Control-Allow-Origin: *`, so the browser calls it directly.

The screen and the PDF are deliberately different — a timeline plus a detail pane on one side, flat
text meant to be read in an inbox on the other. They cannot disagree on *content* because
[`reportPdf.js`](frontend/reportPdf.js) renders a plain structure built at send time from the same
`venues` / `readValue` the screen uses. The screen never reads that structure, so the timeline owes
nothing to the PDF path.

- **Recipients** = contacts whose checkbox custom property is ticked (`rapport_pre_evenement` on the
  Espace Saint-Denis base), read through the `Courriel` field and deduplicated. The button is
  disabled — with the reason shown underneath — when the webhook is unset, the recipient fields are
  unmapped, no contact is ticked, or the day has no occupied venue.
- **Payload**: one `payload` form field holding JSON — `token`, `type: "rapport_pre_evenement"`,
  `date` (`YYYY-MM-DD`), `sujet`, `destinataires` (array) + `destinataires_str` (comma-joined, map
  this into the mail's "To"), `pdf_base64` and `pdf_nom`. Decode the attachment in Make with
  `toBinary(pdf_base64; "base64")`.
- This is the **same shape** the portal's `rapport quotidien` already sends, so the existing Make
  scenario handles it; branch on `type` if the subject or recipients must differ.
- Sending is **not** idempotent, by design: the report is triggered by hand and regenerating it
  after a correction is a normal thing to do.
- The webhook token is a custom property, so it is readable by anyone who can edit the Interface
  page. Acceptable for an internal tool — worst case is an unwanted report email — but it is not a
  secret.

The PDF uses only the built-in Helvetica, which covers French accents through WinAnsi encoding, so
no font is fetched at runtime.

**Airtable setup**: the contacts table and the `rapport_pre_evenement` checkbox must be marked
**Visible** in the extension's **Données** panel, or the SDK will not see them and the field pickers
will come up empty.

## Development

```bash
npm install --legacy-peer-deps
block run        # loads at https://localhost:9000
```

```bash
npm run lint
block release    # publish
```
