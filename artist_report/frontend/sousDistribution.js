// Sub-distribution report ("Rapport de sous-distribution"): for an artist (the label)
// and a period (a month or a half-year), one workbook with a Sommaire sheet and one
// sheet per ticked canal listing every Believe royalty line of the canal.
//
// The lines come from `POST /api/airtable/royalties` with `summary: "lines"`
// (get_royalty_lines, frontend repo), one month and one page at a time. A line is
// matched by one key chosen server-side: its ISRC if it has one, else its UPC. These
// are the same keys as the canal's Believe column (fetchBelieveByMonth sends ISRCs +
// UPCs, no catalog numbers), so a canal's lines add up to that column.
//
// One request covers every ticked canal at once (the union of their keys): the server
// scans the month once, and each line is then given to the canal(s) holding its key.
// A UPC shared by several canaux puts its lines in each of them (sharedRoyaltyKeys
// already warns about it), as the Believe column does.

import ExcelJS from "exceljs";

const MONTHS_SHORT_FR = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

// What one request may list (MAX_LIST in the frontend's parseRoyaltiesQuery).
const MAX_KEYS = 2000;

const pad2 = (n) => String(n).padStart(2, "0");

const monthLabel = (iso) => {
  const [y, m] = String(iso || "").split("-");
  const idx = parseInt(m, 10);
  return idx >= 1 && idx <= 12 ? `${MONTHS_SHORT_FR[idx - 1]} ${y}` : String(iso || "");
};

const chunks = (list, size) => {
  if (list.length === 0) return [[]];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// The Believe lines of the canaux for the period, as Map canalId → [line].
// `post(body)` returns the API's JSON (columns, rows, next_after_id, upc_keys).
// `canaux` = [{ id, isrcs, upcs }]. `onProgress(text)` reports where it is.
export async function fetchSousDistributionLines({ post, canaux, period, onProgress }) {
  const isrcOwners = new Map(); // ISRC → Set(canalId)
  const upcInputOwners = new Map(); // UPC as typed in Airtable → Set(canalId)
  const own = (map, key, id) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const c of canaux) {
    for (const i of c.isrcs) own(isrcOwners, i, c.id);
    for (const u of c.upcs) own(upcInputOwners, u, c.id);
  }
  const isrcs = [...isrcOwners.keys()];
  const upcs = [...upcInputOwners.keys()];

  const byCanal = new Map(canaux.map((c) => [c.id, []]));
  if (isrcs.length === 0 && upcs.length === 0) return byCanal;

  // One request per month, unless a list is past the server's limit: then ISRCs and
  // UPCs go in chunks of their own. A line matches by one key only (ISRC lines are never
  // matched by UPC), so separate requests never return a line twice.
  const batches = isrcs.length <= MAX_KEYS && upcs.length <= MAX_KEYS
    ? [{ isrcs, upcs }]
    : [
        ...(isrcs.length > 0 ? chunks(isrcs, MAX_KEYS).map((part) => ({ isrcs: part, upcs: [] })) : []),
        ...(upcs.length > 0 ? chunks(upcs, MAX_KEYS).map((part) => ({ isrcs: [], upcs: part })) : []),
      ];

  const upcKeyOwners = new Map(); // normalized UPC key → Set(canalId)
  const months = period.months.map((m) => `${period.year}-${pad2(m)}-01`);
  for (let mi = 0; mi < months.length; mi++) {
    const month = months[mi];
    for (const batch of batches) {
      let afterId = 0;
      let page = 0;
      for (;;) {
        page += 1;
        onProgress?.(`Lecture Believe ${monthLabel(month)} (${mi + 1}/${months.length})${page > 1 ? `, page ${page}` : ""}…`);
        const res = await post({
          summary: "lines",
          month,
          isrcs: batch.isrcs,
          ...(batch.upcs.length > 0 ? { upcs: batch.upcs } : {}),
          after_id: afterId,
        });
        const columns = res?.columns || [];
        const col = Object.fromEntries(columns.map((name, i) => [name, i]));
        for (const [input, key] of Object.entries(res?.upc_keys || {})) {
          if (!key) continue;
          for (const id of upcInputOwners.get(input) || []) own(upcKeyOwners, key, id);
        }
        for (const raw of res?.rows || []) {
          const line = {};
          for (const name of columns) line[name] = raw[col[name]];
          const owners = line.key_type === "isrc" ? isrcOwners.get(line.key) : upcKeyOwners.get(line.key);
          for (const id of owners || []) byCanal.get(id)?.push(line);
        }
        if (res?.next_after_id == null) break;
        afterId = res.next_after_id;
      }
    }
  }
  return byCanal;
}

// --- Workbook ---

