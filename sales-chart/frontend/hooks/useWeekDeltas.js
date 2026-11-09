import { useEffect, useMemo, useState } from "react";
import { fetchSalesReport, hasSalesSource } from "../utils/salesReport";
import {
  computeWeekDeltas,
  lastCompleteDayBounds,
  lastCompleteWeekBounds,
} from "../utils/salesData";

// Per-rep deltas for the Vendus/Revenus (sem. / jour) table columns of the
// all-events page. `repIdsStr` = comma-joined record ids (stable dependency).
// Window: "7d" = last complete Mon→Mon week, "24h" = last complete day.
// Returns { recordId: { sold, revenue } }, {} while loading or without source.
export function useWeekDeltas(salesSource, repIdsStr, salesWindow = "7d") {
  const [salesRows, setSalesRows] = useState([]);

  useEffect(() => {
    if (!hasSalesSource(salesSource) || !repIdsStr) {
      setSalesRows([]);
      return;
    }
    let didCancel = false;
    const run = async () => {
      try {
        const rows = await fetchSalesReport(
          salesSource,
          repIdsStr.split(","),
          "record_id,date,sold,total",
          () => didCancel,
        );
        if (rows === null || didCancel) return;
        setSalesRows(rows);
      } catch {
        if (!didCancel) setSalesRows([]);
      }
    };
    run();
    return () => {
      didCancel = true;
    };
  }, [repIdsStr, salesSource]);

  return useMemo(() => {
    if (!salesRows.length) return {};
    const { start, end } =
      salesWindow === "24h" ? lastCompleteDayBounds() : lastCompleteWeekBounds();
    return computeWeekDeltas(salesRows, start, end);
  }, [salesRows, salesWindow]);
}
