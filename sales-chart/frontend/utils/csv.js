// Export the table rows (already filtered) to a CSV matching the displayed
// columns. Semicolon-delimited + comma decimals + UTF-8 BOM for French Excel.
export function downloadRepsCsv(reps, weekDeltas, showSpectacleCol, title) {
  const num = (v) =>
    v == null || (typeof v === "number" && isNaN(v)) ? "" : String(v).replace(".", ",");
  const sel = (v) => (v && v.text) || "";
  const columns = [
    ...(showSpectacleCol ? [["Spectacle", (r) => r.spectacleName || ""]] : []),
    ["J. restants", (r) => r.colJoursRestants || ""],
    ["Date", (r) => r.colDateRep || ""],
    ["Salle", (r) => r.colSalle || ""],
    ["Ville", (r) => r.colVille || ""],
    ["Capacite", (r) => num(r.colCapacite)],
    ["Places bloquees", (r) => num(r.colPlacesBloques)],
    ["Billets dispo", (r) => num(r.colBilletsDispo)],
    ["Total vendus", (r) => num(r.colTotalBilletsVendus)],
    ["Total gratuits", (r) => num(r.colTotalBilletsGratuits)],
    ["Vendus (sem.)", (r) => num(weekDeltas[r.id]?.sold)],
    ["Revenus (sem.)", (r) => num(weekDeltas[r.id]?.revenue)],
    ["Assistance", (r) => num(r.colAssistance)],
    ["Taux remplissage (%)", (r) => (r.colTauxRemplissage != null ? num(Math.round(r.colTauxRemplissage * 100)) : "")],
    ["Revenus billetterie", (r) => num(r.colRevenus)],
    ["Statut rapport", (r) => sel(r.colStatutRapport)],
    ["Objectif revenus", (r) => num(r.colObjectifRevenus)],
    ["Mise a jour", (r) => sel(r.colMiseAJour)],
    ["Priorisation", (r) => sel(r.colPriorisation)],
    ["Billetterie Salle", (r) => sel(r.colBilleterieSalle)],
    ["Note", (r) => sel(r.colNote)],
    ["Statut", (r) => sel(r.colStatut)],
    ["Site web", (r) => sel(r.colSiteWeb)],
  ];
  const esc = (s) => {
    const str = String(s ?? "");
    return /[";\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [columns.map((c) => esc(c[0])).join(";")];
  for (const r of reps) lines.push(columns.map((c) => esc(c[1](r))).join(";"));
  triggerCsvDownload(lines, title || "representations");
}

// Shared writer: prepend a UTF-8 BOM, join with CRLF, and trigger a download.
function triggerCsvDownload(lines, title) {
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const csvEsc = (s) => {
  const str = String(s ?? "");
  return /[";\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

// Export the artists weekly sold grid. One row per représentation, columns:
// Artiste, Spectacle, Date, Ville, then one column per week (ISO Monday) holding
// the cumulative tickets sold as of that week. `soldByRec` = { repId: [perWeek] }.
export function downloadArtistsCsv(artists, weeks, soldByRec, title) {
  const num = (v) =>
    v == null || (typeof v === "number" && isNaN(v)) ? "" : String(v).replace(".", ",");
  const header = ["Artiste", "Spectacle", "Date", "Ville", ...weeks.map((w) => w.mondayIso)];
  const lines = [header.map(csvEsc).join(";")];
  artists.forEach((artist) => {
    artist.spectacles.forEach((spec) => {
      spec.shows.forEach((show) => {
        const series = soldByRec[show.id];
        const cells = [
          artist.name,
          spec.projetName,
          show.dateRepIso || show.colDateRep || "",
          show.colVille || "",
          ...weeks.map((w, wi) => {
            const v = series ? series[wi] : 0;
            return v > 0 ? num(v) : "";
          }),
        ];
        lines.push(cells.map(csvEsc).join(";"));
      });
    });
  });
  triggerCsvDownload(lines, title || "ventes-par-artistes");
}
