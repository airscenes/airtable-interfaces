# Availability Matrix — Airtable Interface Extension

Read-only matrix of submitted employee availabilities: **employees as rows, days as columns**,
the submitted time window in each cell. Built for **Espace Saint-Denis**, as the Airtable
replacement for the WordPress *Tableau des disponibilités*.

It is the reading counterpart of the employee portal's **Mes disponibilités** calendar, which
writes one record per contact × available day into the `disponibilites` table. This extension only
reads that table — dispatching people to shifts happens in `schedule_grid`.

## Why an extension and not a native view

Airtable interfaces have no crosstab element: a grid lists records, and a **Chronologie** (Timeline)
draws bars on a date axis rather than a fixed grid of day columns with the hours written out. The
base-level Pivot Table extension does cross two fields, but it aggregates numbers — it can count
records per employee × day, never render `18h00 à 23h00` in the cell.

## Configuration

All fields are set from the settings panel; sensible defaults are auto-detected by name.

**Table Disponibilités** (`disponibilites`)

- **Jour de la disponibilité** — the day the record belongs to (default `date`).
- **Lien Contact** — link to Contacts (default `Contacts`). Also used to derive which Contacts
  table the rows come from, so the rows always match what the link points at.
- **Heure de début** / **Heure de fin** — Duration fields, seconds since midnight (`heure_debut` /
  `heure_fin`). Both optional: a day submitted with no hours reads **Toute la journée**, and a
  single bound reads *À partir de …* / *Jusqu'à …*. This is deliberate — the portal's calendar lets
  an employee submit a day without hours, and rendering that as `00h00 à 00h00` (as the WordPress
  table did) reads like *unavailable*.

**Table Contacts**

- **Catégorie de contact** + **Catégorie de contact à afficher** (default `Employés`) — Contacts
  also holds producers, venue teams and suppliers, so the rows are narrowed to one category.

## Reading it

- **Period** — always starts on a Sunday, so a period reads as whole weeks. 1, 2 (default) or 4
  weeks, with *Semaine précédente* / *Aujourd'hui* / *Semaine suivante*. Two weeks matches the
  document this replaces. Today's column is tinted.
- **Employees with nothing submitted are shown**, with an empty row — that is precisely who the
  dispatcher needs to chase. **Masquer les employés sans disponibilité** hides them and reports how
  many were hidden.
- **Footer** — how many employees are available each day; a day with none is flagged orange.
- **Two windows on the same day** are stacked in the cell. The portal writes one record per day, so
  this should not happen, but silently dropping the second would misreport someone's availability.

## Not covered (deliberately)

The WordPress table also carried per-employee notes — *Accepte : Portier placier, Placier senior,
Merch*, free-text unavailability remarks, and a derived *Ont oublié d'accepter au moins un poste*
list. None of that exists in Airtable: employees declare days, not roles, and the dispatch is the
operations director's decision. Treated as indicative and dropped.

## Setup

1. In Airtable: Interface > Add extension > Build a custom extension.
2. Copy the generated `blockId` into `.block/remote.json` (it ships as
   `REPLACE_WITH_BLOCK_ID`).
3. Expose the `disponibilites` **and** `Contacts` tables to the extension in the interface builder,
   with the fields above marked **Visible** — an interface extension sees nothing else, and a table
   it cannot see will not even appear in the settings dropdown.
4. `npm install --legacy-peer-deps`, then `block run` / `block release`.

Note that Airtable does **not** pre-fill a property added after the extension was first configured:
each one must be pointed at its field once, by hand.
