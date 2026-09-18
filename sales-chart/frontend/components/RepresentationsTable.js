import { expandRecord } from "@airtable/blocks/interface/ui";
import { fmtNumber, fmtCurrency } from "../utils/format";
import { downloadRepsCsv } from "../utils/csv";
import { colDefaultWidth } from "../utils/columns";
import { useColumnWidths } from "../hooks/useColumnWidths";
import { SelectBadge } from "./SelectBadge";

// Header cells stay visible while scrolling down. The background must live on
// the th itself — a background set on the <tr> is not painted under a sticky
// cell, so rows would show through it. Borders drawn as an inset shadow (right
// + bottom edge) because collapsed table borders don't stick with the cell.
const TH =
  "px-3 py-2 sticky top-0 z-10 bg-gray-gray75 dark:bg-gray-gray800 " +
  "shadow-[inset_-1px_-1px_0_#dadee6] dark:shadow-[inset_-1px_-1px_0_#41454d]";

// Row tint for free events (no promo to monitor): neutral pale gray so these
// rows read as "no follow-up", a notch darker than the gray25 hover of regular
// rows so the two stay distinguishable. Arbitrary values rather than theme
// tokens so the colors live next to their only use.
const FREE_ROW =
  "bg-[rgb(236,238,241)] hover:bg-[rgb(225,228,233)] " +
  "dark:bg-[rgb(42,45,52)] dark:hover:bg-[rgb(54,58,66)]";

// Vertical separator between body cells.
const TD = "px-3 py-2 border-r border-gray-gray200 dark:border-gray-gray600";

// Caps the table box so its horizontal scrollbar stays on screen. Expressed in
// viewport units so it scales with the screen instead of assuming a fixed
// header height; the remaining 12vh is the breathing room left below the box.
const SCROLL_MAX_HEIGHT = "88vh";

const RIGHT_ALIGNED = new Set(["num", "currency", "weekSold", "weekRevenue"]);
const isRight = (c) => RIGHT_ALIGNED.has(c.type);

// Fill-rate bar: red < 50% ≤ orange < 80% ≤ green.
function FillRate({ value }) {
  if (value === null || value === undefined) return "—";
  const pct = Math.min(100, Math.round(value * 100));
  const barColor = pct >= 80 ? "#20c933" : pct >= 50 ? "#fcb400" : "#f82b60";
  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 bg-gray-gray200 dark:bg-gray-gray600 rounded-full h-2" style={{ minWidth: 60 }}>
        <div className="rounded-full h-2" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <span className="text-xs text-gray-gray500 dark:text-gray-gray400 whitespace-nowrap">{pct}%</span>
    </div>
  );
}

// Width of the selection checkbox column (not resizable).
const CHECKBOX_COL_WIDTH = 36;

// Leading "Spectacle" column of the mixed all-events view. Resizable like the
// others, but not part of REP_COLUMNS: it is not configurable.
const SPECTACLE_COL = { key: "spectacle", label: "Spectacle", type: "spectacle" };

// Drag handle on the right edge of a header cell. Double-click resets the width.
function ResizeHandle({ onPointerDown, onReset }) {
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onClick={(e) => e.stopPropagation()}
      title="Glisser pour redimensionner — double-clic pour réinitialiser"
      className="absolute top-0 right-0 h-full w-2 cursor-col-resize group"
    >
      <div className="ml-auto h-full w-0.5 group-hover:bg-blue-blue" />
    </div>
  );
}

function renderCell(c, rep, weekDeltas) {
  switch (c.type) {
    case "spectacle":
      return rep.spectacleName || "—";
    case "num":
      return fmtNumber(rep[c.key]);
    case "currency":
      return fmtCurrency(rep[c.key]);
    case "select":
      return <SelectBadge value={rep[c.key]} />;
    case "pct":
      return <FillRate value={rep[c.key]} />;
    case "weekSold":
      return fmtNumber(weekDeltas[rep.id]?.sold);
    case "weekRevenue":
      return fmtCurrency(weekDeltas[rep.id]?.revenue);
    default:
      return rep[c.key];
  }
}

