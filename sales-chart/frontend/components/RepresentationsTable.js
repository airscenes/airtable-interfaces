import { expandRecord } from "@airtable/blocks/interface/ui";
import { fmtNumber, fmtCurrency } from "../utils/format";
import { downloadRepsCsv } from "../utils/csv";
import { SelectBadge } from "./SelectBadge";

// Header cells stay visible while scrolling down. The background must live on
// the th itself — a background set on the <tr> is not painted under a sticky
// cell, so rows would show through it.
const TH =
  "px-3 py-2 sticky top-0 z-10 bg-gray-gray75 dark:bg-gray-gray800 " +
  "shadow-[inset_0_-1px_0_#e5e9f0] dark:shadow-[inset_0_-1px_0_#41454d]";

// Caps the table box so its horizontal scrollbar stays on screen. Expressed in
// viewport units so it scales with the screen instead of assuming a fixed
// header height; the remaining 12vh is the breathing room left below the box.
const SCROLL_MAX_HEIGHT = "88vh";

// --- Shared events table (header + filters + table card) ---
// Selection (checkbox column + row click) is enabled only when setSelectedRepIds
// is provided. showSpectacleCol adds a "Spectacle" column for the mixed all-events
// view where rows span multiple shows.
export function RepresentationsTable({
  title,
  totalCount,
  filteredReps,
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
}) {
  const selectable = !!setSelectedRepIds;
  const minWidth = (showSpectacleCol ? 1780 : 1600) + 124;

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
            onClick={() => downloadRepsCsv(filteredReps, weekDeltas, showSpectacleCol, title)}
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
      {/* City and Venue filters */}
      {(uniqueVilles.length > 1 || uniqueSalles.length > 1) && (
        <div className="flex items-center gap-3 mb-3">
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
          <table className="w-full text-sm text-gray-gray700 dark:text-gray-gray200" style={{ minWidth }}>
            <thead>
              <tr className="text-gray-gray600 dark:text-gray-gray300 text-left text-xs">
                {selectable && (
                  <th className={`${TH} w-8`}>
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
                {showSpectacleCol && <th className={`${TH} font-semibold`}>Spectacle</th>}
                <th className={`${TH} font-semibold`}>J. restants</th>
                <th className={`${TH} font-semibold whitespace-nowrap`} style={{ minWidth: 150 }}>Date</th>
                <th className={`${TH} font-semibold`}>Salle</th>
                <th className={`${TH} font-semibold`}>Ville</th>
                <th className={`${TH} font-semibold text-right`}>Capacite</th>
                <th className={`${TH} font-semibold text-right`}>Places bloq.</th>
                <th className={`${TH} font-semibold text-right`}>Billets dispo</th>
                <th className={`${TH} font-semibold text-right`}>Total vendus</th>
                <th className={`${TH} font-semibold text-right`}>Total gratuits</th>
                <th className={`${TH} font-semibold text-right`} title="Dernière semaine complète (lundi → lundi)">Vendus (sem.)</th>
                <th className={`${TH} font-semibold text-right`} title="Dernière semaine complète (lundi → lundi)">Revenus (sem.)</th>
                <th className={`${TH} font-semibold text-right`}>Assistance</th>
                <th className={`${TH} font-semibold`} style={{ minWidth: 120 }}>Taux remplissage</th>
                <th className={`${TH} font-semibold text-right`}>Revenus billetterie</th>
                <th className={`${TH} font-semibold`}>Statut rapport</th>
                <th className={`${TH} font-semibold text-right`}>Objectif revenus</th>
                <th className={`${TH} font-semibold`}>Mise a jour</th>
                <th className={`${TH} font-semibold`}>Priorisation</th>
                <th className={`${TH} font-semibold`}>Billetterie Salle</th>
                <th className={`${TH} font-semibold`}>Note</th>
                <th className={`${TH} font-semibold`}>Statut</th>
                <th className={`${TH} font-semibold`}>Site web</th>
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
                                    ? "bg-free-light dark:bg-free-dark hover:bg-free-lightHover dark:hover:bg-free-darkHover"
                                    : "hover:bg-gray-gray25 dark:hover:bg-gray-gray600"
                              }`}
                >
                  {selectable && (
                    <td
                      className="px-3 py-2 text-center"
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
                  {showSpectacleCol && (
                    <td className="px-3 py-2 font-medium text-gray-gray800 dark:text-gray-gray100">{rep.spectacleName || "—"}</td>
                  )}
                  <td className="px-3 py-2">{rep.colJoursRestants}</td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ minWidth: 150 }}>{rep.colDateRep}</td>
                  <td className="px-3 py-2">{rep.colSalle}</td>
                  <td className="px-3 py-2">{rep.colVille}</td>
                  <td className="px-3 py-2 text-right">{fmtNumber(rep.colCapacite)}</td>
                  <td className="px-3 py-2 text-right">{fmtNumber(rep.colPlacesBloques)}</td>
                  <td className="px-3 py-2 text-right">{fmtNumber(rep.colBilletsDispo)}</td>
                  <td className="px-3 py-2 text-right">{fmtNumber(rep.colTotalBilletsVendus)}</td>
                  <td className="px-3 py-2 text-right">{fmtNumber(rep.colTotalBilletsGratuits)}</td>
                  <td className="px-3 py-2 text-right">{fmtNumber(weekDeltas[rep.id]?.sold)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(weekDeltas[rep.id]?.revenue)}</td>
                  <td className="px-3 py-2 text-right">{fmtNumber(rep.colAssistance)}</td>
                  <td className="px-3 py-2" style={{ minWidth: 120 }}>
                    {rep.colTauxRemplissage !== null ? (() => {
                      const pct = Math.min(100, Math.round(rep.colTauxRemplissage * 100));
                      const barColor = pct >= 80 ? "#20c933" : pct >= 50 ? "#fcb400" : "#f82b60";
                      return (
                        <div className="flex items-center gap-1">
                          <div className="flex-1 bg-gray-gray200 dark:bg-gray-gray600 rounded-full h-2" style={{ minWidth: 60 }}>
                            <div
                              className="rounded-full h-2"
                              style={{ width: `${pct}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <span className="text-xs text-gray-gray500 dark:text-gray-gray400 whitespace-nowrap">
                            {pct}%
                          </span>
                        </div>
                      );
                    })() : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(rep.colRevenus)}</td>
                  <td className="px-3 py-2"><SelectBadge value={rep.colStatutRapport} /></td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(rep.colObjectifRevenus)}</td>
                  <td className="px-3 py-2"><SelectBadge value={rep.colMiseAJour} /></td>
                  <td className="px-3 py-2"><SelectBadge value={rep.colPriorisation} /></td>
                  <td className="px-3 py-2"><SelectBadge value={rep.colBilleterieSalle} /></td>
                  <td className="px-3 py-2"><SelectBadge value={rep.colNote} /></td>
                  <td className="px-3 py-2"><SelectBadge value={rep.colStatut} /></td>
                  <td className="px-3 py-2"><SelectBadge value={rep.colSiteWeb} /></td>
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
