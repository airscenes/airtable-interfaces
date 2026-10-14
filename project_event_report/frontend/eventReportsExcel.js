// "Rapports par événement" — data and Excel side (no UI, runs in Node too): one report per
// event (revenus/dépenses grouped by compte), filled into a "Sommaire" tab + one tab per event.
// Download only: nothing is written to Airtable, so no État de compte is created and the
// monthly period is not closed. UI in eventReports.js.

import {
  fillTemplate,
  cloneWorksheet,
  unshareFormulas,
  fixOverlappingMerges,
  normalizeWorkbookForExcel,
} from "./excelTemplate.js";
import { buildDefaultEventTemplate, SUMMARY_SHEET, EVENT_SHEET } from "./eventTemplateDefault.js";

const COMMISSIONS_GROUP = "Commissions";
const UNBILLED_GROUP = "Non facturé (événement)";
const NO_COMPTE = "Sans compte";

export const pad = (n) => String(n).padStart(2, "0");
export const round2 = (v) => Math.round(v * 100) / 100;
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

// YYYY-MM-DD of a date/dateTime cell value. Date-only strings are sliced, never parsed (parsing
// "YYYY-MM-DD" yields UTC midnight, i.e. the previous day in Québec). DateTime values are UTC
// timestamps and must go through local time, or an evening show lands on the next day.
export function localIsoDate(value) {
  let v = value;
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === "object" && v.value) v = v.value;
  if (typeof v !== "string" || !v) return "";
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d)) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
}

// Numeric value of a cell, summing lookups/rollups that come back as arrays.
function numberOf(rec, field) {
  const v = rec.getCellValue(field);
  if (Array.isArray(v)) return v.reduce((s, x) => s + (Number(x && typeof x === "object" ? x.value : x) || 0), 0);
  return Number(v) || 0;
}

function groupByCompte(items) {
  const map = new Map();
  for (const it of items) {
    const key = it.compte || NO_COMPTE;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "fr", { numeric: true }))
    .map(([nom, its]) => ({
      nom,
      total: round2(its.reduce((s, it) => s + it.montant, 0)),
      items: its.sort((a, b) => (a.date || "").localeCompare(b.date || "")),
    }));
}

// Map(event id → records) through a link field of the records pointing at Événements.
function indexByEvent(records, linkField) {
  const map = new Map();
  if (!linkField) return map;
  for (const r of records || []) {
    const links = r.getCellValue(linkField);
    if (!Array.isArray(links)) continue;
    for (const l of links) {
      if (!map.has(l.id)) map.set(l.id, []);
      map.get(l.id).push(r);
    }
  }
  return map;
}

/**
 * One report per event: revenus = linked Revenus (invoice lines) with montant > 0; dépenses =
 * linked lines of the Dépenses table (when configured) + linked Revenus with montant < 0
 * (absolute) + the event's commission field. Cachet and remise come from the Revenus lines;
 * with `cachetSiNonFacture`, an event with no Revenus line at all uses its own Cachet + Remise.
 */
export function buildEventReports(events, revenusRecords, cfg, depensesRecords = []) {
  const {
    dateField, lieuField, revenusEvenementLinkField, revenusMontantField,
    revenusCompteField, revenusDateField, revenusDateFallbackField, revenusDescriptionField,
    depensesEvenementLinkField, depensesMontantField, depensesCompteField,
    depensesDateField, depensesDateFallbackField, depensesDescriptionField,
    commissionField, commissionLabel, cachetField, remiseField, cachetSiNonFacture,
  } = cfg;

  const revenusByEvent = indexByEvent(revenusRecords, revenusMontantField && revenusEvenementLinkField);
  const depensesByEvent = indexByEvent(depensesRecords, depensesMontantField && depensesEvenementLinkField);
  const dateOf = (rec, ...fields) => {
    for (const f of fields) if (f) { const d = localIsoDate(rec.getCellValue(f)); if (d) return d; }
    return "";
  };

  return events.map((ev) => {
    const date = dateField ? localIsoDate(ev.getCellValue(dateField)) : "";
    const revenus = [];
    const depenses = [];
    for (const r of revenusByEvent.get(ev.id) || []) {
      const m = Number(r.getCellValue(revenusMontantField)) || 0;
      if (m === 0) continue;
      const item = {
        compte: revenusCompteField ? r.getCellValueAsString(revenusCompteField) : "",
        date: dateOf(r, revenusDateField, revenusDateFallbackField),
        description: revenusDescriptionField ? r.getCellValueAsString(revenusDescriptionField) : "",
        montant: round2(Math.abs(m)),
      };
      (m > 0 ? revenus : depenses).push(item);
    }
    // Not invoiced yet (no Revenus line at all): its Cachet + Remise stand in for the invoice.
    if (cachetSiNonFacture && !(revenusByEvent.get(ev.id) || []).length) {
      for (const [field, label] of [[cachetField, "Cachet"], [remiseField, "Remise"]]) {
        const m = field ? round2(Math.abs(numberOf(ev, field))) : 0;
        if (m) revenus.push({ compte: UNBILLED_GROUP, date, description: `${label} (non facturé)`, montant: m });
      }
    }
    for (const d of depensesByEvent.get(ev.id) || []) {
      const m = Number(d.getCellValue(depensesMontantField)) || 0;
      if (m === 0) continue;
      depenses.push({
        compte: depensesCompteField ? d.getCellValueAsString(depensesCompteField) : "",
        date: dateOf(d, depensesDateField, depensesDateFallbackField),
        description: depensesDescriptionField ? d.getCellValueAsString(depensesDescriptionField) : "",
        montant: round2(Math.abs(m)),
      });
    }
    const commission = commissionField ? round2(Math.abs(numberOf(ev, commissionField))) : 0;
    if (commission) depenses.push({ compte: COMMISSIONS_GROUP, date, description: commissionLabel, montant: commission });
    const totalRevenus = round2(revenus.reduce((s, it) => s + it.montant, 0));
    const totalDepenses = round2(depenses.reduce((s, it) => s + it.montant, 0));
    return {
      id: ev.id,
      nom: ev.name || "",
      date,
      lieu: lieuField ? ev.getCellValueAsString(lieuField) : "",
      revenus: groupByCompte(revenus),
      depenses: groupByCompte(depenses),
      totalRevenus,
      totalDepenses,
      solde: round2(totalRevenus - totalDepenses),
    };
  });
}

