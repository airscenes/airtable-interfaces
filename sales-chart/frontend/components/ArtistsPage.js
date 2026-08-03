import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { fmtNumber, formatDate } from "../utils/format";
import { lastNMondays, cumulativeSoldByWeek } from "../utils/salesData";
import { downloadArtistsCsv } from "../utils/csv";

// --- Artists page: weekly sold grid, hierarchy Artiste → Spectacles → Dates ---
// App prepares the `artists` array ([{ id, name, spectacles: [{ id, projetName,
// shows: [rep, ...] }] }], upcoming shows only, sorted). This component fetches
// each show's cumulative `sold` from Supabase (same source/pattern as
// HomeSalesChart) and renders, per artist, a grid: rows = représentations,
// columns = the last 16 weeks (Mondays) up to today, cells = cumulative tickets
// sold as of that week.

const WEEK_COUNT = 16;
const LABEL_COL = 240;
// Sized for the widest content — the "% remplissage" mode, which stacks
// "5/120" + "4,17 %". Kept constant across modes so toggling never reflows the
// grid.
const WEEK_COL = 86;

// Fill rate as a percentage of the venue capacity, 2 decimals, fr-FR style.
const fmtPct = (sold, capacity) =>
  `${((sold / capacity) * 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;

export function ArtistsPage({ artists, supabaseUrl, supabaseAnonKey, baseId, onBack }) {
  const weeks = useMemo(() => lastNMondays(WEEK_COUNT), []);
  const [mode, setMode] = useState("count"); // "count" | "pct"

  // All representation ids across every artist/spectacle in the view.
  const idsStr = useMemo(() => {
    const ids = new Set();
    artists.forEach((a) => a.spectacles.forEach((s) => s.shows.forEach((sh) => ids.add(sh.id))));
    return [...ids].sort().join(",");
  }, [artists]);

  const [soldByRec, setSoldByRec] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cacheRef = useRef(new Map());

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey || !idsStr) {
      setSoldByRec({});
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    const cacheKey = `artists_${baseId}_${idsStr}_${today}`;
    let didCancel = false;

    const run = async () => {
      if (cacheRef.current.has(cacheKey)) {
        if (!didCancel) {
          setSoldByRec(cacheRef.current.get(cacheKey));
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const ids = idsStr.split(",");
        const chunkSize = 150;
        const pageSize = 1000;
        let rows = [];
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize).join(",");
          const baseUrl =
            `${supabaseUrl}/rest/v1/sales_report` +
            `?base_id=eq.${baseId}` +
            `&record_id=in.(${chunk})` +
            `&order=date.asc` +
            `&select=record_id,date,sold`;
          let offset = 0;
          while (true) {
            const response = await fetch(baseUrl + `&limit=${pageSize}&offset=${offset}`, {
              headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${supabaseAnonKey}`,
                "Content-Type": "application/json",
              },
            });
            if (!response.ok) {
              throw new Error(`Erreur Supabase: ${response.status} ${response.statusText}`);
            }
            const page = await response.json();
            rows = rows.concat(page);
            if (page.length < pageSize) break;
            offset += pageSize;
            if (didCancel) return;
          }
        }
        if (didCancel) return;
        const series = cumulativeSoldByWeek(rows, weeks.map((w) => w.endIso));
        cacheRef.current.set(cacheKey, series);
        setSoldByRec(series);
        setLoading(false);
      } catch (err) {
        if (!didCancel) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      didCancel = true;
    };
  }, [idsStr, supabaseUrl, supabaseAnonKey, baseId, weeks]);

  const minWidth = LABEL_COL + weeks.length * WEEK_COL;

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-medium text-blue-blue hover:text-blue-blueDark1
                     dark:text-blue-blueLight1 dark:hover:text-blue-blueLight2 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Retour
        </button>
        <h2 className="text-xl font-display font-bold text-gray-gray700 dark:text-gray-gray200">
          Spectacles par artistes
        </h2>
        {loading && (
          <span className="flex items-center gap-2 text-sm text-gray-gray500 dark:text-gray-gray400">
            <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-blue"></span>
            Chargement des ventes…
          </span>
        )}
        <div className="ml-auto flex items-center rounded border border-gray-gray200 dark:border-gray-gray500 overflow-hidden">
          {[
            { key: "count", label: "Billets" },
            { key: "pct", label: "% remplissage" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setMode(opt.key)}
              className={`text-sm font-medium px-2.5 py-1 transition-colors ${
                mode === opt.key
                  ? "bg-blue-blue text-white"
                  : "text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray100 dark:hover:bg-gray-gray600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => downloadArtistsCsv(artists, weeks, soldByRec, "ventes-par-artistes")}
          disabled={artists.length === 0 || loading}
          className="flex items-center gap-1 text-sm font-medium px-2.5 py-1 rounded border border-gray-gray200 dark:border-gray-gray500
                     text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray100 dark:hover:bg-gray-gray600 transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
          title="Exporter les ventes en CSV"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Exporter CSV
        </button>
      </div>

      {error && (
        <div className="bg-white dark:bg-gray-gray700 rounded-lg p-3 mb-4 shadow-sm text-sm text-red-red dark:text-red-redLight1">
          {error}
        </div>
      )}

      {artists.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
            Aucun spectacle à venir.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {artists.map((artist) => (
            <div
              key={artist.id}
              className="overflow-x-auto bg-white dark:bg-gray-gray700 rounded-lg border border-gray-gray100 dark:border-gray-gray600 shadow-sm"
            >
              <table className="text-base border-collapse" style={{ width: "100%", minWidth, tableLayout: "fixed" }}>
                <thead>
                  <tr className="bg-gray-gray75 dark:bg-gray-gray800 text-gray-gray600 dark:text-gray-gray300 text-sm">
                    <th
                      className="text-left px-3 py-2 text-base font-display font-bold uppercase tracking-wide text-gray-gray800 dark:text-gray-gray100 sticky left-0 z-10 bg-gray-gray75 dark:bg-gray-gray800"
                      style={{ width: LABEL_COL }}
                    >
                      {artist.name}
                    </th>
                    {weeks.map((w) => (
                      <th
                        key={w.mondayIso}
                        className="px-2 py-2 font-semibold text-right whitespace-nowrap"
                      >
                        {formatDate(w.mondayIso)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {artist.spectacles.map((spec) => (
                    <Fragment key={spec.id}>
                      <tr className="bg-gray-gray50 dark:bg-gray-gray800">
                        <td
                          colSpan={weeks.length + 1}
                          className="py-1.5 text-sm font-semibold text-gray-gray600 dark:text-gray-gray300 border-t border-gray-gray100 dark:border-gray-gray600 bg-gray-gray50 dark:bg-gray-gray800"
                        >
                          {/* The cell spans the full table, so `sticky` goes on an inner
                              block: the title then trails the horizontal scroll and stays
                              on screen like the sticky date column. */}
                          <div className="sticky left-0 inline-block px-3 max-w-full truncate">
                            {spec.projetName}
                          </div>
                        </td>
                      </tr>
                      {spec.shows.map((show) => {
                        const label = [show.dateRepIso || show.colDateRep, show.colVille]
                          .filter(Boolean)
                          .join(" ");
                        const series = soldByRec[show.id];
                        const capacity = show.capacity || show.colCapacite || null;
                        return (
                          <tr
                            key={show.id}
                            className="border-t border-gray-gray100 dark:border-gray-gray600 hover:bg-gray-gray25 dark:hover:bg-gray-gray600"
                          >
                            <td
                              className="px-3 py-2 text-gray-gray700 dark:text-gray-gray200 sticky left-0 bg-white dark:bg-gray-gray700"
                              style={{ width: LABEL_COL, maxWidth: LABEL_COL }}
                            >
                              <div className="truncate">{label || "—"}</div>
                              {show.colSalle && (
                                <div className="truncate text-sm text-gray-gray400 dark:text-gray-gray400">
                                  {show.colSalle}
                                </div>
                              )}
                            </td>
                            {weeks.map((w, wi) => {
                              const v = series ? series[wi] : 0;
                              return (
                                <td
                                  key={w.mondayIso}
                                  className="px-2 py-2 text-right text-gray-gray700 dark:text-gray-gray200"
                                  style={{ fontVariantNumeric: "tabular-nums" }}
                                >
                                  {v > 0 && mode === "pct" && capacity ? (
                                    <>
                                      <div className="whitespace-nowrap">
                                        {fmtNumber(v)}
                                        {/* The capacity repeats on every cell of a row, so it
                                            gets the same muted grey as the percentage line —
                                            secondary, but still readable. */}
                                        <span className="text-sm text-gray-gray500 dark:text-gray-gray400">
                                          /{fmtNumber(capacity)}
                                        </span>
                                      </div>
                                      <div className="whitespace-nowrap text-sm text-gray-gray500 dark:text-gray-gray400">
                                        {fmtPct(v, capacity)}
                                      </div>
                                    </>
                                  ) : v > 0 ? (
                                    fmtNumber(v)
                                  ) : (
                                    ""
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