const AMOUNT_FMT = '#,##0.00';
const LINE_AMOUNT_FMT = '#,##0.000000';
const QTY_FMT = '#,##0';
const RATE_FMT = '0.00%';
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
const SUBTOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F7" } };

// Columns of a canal sheet. `money` columns get a subtotal per month and a total.
const LINE_COLUMNS = [
  { header: "Mois", width: 10, get: (l) => String(l.reporting_month || "").slice(0, 7) },
  { header: "Mois de vente", width: 13, get: (l) => String(l.sales_month || "").slice(0, 7) },
  { header: "Plateforme", width: 26, get: (l) => l.platform || "" },
  { header: "Pays", width: 18, get: (l) => l.country_region || "" },
  { header: "Artiste", width: 22, get: (l) => l.artist_name || "" },
  { header: "Release", width: 30, get: (l) => l.release_title || "" },
  { header: "Track", width: 30, get: (l) => l.track_title || "" },
  { header: "UPC", width: 15, get: (l) => l.upc || "" },
  { header: "ISRC", width: 14, get: (l) => l.isrc || "" },
  { header: "N° catalogue", width: 13, get: (l) => l.release_catalog_nb || "" },
  { header: "Type de release", width: 15, get: (l) => l.release_type || "" },
  { header: "Type de vente", width: 18, get: (l) => l.sales_type || "" },
  { header: "Quantité", width: 10, get: (l) => num(l.quantity), fmt: QTY_FMT, sum: true },
  { header: "Devise", width: 7, get: (l) => l.client_payment_currency || "" },
  { header: "Prix unitaire", width: 13, get: (l) => num(l.unit_price), fmt: LINE_AMOUNT_FMT },
  { header: "Brut", width: 14, get: (l) => num(l.gross_revenue), fmt: LINE_AMOUNT_FMT, sum: true },
  { header: "Taux", width: 8, get: (l) => num(l.client_share_rate), fmt: RATE_FMT },
  { header: "Net", width: 14, get: (l) => num(l.net_revenue), fmt: LINE_AMOUNT_FMT, sum: true },
];

const compareText = (a, b) => String(a || "").localeCompare(String(b || ""), "fr");

function sortLines(lines) {
  return [...lines].sort((a, b) =>
    compareText(a.reporting_month, b.reporting_month)
    || compareText(a.release_title, b.release_title)
    || compareText(a.track_title, b.track_title)
    || compareText(a.platform, b.platform)
    || compareText(a.country_region, b.country_region)
    || (a.id || 0) - (b.id || 0));
}

function styleHeader(row, count, rightFrom) {
  for (let i = 1; i <= count; i++) {
    const cell = row.getCell(i);
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = { bottom: { style: "thin" } };
    cell.alignment = { horizontal: i >= rightFrom ? "right" : "left", vertical: "bottom", wrapText: true };
  }
}

