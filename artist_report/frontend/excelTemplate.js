// Tag-driven Excel template filling (ExcelJS worksheet in, filled worksheet out).
//
// Ported from Airscenes' `expandDocumentBlocks.ts`. Everything is located by the
// tags the template carries, never by row number, so the template layout can
// change without a code change.
//
// Two kinds of tags:
//
// - Scalars: `${nom_spectacle}` (legacy `{{nom_spectacle}}` also accepted),
//   replaced anywhere in the sheet. An unknown scalar is left visible on
//   purpose, so a template typo shows up instead of silently blanking a cell.
// - One-row blocks: a row carrying `${depense.montant}`, `${depense.date}`…
//   is duplicated once per record, each copy filled with that record. With no
//   record, the row is kept (so formulas pointing at it stay valid) but emptied.
//
// A cell holding exactly one tag whose value is a number receives the number
// itself (not text), so its number format and the formulas using it work.
//
// Template formulas are kept and re-pointed after rows are inserted (ExcelJS
// does not do it): `SUM(G25:G25)` over a block row becomes `SUM(G25:G31)`, a
// reference to a row below the block follows it down, and a formula inside a
// block row refers to its own copy's row.

const TAG_RE = /\$\{([\w.]+)\}|\{\{([\w.]+)\}\}/g;
const MERGE_RANGE = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/;
// A1 reference or range. The prefix/lookahead keep it off function names
// (LOG10), defined names and other-sheet references (Feuil2!A1).
const REF_RE = /(^|[^A-Za-z0-9_.!$'"])(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?(?![A-Za-z0-9_(!])/g;

const cellText = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && Array.isArray(value.richText)) {
    return value.richText.map((run) => run.text ?? "").join("");
  }
  return "";
};

const isFormula = (value) => value && typeof value === "object" && typeof value.formula === "string";

// Convert every shared formula into a standalone one. Excel stores a formula
// dragged across cells once (master) + references to it (clones); as soon as a
// master is overwritten or rows move around it, ExcelJS throws "Shared Formula
// master must exist above and or left of clone" on write. Must run before any
// cell is touched: `cell.formula` on a clone is translated from its master.
export function unshareFormulas(ws) {
  const cells = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (v && typeof v === "object" && (v.sharedFormula || v.shareType === "shared")) {
        cells.push({ cell, formula: cell.formula, result: v.result });
      }
    });
  });
  for (const { cell, formula, result } of cells) cell.value = { formula, result };
}

// ExcelJS writes <sheetPr> children as tabColor → pageSetUpPr → outlinePr, but
// the schema wants outlinePr before pageSetUpPr: a template carrying both comes
// out invalid and Excel offers to "repair" it. outlinePr only positions the
// summary line of grouped rows, which the report doesn't use.
export function normalizeWorkbookForExcel(wb) {
  wb.eachSheet((ws) => {
    delete ws.properties.outlineProperties;
  });
}

// Replace the tags of one cell. `lookup(key)` returns undefined for a tag it
// doesn't own (left untouched), otherwise the value (null/"" blanks it).
function fillCell(cell, lookup) {
  const value = cell.value;
  const text = cellText(value);
  if (!text.includes("${") && !text.includes("{{")) return;

  const only = /^\s*(?:\$\{([\w.]+)\}|\{\{([\w.]+)\}\})\s*$/.exec(text);
  if (only) {
    const v = lookup(only[1] || only[2]);
    if (v === undefined) return;
    cell.value = v === "" || v == null ? null : v;
    return;
  }

  const replace = (s) =>
    s.replace(TAG_RE, (match, a, b) => {
      const v = lookup(a || b);
      return v === undefined ? match : v == null ? "" : String(v);
    });
  if (typeof value === "string") {
    cell.value = replace(value);
  } else {
    // Rich text: replace run by run so styling survives (a tag split across
    // two runs by partial formatting is not supported).
    cell.value = { richText: value.richText.map((run) => ({ ...run, text: run.text ? replace(run.text) : run.text })) };
  }
}

const rowHasTagPrefix = (ws, rowNumber, prefix) => {
  let found = false;
  ws.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
    if (cellText(cell.value).includes(`\${${prefix}.`)) found = true;
  });
  return found;
};

// Copy values, styles and height of one row onto rows that already exist.
function copyRow(ws, src, dest) {
  const from = ws.getRow(src);
  const to = ws.getRow(dest);
  to.height = from.height;
  from.eachCell({ includeEmpty: true }, (cell, col) => {
    const target = to.getCell(col);
    target.value = cell.value;
    target.style = { ...cell.style };
  });
}

// Re-point a formula's references after rows were inserted.
// `imagesOf(r)` = final rows the template row r became (several for a block row).
function translateFormula(formula, { selfOriginal, selfFinal, imagesOf, origCount, delta }) {
  const mapRow = (r, isEnd) => {
    if (r === selfOriginal) return selfFinal;
    if (r > origCount) return r + delta;
    const images = imagesOf(r);
    if (!images.length) return r;
    return isEnd ? images[images.length - 1] : images[0];
  };
  // Leave string literals ("…") alone.
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(REF_RE, (m, pre, col1, row1, col2, row2) => {
          if (col2 === undefined) return `${pre}${col1}${mapRow(Number(row1), false)}`;
          return `${pre}${col1}${mapRow(Number(row1), false)}:${col2}${mapRow(Number(row2), true)}`;
        }),
    )
    .join("");
}

