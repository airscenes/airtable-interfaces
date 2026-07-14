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
- **Lien Projet (sur les quarts)** + **Lien Projet (sur Événements)** — `equipe_accueil` carries a
  `Projets` link but does not derive it, and the Projet interface page lists shifts by it: a shift
  without it is simply absent there. It is copied from the event's own `Projets` link whenever an
  event is set, and cleared when the event is removed, so the two never diverge.
- **URL du side-sheet Projet — parties 1/2 and 2/2** — clicking an event opens its project's
  side-sheet. Paste one such URL and only its `rowId` is swapped, so the page and element ids stay
  yours. It is split across two properties because **Airtable truncates a string property at 255
  characters** and these URLs are longer — a silent truncation that corrupts the base64 payload.

**Créer des quarts** (toolbar button) creates N identical open shifts: a date, a role, a work block
(Montage / Show call / Démontage) whose In/Out pair receives the hours, a start and end time, and a
quantity. An overnight shift (e.g. `23:00 → 01:00`) is stored as `25:00`, consistent with how
durations are already totalled. The contact and the event are left empty on purpose: the shift is
open, and gets dispatched later.

**Clicking a shift** opens the edit panel: the three In/Out pairs (a shift may legitimately have
more than one filled — clearing both ends of a pair erases it), the contact, and the event. It also
carries a **Supprimer** button, armed by a first click and only destructive on the second.

**Shifts with no event** are flagged with a ⚠ and counted per day. Their `date_courte` rollup is
empty, so they are correctly dated *in this extension only*: any Airtable view grouping by
`date_courte` will not show them, and the Projet page will not list them either. The clean fix is to
turn `date_courte` into a formula — the event's date when there is one, the shift's own date
otherwise.

**The role dropdown.** `Rôles` is a link to a table the interface does not expose, so it cannot be
read — and `fetchForeignRecordsAsync` would return every role in the base, categories included. The
options are therefore the roles **already linked from `equipe_accueil`**, which are the front-of-house
ones by construction. Caveat: a role never yet used on a shift will not appear. Exposing the Rôles
table to the interface removes that limitation — the code then switches on its own to filtering it by
**Catégorie du rôle** / **Catégorie de rôle à proposer** (default `accueil`), and those two properties
appear in the settings panel.

### Two limits of the Interface Extensions SDK you will hit

**An interface extension sees only the tables and fields the page exposes to it.** A field it cannot
see has no id and cannot be written — silently. That is why `Projets` and `statut_portail` were
invisible until they were exposed on the extension element, and why the Rôles table still is. When a
value refuses to be written, check this before suspecting the code.

**Record creation, editing and deletion are three separate toggles** on the extension element in the
interface builder. Otherwise Airtable refuses the write; the extension reports its reason verbatim
rather than hiding the affordance silently.

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
