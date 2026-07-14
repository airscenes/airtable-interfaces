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

- **Mode de diffusion** — optional (default `mode_diffusion`, a lookup from Projets). Combined with
  **Modes de diffusion à masquer** (comma-separated, default `Location`), it hides matching events
  *and* the shifts linked to them — the venue is merely rented out, so there is nothing to staff.
  Matching is case-insensitive. Leave the field unset to disable hiding entirely.

**Table Équipe accueil (quarts)**

- **Nom du contact** — host name (default `nom_contact`); empty → cell highlighted yellow.
- **Catégorie** — staff role grouping the rows (default `Rôles`: Placiers / Placiers seniors /
  Merch).
- **Date du quart** — day the shift belongs to (default `date_courte`).
- **Montage / Show call / Démontage — In/Out** — three optional work shifts, each an In + Out
  duration. The cell shows the smallest In to the largest Out across the filled shifts
  (e.g. `12:30 - 17:15`).

### Write features (all optional)

Left unconfigured, the extension stays strictly read-only and behaves exactly as before. Airtable
does **not** pre-fill a property that was added after the extension was first configured: each new
property must be pointed at its field once, by hand, in the settings panel.

- **Date du quart — champ inscriptible** — a real `Date` field, required to create shifts.
  `date_courte` is a *rollup* of the linked event's `date_courte_avec_heure`, so it cannot be
  written. Shifts are created for a day and dispatched to an event later, so they need a date of
  their own. The grid places a shift by its event when it has one, and by this field otherwise —
  existing shifts are therefore unaffected.
- **Lien Événement (sur les quarts)** — record link to Événements. Used to hide the shifts of a
  hidden event, and to dispatch a shift to an event when assigning it.
- **Lien Contact (sur les quarts)** + **Table Contacts** — record link used to assign a shift.
  `nom_contact` is the lookup of this link, so an assigned shift stops being yellow on its own.
- **Catégorie de contact** + **Catégorie de contact à proposer** (default `Employés`) — Contacts also
  holds producers and venue teams, so the assignment list is narrowed to one category.

**Créer des quarts** (toolbar button) creates N identical open shifts: a date, a role, a work block
(Montage / Show call / Démontage) whose In/Out pair receives the hours, a start and end time, and a
quantity. An overnight shift (e.g. `23:00 → 01:00`) is stored as `25:00`, consistent with how
durations are already totalled. The contact and the event are left empty on purpose: the shift is
open, and gets dispatched later from the assignment panel.

**The role dropdown.** `Rôles` is a link to a table the interface does not expose, so it cannot be
read — and `fetchForeignRecordsAsync` would return every role in the base, categories included. The
options are therefore the roles **already linked from `equipe_accueil`**, which are the front-of-house
ones by construction. Caveat: a role never yet used on a shift will not appear. Exposing the Rôles
table to the interface removes that limitation — the code then switches on its own to filtering it by
**Catégorie du rôle** / **Catégorie de rôle à proposer** (default `accueil`), and those two properties
appear in the settings panel.

Record creation and editing must also be enabled on the extension element in the Airtable interface
builder (they are two separate toggles). Otherwise Airtable refuses the write, and the extension
reports its reason verbatim instead of hiding the button silently.

**Assigning**: clicking an open (yellow) shift opens the assignment panel (contact + event of that
day). Clicking an already-assigned shift expands the Airtable record, as before. Both affordances
disappear when the collaborator lacks write permission.

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