// --- Excel export ---

const colLetter = (col) => {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Excel tab names: max 31 chars, none of \ / ? * : [ ], unique ignoring case.
function uniqueSheetName(raw, used) {
  const base = (raw.replace(/[\\/?*:[\]]/g, "-").replace(/^'+|'+$/g, "").trim() || "Événement").slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - ` (${i})`.length)} (${i})`;
  used.add(name.toLowerCase());
  return name;
}

// Position of the cells holding exactly `${tag}`, to point the summary at each tab's totals.
function findTagCells(ws, tags) {
  const found = {};
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const v = cell.value;
      const text = typeof v === "string" ? v.trim() : "";
      for (const tag of tags) if (text === `\${${tag}}` && !found[tag]) found[tag] = { row: rowNumber, col };
    });
  });
  return found;
}

// Section rows: one `<prefix>_compte` header per compte, followed by its `<prefix>` items.
function sectionRows(prefix, groups) {
  const header = `${prefix}_compte`;
  const rows = [];
  for (const g of groups) {
    rows.push({ prefix: header, data: { nom: g.nom, total: g.total } });
    for (const it of g.items) rows.push({ prefix, data: { ...it, compte: g.nom } });
  }
  if (!rows.length) rows.push({ prefix, data: { description: "Aucune entrée" } });
  return { prefixes: [header, prefix], rows };
}

async function loadTemplate(ExcelJS, templateUrl) {
  if (!templateUrl) return buildDefaultEventTemplate(ExcelJS);
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error(`Téléchargement du template échoué : ${res.status}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await fixOverlappingMerges(await res.arrayBuffer()));
  return wb;
}

/** Fill the template into a workbook: "Sommaire" + one tab per report. `wb` = loaded template. */
export function fillEventReportsWorkbook(wb, { spectacleName, producteurName, dateFrom, dateTo, reports }) {
  const src = wb.getWorksheet(EVENT_SHEET);
  if (!src) throw new Error(`Feuille « ${EVENT_SHEET} » absente du template`);
  const summary = wb.getWorksheet(SUMMARY_SHEET);
  unshareFormulas(src);
  const totalCells = findTagCells(src, ["total_revenus", "total_depenses", "solde"]);

  const common = {
    nom_spectacle: spectacleName,
    nom_producteur: producteurName || "",
    date_debut: dateFrom,
    date_fin: dateTo,
    date_generation: todayIso(),
  };
  const used = new Set(wb.worksheets.map((w) => w.name.toLowerCase()));
  const summaryRows = [];

  for (const rep of reports) {
    const name = uniqueSheetName(`${rep.date} ${rep.nom}`, used);
    const ws = cloneWorksheet(wb, src, name);
    const { imagesOf } = fillTemplate(ws, {
      tags: {
        ...common,
        evenement: rep.nom,
        date: rep.date,
        lieu: rep.lieu,
        total_revenus: rep.totalRevenus,
        total_depenses: rep.totalDepenses,
        solde: rep.solde,
      },
      sections: {
        revenus: sectionRows("revenu", rep.revenus),
        depenses: sectionRows("depense", rep.depenses),
      },
    });
    // Summary amounts are formulas pointing at the tab, so a correction made in a tab carries over.
    const linked = (tag, value) => {
      const pos = totalCells[tag];
      const row = pos && imagesOf(pos.row)[0];
      return row ? { formula: `'${name.replace(/'/g, "''")}'!${colLetter(pos.col)}${row}`, result: value } : value;
    };
    summaryRows.push({
      date: rep.date,
      nom: rep.nom,
      lieu: rep.lieu,
      revenus: linked("total_revenus", rep.totalRevenus),
      depenses: linked("total_depenses", rep.totalDepenses),
      solde: linked("solde", rep.solde),
    });
  }

  wb.removeWorksheet(src.id);
  if (summary) fillTemplate(summary, { tags: common, blocks: { evenement: summaryRows } });

  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  normalizeWorkbookForExcel(wb);
}

export async function exportEventReports({ templateUrl, ...data }) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = await loadTemplate(ExcelJS, templateUrl);
  fillEventReportsWorkbook(wb, data);
  const { spectacleName, dateFrom, dateTo } = data;
  const out = await wb.xlsx.writeBuffer();
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, "_");
  a.href = url;
  a.download = `Rapports_${safe(spectacleName)}_${dateFrom}_${dateTo}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