// One canal's sheet: title, header (row 4, frozen, filterable), the lines month by
// month, a subtotal after each month and a total. Subtotals use SUBTOTAL(9, …) so the
// total, over the whole range, does not count them twice. Returns the canal's totals.
function fillCanalSheet(ws, { canalName, artistName, period, lines }) {
  const HEADER_ROW = 4;
  ws.columns = LINE_COLUMNS.map((c) => ({ width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
  ws.getCell("A1").value = canalName;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `${artistName} — Période : ${period.label} — Source : Believe — ${lines.length} lignes`;
  ws.getRow(HEADER_ROW).values = LINE_COLUMNS.map((c) => c.header);
  styleHeader(ws.getRow(HEADER_ROW), LINE_COLUMNS.length, LINE_COLUMNS.findIndex((c) => c.fmt) + 1);
  ws.views = [{ state: "frozen", ySplit: HEADER_ROW }];
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: LINE_COLUMNS.length } };

  const sumCols = LINE_COLUMNS.map((c, i) => (c.sum ? i : -1)).filter((i) => i >= 0);
  const letter = (i) => ws.getColumn(i + 1).letter;
  const totals = { lignes: lines.length, quantite: 0, brut: 0, net: 0, netByMonth: {} };

  const byMonth = new Map();
  for (const l of sortLines(lines)) {
    const m = String(l.reporting_month || "").slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(l);
  }

  let r = HEADER_ROW + 1;
  const firstData = r;
  for (const [month, monthLines] of byMonth) {
    const from = r;
    const sums = sumCols.map(() => 0);
    ws.addRows(monthLines.map((l) => LINE_COLUMNS.map((c) => c.get(l))));
    for (const l of monthLines) {
      sumCols.forEach((ci, k) => { sums[k] += LINE_COLUMNS[ci].get(l); });
    }
    r += monthLines.length;
    const sub = ws.getRow(r);
    sub.getCell(1).value = `Sous-total ${monthLabel(`${month}-01`)}`;
    sumCols.forEach((ci, k) => {
      sub.getCell(ci + 1).value = { formula: `SUBTOTAL(9,${letter(ci)}${from}:${letter(ci)}${r - 1})`, result: sums[k] };
    });
    sub.font = { bold: true };
    for (let i = 1; i <= LINE_COLUMNS.length; i++) sub.getCell(i).fill = SUBTOTAL_FILL;
    r += 1;

    const net = sums[sumCols.findIndex((ci) => LINE_COLUMNS[ci].header === "Net")];
    totals.netByMonth[month] = net;
    totals.net += net;
    totals.brut += sums[sumCols.findIndex((ci) => LINE_COLUMNS[ci].header === "Brut")];
    totals.quantite += sums[sumCols.findIndex((ci) => LINE_COLUMNS[ci].header === "Quantité")];
  }

  const total = ws.getRow(r);
  total.getCell(1).value = "Total";
  sumCols.forEach((ci) => {
    const header = LINE_COLUMNS[ci].header;
    const result = header === "Net" ? totals.net : header === "Brut" ? totals.brut : totals.quantite;
    total.getCell(ci + 1).value = r > firstData
      ? { formula: `SUBTOTAL(9,${letter(ci)}${firstData}:${letter(ci)}${r - 1})`, result }
      : 0;
    total.getCell(ci + 1).numFmt = LINE_COLUMNS[ci].fmt === QTY_FMT ? QTY_FMT : AMOUNT_FMT;
  });
  total.font = { bold: true };
  total.eachCell((cell) => { cell.border = { top: { style: "thin" } }; });
  return totals;
}

// The workbook: Sommaire (one row per canal: lines, quantity, net per month of the
// period, gross, net; then a total), then one sheet per canal, in the given order.
// `canaux` = [{ name, lines }]. `uniqueSheetName(raw, used)` comes from index.js.
export function buildSousDistributionWorkbook({ artistName, period, canaux, uniqueSheetName }) {
  const wb = new ExcelJS.Workbook();
  const sommaire = wb.addWorksheet("Sommaire");
  const used = new Set(["sommaire"]);

  const rows = canaux.map((c) => {
    const ws = wb.addWorksheet(uniqueSheetName(c.name, used));
    return { canal: c.name, ...fillCanalSheet(ws, { canalName: c.name, artistName, period, lines: c.lines }) };
  });

  const months = period.months.map((m) => `${period.year}-${pad2(m)}`);
  const cols = [
    { header: "Lignes", width: 10, fmt: QTY_FMT, get: (r) => r.lignes },
    { header: "Quantité", width: 12, fmt: QTY_FMT, get: (r) => r.quantite },
    ...(months.length > 1
      ? months.map((m) => ({ header: `Net ${monthLabel(`${m}-01`)}`, width: 14, fmt: AMOUNT_FMT, get: (r) => r.netByMonth[m] || 0 }))
      : []),
    { header: "Brut", width: 14, fmt: AMOUNT_FMT, get: (r) => r.brut },
    { header: "Net", width: 14, fmt: AMOUNT_FMT, get: (r) => r.net },
  ];

  sommaire.columns = [{ width: 42 }, ...cols.map((c) => ({ width: c.width }))];
  sommaire.getCell("A1").value = `Rapport de sous-distribution — ${artistName}`;
  sommaire.getCell("A1").font = { bold: true, size: 14 };
  sommaire.getCell("A2").value = `Période : ${period.label} — Source : Believe`;
  const HEADER_ROW = 4;
  sommaire.getRow(HEADER_ROW).values = ["Canal", ...cols.map((c) => c.header)];
  styleHeader(sommaire.getRow(HEADER_ROW), cols.length + 1, 2);
  rows.forEach((r, k) => {
    const row = sommaire.getRow(HEADER_ROW + 1 + k);
    row.getCell(1).value = r.canal;
    cols.forEach((c, i) => {
      row.getCell(2 + i).value = c.get(r);
      row.getCell(2 + i).numFmt = c.fmt;
    });
  });
  const totalRow = sommaire.getRow(HEADER_ROW + 1 + rows.length);
  totalRow.getCell(1).value = "Total";
  cols.forEach((c, i) => {
    const col = sommaire.getColumn(2 + i).letter;
    const cell = totalRow.getCell(2 + i);
    cell.value = rows.length
      ? { formula: `SUM(${col}${HEADER_ROW + 1}:${col}${HEADER_ROW + rows.length})`, result: rows.reduce((s, r) => s + (c.get(r) || 0), 0) }
      : 0;
    cell.numFmt = c.fmt;
  });
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => { cell.border = { top: { style: "thin" } }; });

  return wb;
}
