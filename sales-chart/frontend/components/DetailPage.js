import { useState, useMemo, useEffect, useRef } from "react";
import { PRESETS } from "../utils/constants";
import { defaultDateRange } from "../utils/format";
import {
  aggregateSalesByDate,
  lastCompleteWeekBounds,
  computeWeekDeltas,
  buildObjectiveSeries,
} from "../utils/salesData";
import { useRepFilters } from "../hooks/useRepFilters";
import { SalesChart } from "./SalesChart";
import { RepresentationsTable } from "./RepresentationsTable";

// --- Detail Page ---

export function DetailPage({
  spectacle,
  representations,
  spectacleKPIs,
  supabaseUrl,
  supabaseAnonKey,
  baseId,
  onBack,
  repRecords,
}) {
  const [selectedRepIds, setSelectedRepIds] = useState(new Set());
  const [salesData, setSalesData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => defaultDateRange().from);
  const [dateTo, setDateTo] = useState(() => defaultDateRange().to);
  const [refreshKey, setRefreshKey] = useState(0);
  const [salesRows, setSalesRows] = useState([]);
  const cacheRef = useRef(new Map());

  // City/venue/status filtering (shared with the all-events page)
  const {
    showAll, setShowAll,
    filterVille, setFilterVille,
    filterSalle, setFilterSalle,
    uniqueVilles, uniqueSalles,
    filteredReps,
  } = useRepFilters(representations);

  // Stable string of selected rep IDs for useEffect dependency
  const selectedRepIdsStr = useMemo(
    () => [...selectedRepIds].sort().join(","),
    [selectedRepIds],
  );

  // Stable string of filtered rep IDs for cache key + useEffect dependency
  const allRepIds = useMemo(
    () => filteredReps.map((r) => r.id).join(","),
    [filteredReps],
  );

  // Fetch sales data from Supabase (total or individual)
  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) {
      setSalesData([]);
      setLoading(false);
      setError(null);
      return;
    }

    const isAllMode = selectedRepIdsStr === "";
    const idsToFetch = isAllMode ? allRepIds : selectedRepIdsStr;
    if (!idsToFetch) {
      setSalesData([]);
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    const cacheKey = isAllMode ? `all_${allRepIds}_${today}_${refreshKey}` : `multi_${selectedRepIdsStr}_${today}_${refreshKey}`;
    let didCancel = false;

    const fetchSales = async () => {
      if (cacheRef.current.has(cacheKey)) {
        if (!didCancel) {
          setSalesData(cacheRef.current.get(cacheKey));
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const filter = `record_id=in.(${idsToFetch})`;

        const baseUrl =
          `${supabaseUrl}/rest/v1/sales_report` +
          `?base_id=eq.${baseId}` +
          `&${filter}` +
          `&order=date.asc` +
          `&select=record_id,date,sold,free,total`;

        // Paginate to fetch all rows (Supabase caps at 1000 per request)
        let data = [];
        let offset = 0;
        const pageSize = 1000;
        while (true) {
          const response = await fetch(
            baseUrl + `&limit=${pageSize}&offset=${offset}`,
            {
              headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${supabaseAnonKey}`,
                "Content-Type": "application/json",
              },
            },
          );

          if (!response.ok) {
            throw new Error(
              `Erreur Supabase: ${response.status} ${response.statusText}`,
            );
          }

          const page = await response.json();
          data = data.concat(page);
          if (page.length < pageSize) break;
          offset += pageSize;
          if (didCancel) return;
        }

        if (!didCancel) {
          const formatted = aggregateSalesByDate(data);
          cacheRef.current.set(cacheKey, formatted);
          setSalesData(formatted);
          setLoading(false);
        }
      } catch (err) {
        if (!didCancel) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchSales();

    return () => {
      didCancel = true;
    };
  }, [selectedRepIdsStr, supabaseUrl, supabaseAnonKey, baseId, allRepIds, refreshKey]);

  // Raw per-representation sales rows for all filtered reps (regardless of chart
  // selection). Used to derive both the weekly table columns and the period KPI
  // revenue (priced via average net price, consistent with the columns).
  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey || !allRepIds) {
      setSalesRows([]);
      return;
    }
    let didCancel = false;
    const run = async () => {
      try {
        const ids = allRepIds.split(",");
        const chunkSize = 150;
        const pageSize = 1000;
        let rows = [];
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize).join(",");
          const url =
            `${supabaseUrl}/rest/v1/sales_report` +
            `?base_id=eq.${baseId}` +
            `&record_id=in.(${chunk})` +
            `&order=date.asc` +
            `&select=record_id,date,sold,total`;
          let offset = 0;
          while (true) {
            const resp = await fetch(url + `&limit=${pageSize}&offset=${offset}`, {
              headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${supabaseAnonKey}`,
                "Content-Type": "application/json",
              },
            });
            if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
            const page = await resp.json();
            rows = rows.concat(page);
            if (page.length < pageSize) break;
            offset += pageSize;
            if (didCancel) return;
          }
        }
        if (didCancel) return;
        setSalesRows(rows);
      } catch {
        if (!didCancel) setSalesRows([]);
      }
    };
    run();
    return () => {
      didCancel = true;
    };
  }, [allRepIds, supabaseUrl, supabaseAnonKey, baseId, refreshKey]);

  // Weekly table columns: per-rep deltas over the last complete Mon→Mon week.
  const weekDeltas = useMemo(() => {
    if (!salesRows.length) return {};
    const { start, end } = lastCompleteWeekBounds();
    return computeWeekDeltas(salesRows, start, end);
  }, [salesRows]);

  const localDateStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const activePreset = useMemo(() => {
    if (!dateFrom && !dateTo) return "all";
    const now = new Date();
    const nowStr = localDateStr(now);
    for (const p of PRESETS) {
      if (p.key === "all") continue;
      const from = new Date(now);
      if (p.days != null) from.setDate(from.getDate() - p.days);
      else from.setMonth(from.getMonth() - p.months);
      if (dateFrom !== localDateStr(from)) continue;
      if (p.days != null ? dateTo === nowStr : !dateTo) return p.key;
    }
    return null;
  }, [dateFrom, dateTo]);

  // Filter salesData by date range
  const filteredSalesData = useMemo(() => {
    if (!salesData.length) return salesData;
    let data = salesData;
    if (dateFrom) data = data.filter((d) => d.date >= dateFrom);
    if (dateTo) data = data.filter((d) => d.date <= dateTo);
    // Ensure at least 2 points so Recharts draws a line (duplicate single point with dateTo label)
    if (data.length === 1 && dateTo && data[0].date !== dateTo) {
      data = [...data, { ...data[0], date: dateTo, dateLabel: dateTo }];
    }
    return data;
  }, [salesData, dateFrom, dateTo]);

  // Period stats: delta between first and last point in filtered range
  const periodStats = useMemo(() => {
    if (filteredSalesData.length < 1) return null;
    const first = filteredSalesData[0];
    const last = filteredSalesData[filteredSalesData.length - 1];
    const baseIndex = salesData.indexOf(first);
    const base =
      baseIndex > 0
        ? salesData[baseIndex - 1]
        : { ventes: 0, gratuits: 0, total_dollars: 0 };
    const ventesInPeriod = last.ventes - base.ventes;
    // Revenue is priced via average net price (same method as the table
    // columns), not the raw `total` delta: `total` is only refreshed
    // periodically and lags `sold`, so its delta collapses on recent days.
    let revenusInPeriod = 0;
    if (salesRows.length && dateFrom) {
      const activeIds =
        selectedRepIds.size === 0
          ? new Set(filteredReps.map((r) => r.id))
          : selectedRepIds;
      const activeRows = salesRows.filter((r) => activeIds.has(r.record_id));
      const end = dateTo || localDateStr(new Date());
      const deltas = computeWeekDeltas(activeRows, dateFrom, end);
      for (const id in deltas) revenusInPeriod += deltas[id].revenue || 0;
    }
    return { ventesInPeriod, revenusInPeriod };
  }, [filteredSalesData, salesData, salesRows, dateFrom, dateTo, selectedRepIds, filteredReps]);

  // Fixed KPIs: Ventes and Revenus (always shown, context-dependent values)
  const hasFilter = !!(dateFrom || dateTo);
  const fixedKPIs = useMemo(() => {
    if (salesData.length === 0)
      return [
        { value: "—", label: "Billets vendus", colored: false },
        { value: "—", label: "Revenus", colored: false },
      ];
    const last =
      filteredSalesData.length > 0
        ? filteredSalesData[filteredSalesData.length - 1]
        : salesData[salesData.length - 1];
    if (hasFilter && periodStats) {
      return [
        {
          value: `+${periodStats.ventesInPeriod.toLocaleString("fr-FR")}`,
          label: "Billets vendus (période)",
          colored: true,
        },
        {
          value: `+${periodStats.revenusInPeriod.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $`,
          label: "Revenus (période)",
          colored: true,
        },
      ];
    }
    return [
      { value: last.ventes.toLocaleString("fr-FR"), label: "Billets vendus", colored: false },
      { value: `${last.total_dollars.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $`, label: "Revenus", colored: false },
    ];
  }, [salesData, filteredSalesData, hasFilter, periodStats]);

  // Preset helper
  const setPreset = (key) => {
    const now = new Date();
    const p = PRESETS.find((x) => x.key === key);
    if (!p || key === "all") {
      setDateFrom("");
      setDateTo("");
      return;
    }
    const from = new Date(now);
    if (p.days != null) from.setDate(from.getDate() - p.days);
    else from.setMonth(from.getMonth() - p.months);
    setDateFrom(localDateStr(from));
    setDateTo(p.days != null ? localDateStr(now) : "");
  };

  // Build chart content based on current state
  const chartContent = (() => {
    const placeholderClass =
      "bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm flex items-center justify-center h-full";

    if (loading) {
      return (
        <div className={placeholderClass}>
          <div className="flex items-center space-x-3 text-gray-gray500">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-blue"></div>
            <span className="text-sm">Chargement...</span>
          </div>
        </div>
      );
    }
    if (error) {
      return (
        <div className={placeholderClass}>
          <p className="text-sm text-red-red dark:text-red-redLight1">
            {error}
          </p>
        </div>
      );
    }
    if (salesData.length === 0) {
      return (
        <div className={placeholderClass}>
          <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
            Aucune donnee de ventes.
          </p>
        </div>
      );
    }

    const isAllMode = selectedRepIds.size === 0;
    const selectedRep =
      selectedRepIds.size === 1
        ? filteredReps.find((r) => selectedRepIds.has(r.id))
        : null;
    // Compute aggregated capacity & revenuePotential for multi/all mode
    const activeReps = isAllMode ? filteredReps : filteredReps.filter((r) => selectedRepIds.has(r.id));
    const totalCapacity = activeReps.reduce((sum, r) => sum + (r.capacity || 0), 0) || null;
    const totalRevenuePotential = activeReps.reduce((sum, r) => sum + (r.revenuePotential || 0), 0) || null;

    // Budget-target curve: a single convex (accelerating) ramp from 0 to the
    // TOTAL objective (sum of the active reps' "Objectif revenus producteur").
    // The ramp spans the currently visible window — computed over the filtered
    // dates — so it fits the active date filter (full range in "Tout", the last
    // 7 days in "7j", etc.) and always reaches the target at the right edge.
    const totalObjective = activeReps.reduce(
      (s, r) => s + (r.colObjectifRevenus || 0),
      0,
    );
    const objByDate = buildObjectiveSeries(
      filteredSalesData.map((d) => d.date),
      totalObjective,
    );
    const chartData = filteredSalesData.map((d) => ({
      ...d,
      objectif: objByDate[d.date] ?? null,
    }));
    const presets = PRESETS;
    const btnBase = "px-2 py-0.5 rounded text-xs font-medium transition-colors";
    const btnActive = "bg-blue-blue text-white";
    const btnInactive =
      "bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray200 dark:hover:bg-gray-gray500";
    const inputStyle = {
      fontSize: 11,
      padding: "2px 6px",
      borderRadius: 4,
      border: "1px solid #d0d5dd",
      backgroundColor: "#fff",
      color: "#333",
      width: 120,
    };

    return (
      <div>
        {/* Date filter bar */}
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-1">
            {presets.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`${btnBase} ${activePreset === p.key ? btnActive : btnInactive}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="yyyy-mm-dd"
              pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
              maxLength={10}
              style={inputStyle}
            />
            <span className="text-xs text-gray-gray400">—</span>
            <input
              type="text"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="yyyy-mm-dd"
              pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
              maxLength={10}
              style={inputStyle}
            />
            <button
              onClick={() => { cacheRef.current.clear(); setRefreshKey((k) => k + 1); }}
              title="Rafraîchir les données"
              className={`${btnBase} ${btnInactive}`}
            >
              ↺
            </button>
          </div>
        </div>

        {/* Mode label / back to total */}
        {isAllMode ? (
          <p className="text-xs text-gray-gray500 dark:text-gray-gray400 mb-1 text-center font-medium">
            Total — toutes representations
          </p>
        ) : (
          <button
            onClick={() => setSelectedRepIds(new Set())}
            className="flex items-center gap-1 text-xs font-medium text-blue-blue hover:text-blue-blueDark1
                                   dark:text-blue-blueLight1 dark:hover:text-blue-blueLight2 transition-colors mb-1 mx-auto"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Voir le total ({selectedRepIds.size} selection{selectedRepIds.size > 1 ? "s" : ""})
          </button>
        )}
        <SalesChart
          data={chartData}
          capacity={selectedRep ? selectedRep.capacity : totalCapacity}
          revenueCapacity={selectedRep ? selectedRep.revenuePotential : totalRevenuePotential}
          zoom={hasFilter}
          height={isAllMode ? 320 : 330}
        />
      </div>
    );
  })();

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
      {/* Back button + title */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-medium text-blue-blue hover:text-blue-blueDark1
                               dark:text-blue-blueLight1 dark:hover:text-blue-blueLight2 transition-colors"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Retour
        </button>
        <h2 className="text-xl font-display font-bold text-gray-gray700 dark:text-gray-gray200">
          {spectacle.name}
        </h2>
      </div>

      {/* Top section: Chart (60%) + KPIs (40%) */}
      <div className="flex gap-5 mb-6" style={{ minHeight: 400 }}>
        {/* Chart - left 60% */}
        <div style={{ width: "60%" }}>{chartContent}</div>

        {/* KPIs - right 40% */}
        <div style={{ width: "40%" }}>
          <div
            className="grid grid-cols-2 gap-3 h-full"
            style={{ gridTemplateRows: "repeat(4, 1fr)" }}
          >
            {/* Fixed KPIs: Ventes + Revenus */}
            {fixedKPIs.map((kpi, i) => (
              <div
                key={`fixed-${i}`}
                className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100
                                           dark:border-gray-gray600 flex flex-col justify-center items-center p-4"
                style={
                  hasFilter
                    ? {
                        borderColor: i === 0 ? "#3b82f6" : "#4a7a33",
                        borderWidth: 2,
                      }
                    : {}
                }
              >
                <p
                  className={`font-bold font-display ${kpi.colored ? "" : "text-gray-gray800 dark:text-gray-gray100"}`}
                  style={{
                    fontSize: "1.75rem",
                    lineHeight: 1.1,
                    ...(kpi.colored ? { color: i === 0 ? "#3b82f6" : "#4a7a33" } : {}),
                  }}
                >
                  {kpi.value}
                </p>
                <p
                  className="text-xs text-gray-gray500 dark:text-gray-gray400 mt-2 text-center leading-tight font-medium uppercase tracking-wide"
                  style={{ fontSize: "0.6rem" }}
                >
                  {kpi.label}
                </p>
              </div>
            ))}
            {/* Configurable KPIs */}
            {spectacleKPIs.map((kpi, i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100
                                           dark:border-gray-gray600 flex flex-col justify-center items-center p-4"
              >
                <p
                  className="font-bold text-gray-gray800 dark:text-gray-gray100 font-display"
                  style={{ fontSize: "1.75rem", lineHeight: 1.1 }}
                >
                  {kpi.value || "—"}
                </p>
                <p
                  className="text-xs text-gray-gray500 dark:text-gray-gray400 mt-3 text-center leading-tight font-medium uppercase tracking-wide"
                  style={{ fontSize: "0.6rem" }}
                >
                  {kpi.label}
                </p>
              </div>
            ))}
            {/* Fill empty slots if fewer than 6 configurable KPIs */}
            {Array.from({ length: Math.max(0, 6 - spectacleKPIs.length) }).map(
              (_, i) => (
                <div
                  key={`empty-${i}`}
                  className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100
                                           dark:border-gray-gray600 flex flex-col justify-center items-center p-4 opacity-30"
                >
                  <p className="text-2xl font-bold text-gray-gray300">
                    {"—"}
                  </p>
                </div>
              ),
            )}
          </div>
        </div>
      </div>

      {/* Representations table */}
      <RepresentationsTable
        title="Representations"
        totalCount={representations.length}
        filteredReps={filteredReps}
        uniqueVilles={uniqueVilles}
        uniqueSalles={uniqueSalles}
        filterVille={filterVille}
        setFilterVille={setFilterVille}
        filterSalle={filterSalle}
        setFilterSalle={setFilterSalle}
        showAll={showAll}
        setShowAll={setShowAll}
        selectedRepIds={selectedRepIds}
        setSelectedRepIds={setSelectedRepIds}
        repRecords={repRecords}
        weekDeltas={weekDeltas}
      />
    </div>
  );
}
