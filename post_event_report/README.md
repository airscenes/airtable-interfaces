# post_event_report

Custom Airtable Interface Extension — **Suivi des rapports post-événement** (Espace Saint-Denis).

Events grouped by day. Each day header shows how many events it holds (= number
of gérant reports expected), how many are filled / sent, and a single **per-day
"Envoyer"** button. Sending a day builds one PDF (one section per event, from the
submitted report text), attaches the events' files, emails it to the recipient
contacts through the Make webhook, and stamps the "sent" date on each of the day's
filled events so the status persists.

## Data model

- The gérant fills a report from the **portal**, which creates a record in the
  **`formulaire_evenement`** table: `texte_soumis` (the whole report as markdown),
  `pieces_jointes` (attachments), a link to the Événement, and `Date de création`
  (the fill/submission timestamp).
- **Rempli** = the event has a linked `formulaire_evenement` record (latest one is
  used if there are several). Its `Date de création` is shown.
- **Envoyé** = `rapport_post_evenement_date_envoi` on the Événement, stamped by
  this extension when the client emails the day. This is the milestone the suivi
  tracks (distinct from the gérant's submission).
- **Recipients** = Contacts whose global `rapports` checkbox is ticked.
- **Send** = build the PDF (`reportPdf.js`) from each filled event's
  `texte_soumis` → `POST` FormData to the Make webhook (`type:
  "rapport_post_evenement"`, `pdf_base64`, `destinataires`, `pieces_jointes`
  [{url, nom}]) → on `200`, write `date_envoi`. No server: Make answers
  `Access-Control-Allow-Origin: *`.

## Files

- `frontend/index.js` — the suivi list, per-day send flow, and write-back.
- `frontend/reportPdf.js` — the emailed PDF (`@react-pdf/renderer`): one document
  per day, one section per event, rendering the parsed `texte_soumis`.
- `frontend/format.js` — date helpers + `parseTexteSoumis` (markdown → blocks).

## Setup

1. Register a new extension in the base's Interface and set `.block/remote.json`
   `blockId` (then `block run` / `block release`).
2. In the extension **settings** (Données panel), set: events table, Date field,
   `Date d'envoi` field (`rapport_post_evenement_date_envoi`), the `formulaire_evenement`
   table + its `texte_soumis` / link-to-event / `pieces_jointes` / `Date de création`
   fields, contacts table, Courriel field, `rapports` checkbox, and the Make
   webhook URL + token.
3. Make the fields used above **Visible** in the Données panel of each table.
4. Add a `rapport_post_evenement` branch to the Make scenario router: email the
   `pdf_base64` to `destinataires_str`, plus the `pieces_jointes` URLs as
   attachments. It can otherwise reuse the pré-événement email step.
