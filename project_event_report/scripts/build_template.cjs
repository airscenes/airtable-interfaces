// One-shot generator for the starter Excel template.
// Run: node project_event_report/scripts/build_template.cjs
// Output: project_event_report/Rapport_template.xlsx
//
// The runtime exporter (frontend/index.js → exportFromTemplate) looks for these markers:
//   {{nom_spectacle}}, {{mois}}, {{annee}}, {{periode}}, {{date_generation}}
//   {{total_revenus}}, {{total_depenses}}, {{solde}}
//   {{events_marker}}, {{revenus_marker}}, {{factures_marker}}
// Each *_marker is a single cell on a row; the exporter clears it and inserts
// a header row + N data rows at that location, pushing everything below down.

const ExcelJS = require("exceljs");
const path = require("path");

async function build() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "project_event_report";
  wb.created = new Date();

  const ws = wb.addWorksheet("Rapport", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 18 },
  });

  // Column widths — 10 columns to fit booking-style event tables
  // (Date / Ville / Salle / Événement / Entente / Garantie / Overage / Commission / Balance / Avancé)
  ws.columns = Array.from({ length: 10 }, () => ({ width: 16 }));

  // --- Title block (spans all 10 cols) ---
  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = "RAPPORT MENSUEL";
  ws.getCell("A1").font = { name: "Calibri", size: 22, bold: true };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 32;

  ws.mergeCells("A2:J2");
  ws.getCell("A2").value = "{{nom_spectacle}}";
  ws.getCell("A2").font = { name: "Calibri", size: 16, bold: true };
  ws.getCell("A2").alignment = { horizontal: "center" };
  ws.getRow(2).height = 24;

  ws.mergeCells("A3:J3");
  ws.getCell("A3").value = "{{mois}} {{annee}}";
  ws.getCell("A3").font = { name: "Calibri", size: 14, italic: true, color: { argb: "FF555555" } };
  ws.getCell("A3").alignment = { horizontal: "center" };

  // Agency address block (left aligned, editable directly in Excel)
  ws.getCell("A5").value = "Bonsound";
  ws.getCell("A5").font = { bold: true };
  ws.getCell("A6").value = "160, rue St-Viateur Est, bureau 400";
  ws.getCell("A7").value = "Montréal, QC, H2T 1A8";
  ws.getCell("A8").value = "Canada";
  ws.getCell("A9").value = "+1 (514) 522-5672";

  ws.mergeCells("I5:J5");
  ws.getCell("I5").value = "Créé le {{date_generation}}";
  ws.getCell("I5").font = { italic: true, color: { argb: "FF555555" } };
  ws.getCell("I5").alignment = { horizontal: "right" };

  // --- KPI block (rows 11-12) — 3 boxes spanning the 10 cols ---
  ws.getRow(11).height = 28;
  ws.getRow(12).height = 44;

  const kpiBorder = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  const kpiBoxes = [
    { label: "TOTAL REVENUS", placeholder: "{{total_revenus}}", from: 1, to: 3 },   // A:C
    { label: "TOTAL DÉPENSES", placeholder: "{{total_depenses}}", from: 4, to: 7 }, // D:G
    { label: "SOLDE", placeholder: "{{solde}}", from: 8, to: 10 },                  // H:J
  ];
  const colLetter = (n) => String.fromCharCode(64 + n);
  for (const box of kpiBoxes) {
    const a = colLetter(box.from);
    const b = colLetter(box.to);
    ws.mergeCells(`${a}11:${b}11`);
    ws.getCell(`${a}11`).value = box.label;
    ws.getCell(`${a}11`).font = { bold: true, size: 11, color: { argb: "FF666666" } };
    ws.getCell(`${a}11`).alignment = { horizontal: "center", vertical: "middle" };
    ws.mergeCells(`${a}12:${b}12`);
    ws.getCell(`${a}12`).value = box.placeholder;
    ws.getCell(`${a}12`).font = { name: "Calibri", size: 22, bold: true };
    ws.getCell(`${a}12`).alignment = { horizontal: "center", vertical: "middle" };
    for (let c = box.from; c <= box.to; c++) {
      ws.getCell(`${colLetter(c)}11`).border = kpiBorder;
      ws.getCell(`${colLetter(c)}12`).border = kpiBorder;
    }
  }

  // --- Événements section ---
  ws.getCell("A15").value = "ÉVÉNEMENTS";
  ws.getCell("A15").font = { name: "Calibri", size: 14, bold: true };
  ws.getRow(15).height = 22;
  ws.getCell("A16").value = "{{events_marker}}";
  ws.getCell("A16").font = { color: { argb: "FFCCCCCC" } };

  // --- Revenus par catégorie ---
  ws.getCell("A18").value = "REVENUS PAR CATÉGORIE";
  ws.getCell("A18").font = { name: "Calibri", size: 14, bold: true };
  ws.getRow(18).height = 22;
  ws.getCell("A19").value = "{{revenus_marker}}";
  ws.getCell("A19").font = { color: { argb: "FFCCCCCC" } };

  // --- Factures (dépenses) ---
  ws.getCell("A21").value = "DÉPENSES (FACTURES)";
  ws.getCell("A21").font = { name: "Calibri", size: 14, bold: true };
  ws.getRow(21).height = 22;
  ws.getCell("A22").value = "{{factures_marker}}";
  ws.getCell("A22").font = { color: { argb: "FFCCCCCC" } };

  const outPath = path.join(__dirname, "..", "Rapport_template.xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log("Template written:", outPath);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