// --- Shared events table (header + filters + table card) ---
// Selection (checkbox column + row click) is enabled only when setSelectedRepIds
// is provided. showSpectacleCol adds a "Spectacle" column for the mixed all-events
// view where rows span multiple shows.
export function RepresentationsTable({
  title,
  totalCount,
  filteredReps,
  uniqueSpectacles = [],
  filterSpectacle = "",
  setFilterSpectacle,
  uniqueVilles,
  uniqueSalles,
  filterVille,
  setFilterVille,
  filterSalle,
  setFilterSalle,
  showAll,
  setShowAll,
  selectedRepIds,
  setSelectedRepIds,
  repRecords,
  showSpectacleCol = false,
  weekDeltas = {},
  columns,
}) {
  const selectable = !!setSelectedRepIds;
  const { widths, startResize, resetWidth } = useColumnWidths();
  const cols = showSpectacleCol ? [SPECTACLE_COL, ...columns] : columns;
  const widthOf = (c) => widths[c.key] || colDefaultWidth(c);
  // Fixed layout: the table is exactly as wide as its columns, so a resize
  // moves only the dragged column's edge (hidden columns take no space).
  const tableWidth =
    cols.reduce((sum, c) => sum + widthOf(c), 0) + (selectable ? CHECKBOX_COL_WIDTH : 0);

  // Clicking anywhere on a row expands the record, like a row click in Airtable.
  // Selection (when enabled) is therefore driven by the checkbox column only,
  // whose cell stops propagation so the two interactions never collide.
  const openRecord = (repId) => {
    const record = repRecords && repRecords.find((r) => r.id === repId);
    if (record) expandRecord(record);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-gray600 dark:text-gray-gray300">
          {title} ({filteredReps.length}
          {filteredReps.length !== totalCount ? ` / ${totalCount}` : ""})
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => downloadRepsCsv(filteredReps, columns, weekDeltas, showSpectacleCol, title)}
            className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-gray-gray200 dark:border-gray-gray500
                       text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray100 dark:hover:bg-gray-gray600 transition-colors"
            title="Exporter le tableau en CSV"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Exporter CSV
          </button>
          <label className="flex items-center gap-2 text-xs text-gray-gray500 dark:text-gray-gray400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="rounded"
            />
            Afficher les événements passés
          </label>
        </div>
      </div>
      {/* Show, City and Venue filters */}
      {(uniqueSpectacles.length > 1 || uniqueVilles.length > 1 || uniqueSalles.length > 1) && (
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {uniqueSpectacles.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-gray500 dark:text-gray-gray400 font-medium">Spectacle:</label>
              <select
                value={filterSpectacle}
                onChange={(e) => setFilterSpectacle(e.target.value)}
                className="text-xs rounded border border-gray-gray200 dark:border-gray-gray500 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
                style={{ fontSize: 11, padding: "3px 8px", minWidth: 160 }}
              >
                <option value="">Tous</option>
                {uniqueSpectacles.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || "(Sans nom)"}</option>
                ))}
              </select>
            </div>
          )}
          {uniqueVilles.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-gray500 dark:text-gray-gray400 font-medium">Ville:</label>
              <select
                value={filterVille}
                onChange={(e) => setFilterVille(e.target.value)}
                className="text-xs rounded border border-gray-gray200 dark:border-gray-gray500 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
                style={{ fontSize: 11, padding: "3px 8px", minWidth: 120 }}
              >
                <option value="">Toutes</option>
                {uniqueVilles.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          )}
          {uniqueSalles.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-gray500 dark:text-gray-gray400 font-medium">Salle:</label>
              <select
                value={filterSalle}
                onChange={(e) => setFilterSalle(e.target.value)}
                className="text-xs rounded border border-gray-gray200 dark:border-gray-gray500 bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
                style={{ fontSize: 11, padding: "3px 8px", minWidth: 120 }}
              >
                <option value="">Toutes</option>
                {uniqueSalles.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm overflow-hidden border border-gray-gray100 dark:border-gray-gray600">
        {/* Single scroll container for both axes: the horizontal scrollbar sits
            at the bottom of this box rather than at the bottom of a full-height
            table, so it stays reachable however long the list is. The header is
            sticky inside the same container. */}
        <div style={{ overflow: "auto", maxHeight: SCROLL_MAX_HEIGHT }}>
          <table
            className="text-sm text-gray-gray700 dark:text-gray-gray200"
            style={{ tableLayout: "fixed", width: tableWidth }}
          >
            <colgroup>
              {selectable && <col style={{ width: CHECKBOX_COL_WIDTH }} />}
              {cols.map((c) => (
                <col key={c.key} style={{ width: widthOf(c) }} />
              ))}
            </colgroup>
            <thead>
              <tr className="text-gray-gray600 dark:text-gray-gray300 text-left text-xs">
                {selectable && (
                  <th className={TH}>
                    <input
                      type="checkbox"
                      checked={filteredReps.length > 0 && filteredReps.every((r) => selectedRepIds.has(r.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedRepIds(new Set(filteredReps.map((r) => r.id)));
                        } else {
                          setSelectedRepIds(new Set());
                        }
                      }}
                      className="rounded"
                    />
                  </th>
                )}
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className={`${TH} font-semibold truncate${isRight(c) ? " text-right" : ""}`}
                    title={c.title || c.label}
                  >
                    {c.label}
                    <ResizeHandle
                      onPointerDown={(e) => startResize(c.key, widthOf(c), e)}
                      onReset={() => resetWidth(c.key)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredReps.map((rep) => (
                <tr
                  key={rep.id}
                  onClick={() => openRecord(rep.id)}
                  title={
                    rep.isFree
                      ? "Evenement gratuit — aucune promo a surveiller. Cliquer pour ouvrir la fiche."
                      : "Ouvrir la fiche de l'evenement"
                  }
                  className={`border-t border-gray-gray100 dark:border-gray-gray600 transition-colors cursor-pointer
                              ${
                                selectable && selectedRepIds.has(rep.id)
                                  ? "bg-blue-blueLight3 dark:bg-blue-blueDark1 font-medium"
                                  : rep.isFree
                                    ? FREE_ROW
                                    : "hover:bg-gray-gray25 dark:hover:bg-gray-gray600"
                              }`}
                >
                  {selectable && (
                    <td
                      className={`${TD} text-center`}
                      onClick={(e) => e.stopPropagation()}
                      title="Selectionner pour le graphique"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRepIds.has(rep.id)}
                        onChange={(e) => {
                          setSelectedRepIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) {
                              next.add(rep.id);
                            } else {
                              next.delete(rep.id);
                            }
                            return next;
                          });
                        }}
                        className="rounded"
                      />
                    </td>
                  )}
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className={`${TD} truncate${isRight(c) ? " text-right" : ""}${
                        c.type === "spectacle" ? " font-medium text-gray-gray800 dark:text-gray-gray100" : ""
                      }`}
                    >
                      {renderCell(c, rep, weekDeltas)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredReps.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
              Aucun evenement trouve.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
