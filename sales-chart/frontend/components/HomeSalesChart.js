import { useState, useMemo, useEffect, useRef } from "react";
import { HOME_PRESETS as PRESETS } from "../utils/constants";
import { aggregateSalesByDate, dailySalesSeries } from "../utils/salesData";
import { fetchSalesReport, hasSalesSource, salesSourceKey } from "../utils/salesReport";
import { DailySalesChart } from "./DailySalesChart";

// --- Home overview: daily sales across every representation ---
// Bars = tickets sold per day (DailySalesChart). The spectacle / event pages
// keep the cumulative SalesChart. `data` (cumulative) only feeds the overall
// KPIs when no period is selected.

export function HomeSalesChart({ repIds, salesSource }) {
  const [data, setData] = useState([]);
  const [daily, setDaily] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Default range: the last 3 months (same bounds as the "3m" preset: dateFrom
  // = 3 months ago, dateTo empty). The spectacle pages keep their own default.
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [dateTo, setDateTo] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const cacheRef = useRef(new Map());
  const idsStr = useMemo(() => [...repIds].sort().join(","), [repIds]);

  const sourceKey = salesSourceKey(salesSource);

  useEffect(() => {
    if (!hasSalesSource(salesSource) || !idsStr) {
      setData([]);
      setDaily([]);
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    const cacheKey = `home_${sourceKey}_${today}_${refreshKey}`;
    let didCancel = false;

    const run = async () => {
      if (cacheRef.current.has(cacheKey)) {
        if (!didCancel) {
          const cached = cacheRef.current.get(cacheKey);
          setData(cached.cumulative);
          setDaily(cached.daily);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchSalesReport(
          salesSource,
          idsStr.split(","),
          "record_id,date,sold,free,total",
          () => didCancel,
        );
        if (rows === null || didCancel) return;
        const cumulative = aggregateSalesByDate(rows);
        const dailyRows = dailySalesSeries(rows);
        cacheRef.current.set(cacheKey, { cumulative, daily: dailyRows });
        setData(cumulative);
        setDaily(dailyRows);
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
  }, [idsStr, salesSource, sourceKey, refreshKey]);

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

  const filteredDaily = useMemo(() => {
    let d = daily;
    if (dateFrom) d = d.filter((x) => x.date >= dateFrom);
    if (dateTo) d = d.filter((x) => x.date <= dateTo);
    return d;
  }, [daily, dateFrom, dateTo]);

  // Period KPIs = sum of the bars in range, so they always match the chart.
  const periodStats = useMemo(() => {
    if (filteredDaily.length < 1) return null;
    let ventesInPeriod = 0;
    let revenusInPeriod = 0;
    for (const d of filteredDaily) {
      ventesInPeriod += d.ventes;
      revenusInPeriod += d.revenus || 0;
    }
    return { ventesInPeriod, revenusInPeriod };
  }, [filteredDaily]);

  const hasFilter = !!(dateFrom || dateTo);
  const kpis = useMemo(() => {
    if (!data.length)
      return [
        { value: "—", label: "Billets vendus" },
        { value: "—", label: "Revenus" },
      ];
    const last = data[data.length - 1];
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
  }, [data, hasFilter, periodStats]);

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
        <DailySalesChart data={filteredDaily} height={280} />
      )}
    </div>
  );
}
