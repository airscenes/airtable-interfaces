// Export the table rows (already filtered) to a CSV matching the displayed
// columns (`repColumns`, see utils/columns.js). Semicolon-delimited + comma
// decimals + UTF-8 BOM for French Excel.
export function downloadRepsCsv(reps, repColumns, weekDeltas, showSpectacleCol, title) {
  const num = (v) =>
    v == null || (typeof v === "number" && isNaN(v)) ? "" : String(v).replace(".", ",");
  const sel = (v) => (v && v.text) || "";
  const cellFor = (c) => {
    switch (c.type) {
      case "num":
      case "currency":
        return (r) => num(r[c.key]);
      case "select":
        return (r) => sel(r[c.key]);
      case "pct":
        return (r) => (r[c.key] != null ? num(Math.round(r[c.key] * 100)) : "");
      case "weekSold":
        return (r) => num(weekDeltas[r.id]?.sold);
      case "weekRevenue":
        return (r) => num(weekDeltas[r.id]?.revenue);
      default:
        return (r) => r[c.key] || "";
    }
  };
  const columns = [
    ...(showSpectacleCol ? [["Spectacle", (r) => r.spectacleName || ""]] : []),
    ...repColumns.map((c) => [c.csvLabel || c.label, cellFor(c)]),
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