// Put merged ranges back on every row their template row became. ExcelJS
// doesn't merge the copies of a merged row, so the ranges are snapshotted
// before anything moves and recreated from the final layout.
//
// Unmerging wipes the secondary cells' styles and merging copies the first
// cell's style over them, which would drop e.g. the right border of a merged
// header. So every cell's style is saved before and put back after.
function rebuildMerges(ws, originalRanges, imagesOf) {
  const wanted = new Set();
  for (const range of originalRanges) {
    const match = MERGE_RANGE.exec(range);
    if (!match) continue;
    const [, startCol, startRow, endCol, endRow] = match;
    const height = Number(endRow) - Number(startRow);
    for (const image of imagesOf(Number(startRow))) {
      wanted.add(`${startCol}${image}:${endCol}${image + height}`);
    }
  }

  const styles = [];
  for (const range of wanted) {
    const [tl, br] = range.split(":").map((a) => ws.getCell(a));
    for (let r = tl.row; r <= br.row; r++) {
      for (let c = tl.col; c <= br.col; c++) {
        styles.push({ r, c, style: JSON.parse(JSON.stringify(ws.getCell(r, c).style || {})) });
      }
    }
  }

  for (const range of [...(ws.model.merges || [])]) ws.unMergeCells(range);
  for (const range of wanted) {
    try {
      ws.mergeCells(range);
    } catch {
      // Overlapping copies of a multi-row merge: losing one merge beats losing the file.
    }
  }
  for (const { r, c, style } of styles) ws.getCell(r, c).style = style;
}

/**
 * Fill a worksheet in place.
 * @param ws      ExcelJS worksheet (freshly loaded template)
 * @param tags    { key: string|number } scalar tags
 * @param blocks  { prefix: [{ field: string|number }] } one-row blocks
 */
export function fillTemplate(ws, { tags = {}, blocks = {} }) {
  unshareFormulas(ws);

  const originalMerges = [...(ws.model.merges || [])];
  const origCount = ws.rowCount;
  // layout[finalRow - 1] = template row now sitting there. Rows are only ever
  // inserted (never removed), so every template row keeps at least one image.
  const layout = Array.from({ length: origCount }, (_, i) => i + 1);

  // Blocks, bottom-up: expanding a block only pushes down rows below it, so
  // the anchors found above it stay valid.
  const anchors = [];
  for (const prefix of Object.keys(blocks)) {
    for (let r = 1; r <= origCount; r++) {
      if (rowHasTagPrefix(ws, r, prefix)) {
        anchors.push({ prefix, row: r });
        break;
      }
    }
  }
  anchors.sort((a, b) => b.row - a.row);

  for (const { prefix, row } of anchors) {
    const records = blocks[prefix] || [];
    const extra = records.length - 1;
    if (extra > 0) {
      ws.spliceRows(row + 1, 0, ...Array.from({ length: extra }, () => []));
      layout.splice(row, 0, ...Array.from({ length: extra }, () => layout[row - 1]));
      for (let k = 1; k <= extra; k++) copyRow(ws, row, row + k);
    }
    if (records.length === 0) {
      // Keep the row and its borders, drop its content (tags and formulas).
      ws.getRow(row).eachCell({ includeEmpty: false }, (cell) => {
        cell.value = null;
      });
      continue;
    }
    records.forEach((data, k) => {
      ws.getRow(row + k).eachCell({ includeEmpty: false }, (cell) => {
        fillCell(cell, (key) => (key.startsWith(`${prefix}.`) ? (data[key.slice(prefix.length + 1)] ?? "") : undefined));
      });
    });
  }

  const finalCount = layout.length;
  const imagesByOriginal = new Map();
  layout.forEach((original, i) => {
    if (!imagesByOriginal.has(original)) imagesByOriginal.set(original, []);
    imagesByOriginal.get(original).push(i + 1);
  });
  const imagesOf = (r) => imagesByOriginal.get(r) || [];

  // Scalars everywhere (blocks are already filled, so only scalars remain).
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      fillCell(cell, (key) => (Object.prototype.hasOwnProperty.call(tags, key) ? tags[key] : undefined));
    });
  });

  // Re-point formulas, and drop cached results so Excel recalculates them.
  if (finalCount !== origCount) {
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (!isFormula(cell.value)) return;
        cell.value = {
          formula: translateFormula(cell.value.formula, {
            selfOriginal: layout[rowNumber - 1],
            selfFinal: rowNumber,
            imagesOf,
            origCount,
            delta: finalCount - origCount,
          }),
        };
      });
    });
  }

  rebuildMerges(ws, originalMerges, imagesOf);
}
