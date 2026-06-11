import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  initializeBlock,
  useBase,
  useRecords,
  useCustomProperties,
  useGlobalConfig,
  expandRecord,
} from "@airtable/blocks/interface/ui";
import { FieldType } from "@airtable/blocks/interface/models";
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
import "./style.css";

// --- Helper: format ISO timestamp to "15 fev" ---

const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "avr",
  "mai",
  "jun",
  "jul",
  "aou",
  "sep",
  "oct",
  "nov",
  "dec",
];

// Date range presets: `days` or `months` = offset back from now.
// Day-based presets also pin dateTo to "now" so short ranges render a line.
const PRESETS = [
  { key: "24h", label: "24h", days: 1 },
  { key: "72h", label: "72h", days: 3 },
  { key: "7d", label: "7j", days: 7 },
  { key: "1m", label: "1m", months: 1 },
  { key: "3m", label: "3m", months: 3 },
  { key: "all", label: "Tout" },
];

// Default visible window: last 7 days (matches the "7j" preset). Used as the
// initial date filter so charts open zoomed on recent weekly variation.
function defaultDateRange() {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  return { from: iso(from), to: iso(now) };
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length < 3) return isoDate;
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${day} ${MONTHS_SHORT[month]}`;
}

// --- Number/currency formatters (fr-FR locale) ---

const fmtNumber = (v) =>
  v == null || (typeof v === "number" && isNaN(v)) ? "—" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });

const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v)) ? "—" : `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $`;

// --- Airtable single-select color palette ---

const AIRTABLE_COLORS = {
  blueBright:   { bg: "#2d7ff9", text: "#fff" },
  blueLight1:   { bg: "#9cc7ff", text: "#333" },
  blueLight2:   { bg: "#cfdfff", text: "#333" },
  cyanBright:   { bg: "#18bfff", text: "#fff" },
  cyanLight1:   { bg: "#77d1f3", text: "#333" },
  cyanLight2:   { bg: "#d0f0fd", text: "#333" },
  tealBright:   { bg: "#20d9d2", text: "#fff" },
  tealLight1:   { bg: "#72ddc3", text: "#333" },
  tealLight2:   { bg: "#c2f5e9", text: "#333" },
  greenBright:  { bg: "#20c933", text: "#fff" },
  greenLight1:  { bg: "#93e088", text: "#333" },
  greenLight2:  { bg: "#d1f7c4", text: "#333" },
  yellowBright: { bg: "#fcb400", text: "#333" },
  yellowLight1: { bg: "#ffd66e", text: "#333" },
  yellowLight2: { bg: "#ffeab6", text: "#333" },
  orangeBright: { bg: "#ff6f2c", text: "#fff" },
  orangeLight1: { bg: "#ffaa57", text: "#333" },
  orangeLight2: { bg: "#fee2d5", text: "#333" },
  redBright:    { bg: "#f82b60", text: "#fff" },
  redLight1:    { bg: "#ff9eb7", text: "#333" },
  redLight2:    { bg: "#ffdce5", text: "#333" },
  pinkBright:   { bg: "#ff08c2", text: "#fff" },
  pinkLight1:   { bg: "#f99de2", text: "#333" },
  pinkLight2:   { bg: "#ffdaf6", text: "#333" },
  purpleBright: { bg: "#8b46ff", text: "#fff" },
  purpleLight1: { bg: "#cdb0ff", text: "#333" },
  purpleLight2: { bg: "#ede2fe", text: "#333" },
  grayBright:   { bg: "#666666", text: "#fff" },
  gray:         { bg: "#aaaaaa", text: "#fff" },
};

// --- Custom Properties Definition ---

function getCustomProperties(base, selectedSpectaclesTableId, selectedRepsTableId) {
  const tables = base.tables;
  const heuristicSpectacles =
    tables.find((t) => t.name.toLowerCase().includes("projet")) ||
    tables.find((t) => t.name.toLowerCase().includes("spectacle")) ||
    tables[0];
  const heuristicReps =
    tables.find((t) => t.name.toLowerCase().includes("repr")) ||
    tables.find((t) => t.name.toLowerCase().includes("événement") || t.name.toLowerCase().includes("evenement") || t.name.toLowerCase().includes("event")) ||
    tables.find((t) => t !== heuristicSpectacles) ||
    tables[1] ||
    tables[0];
  const spectaclesTable =
    (selectedSpectaclesTableId && base.getTableByIdIfExists(selectedSpectaclesTableId)) ||
    heuristicSpectacles;
  const repsTable =
    (selectedRepsTableId && base.getTableByIdIfExists(selectedRepsTableId)) ||
    heuristicReps;

  const isLinkOrLookupField = (field) => {
    const t = field.config.type;
    return (
      t === FieldType.MULTIPLE_RECORD_LINKS ||
      t === FieldType.MULTIPLE_LOOKUP_VALUES ||
      t === "lookup"
    );
  };

  const isNumericField = (field) =>
    field.config.type === FieldType.NUMBER ||
    field.config.type === FieldType.CURRENCY ||
    field.config.type === FieldType.FORMULA ||
    field.config.type === FieldType.ROLLUP ||
    field.config.type === FieldType.COUNT ||
    field.config.type === FieldType.PERCENT ||
    field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

  const isTextField = (field) =>
    field.config.type === FieldType.SINGLE_LINE_TEXT ||
    field.config.type === FieldType.SINGLE_SELECT ||
    field.config.type === FieldType.FORMULA ||
    field.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
    field.config.type === FieldType.ROLLUP ||
    field.config.type === FieldType.AUTO_NUMBER ||
    field.config.type === FieldType.DATE ||
    field.config.type === FieldType.DATE_TIME;

  const isAnyField = () => true;

  return [
    {
      key: "spectaclesTable",
      label: "Table des projets",
      type: "table",
    },
    {
      key: "imageField",
      label: "Champ image (dans Projets)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "cardSubtitleField",
      label: "Champ sous-titre carte (dans Projets)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "cardColorField",
      label: "Champ couleur carte (single select, dans Projets)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "representationsTable",
      label: "Table des evenements",
      type: "table",
    },
    {
      key: "spectacleLinkField",
      label: "Champ lien ou lookup vers Projet/Spectacle (dans Evenements)",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isLinkOrLookupField,
    },
    {
      key: "repNameField",
      label: "Champ nom/date de l'evenement",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isTextField,
    },
    {
      key: "capacityField",
      label: "Champ Capacite totale (dans Evenements)",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isNumericField,
    },
    {
      key: "revenuePotentialField",
      label: "Champ Potentiel en salle (dans Evenements)",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isNumericField,
    },
    // --- Table columns (Representations) ---
    {
      key: "colJoursRestants",
      label: "Colonne: Jours restants",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colDateRep",
      label: "Colonne: Date evenement",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colSalle",
      label: "Colonne: Salle",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colVille",
      label: "Colonne: Ville",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colPlacesBloques",
      label: "Colonne: Places bloquees",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colBilletsDispo",
      label: "Colonne: Billets disponibles",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    // --- KPIs (Spectacles) ---
    {
      key: "kpiField1",
      label: "KPI: Nombre evenements",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
    },
    {
      key: "kpiField2",
      label: "KPI: Nombre evenements a venir",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
    },
    {
      key: "kpiField3",
      label: "KPI: Billets vendus",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
    },
    {
      key: "kpiField4",
      label: "KPI: Billets disponibles",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
    },
    {
      key: "kpiField5",
      label: "KPI: Objectif",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
    },
    {
      key: "kpiField6",
      label: "KPI: Revenus totaux",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
    },
    // --- Additional table columns (Representations) ---
    {
      key: "colTotalBilletsVendus",
      label: "Colonne: Total de billets vendus",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colTotalBilletsGratuits",
      label: "Colonne: Total de billets gratuits",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colAssistance",
      label: "Colonne: Assistance a ce jour",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colTauxRemplissage",
      label: "Colonne: Taux de remplissage",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colRevenus",
      label: "Colonne: Revenus totaux de billetterie",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colStatutRapport",
      label: "Colonne: Statut rapport",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colObjectifRevenus",
      label: "Colonne: Objectif revenus producteur",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colMiseAJour",
      label: "Colonne: Mise a jour des ventes",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colPriorisation",
      label: "Colonne: Priorisation Salles (SALLES)",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colBilleterieSalle",
      label: "Colonne: Billetterie Salle",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colNote",
      label: "Colonne: Note",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colStatut",
      label: "Colonne: Statut",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "colSiteWeb",
      label: "Colonne: Site web",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
    },
    // --- Supabase ---
    {
      key: "supabaseUrl",
      label: "Supabase URL (ex: https://xyz.supabase.co)",
      type: "string",
      defaultValue: "",
    },
    {
      key: "supabaseAnonKey",
      label: "Supabase Anon Key",
      type: "string",
      defaultValue: "",
    },
  ];
}

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

// Aggregate raw sales_report rows into one cumulative point per calendar day.
// Cumulative values never decrease (Math.max); each record carries its last
// known value forward to fill gap days. String-based date math avoids UTC shift.
function aggregateSalesByDate(rows) {
  const byRecord = {};
  const allDatesSet = new Set();
  rows.forEach((row) => {
    const rid = row.record_id;
    const day = row.date ? row.date.split("T")[0] : row.date;
    allDatesSet.add(day);
    if (!byRecord[rid]) byRecord[rid] = {};
    byRecord[rid][day] = {
      sold: row.sold || 0,
      free: row.free || 0,
      total: parseFloat(row.total) || 0,
    };
  });
  const sortedDates = [...allDatesSet].sort();
  if (sortedDates.length === 0) return [];
  const recordIds = Object.keys(byRecord);
  const nextDay = (dateStr) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  const lastKnown = {};
  const formatted = [];
  for (
    let day = sortedDates[0];
    day <= sortedDates[sortedDates.length - 1];
    day = nextDay(day)
  ) {
    let sumSold = 0,
      sumFree = 0,
      sumTotal = 0;
    for (const rid of recordIds) {
      if (byRecord[rid] && byRecord[rid][day]) {
        const entry = byRecord[rid][day];
        if (!lastKnown[rid]) lastKnown[rid] = { sold: 0, free: 0, total: 0 };
        lastKnown[rid].sold = Math.max(lastKnown[rid].sold, entry.sold);
        lastKnown[rid].free = Math.max(lastKnown[rid].free, entry.free);
        lastKnown[rid].total = Math.max(lastKnown[rid].total, entry.total);
      }
      if (lastKnown[rid]) {
        sumSold += lastKnown[rid].sold;
        sumFree += lastKnown[rid].free;
        sumTotal += lastKnown[rid].total;
      }
    }
    formatted.push({
      date: day,
      dateLabel: formatDate(day),
      ventes: sumSold,
      gratuits: sumFree,
      total_dollars: sumTotal,
    });
  }
  return formatted;
}

// Bounds of the last *complete* Monday→Monday week relative to `ref`:
// end = most recent Monday on/before `ref`, start = the Monday before that.
function lastCompleteWeekBounds(ref = new Date()) {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  const end = new Date(d);
  end.setDate(d.getDate() - dow);
  const start = new Date(end);
  start.setDate(end.getDate() - 7);
  return { start: iso(start), end: iso(end) };
}

// Per-representation weekly deltas. rows: [{ record_id, date, sold, total }].
// - sold delta = cumulative `sold` at endISO minus at startISO (running max; sold
//   is maintained live).
// - revenue = sold delta × net unit price, where net price = avg(total/sold) over
//   rows that have both filled. We DON'T use the `total` delta: `total` is filled
//   by a manual batch script (calculate-totals.mjs) so recent rows are 0/NULL and
//   would crush the weekly revenue to ~0. Pricing the sold delta mirrors that
//   same backfill logic (total = sold × prix_effectif) and stays reliable.
// Returns { recordId: { sold, revenue } } (revenue null when no price is known).
function computeWeekDeltas(rows, startISO, endISO) {
  const byRec = {};
  for (const r of rows) {
    const day = r.date ? r.date.split("T")[0] : r.date;
    (byRec[r.record_id] = byRec[r.record_id] || []).push({
      day,
      sold: Number(r.sold) || 0,
      total: parseFloat(r.total) || 0,
    });
  }
  const out = {};
  for (const rid in byRec) {
    const list = byRec[rid].sort((a, b) => a.day.localeCompare(b.day));
    // Cumulative sold at a bound = running max over rows on/before it.
    const soldAt = (target) => {
      let sold = 0;
      for (const e of list) {
        if (e.day > target) break;
        if (e.sold > sold) sold = e.sold;
      }
      return sold;
    };
    const soldDelta = soldAt(endISO) - soldAt(startISO);
    // Net unit price = avg(total/sold) over rows where both are positive.
    let ratioSum = 0;
    let ratioCount = 0;
    for (const e of list) {
      if (e.total > 0 && e.sold > 0) {
        ratioSum += e.total / e.sold;
        ratioCount += 1;
      }
    }
    const prixNet = ratioCount > 0 ? ratioSum / ratioCount : null;
    out[rid] = {
      sold: soldDelta,
      revenue: prixNet != null ? soldDelta * prixNet : null,
    };
  }
  return out;
}

// Synthesize a cumulative budget-target curve over the given sorted ISO dates:
// a single convex (accelerating) ramp from 0 at the first date to totalObjective
// at the last date (right edge / today). Returns { isoDate: value }.
const OBJECTIVE_ACCEL = 2.2; // >1 = slow start, accelerating toward the right edge
function buildObjectiveSeries(dates, totalObjective) {
  const out = {};
  if (!dates.length || !totalObjective) return out;
  const dayMs = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const startMs = dayMs(dates[0]);
  const span = dayMs(dates[dates.length - 1]) - startMs;
  for (const iso of dates) {
    const frac = span > 0 ? (dayMs(iso) - startMs) / span : 1;
    const eased = frac <= 0 ? 0 : frac >= 1 ? 1 : Math.pow(frac, OBJECTIVE_ACCEL);
    out[iso] = totalObjective * eased;
  }
  return out;
}

// Fit an axis to [min, max] with a 5% margin so the line stays off the edges.
// Falls back to a small fixed pad when the range is flat (single value).
function padDomain(min, max) {
  if (!isFinite(min) || !isFinite(max)) return [0, "auto"];
  // Keep the floor at 0 when the data is non-negative (revenue/objective never
  // go below 0); only allow a negative lower bound if the data itself is.
  const floor = (lo) => (min >= 0 ? Math.max(0, lo) : lo);
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    return [floor(min - pad), max + pad];
  }
  const margin = (max - min) * 0.05;
  return [floor(min - margin), max + margin];
}

function SalesChart({ data, capacity, revenueCapacity, zoom = false, height = 500 }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
          Aucune donnee de ventes pour cette representation.
        </p>
      </div>
    );
  }

  // Single $ axis shared by real revenue and the budget-target curve.
  // Full view: 0→auto. When a date filter is active (zoom), fit the axis to the
  // visible range of BOTH curves so the objective ramp stays fully on-screen
  // (no clipping) while revenue variation is still emphasized. On charts without
  // an objective (e.g. the global overview) only revenue drives the bounds.
  let dollarDomain = [0, "auto"];
  if (zoom) {
    let lo = Infinity, hi = -Infinity;
    for (const d of data) {
      for (const v of [d.total_dollars, d.objectif]) {
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (isFinite(lo)) dollarDomain = padDomain(lo, hi);
  }

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
              yAxisId="dollars"
              orientation="left"
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
                angle: -90,
                position: "insideLeft",
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
              formatter={(value, name) => [
                `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $`,
                name,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
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

// --- Home aggregate chart: total sales across every representation ---

function HomeSalesChart({ repIds, supabaseUrl, supabaseAnonKey, baseId }) {
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

// --- Gallery Card ---

function getInitials(name) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

function SpectacleCard({ name, subtitle, imageUrl, placeholderColor, onClick }) {
  const initials = getInitials(name);
  const bgColor = placeholderColor || "#666666";

  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm overflow-hidden cursor-pointer
                       hover:shadow-md transition-shadow duration-200 border border-gray-gray100 dark:border-gray-gray600"
    >
      <div
        className="w-full"
        style={{ height: 160, overflow: "hidden" }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            className="flex items-center justify-center h-full"
            style={{ backgroundColor: bgColor }}
          >
            <span style={{ fontSize: 40, fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: 2 }}>
              {initials}
            </span>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-gray-gray700 dark:text-gray-gray200 truncate">
          {name}
        </p>
        {subtitle && (
          <p className="text-xs text-gray-gray400 dark:text-gray-gray500 truncate mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// --- Select field helper (returns { text, color }) ---

function getFieldChoices(field, base) {
  if (!field) return null;
  try {
    const { type, options } = field.config;
    if (type === FieldType.SINGLE_SELECT || type === FieldType.MULTIPLE_SELECTS) {
      return options?.choices || null;
    }
    if (type === FieldType.MULTIPLE_LOOKUP_VALUES) {
      // Try embedded result choices first
      const direct = options?.result?.options?.choices;
      if (direct) return direct;
      // Traverse to the linked table to find the source field's choices
      if (base && options?.recordLinkFieldId && options?.fieldIdInLinkedTable) {
        for (const table of base.tables) {
          const linkField = table.fields?.find((f) => f.id === options.recordLinkFieldId);
          const linkedTableId = linkField?.config?.options?.linkedTableId;
          if (linkedTableId) {
            const linkedTable = base.tables.find((t) => t.id === linkedTableId);
            const sourceField = linkedTable?.fields?.find((f) => f.id === options.fieldIdInLinkedTable);
            const choices = sourceField?.config?.options?.choices;
            if (choices) return choices;
          }
        }
      }
    }
  } catch { /* field config unavailable */ }
  return null;
}

function safeCellValue(record, field) {
  if (!field) return null;
  try { return record.getCellValue(field); } catch { return null; }
}

// Normalizes a MULTIPLE_RECORD_LINKS or MULTIPLE_LOOKUP_VALUES (of a link)
// cell value into a flat [{id, name}, ...] array.
function extractLinkedRecords(cellValue) {
  if (!Array.isArray(cellValue)) return [];
  const out = [];
  for (const item of cellValue) {
    if (!item) continue;
    if (item.id) {
      out.push({ id: item.id, name: item.name });
      continue;
    }
    if (item.value) {
      if (Array.isArray(item.value)) {
        for (const v of item.value) {
          if (v && v.id) out.push({ id: v.id, name: v.name });
        }
      } else if (item.value.id) {
        out.push({ id: item.value.id, name: item.value.name });
      }
    }
  }
  return out;
}
function safeCellString(record, field) {
  if (!field) return "";
  try { return record.getCellValueAsString(field); } catch { return ""; }
}

function getColSelect(record, field, base) {
  if (!field) return { text: "", color: null };
  const raw = safeCellValue(record, field);
  // Single-select: { id, name, color }
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.name) {
    return { text: raw.name, color: raw.color || null };
  }
  // Multiselect or lookup returning [{ id, name, color }, ...]
  if (Array.isArray(raw) && raw.length > 0 && raw[0]?.name) {
    return { text: raw[0].name, color: raw[0].color || null };
  }
  // Lookup returning plain strings — resolve color via field choices
  const text = safeCellString(record, field);
  if (text) {
    const choices = getFieldChoices(field, base);
    if (choices) {
      const match = choices.find((c) => c.name === text);
      if (match?.color) return { text, color: match.color };
    }
  }
  return { text, color: null };
}

// --- SelectBadge: renders a colored pill for single-select values ---

function SelectBadge({ value }) {
  if (!value || !value.text) return <span className="text-gray-gray400">—</span>;
  const palette = value.color ? AIRTABLE_COLORS[value.color] : null;
  if (!palette) return <span>{value.text}</span>;
  return (
    <span style={{ backgroundColor: palette.bg, color: palette.text, padding: "1px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", display: "inline-block" }}>
      {value.text}
    </span>
  );
}

// --- Shared sort: chronological by event date, then name ---

function sortRepsByDate(reps) {
  return [...reps].sort((a, b) => {
    if (a.rawDate && b.rawDate) return a.rawDate - b.rawDate;
    if (a.rawDate) return -1;
    if (b.rawDate) return 1;
    return a.name.localeCompare(b.name, "fr");
  });
}

// --- Shared status/city/venue filtering for the events table ---
// Used by both the per-spectacle detail page and the global all-events page.
function useRepFilters(representations) {
  const [showAll, setShowAll] = useState(false);
  const [filterVille, setFilterVille] = useState("");
  const [filterSalle, setFilterSalle] = useState("");

  // Default filters: Statut = Confirmé/En vente, Site Web = En ligne, Date >= today
  const filteredByStatus = useMemo(() => {
    if (showAll) return representations;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return representations.filter((rep) => {
      if (rep.rawDate && rep.rawDate < today) return false;
      if (rep.rawStatus && rep.rawStatus.toLowerCase() !== "confirmé" && rep.rawStatus.toLowerCase() !== "en vente") return false;
      if (rep.colSiteWeb?.text && rep.colSiteWeb.text.toLowerCase() !== "en ligne") return false;
      if (rep.rawOnSale !== null && !rep.rawOnSale) return false;
      return true;
    });
  }, [representations, showAll]);

  const uniqueVilles = useMemo(() => {
    const set = new Set(filteredByStatus.map((r) => r.colVille).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [filteredByStatus]);

  const uniqueSalles = useMemo(() => {
    const set = new Set(filteredByStatus.map((r) => r.colSalle).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [filteredByStatus]);

  const filteredReps = useMemo(() => {
    let reps = filteredByStatus;
    if (filterVille) reps = reps.filter((r) => r.colVille === filterVille);
    if (filterSalle) reps = reps.filter((r) => r.colSalle === filterSalle);
    return reps;
  }, [filteredByStatus, filterVille, filterSalle]);

  // Reset stale filters when options change
  useEffect(() => {
    if (filterVille && !uniqueVilles.includes(filterVille)) setFilterVille("");
    if (filterSalle && !uniqueSalles.includes(filterSalle)) setFilterSalle("");
  }, [uniqueVilles, uniqueSalles, filterVille, filterSalle]);

  return {
    showAll, setShowAll,
    filterVille, setFilterVille,
    filterSalle, setFilterSalle,
    uniqueVilles, uniqueSalles,
    filteredReps,
  };
}

// --- Shared events table (header + filters + table card) ---
// Selection (checkbox column + row click) is enabled only when setSelectedRepIds
// is provided. showSpectacleCol adds a "Spectacle" column for the mixed all-events
// view where rows span multiple shows.
// Export the table rows (already filtered) to a CSV matching the displayed
// columns. Semicolon-delimited + comma decimals + UTF-8 BOM for French Excel.
function downloadRepsCsv(reps, weekDeltas, showSpectacleCol, title) {
  const num = (v) =>
    v == null || (typeof v === "number" && isNaN(v)) ? "" : String(v).replace(".", ",");
  const sel = (v) => (v && v.text) || "";
  const columns = [
    ...(showSpectacleCol ? [["Spectacle", (r) => r.spectacleName || ""]] : []),
    ["J. restants", (r) => r.colJoursRestants || ""],
    ["Date", (r) => r.colDateRep || ""],
    ["Salle", (r) => r.colSalle || ""],
    ["Ville", (r) => r.colVille || ""],
    ["Capacite", (r) => num(r.colCapacite)],
    ["Places bloquees", (r) => num(r.colPlacesBloques)],
    ["Billets dispo", (r) => num(r.colBilletsDispo)],
    ["Total vendus", (r) => num(r.colTotalBilletsVendus)],
    ["Total gratuits", (r) => num(r.colTotalBilletsGratuits)],
    ["Vendus (sem.)", (r) => num(weekDeltas[r.id]?.sold)],
    ["Revenus (sem.)", (r) => num(weekDeltas[r.id]?.revenue)],
    ["Assistance", (r) => num(r.colAssistance)],
    ["Taux remplissage (%)", (r) => (r.colTauxRemplissage != null ? num(Math.round(r.colTauxRemplissage * 100)) : "")],
    ["Revenus billetterie", (r) => num(r.colRevenus)],
    ["Statut rapport", (r) => sel(r.colStatutRapport)],
    ["Objectif revenus", (r) => num(r.colObjectifRevenus)],
    ["Mise a jour", (r) => sel(r.colMiseAJour)],
    ["Priorisation", (r) => sel(r.colPriorisation)],
    ["Billetterie Salle", (r) => sel(r.colBilleterieSalle)],
    ["Note", (r) => sel(r.colNote)],
    ["Statut", (r) => sel(r.colStatut)],
    ["Site web", (r) => sel(r.colSiteWeb)],
  ];
  const esc = (s) => {
    const str = String(s ?? "");
    return /[";\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [columns.map((c) => esc(c[0])).join(";")];
  for (const r of reps) lines.push(columns.map((c) => esc(c[1](r))).join(";"));
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(title || "representations").toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function RepresentationsTable({
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
  const minWidth = (showSpectacleCol ? 1780 : 1600) + 180;
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
            Afficher tout
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
        <div style={{ overflowX: "auto" }}>
          <table className="w-full text-sm text-gray-gray700 dark:text-gray-gray200" style={{ minWidth }}>
            <thead>
              <tr className="bg-gray-gray75 dark:bg-gray-gray800 text-gray-gray600 dark:text-gray-gray300 text-left text-xs">
                {selectable && (
                  <th className="px-3 py-2 w-8">
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
                {showSpectacleCol && <th className="px-3 py-2 font-semibold">Spectacle</th>}
                <th className="px-3 py-2 font-semibold">J. restants</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Salle</th>
                <th className="px-3 py-2 font-semibold">Ville</th>
                <th className="px-3 py-2 font-semibold text-right">Capacite</th>
                <th className="px-3 py-2 font-semibold text-right">Places bloq.</th>
                <th className="px-3 py-2 font-semibold text-right">Billets dispo</th>
                <th className="px-3 py-2 font-semibold text-right">Total vendus</th>
                <th className="px-3 py-2 font-semibold text-right">Total gratuits</th>
                <th className="px-3 py-2 font-semibold text-right" title="Dernière semaine complète (lundi → lundi)">Vendus (sem.)</th>
                <th className="px-3 py-2 font-semibold text-right" title="Dernière semaine complète (lundi → lundi)">Revenus (sem.)</th>
                <th className="px-3 py-2 font-semibold text-right">Assistance</th>
                <th className="px-3 py-2 font-semibold" style={{ minWidth: 120 }}>Taux remplissage</th>
                <th className="px-3 py-2 font-semibold text-right">Revenus billetterie</th>
                <th className="px-3 py-2 font-semibold">Statut rapport</th>
                <th className="px-3 py-2 font-semibold text-right">Objectif revenus</th>
                <th className="px-3 py-2 font-semibold">Mise a jour</th>
                <th className="px-3 py-2 font-semibold">Priorisation</th>
                <th className="px-3 py-2 font-semibold">Billetterie Salle</th>
                <th className="px-3 py-2 font-semibold">Note</th>
                <th className="px-3 py-2 font-semibold">Statut</th>
                <th className="px-3 py-2 font-semibold">Site web</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filteredReps.map((rep) => (
                <tr
                  key={rep.id}
                  onClick={
                    selectable
                      ? () => {
                          setSelectedRepIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(rep.id)) {
                              next.delete(rep.id);
                            } else {
                              next.add(rep.id);
                            }
                            return next;
                          });
                        }
                      : undefined
                  }
                  className={`border-t border-gray-gray100 dark:border-gray-gray600 transition-colors
                              ${selectable ? "cursor-pointer" : ""}
                              ${
                                selectable && selectedRepIds.has(rep.id)
                                  ? "bg-blue-blueLight3 dark:bg-blue-blueDark1 font-medium"
                                  : "hover:bg-gray-gray25 dark:hover:bg-gray-gray600"
                              }`}
                >
                  {selectable && (
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedRepIds.has(rep.id)}
                        onClick={(e) => e.stopPropagation()}
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
                  <td className="px-3 py-2">{rep.colDateRep}</td>
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
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const record =
                          repRecords &&
                          repRecords.find((r) => r.id === rep.id);
                        if (record) expandRecord(record);
                      }}
                      className="text-gray-gray400 hover:text-blue-blue dark:hover:text-blue-blueLight1 transition-colors"
                      title="Ouvrir le detail"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </button>
                  </td>
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

// --- All-events page: every event across all shows, mixed ---

function AllEventsPage({ allReps, repRecords, onBack }) {
  const {
    showAll, setShowAll,
    filterVille, setFilterVille,
    filterSalle, setFilterSalle,
    uniqueVilles, uniqueSalles,
    filteredReps,
  } = useRepFilters(allReps);

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
          Tous les événements
        </h2>
      </div>
      <RepresentationsTable
        title="Événements"
        totalCount={allReps.length}
        filteredReps={filteredReps}
        uniqueVilles={uniqueVilles}
        uniqueSalles={uniqueSalles}
        filterVille={filterVille}
        setFilterVille={setFilterVille}
        filterSalle={filterSalle}
        setFilterSalle={setFilterSalle}
        showAll={showAll}
        setShowAll={setShowAll}
        repRecords={repRecords}
        showSpectacleCol
      />
    </div>
  );
}

// --- Detail Page ---

function DetailPage({
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

    const isAllMode = selectedRepIds.size === 0;
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
  }, [salesData, dateFrom, dateTo, activePreset]);

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
        { value: "\u2014", label: "Billets vendus", colored: false },
        { value: "\u2014", label: "Revenus", colored: false },
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
                  {kpi.value || "\u2014"}
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
                    {"\u2014"}
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

// --- Main App ---

function SalesChartApp() {
  const base = useBase();
  const globalConfig = useGlobalConfig();
  const selectedSpectaclesTableId = globalConfig.get("spectaclesTable") || null;
  const selectedRepsTableId = globalConfig.get("representationsTable") || null;
  const getProps = useCallback(
    (b) => getCustomProperties(b, selectedSpectaclesTableId, selectedRepsTableId),
    [selectedSpectaclesTableId, selectedRepsTableId],
  );
  const { customPropertyValueByKey, errorState } = useCustomProperties(getProps);

  const spectaclesTable = customPropertyValueByKey.spectaclesTable;
  const imageField = customPropertyValueByKey.imageField;
  const cardSubtitleField = customPropertyValueByKey.cardSubtitleField;
  const cardColorField = customPropertyValueByKey.cardColorField;
  const repsTable = customPropertyValueByKey.representationsTable;
  const spectacleLinkField = customPropertyValueByKey.spectacleLinkField;
  const repNameField = customPropertyValueByKey.repNameField;
  const capacityField = customPropertyValueByKey.capacityField;
  const revenuePotentialField = customPropertyValueByKey.revenuePotentialField;
  const colJoursRestants = customPropertyValueByKey.colJoursRestants;
  const colDateRep = customPropertyValueByKey.colDateRep;
  const colSalle = customPropertyValueByKey.colSalle;
  const colVille = customPropertyValueByKey.colVille;
  const colPlacesBloques = customPropertyValueByKey.colPlacesBloques;
  const colBilletsDispo = customPropertyValueByKey.colBilletsDispo;
  const kpiField1 = customPropertyValueByKey.kpiField1;
  const kpiField2 = customPropertyValueByKey.kpiField2;
  const kpiField3 = customPropertyValueByKey.kpiField3;
  const kpiField4 = customPropertyValueByKey.kpiField4;
  const kpiField5 = customPropertyValueByKey.kpiField5;
  const kpiField6 = customPropertyValueByKey.kpiField6;
  // Auto-detect filter fields directly from table (ignore if not found)
  const filterStatusField = repsTable?.fields.find((f) => f.name.toLowerCase().includes("statut") || f.name.toLowerCase().includes("status")) || null;
  const colTotalBilletsVendus = customPropertyValueByKey.colTotalBilletsVendus;
  const colTotalBilletsGratuits = customPropertyValueByKey.colTotalBilletsGratuits;
  const colAssistance = customPropertyValueByKey.colAssistance;
  const colTauxRemplissage = customPropertyValueByKey.colTauxRemplissage;
  const colRevenus = customPropertyValueByKey.colRevenus;
  const colStatutRapport = customPropertyValueByKey.colStatutRapport;
  const colObjectifRevenus = customPropertyValueByKey.colObjectifRevenus;
  const colMiseAJour = customPropertyValueByKey.colMiseAJour;
  const colPriorisation = customPropertyValueByKey.colPriorisation;
  const colBilleterieSalle = customPropertyValueByKey.colBilleterieSalle;
  const colNote = customPropertyValueByKey.colNote;
  const colStatut = customPropertyValueByKey.colStatut;
  const colSiteWeb = customPropertyValueByKey.colSiteWeb;
  const colOnSale = repsTable?.fields.find((f) => f.name.toLowerCase().includes("on_sale") || f.name.toLowerCase().includes("on sale") || f.name.toLowerCase().includes("en vente")) || null;
  const supabaseUrl = customPropertyValueByKey.supabaseUrl;
  const supabaseAnonKey = customPropertyValueByKey.supabaseAnonKey;

  if (!spectaclesTable || !repsTable) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500">Veuillez configurer les tables dans les propriétés de l'extension.</p>
      </div>
    );
  }

  const spectacleRecords = useRecords(spectaclesTable);
  const repRecords = useRecords(repsTable);

  const [selectedSpectacleId, setSelectedSpectacleId] = useState(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("gallery"); // "gallery" | "events"

  // Get KPI data for selected spectacle from configured fields
  const kpiFields = useMemo(
    () =>
      [kpiField1, kpiField2, kpiField3, kpiField4, kpiField5, kpiField6].filter(
        Boolean,
      ),
    [kpiField1, kpiField2, kpiField3, kpiField4, kpiField5, kpiField6],
  );

  const spectacleKPIs = useMemo(() => {
    if (!selectedSpectacleId || !spectacleRecords || kpiFields.length === 0)
      return [];
    const record = spectacleRecords.find((r) => r.id === selectedSpectacleId);
    if (!record) return [];
    return kpiFields.map((field) => ({
      label: field.name,
      value: safeCellString(record, field),
    }));
  }, [selectedSpectacleId, spectacleRecords, kpiFields]);

  // Build spectacle data with images
  const spectacles = useMemo(() => {
    if (!spectacleRecords) return [];

    // Track which spectacles have at least one representation
    const spectaclesWithReps = new Set();
    if (repRecords && spectacleLinkField) {
      repRecords.forEach((rep) => {
        const links = extractLinkedRecords(safeCellValue(rep, spectacleLinkField));
        links.forEach((link) => spectaclesWithReps.add(link.id));
      });
    }

    // Aggregate total sold per spectacle from rep records
    const soldBySpectacle = {};
    if (repRecords && spectacleLinkField && colTotalBilletsVendus) {
      repRecords.forEach((rep) => {
        const links = extractLinkedRecords(safeCellValue(rep, spectacleLinkField));
        if (links.length === 0) return;
        const raw = safeCellValue(rep, colTotalBilletsVendus);
        const sold = typeof raw === "number" ? raw : parseFloat(raw) || 0;
        const seen = new Set();
        links.forEach((link) => {
          if (seen.has(link.id)) return;
          seen.add(link.id);
          soldBySpectacle[link.id] = (soldBySpectacle[link.id] || 0) + sold;
        });
      });
    }

    return spectacleRecords
      .map((record) => {
        let imageUrl = null;
        if (imageField) {
          const cellValue = safeCellValue(record, imageField);
          if (Array.isArray(cellValue) && cellValue.length > 0) {
            const first = cellValue[0];
            // Direct attachment: {url, thumbnails, ...}
            // Lookup of attachment: {linkedRecordId, value: {url, thumbnails, ...}}
            const att = first.url ? first : (first.value && first.value.url ? first.value : null);
            if (att && att.url) {
              const thumb = att.thumbnails;
              imageUrl = (thumb && thumb.large && thumb.large.url) || att.url;
            }
          }
        }
        const subtitle = safeCellString(record, cardSubtitleField);
        const colorSelect = cardColorField ? getColSelect(record, cardColorField, base) : null;
        const airtableColor = colorSelect?.color ? AIRTABLE_COLORS[colorSelect.color] : null;
        return {
          id: record.id,
          name: record.name || "",
          imageUrl,
          subtitle,
          placeholderColor: airtableColor ? airtableColor.bg : null,
          totalSold: soldBySpectacle[record.id] || 0,
        };
      })
      .filter((s) => s.name && spectaclesWithReps.has(s.id))
      .sort((a, b) => b.totalSold - a.totalSold);
  }, [spectacleRecords, imageField, cardSubtitleField, cardColorField, base, repRecords, spectacleLinkField, colTotalBilletsVendus]);

  // Filter spectacles by search
  const filteredSpectacles = useMemo(() => {
    if (!search) return spectacles;
    const lower = search.toLowerCase();
    return spectacles.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        (s.subtitle && s.subtitle.toLowerCase().includes(lower)),
    );
  }, [spectacles, search]);

  // Build every event (representation) across all shows, with table column
  // values. The per-spectacle detail list and the mixed all-events list are
  // both derived from this.
  const allRepresentations = useMemo(() => {
    if (!repRecords || !spectacleLinkField) return [];

    const getCol = (record, field) => safeCellString(record, field);

    return repRecords
      .map((record) => {
        const links = extractLinkedRecords(safeCellValue(record, spectacleLinkField));
        let cap = null;
        if (capacityField) {
          const val = safeCellValue(record, capacityField);
          cap = typeof val === "number" ? val : parseFloat(String(val)) || null;
        }
        let revPotential = null;
        if (revenuePotentialField) {
          const val = safeCellValue(record, revenuePotentialField);
          revPotential =
            typeof val === "number" ? val : parseFloat(String(val)) || null;
        }
        // Raw values for filtering/sorting
        let rawDate = null;
        let dateRepIso = null;
        if (colDateRep) {
          const dv = safeCellValue(record, colDateRep);
          if (dv) {
            rawDate = new Date(dv);
            // Date/DateTime cells return an ISO string; slice to YYYY-MM-DD to
            // avoid the new Date()→local off-by-one shift in UTC-N timezones.
            if (typeof dv === "string") dateRepIso = dv.slice(0, 10);
          }
        }
        const rawStatus = filterStatusField
          ? safeCellString(record, filterStatusField)
          : "";
        const rawOnSale = colOnSale ? safeCellValue(record, colOnSale) : null;

        const getNum = (field) => {
          if (!field) return null;
          const v = safeCellValue(record, field);
          return typeof v === "number" ? v : null;
        };

        return {
          id: record.id,
          spectacleIds: links.map((l) => l.id),
          spectacleName: links.map((l) => l.name).filter(Boolean).join(", "),
          name: repNameField
            ? safeCellString(record, repNameField)
            : record.name,
          capacity: cap,
          revenuePotential: revPotential,
          rawDate,
          dateRepIso,
          rawStatus,
          rawOnSale,
          colJoursRestants: getCol(record, colJoursRestants),
          colDateRep: getCol(record, colDateRep),
          colSalle: getCol(record, colSalle),
          colVille: getCol(record, colVille),
          colCapacite: getNum(capacityField),
          colPlacesBloques: getNum(colPlacesBloques),
          colBilletsDispo: getNum(colBilletsDispo),
          colTotalBilletsVendus: getNum(colTotalBilletsVendus),
          colTotalBilletsGratuits: getNum(colTotalBilletsGratuits),
          colAssistance: getNum(colAssistance),
          colTauxRemplissage: getNum(colTauxRemplissage),
          colRevenus: getNum(colRevenus),
          colStatutRapport: getColSelect(record, colStatutRapport, base),
          colObjectifRevenus: getNum(colObjectifRevenus),
          colMiseAJour: getColSelect(record, colMiseAJour, base),
          colPriorisation: getColSelect(record, colPriorisation, base),
          colBilleterieSalle: getColSelect(record, colBilleterieSalle, base),
          colNote: getColSelect(record, colNote, base),
          colStatut: getColSelect(record, colStatut, base),
          colSiteWeb: getColSelect(record, colSiteWeb, base),
        };
      })
      .filter((r) => r.name);
  }, [
    base,
    repRecords,
    spectacleLinkField,
    repNameField,
    capacityField,
    revenuePotentialField,
    colJoursRestants,
    colDateRep,
    colSalle,
    colVille,
    colPlacesBloques,
    colBilletsDispo,
    colTotalBilletsVendus,
    colTotalBilletsGratuits,
    colAssistance,
    colTauxRemplissage,
    colRevenus,
    colStatutRapport,
    colObjectifRevenus,
    colMiseAJour,
    colPriorisation,
    colBilleterieSalle,
    colNote,
    colStatut,
    colSiteWeb,
    filterStatusField,
    colOnSale,
  ]);

  // All events, sorted chronologically (for the mixed all-events page)
  const allRepresentationsSorted = useMemo(
    () => sortRepsByDate(allRepresentations),
    [allRepresentations],
  );

  // Events for the selected spectacle only (for the detail page)
  const representations = useMemo(() => {
    if (!selectedSpectacleId) return [];
    return sortRepsByDate(
      allRepresentations.filter((r) => r.spectacleIds.includes(selectedSpectacleId)),
    );
  }, [allRepresentations, selectedSpectacleId]);

  // Get selected spectacle data
  const selectedSpectacle = useMemo(() => {
    return spectacles.find((s) => s.id === selectedSpectacleId) || null;
  }, [spectacles, selectedSpectacleId]);

  if (errorState) {
    return (
      <div className="p-6 text-center text-red-red dark:text-red-redLight1">
        Erreur de configuration : {errorState.message || "Erreur inconnue"}
      </div>
    );
  }

  const isConfigured =
    spectaclesTable &&
    repsTable &&
    spectacleLinkField &&
    repNameField &&
    supabaseUrl &&
    supabaseAnonKey;
  if (!isConfigured) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray200 mb-2">
            Configuration requise
          </p>
          <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
            Ouvrez le panneau des proprietes pour configurer les tables, les
            champs, l&apos;URL Supabase et la cle API.
          </p>
        </div>
      </div>
    );
  }

  // --- All-events Page ---
  if (view === "events") {
    return (
      <AllEventsPage
        allReps={allRepresentationsSorted}
        repRecords={repRecords}
        onBack={() => setView("gallery")}
      />
    );
  }

  // --- Detail Page ---
  if (selectedSpectacle) {
    return (
      <DetailPage
        spectacle={selectedSpectacle}
        representations={representations}
        spectacleKPIs={spectacleKPIs}
        supabaseUrl={supabaseUrl}
        supabaseAnonKey={supabaseAnonKey}
        baseId={base.id}
        onBack={() => setSelectedSpectacleId(null)}
        repRecords={repRecords}
      />
    );
  }

  // --- Gallery Page ---
  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-xl font-display font-bold text-gray-gray700 dark:text-gray-gray200">
          Spectacles
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView("events")}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md
                       bg-blue-blue text-white hover:bg-blue-blueDark1 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Tous les événements
          </button>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un spectacle ou un artiste..."
            style={{
              fontSize: 13,
              padding: "6px 12px",
              borderRadius: 6,
              border: "2px solid #d0d5dd",
              backgroundColor: "#fff",
              color: "#333",
              width: 260,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Overview: total sales across every representation */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-gray600 dark:text-gray-gray300 mb-2">
          Ventes globales
        </h3>
        <HomeSalesChart
          repIds={(repRecords || []).map((r) => r.id)}
          supabaseUrl={supabaseUrl}
          supabaseAnonKey={supabaseAnonKey}
          baseId={base.id}
        />
      </div>

      {filteredSpectacles.length === 0 && (
        <div className="flex items-center justify-center h-64">
          <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
            {search ? "Aucun spectacle trouve." : "Aucun spectacle disponible."}
          </p>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 16,
        }}
      >
        {filteredSpectacles.map((spectacle) => (
          <SpectacleCard
            key={spectacle.id}
            name={spectacle.name}
            subtitle={spectacle.subtitle}
            imageUrl={spectacle.imageUrl}
            placeholderColor={spectacle.placeholderColor}
            onClick={() => setSelectedSpectacleId(spectacle.id)}
          />
        ))}
      </div>
    </div>
  );
}

// Force a full remount of SalesChartApp whenever the user picks a different
// table in the config panel. useCustomProperties only re-evaluates getCustomProperties
// on schema changes, so without remounting, the field-pickers stay scoped to the
// previously selected table and show the wrong fields.
function SalesChartRoot() {
  const globalConfig = useGlobalConfig();
  const spectId = globalConfig.get("spectaclesTable") || "_";
  const repId = globalConfig.get("representationsTable") || "_";
  return <SalesChartApp key={`${spectId}::${repId}`} />;
}

initializeBlock({ interface: () => <SalesChartRoot /> });
