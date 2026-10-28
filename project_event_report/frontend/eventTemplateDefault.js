// Default template of the "rapports par événement" export, built in code.
//
// Each producer attaches its own copy (with its logo) on its Organismes record; this one is
// the fallback when none is attached, and the source of `scripts/build_event_template.mjs`,
// which writes it to `Rapport_evenements_template.xlsx` to be customised in Excel.
//
// Two sheets:
// - "Sommaire": one row per event (block `evenement.*`) + a SUM total row.
// - "Événement": copied once per event. Two sections grouped by compte:
//   `revenu_compte.*` header row + `revenu.*` item row, same for `depense_compte` / `depense`.
//
// Tags (excelTemplate.js syntax):
//   both sheets  ${nom_spectacle} ${nom_producteur} ${date_debut} ${date_fin} ${date_generation}
//   Sommaire     ${evenement.date|nom|lieu|revenus|depenses|solde}
//   Événement    ${evenement} ${date} ${lieu} ${total_revenus} ${total_depenses} ${solde}
//                ${revenu_compte.nom|total} ${revenu.date|description|montant}
//                ${depense_compte.nom|total} ${depense.date|description|montant}

export const SUMMARY_SHEET = "Sommaire";
export const EVENT_SHEET = "Événement";

const FONT = "Roboto";
const MONEY = '#,##0.00" $"';
const BAND = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
const GROUP = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F7" } };
const THIN = { style: "thin", color: { argb: "FFBBBBBB" } };

function put(ws, address, value, { bold = false, size = 10, italic = false, money = false, fill, align } = {}) {
  const cell = ws.getCell(address);
  cell.value = value;
  cell.font = { name: FONT, size, bold, italic };
  if (money) cell.numFmt = MONEY;
  if (fill) cell.fill = fill;
  if (align) cell.alignment = { horizontal: align, vertical: "middle" };
  return cell;
}

// Paint a fill / border across a whole row span (A..lastCol), so bands read as one line.
function band(ws, row, lastCol, { fill, top, bottom } = {}) {
  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(row, c);
    if (fill) cell.fill = fill;
    if (top || bottom) cell.border = { ...(top ? { top: THIN } : {}), ...(bottom ? { bottom: THIN } : {}) };
  }
}

function buildSummary(wb) {
  const ws = wb.addWorksheet(SUMMARY_SHEET);
  ws.columns = [{ width: 13 }, { width: 34 }, { width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }];
  put(ws, "A1", "${nom_spectacle}", { bold: true, size: 16 });
  put(ws, "A2", "Rapports par événement — du ${date_debut} au ${date_fin}", { size: 11 });
  put(ws, "A3", "${nom_producteur}", { italic: true });
  put(ws, "F3", "Créé le ${date_generation}", { italic: true, align: "right" });

  ["Date", "Événement", "Lieu", "Revenus", "Dépenses", "Solde"].forEach((h, i) => {
    put(ws, `${"ABCDEF"[i]}5`, h, { bold: true, align: i >= 3 ? "right" : "left" });
  });
  band(ws, 5, 6, { fill: BAND, bottom: true });

  put(ws, "A6", "${evenement.date}");
  put(ws, "B6", "${evenement.nom}");
  put(ws, "C6", "${evenement.lieu}");
  put(ws, "D6", "${evenement.revenus}", { money: true });
  put(ws, "E6", "${evenement.depenses}", { money: true });
  put(ws, "F6", "${evenement.solde}", { money: true });

  put(ws, "A7", "TOTAL", { bold: true });
  for (const col of ["D", "E", "F"]) put(ws, `${col}7`, { formula: `SUM(${col}6:${col}6)` }, { bold: true, money: true });
  band(ws, 7, 6, { fill: BAND, top: true });

  ws.views = [{ state: "frozen", ySplit: 5 }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

// One grouped section (title, column header, group row, item row, total row). Returns next free row.
function section(ws, top, { title, groupPrefix, itemPrefix, totalTag, totalLabel }) {
  put(ws, `A${top}`, title, { bold: true, size: 12 });
  ["Poste", "Date", "Description", "Montant"].forEach((h, i) => {
    put(ws, `${"ABCD"[i]}${top + 1}`, h, { bold: true, align: i === 3 ? "right" : "left" });
  });
  band(ws, top + 1, 4, { fill: BAND, bottom: true });

  const g = top + 2;
  put(ws, `A${g}`, `\${${groupPrefix}.nom}`, { bold: true, fill: GROUP });
  put(ws, `D${g}`, `\${${groupPrefix}.total}`, { bold: true, money: true, fill: GROUP });
  band(ws, g, 4, { fill: GROUP });

  const i = top + 3;
  put(ws, `B${i}`, `\${${itemPrefix}.date}`);
  put(ws, `C${i}`, `\${${itemPrefix}.description}`);
  put(ws, `D${i}`, `\${${itemPrefix}.montant}`, { money: true });

  const t = top + 4;
  put(ws, `A${t}`, totalLabel, { bold: true });
  put(ws, `D${t}`, `\${${totalTag}}`, { bold: true, money: true });
  band(ws, t, 4, { fill: BAND, top: true });
  return t + 2;
}

function buildEvent(wb) {
  const ws = wb.addWorksheet(EVENT_SHEET);
  ws.columns = [{ width: 40 }, { width: 13 }, { width: 44 }, { width: 16 }];
  put(ws, "A1", "${nom_spectacle}", { bold: true, size: 16 });
  put(ws, "A2", "${evenement}", { bold: true, size: 12 });
  put(ws, "A3", "${date} · ${lieu}");
  put(ws, "D3", "Créé le ${date_generation}", { italic: true, align: "right" });

  let row = 5;
  row = section(ws, row, {
    title: "REVENUS", groupPrefix: "revenu_compte", itemPrefix: "revenu",
    totalTag: "total_revenus", totalLabel: "Total revenus",
  });
  row = section(ws, row, {
    title: "DÉPENSES", groupPrefix: "depense_compte", itemPrefix: "depense",
    totalTag: "total_depenses", totalLabel: "Total dépenses",
  });

  put(ws, `A${row}`, "SOLDE", { bold: true, size: 12 });
  put(ws, `D${row}`, "${solde}", { bold: true, size: 12, money: true });
  band(ws, row, 4, { fill: BAND, top: true, bottom: true });

  ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

/** Build the default template workbook. `ExcelJS` is passed in (dynamic import in the app). */
export function buildDefaultEventTemplate(ExcelJS) {
  const wb = new ExcelJS.Workbook();
  buildSummary(wb);
  buildEvent(wb);
  return wb;
}
