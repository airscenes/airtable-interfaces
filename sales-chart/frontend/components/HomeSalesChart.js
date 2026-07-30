import { useState, useMemo, useEffect, useRef } from "react";
import { PRESETS } from "../utils/constants";
import { aggregateSalesByDate } from "../utils/salesData";
import { SalesChart } from "./SalesChart";

// --- Home aggregate chart: total sales across every representation ---

export function HomeSalesChart({ repIds, supabaseUrl, supabaseAnonKey, baseId }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const cacheRef = useRef(new Map());
  const idsStr = useMemo(() => [...repIds].sort().join(","), [repIds]);

  // Note: dateFrom/dateTo above default to empty (full range) for the global
  // overview; the 7-day default is applied to the per-spectacle detail chart.

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey || !idsStr) {
      setData([]);
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    const cacheKey = `home_${baseId}_${today}_${refreshKey}`;
    let didCancel = false;

    const run = async () => {
      if (cacheRef.current.has(cacheKey)) {
        if (!didCancel) {
          setData(cacheRef.current.get(cacheKey));
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const ids = idsStr.split(",");
        // Chunk the IN() filter so URLs stay within server limits.
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
            `&select=record_id,date,sold,free,total`;
          let offset = 0;
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
            rows = rows.concat(page);
            if (page.length < pageSize) break;
            offset += pageSize;
            if (didCancel) return;
          }
        }
        if (didCancel) return;
        const formatted = aggregateSalesByDate(rows);
        cacheRef.current.set(cacheKey, formatted);
        setData(formatted);
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
  }, [idsStr, supabaseUrl, supabaseAnonKey, baseId, refreshKey]);

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

  const filteredData = useMemo(() => {
    if (!data.length) return data;
    let d = data;
    if (dateFrom) d = d.filter((x) => x.date >= dateFrom);
    if (dateTo) d = d.filter((x) => x.date <= dateTo);
    if (d.length === 1 && dateTo && d[0].date !== dateTo) {
      d = [...d, { ...d[0], date: dateTo, dateLabel: dateTo }];
    }
    return d;
  }, [data, dateFrom, dateTo]);

  // Delta between the point just before the range and the last point in range.
  const periodStats = useMemo(() => {
    if (filteredData.length < 1) return null;
    const first = filteredData[0];
    const last = filteredData[filteredData.length - 1];
    const baseIndex = data.indexOf(first);
    const baseRow =
      baseIndex > 0 ? data[baseIndex - 1] : { ventes: 0, total_dollars: 0 };
    return {
      ventesInPeriod: last.ventes - baseRow.ventes,
      revenusInPeriod: last.total_dollars - baseRow.total_dollars,
    };
  }, [filteredData, data]);

  const hasFilter = !!(dateFrom || dateTo);
  const kpis = useMemo(() => {
    if (!data.length)
      return [
        { value: "—", label: "Billets vendus" },
        { value: "—", label: "Revenus" },
      ];
    const last =
      filteredData.length > 0
        ? filteredData[filteredData.length - 1]
        : data[data.length - 1];
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
      { value: last.ventes.toLocaleString("fr-FR"), label: "Billets vendus" },
      {
        value: `${last.total_dollars.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $`,
        label: "Revenus",
      },
    ];
  }, [data, filteredData, hasFilter, periodStats]);

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

  const btnBase = "px-2 py-0.5 rounded text-xs font-medium transition-colors";
  const btnActive = "bg-blue-blue text-white";
  const btnInactive =
    "bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray200 dark:hover:bg-gray-gray500";

  return (
    <div>
      {/* Filter bar + dynamic KPIs */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`${btnBase} ${activePreset === p.key ? btnActive : btnInactive}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {kpis.map((k, i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100 dark:border-gray-gray600 flex flex-col items-center justify-center px-4 py-2"
              style={{
                minWidth: 120,
                ...(k.colored
                  ? { borderColor: i === 0 ? "#3b82f6" : "#4a7a33", borderWidth: 2 }
                  : {}),
              }}
            >
              <span
                className="font-bold font-display text-gray-gray800 dark:text-gray-gray100"
                style={{
                  fontSize: "1.25rem",
                  lineHeight: 1.1,
                  ...(k.colored ? { color: i === 0 ? "#3b82f6" : "#4a7a33" } : {}),
                }}
              >
                {k.value}
              </span>
              <span
                className="text-gray-gray500 dark:text-gray-gray400 uppercase tracking-wide mt-0.5"
                style={{ fontSize: "0.55rem", fontWeight: 500 }}
              >
                {k.label}
              </span>
            </div>
          ))}
          <button
            onClick={() => {
              cacheRef.current.clear();
              setRefreshKey((k) => k + 1);
            }}
            title="Rafraîchir les données"
            className={`${btnBase} ${btnInactive}`}
          >
            ↺
          </button>
        </div>
      </div>

      {loading ? (
        <div
          className="bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm flex items-center justify-center"
          style={{ height: 300 }}
        >
          <div className="flex items-center space-x-3 text-gray-gray500">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-blue"></div>
            <span className="text-sm">Chargement...</span>
          </div>
        </div>
      ) : error ? (
        <div className="bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm text-sm text-red-red dark:text-red-redLight1">
          {error}
        </div>
      ) : (
        <SalesChart data={filteredData} zoom={hasFilter} height={280} />
      )}
    </div>
  );
}
