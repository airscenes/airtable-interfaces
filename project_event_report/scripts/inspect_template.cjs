const ExcelJS = require("exceljs");
const path = require("path");

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, "..", "Rapport_template.xlsx"));
  const ws = wb.getWorksheet("Rapport") || wb.worksheets[0];
  console.log("Sheet:", ws.name, "rows:", ws.rowCount, "cols:", ws.columnCount);
  console.log("Column widths:", ws.columns.map((c, i) => `${String.fromCharCode(65 + i)}=${c.width}`).join(" "));
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const parts = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c);
      let v = cell.value;
      if (v && typeof v === "object" && v.text) v = v.text;
      if (v != null && v !== "") parts.push(`${String.fromCharCode(64 + c)}=${JSON.stringify(v)}`);
    }
    if (parts.length) console.log(`R${r}: ${parts.join("  ")}`);
  }
})();
