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
const LABEL_COL = 220;
const WEEK_COL = 50;

export function ArtistsPage({ artists, supabaseUrl, supabaseAnonKey, baseId, onBack }) {
  const weeks = useMemo(() => lastNMondays(WEEK_COUNT), []);

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
          <span className="flex items-center gap-2 text-xs text-gray-gray500 dark:text-gray-gray400">
            <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-blue"></span>
            Chargement des ventes…
          </span>
        )}
        <button
          onClick={() => downloadArtistsCsv(artists, weeks, soldByRec, "ventes-par-artistes")}
          disabled={artists.length === 0 || loading}
          className="ml-auto flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-gray-gray200 dark:border-gray-gray500
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
              <table className="text-sm border-collapse" style={{ width: "100%", minWidth, tableLayout: "fixed" }}>
                <thead>
                  <tr className="bg-gray-gray75 dark:bg-gray-gray800 text-gray-gray600 dark:text-gray-gray300 text-xs">
                    <th
                      className="text-left px-3 py-2 font-display font-bold uppercase tracking-wide text-gray-gray800 dark:text-gray-gray100 sticky left-0 z-10 bg-gray-gray75 dark:bg-gray-gray800"
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
                          className="px-3 py-1.5 text-xs font-semibold text-gray-gray600 dark:text-gray-gray300 border-t border-gray-gray100 dark:border-gray-gray600 sticky left-0 bg-gray-gray50 dark:bg-gray-gray800"
                        >
                          {spec.projetName}
                        </td>
                      </tr>
                      {spec.shows.map((show) => {
                        const label = [show.dateRepIso || show.colDateRep, show.colVille]
                          .filter(Boolean)
                          .join(" ");
                        const series = soldByRec[show.id];
                        return (
                          <tr
                            key={show.id}
                            className="border-t border-gray-gray100 dark:border-gray-gray600 hover:bg-gray-gray25 dark:hover:bg-gray-gray600"
                          >
                            <td
                              className="px-3 py-2 truncate text-gray-gray700 dark:text-gray-gray200 sticky left-0 bg-white dark:bg-gray-gray700"
                              style={{ width: LABEL_COL, maxWidth: LABEL_COL }}
                            >
                              {label || "—"}
                            </td>
                            {weeks.map((w, wi) => {
                              const v = series ? series[wi] : 0;
                              return (
                                <td
                                  key={w.mondayIso}
                                  className="px-2 py-2 text-right text-gray-gray700 dark:text-gray-gray200"
                                  style={{ fontVariantNumeric: "tabular-nums" }}
                                >
                                  {v > 0 ? fmtNumber(v) : ""}
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
