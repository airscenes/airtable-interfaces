import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatDate } from "../utils/format";

// --- Daily sales bar chart (home page only) ---
// data: [{ date, ventes, revenus }] from dailySalesSeries — one bar per day,
// tickets sold that day; the day's revenue is shown in the tooltip.

function DailyTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div
      className="bg-white dark:bg-gray-gray700 text-gray-gray700 dark:text-gray-gray200"
      style={{
        fontSize: 12,
        borderRadius: 8,
        border: "1px solid #e0e0e0",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        padding: "6px 10px",
      }}
    >
      <div className="font-semibold mb-0.5">{formatDate(label)}</div>
      <div>Billets vendus : {d.ventes.toLocaleString("fr-FR")}</div>
      <div>
        Revenus :{" "}
        {d.revenus != null
          ? `${d.revenus.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $`
          : "—"}
      </div>
    </div>
  );
}

export function DailySalesChart({ data, height = 280 }) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm flex items-center justify-center h-48">
        <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
          Aucune donnée de ventes pour cette période.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm">
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 10, fill: "#888" }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#888" }}
              allowDecimals={false}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)}
              label={{
                value: "Billets vendus",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "#888" },
              }}
            />
            <Tooltip
              content={<DailyTooltip />}
              cursor={{ fill: "rgba(59,130,246,0.1)" }}
            />
            <Bar dataKey="ventes" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={40} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
