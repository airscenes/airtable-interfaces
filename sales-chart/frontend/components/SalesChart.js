import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatDate } from "../utils/format";

// --- Custom X-axis tick with rotation ---

function CustomXAxisTick({ x, y, payload }) {
  const label = formatDate(payload.value);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{label}</title>
      <text
        x={0}
        y={0}
        dy={8}
        textAnchor="end"
        fill="#666"
        fontSize={10}
        transform="rotate(-45)"
      >
        {label}
      </text>
    </g>
  );
}

// --- Sales Chart Component ---

export function SalesChart({ data, capacity, revenueCapacity, zoom = false, height = 500 }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
          Aucune donnee de ventes pour cette representation.
        </p>
      </div>
    );
  }

  // The two axes are LOCKED together via the ACTUAL average ticket price
  // (revenue ÷ sold), so the revenue line lands exactly on the number of tickets
  // on the left axis — a "sold" line would trace the revenue line. The left
  // (tickets) axis spans 0→capacity; the right ($) axis spans 0→capacity×price
  // (= revenue if the hall sold out at the real average price). We don't use the
  // configured "Potentiel en salle" here because its implied price (potentiel ÷
  // capacity) often differs from what's actually realized. When capacity is
  // unknown (e.g. the aggregate "Total" view) we anchor on the max tickets seen
  // in the data so the lock still holds; revenueCapacity is a last-resort fallback.
  let price = null;
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].ventes > 0 && data[i].total_dollars > 0) {
      price = data[i].total_dollars / data[i].ventes;
      break;
    }
  }
  let capMax = capacity || null;
  if (!capMax) {
    let t = 0;
    for (const d of data) {
      if ((d.ventes || 0) > t) t = d.ventes || 0;
      if ((d.gratuits || 0) > t) t = d.gratuits || 0;
    }
    capMax = t || null;
  }
  // Crop the top down to 50% of capacity when the data never reaches that high,
  // so low-fill charts use more vertical space (but never crop past half — we
  // always keep at least the lower 50% of the hall visible for context). Only
  // applies when a real capacity is known; the right ($) axis is cropped in
  // lockstep so the two axes stay synced.
  let ticketTop = capMax;
  if (capacity && capMax && price != null) {
    let dataTickets = 0;
    for (const d of data) {
      const revTickets = (d.total_dollars || 0) / price; // revenue in ticket-equiv
      if (revTickets > dataTickets) dataTickets = revTickets;
      if ((d.gratuits || 0) > dataTickets) dataTickets = d.gratuits || 0;
    }
    if (dataTickets < capMax * 0.5) ticketTop = capMax * 0.5;
  }
  const ticketDomain = [0, ticketTop || "auto"];
  const dollarDomain = [
    0,
    price && ticketTop ? ticketTop * price : revenueCapacity || "auto",
  ];

  return (
    <div className="bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm">
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 40, bottom: 5, left: 40 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e8e8e8"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={<CustomXAxisTick />}
              interval="preserveStartEnd"
              height={50}
            />
            <YAxis
              yAxisId="billets"
              orientation="left"
              stroke="#cc0000"
              tick={{ fontSize: 10 }}
              allowDecimals={false}
              tickFormatter={(v) =>
                v >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v)
              }
              domain={ticketDomain}
              allowDataOverflow={zoom}
              padding={{ top: 20, bottom: 10 }}
              label={{
                value: "Nombre de billets",
                angle: -90,
                position: "insideLeft",
                offset: -25,
                style: { fontSize: 11, fill: "#cc0000", fontWeight: 600 },
              }}
            />
            <YAxis
              yAxisId="dollars"
              orientation="right"
              stroke="#6aa84f"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) =>
                `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} $`
              }
              domain={dollarDomain}
              allowDataOverflow={zoom}
              padding={{ top: 20, bottom: 10 }}
              label={{
                value: "Revenus ($)",
                angle: 90,
                position: "insideRight",
                offset: -25,
                style: { fontSize: 11, fill: "#6aa84f", fontWeight: 600 },
              }}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid #e0e0e0",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}
              labelFormatter={formatDate}
              formatter={(value, name, props) => {
                const isTickets =
                  props?.dataKey === "gratuits" || props?.dataKey === "ventes";
                const num = Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
                return [isTickets ? num : `${num} $`, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            {/* Invisible series: feeds the tooltip with "Billets vendus" without
                drawing a line or appearing in the legend. */}
            <Line
              yAxisId="billets"
              type="monotone"
              dataKey="ventes"
              name="Billets vendus"
              stroke="#333333"
              strokeWidth={0}
              dot={false}
              activeDot={false}
              legendType="none"
              isAnimationActive={false}
            />
            <Line
              yAxisId="billets"
              type="monotone"
              dataKey="gratuits"
              name="Billets gratuits"
              stroke="#cc0000"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              strokeDasharray="5 5"
            />
            <Line
              yAxisId="dollars"
              type="monotone"
              dataKey="total_dollars"
              name="Revenus ($)"
              stroke="#6aa84f"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              yAxisId="dollars"
              type="monotone"
              dataKey="objectif"
              name="Objectif ($)"
              stroke="#e69138"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              strokeDasharray="5 5"
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
