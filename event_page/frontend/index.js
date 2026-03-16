import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  initializeBlock,
  useBase,
  useRecords,
  useCustomProperties,
  expandRecord,
} from "@airtable/blocks/interface/ui";
import { FieldType } from "@airtable/blocks/interface/models";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import "./style.css";

// ─── Constants ───────────────────────────────────────────────────────────────

const TAX_DIVISOR = 1.14975;

const MONTHS_SHORT = [
  "jan", "fev", "mar", "avr", "mai", "jun",
  "jul", "aou", "sep", "oct", "nov", "dec",
];

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length < 3) return isoDate;
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${day} ${MONTHS_SHORT[month]}`;
}

function formatFullDate(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length < 3) return isoDate;
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parts[0];
  const months = ["janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"];
  return `${day} ${months[month]} ${year}`;
}

const fmtNumber = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });

const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : Number(v).toLocaleString("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });

const fmtPercent = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%`;

// ─── Select field helpers ────────────────────────────────────────────────────

function getFieldChoices(field, base) {
  if (!field) return null;
  try {
    const { type, options } = field.config;
    if (type === FieldType.SINGLE_SELECT || type === FieldType.MULTIPLE_SELECTS) {
      return options?.choices || null;
    }
    if (type === FieldType.MULTIPLE_LOOKUP_VALUES) {
      const direct = options?.result?.options?.choices;
      if (direct) return direct;
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

function getColSelect(record, field, base) {
  if (!field) return { text: "", color: null };
  const raw = record.getCellValue(field);
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.name) {
    return { text: raw.name, color: raw.color || null };
  }
  if (Array.isArray(raw) && raw.length > 0 && raw[0]?.name) {
    return { text: raw[0].name, color: raw[0].color || null };
  }
  const text = record.getCellValueAsString(field);
  if (text) {
    const choices = getFieldChoices(field, base);
    if (choices) {
      const match = choices.find((c) => c.name === text);
      if (match?.color) return { text, color: match.color };
    }
  }
  return { text, color: null };
}

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

// ─── Financial Calculations ──────────────────────────────────────────────────

function calculateEventMetrics({ capacity, fee, splitPercentage, approvedExpenses, ticketPrice, producerComps, promoterComps, blockedSeats, salesTarget, sold, totalNetRevenu }) {
  const netPrice = ticketPrice ? Math.round((ticketPrice / TAX_DIVISOR) * 100) / 100 : 0;
  const sellableTickets = Math.max(0, Math.round(capacity - producerComps - promoterComps - blockedSeats));
  const potentialRevenue = Math.round(netPrice * sellableTickets * 100) / 100;
  const splitThresholdAmount = fee + approvedExpenses;

  // Normalize split percentage (could be stored as 0.70 or 70)
  const splitPct = splitPercentage > 1 ? splitPercentage / 100 : splitPercentage;

  const breakEvenFee = netPrice > 0 ? Math.round(Math.min(fee / netPrice, sellableTickets)) : 0;
  const breakEvenSplit = netPrice > 0 ? Math.round(Math.min(splitThresholdAmount / netPrice, sellableTickets)) : 0;

  const potentialSettlement = Math.round((fee + Math.max(0, (potentialRevenue - splitThresholdAmount) * splitPct)) * 100) / 100;
  const potentialPromoterProfit = Math.round((potentialRevenue - potentialSettlement) * 100) / 100;

  const targetSold = salesTarget || Math.floor(sellableTickets * 0.65);
  const targetRevenue = Math.round(netPrice * targetSold * 100) / 100;
  const targetSettlement = Math.round(Math.max(0, (targetRevenue - splitThresholdAmount) * splitPct) * 100) / 100;
  const targetPromoterProfit = ticketPrice === 0 ? 0 : Math.round((targetRevenue - (fee + targetSettlement + approvedExpenses)) * 100) / 100;

  const occupancyRate = capacity > 0 ? Math.round((sold / capacity) * 1000) / 10 : 0;
  const targetRate = targetRevenue > 0 ? Math.round(((totalNetRevenu || 0) / targetRevenue) * 1000) / 10 : 0;

  return {
    netPrice, sellableTickets, potentialRevenue, breakEvenFee, breakEvenSplit,
    potentialSettlement, potentialPromoterProfit, targetSold, targetRevenue,
    targetSettlement, targetPromoterProfit, occupancyRate, targetRate,
    splitPct,
  };
}

// ─── Custom Properties ───────────────────────────────────────────────────────

function getCustomProperties(base) {
  const tables = base.tables;
  const eventsTable = tables.find((t) => t.name.toLowerCase().includes("événement") || t.name.toLowerCase().includes("événement")) || tables[0];
  const projetsTable = tables.find((t) => t.name.toLowerCase().includes("projet")) || (tables.length > 1 ? tables[1] : tables[0]);

  if (!eventsTable) return [];

  const isLinkField = (field) => field.config.type === FieldType.MULTIPLE_RECORD_LINKS;
  const isNumericField = (field) =>
    field.config.type === FieldType.NUMBER ||
    field.config.type === FieldType.CURRENCY ||
    field.config.type === FieldType.FORMULA ||
    field.config.type === FieldType.ROLLUP ||
    field.config.type === FieldType.COUNT ||
    field.config.type === FieldType.PERCENT ||
    field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;
  const isAnyField = () => true;

  const findField = (table, keyword) =>
    table?.fields?.find((f) => f.name.toLowerCase().includes(keyword));

  return [
    // --- Tables ---
    { key: "eventsTable", label: "Table des événements", type: "table", defaultValue: eventsTable },
    { key: "projetsTable", label: "Table des projets", type: "table", defaultValue: projetsTable },

    // --- Événements fields ---
    { key: "eventStatusField", label: "Événements: Statut", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "statut") },
    { key: "eventTypeField", label: "Événements: Type", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "type") },
    { key: "startDateField", label: "Événements: Date debut", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "debut") || findField(eventsTable, "date") },
    { key: "locationField", label: "Événements: Lieu / Salle", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "lieu") || findField(eventsTable, "salle") },
    { key: "performerField", label: "Événements: Artiste", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "artiste") || findField(eventsTable, "perform") },
    { key: "eventNotesField", label: "Événements: Notes", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "note") },
    { key: "capacityField", label: "Événements: Capacité", type: "field", table: eventsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(eventsTable, "capacit") },

    // --- Billetterie (champs directs sur Événements) ---
    { key: "regularPriceField", label: "Événements: Prix régulier", type: "field", table: eventsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(eventsTable, "prix") || findField(eventsTable, "price") },
    { key: "blockedSeatsField", label: "Événements: Places bloquées", type: "field", table: eventsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(eventsTable, "bloqu") },
    { key: "producerCompsField", label: "Événements: Faveurs producteur", type: "field", table: eventsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(eventsTable, "producteur") || findField(eventsTable, "producer") },
    { key: "promoterCompsField", label: "Événements: Faveurs diffuseur", type: "field", table: eventsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(eventsTable, "diffuseur") || findField(eventsTable, "promoter") },
    { key: "salesTargetField", label: "Événements: Objectif ventes", type: "field", table: eventsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(eventsTable, "objectif") || findField(eventsTable, "target") },

    // --- Lien Événements → Projets ---
    { key: "projetLinkField", label: "Événements: Lien vers Projets", type: "field", table: eventsTable, shouldFieldBeAllowed: isLinkField, defaultValue: eventsTable?.fields?.filter((f) => f.config.type === FieldType.MULTIPLE_RECORD_LINKS).find((f) => f.name.toLowerCase().includes("projet")) },

    // --- Projets fields (Conditions) ---
    { key: "artistFeeField", label: "Projets: Cachet artiste", type: "field", table: projetsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(projetsTable, "cachet") || findField(projetsTable, "fee") },
    { key: "splitPercentageField", label: "Projets: Pourcentage partage", type: "field", table: projetsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(projetsTable, "partage") || findField(projetsTable, "split") || findField(projetsTable, "pourcentage") },
    { key: "approvedExpensesField", label: "Projets: Dépenses approuvées", type: "field", table: projetsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(projetsTable, "depense") || findField(projetsTable, "expense") },
    { key: "mealProvidedField", label: "Projets: Repas", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "repas") || findField(projetsTable, "meal") },
    { key: "accommodationField", label: "Projets: Hébergement", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "hebergement") || findField(projetsTable, "accomodation") },
    { key: "transportField", label: "Projets: Transport", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "transport") },

    // --- Colonnes liste (Événements) ---
    { key: "colDateRep", label: "Colonne: Date representation", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "date") },
    { key: "colSalle", label: "Colonne: Salle", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "salle") },
    { key: "colJoursRestants", label: "Colonne: Jours restants", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "jour") || findField(eventsTable, "restant") },
    { key: "colTotalBilletsVendus", label: "Colonne: Total billets vendus", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "vendu") },
    { key: "colTotalBilletsGratuits", label: "Colonne: Total billets gratuits", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "gratuit") },
    { key: "colAssistance", label: "Colonne: Assistance", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "assistance") },
    { key: "colTauxRemplissage", label: "Colonne: Taux de remplissage", type: "field", table: eventsTable, shouldFieldBeAllowed: isNumericField, defaultValue: findField(eventsTable, "remplissage") || findField(eventsTable, "taux") },
    { key: "colRevenus", label: "Colonne: Revenus billetterie", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "revenu") },
    { key: "colStatut", label: "Colonne: Statut", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "statut") || findField(eventsTable, "status") },

    // --- Supabase ---
    { key: "supabaseUrl", label: "Supabase URL (ex: https://xyz.supabase.co)", type: "string", defaultValue: "" },
    { key: "supabaseAnonKey", label: "Supabase Anon Key", type: "string", defaultValue: "" },
  ];
}

// ─── Custom X-axis Tick ──────────────────────────────────────────────────────

function CustomXAxisTick({ x, y, payload }) {
  const label = formatDate(payload.value);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{label}</title>
      <text x={0} y={0} dy={8} textAnchor="end" fill="#666" fontSize={10} transform="rotate(-45)">
        {label}
      </text>
    </g>
  );
}

// ─── Sales Chart ─────────────────────────────────────────────────────────────

function SalesChart({ salesData, capacity, salesTarget, eventStartDate }) {
  const chartData = useMemo(() => {
    if (!salesData || salesData.length === 0 || !eventStartDate) return [];

    const sorted = [...salesData].sort((a, b) => a.date.localeCompare(b.date));
    const firstDateParts = sorted[0].date.split("-");
    const firstDate = new Date(parseInt(firstDateParts[0]), parseInt(firstDateParts[1]) - 1, parseInt(firstDateParts[2]));

    const eventParts = eventStartDate.split("-");
    const eventDate = new Date(parseInt(eventParts[0]), parseInt(eventParts[1]) - 1, parseInt(eventParts[2]));

    const totalTimeSpan = eventDate.getTime() - firstDate.getTime();
    if (totalTimeSpan <= 0) return [];

    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const totalWeeks = Math.ceil(totalTimeSpan / WEEK_MS);
    const target = salesTarget || 100;
    const points = [];

    for (let week = 0; week <= totalWeeks; week++) {
      const weekDate = new Date(firstDate.getTime() + week * WEEK_MS);
      if (weekDate > eventDate) break;

      const isLastWeek = week === totalWeeks || weekDate.getTime() + WEEK_MS > eventDate.getTime();
      const pointDate = isLastWeek ? eventDate : weekDate;
      const dayStr = `${pointDate.getFullYear()}-${String(pointDate.getMonth() + 1).padStart(2, "0")}-${String(pointDate.getDate()).padStart(2, "0")}`;

      const salesUpTo = sorted.filter((s) => s.date <= dayStr);
      const latest = salesUpTo[salesUpTo.length - 1];

      const elapsed = pointDate.getTime() - firstDate.getTime();
      const progressRatio = Math.min(elapsed / totalTimeSpan, 1);

      points.push({
        date: dayStr,
        ventes: latest ? latest.sold : undefined,
        objectif: Math.round(target * progressRatio),
      });
    }
    return points;
  }, [salesData, capacity, salesTarget, eventStartDate]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
          Aucune donnée de ventes disponible.
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
        <XAxis
          dataKey="date"
          tick={<CustomXAxisTick />}
          interval="preserveStartEnd"
          height={50}
          axisLine={{ stroke: "#374151" }}
        />
        <YAxis
          domain={[0, capacity || "auto"]}
          tick={{ fill: "#9CA3AF", fontSize: 11 }}
          axisLine={{ stroke: "#374151" }}
          width={40}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151", borderRadius: "6px", color: "#F9FAFB" }}
          labelFormatter={formatDate}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "#9CA3AF" }} />
        <Line type="monotone" dataKey="ventes" name="Ventes Actuelles" stroke="#3B82F6" strokeWidth={2} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="objectif" name="Objectif" stroke="#10B981" strokeWidth={2} dot={false} strokeDasharray="5 5" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

const KPI_COLORS = {
  green:  { bg: "rgba(4, 138, 14, 0.1)", border: "rgb(4, 138, 14)", text: "rgb(0, 100, 0)" },
  blue:   { bg: "rgba(22, 110, 225, 0.1)", border: "rgb(22, 110, 225)", text: "rgb(13, 82, 172)" },
  purple: { bg: "rgba(124, 55, 239, 0.1)", border: "rgb(124, 55, 239)", text: "rgb(98, 49, 174)" },
  orange: { bg: "rgba(213, 68, 1, 0.1)", border: "rgb(213, 68, 1)", text: "rgb(170, 45, 0)" },
};

function KpiCard({ title, value, color = "blue" }) {
  const c = KPI_COLORS[color] || KPI_COLORS.blue;
  return (
    <div className="rounded-lg p-4 shadow-xs dark:shadow-none" style={{ backgroundColor: c.bg, borderLeft: `3px solid ${c.border}` }}>
      <p className="text-xs font-medium text-gray-gray500 dark:text-gray-gray400 mb-1">{title}</p>
      <p className="text-xl font-bold" style={{ color: c.text }}>{value}</p>
    </div>
  );
}

// ─── Progress Bar ────────────────────────────────────────────────────────────

function ProgressBar({ label, percent, color = "#166ee1" }) {
  const clamped = Math.min(100, Math.max(0, percent || 0));
  return (
    <div className="bg-white dark:bg-gray-gray700 rounded-lg p-3 shadow-xs dark:shadow-none">
      <div className="flex justify-between items-center mb-1">
        <p className="text-xs font-medium text-gray-gray500 dark:text-gray-gray400">{label}</p>
        <p className="text-xs font-semibold text-gray-gray700 dark:text-gray-gray200">{fmtPercent(clamped)}</p>
      </div>
      <div className="w-full h-2 bg-gray-gray100 dark:bg-gray-gray600 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${clamped}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─── Calculation Metric ──────────────────────────────────────────────────────

function CalculationMetric({ label, value, color }) {
  const colorMap = { green: "#048a0e", blue: "#166ee1", primary: "#31353e" };
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-gray-gray100 dark:border-gray-gray600 last:border-b-0">
      <span className="text-sm text-gray-gray500 dark:text-gray-gray400">{label}</span>
      <span className="text-base font-semibold" style={{ color: colorMap[color] || colorMap.primary }}>{value}</span>
    </div>
  );
}

// ─── Form Input ──────────────────────────────────────────────────────────────

function FormInput({ label, value, onChange, suffix = "", type = "number" }) {
  const [editing, setEditing] = useState(false);
  const isCurrency = suffix === "$";
  const isPercent = suffix === "%";

  const displayValue = () => {
    if (value == null || value === "") return "";
    if (isCurrency) return fmtCurrency(value);
    if (isPercent) return `${Number(value).toLocaleString("fr-CA", { maximumFractionDigits: 2 })} %`;
    return fmtNumber(value);
  };

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-gray500 dark:text-gray-gray400 mb-1">{label}</label>
      {type === "number" && !editing ? (
        <div
          onClick={() => setEditing(true)}
          className="w-full px-3 py-2 text-base border border-gray-gray200 dark:border-gray-gray600 rounded-md bg-white dark:bg-gray-gray800 text-gray-gray700 dark:text-gray-gray200 cursor-text"
        >
          {displayValue() || <span className="text-gray-gray300">—</span>}
        </div>
      ) : (
        <div className="flex items-center">
          <input
            type={type === "number" ? "number" : "text"}
            value={value ?? ""}
            onChange={(e) => onChange(type === "number" ? (e.target.value === "" ? 0 : parseFloat(e.target.value)) : e.target.value)}
            onBlur={() => setEditing(false)}
            autoFocus={editing}
            className="w-full px-3 py-2 text-base border border-blue-blue rounded-md bg-white dark:bg-gray-gray800 text-gray-gray700 dark:text-gray-gray200 focus:outline-none focus:ring-1 focus:ring-blue-blue"
          />
          {suffix && <span className="ml-2 text-sm text-gray-gray400 min-w-[16px]">{suffix}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Form Text Input ─────────────────────────────────────────────────────────

function FormTextInput({ label, value, onChange }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-gray500 dark:text-gray-gray400 mb-1">{label}</label>
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-base border border-gray-gray200 dark:border-gray-gray600 rounded-md bg-white dark:bg-gray-gray800 text-gray-gray700 dark:text-gray-gray200 focus:outline-none focus:ring-1 focus:ring-blue-blue"
      />
    </div>
  );
}

// ─── Form Textarea ───────────────────────────────────────────────────────────

function FormTextarea({ label, value, onChange, rows = 3 }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-gray500 dark:text-gray-gray400 mb-1">{label}</label>
      <textarea
        rows={rows}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-base border border-gray-gray200 dark:border-gray-gray600 rounded-md bg-white dark:bg-gray-gray800 text-gray-gray700 dark:text-gray-gray200 focus:outline-none focus:ring-1 focus:ring-blue-blue resize-none"
      />
    </div>
  );
}

// ─── Section Card ────────────────────────────────────────────────────────────

function SectionCard({ title, children, className = "" }) {
  return (
    <div className={`bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-xs dark:shadow-none ${className}`}>
      {title && <h3 className="text-base font-semibold text-gray-gray700 dark:text-gray-gray200 mb-3">{title}</h3>}
      {children}
    </div>
  );
}

// ─── Events List ─────────────────────────────────────────────────────────────

function EventsList({ events, columns, onSelect, base, eventRecords }) {
  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-gray-gray500 dark:text-gray-gray400">Aucun événement trouvé.</p>
      </div>
    );
  }

  function renderCell(col, value) {
    if (col.type === "select") {
      return <SelectBadge value={value} />;
    }
    if (col.type === "number") {
      return <span className="text-right">{fmtNumber(value)}</span>;
    }
    if (col.type === "currency") {
      return <span className="text-right">{fmtCurrency(value)}</span>;
    }
    if (col.type === "progress") {
      const pct = Math.min(100, Math.round((value || 0) * 100));
      const barColor = pct >= 80 ? "#20c933" : pct >= 50 ? "#fcb400" : "#f82b60";
      return (
        <div className="flex items-center gap-1">
          <div className="flex-1 bg-gray-gray200 dark:bg-gray-gray600 rounded-full h-2" style={{ minWidth: 60 }}>
            <div className="rounded-full h-2" style={{ width: `${pct}%`, backgroundColor: barColor }} />
          </div>
          <span className="text-xs text-gray-gray500 dark:text-gray-gray400 whitespace-nowrap">{pct}%</span>
        </div>
      );
    }
    return value || "—";
  }

  const isRightAligned = (col) => col.type === "number" || col.type === "currency";

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="w-full text-sm text-gray-gray700 dark:text-gray-gray200" style={{ minWidth: columns.length > 8 ? 1400 : undefined }}>
        <thead>
          <tr className="bg-gray-gray75 dark:bg-gray-gray800 text-gray-gray600 dark:text-gray-gray300 text-left text-xs">
            {columns.map((col) => (
              <th key={col.key} className={`px-3 py-2 font-semibold ${isRightAligned(col) ? "text-right" : ""}`} style={col.type === "progress" ? { minWidth: 120 } : undefined}>
                {col.label}
              </th>
            ))}
            <th className="px-3 py-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {events.map((evt) => (
            <tr
              key={evt.id}
              onClick={() => onSelect(evt)}
              className="cursor-pointer border-t border-gray-gray100 dark:border-gray-gray600 hover:bg-gray-gray25 dark:hover:bg-gray-gray600 transition-colors"
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-2 ${isRightAligned(col) ? "text-right" : ""} ${col.key === "performer" ? "font-medium" : ""}`}>
                  {renderCell(col, evt.colValues[col.key])}
                </td>
              ))}
              <td className="px-3 py-2 text-center">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (evt.record) expandRecord(evt.record);
                  }}
                  className="text-gray-gray400 hover:text-blue-blue dark:hover:text-blue-blueLight1 transition-colors"
                  title="Ouvrir le detail"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
  );
}

// ─── Detail Page ─────────────────────────────────────────────────────────────

function DetailPage({
  eventRecord, projetRecord, base,
  eventsTable, projetsTable,
  eventStatusField, eventTypeField, startDateField,
  locationField, performerField, eventNotesField, capacityField,
  regularPriceField, blockedSeatsField, producerCompsField,
  promoterCompsField, salesTargetField,
  artistFeeField, splitPercentageField, approvedExpensesField,
  mealProvidedField, accommodationField, transportField,
  supabaseUrl, supabaseAnonKey, baseId,
  onBack,
}) {
  // --- Read values from records ---
  const getNum = (record, field) => {
    if (!record || !field) return 0;
    const v = record.getCellValue(field);
    return typeof v === "number" ? v : parseFloat(v) || 0;
  };
  const getStr = (record, field) => {
    if (!record || !field) return "";
    return record.getCellValueAsString(field) || "";
  };

  // Event fields
  const capacity = getNum(eventRecord, capacityField);
  const startDate = getStr(eventRecord, startDateField);
  const performer = getStr(eventRecord, performerField);
  const location = getStr(eventRecord, locationField);
  const eventStatus = eventStatusField ? getColSelect(eventRecord, eventStatusField, base) : { text: "", color: null };

  // --- Editable state: Billetterie (from Événements) ---
  const [ticketingValues, setTicketingValues] = useState({
    regularPrice: getNum(eventRecord, regularPriceField),
    blockedSeats: getNum(eventRecord, blockedSeatsField),
    producerComps: getNum(eventRecord, producerCompsField),
    promoterComps: getNum(eventRecord, promoterCompsField),
    salesTarget: getNum(eventRecord, salesTargetField),
  });

  // --- Editable state: Conditions (from Projets) ---
  const [conditionsValues, setConditionsValues] = useState({
    artistFee: getNum(projetRecord, artistFeeField),
    splitPercentage: getNum(projetRecord, splitPercentageField),
    approvedExpenses: getNum(projetRecord, approvedExpensesField),
    mealProvided: getStr(projetRecord, mealProvidedField),
    accommodation: getStr(projetRecord, accommodationField),
    transport: getStr(projetRecord, transportField),
  });

  // --- Editable state: Event notes ---
  const [eventNotes, setEventNotes] = useState(getStr(eventRecord, eventNotesField));

  // --- Supabase sales data ---
  const [salesData, setSalesData] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const cacheRef = useRef(new Map());
  const [saving, setSaving] = useState(false);

  // Fetch sales from Supabase
  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey || !eventRecord) {
      setSalesData([]);
      return;
    }

    const recordId = eventRecord.id;
    const today = new Date().toISOString().split("T")[0];
    const cacheKey = `event_${recordId}_${today}_${refreshKey}`;
    let didCancel = false;

    const fetchSales = async () => {
      if (cacheRef.current.has(cacheKey)) {
        if (!didCancel) {
          setSalesData(cacheRef.current.get(cacheKey));
          setSalesLoading(false);
        }
        return;
      }

      setSalesLoading(true);
      try {
        const filter = `record_id=in.(${recordId})`;
        const baseUrl = `${supabaseUrl}/rest/v1/sales_report?base_id=eq.${baseId}&${filter}&order=date.asc&select=record_id,date,sold,free,total`;
        console.log("[EventPage] Supabase fetch:", { recordId, baseId, url: baseUrl });

        let data = [];
        let offset = 0;
        const pageSize = 1000;
        while (true) {
          const response = await fetch(baseUrl + `&limit=${pageSize}&offset=${offset}`, {
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${supabaseAnonKey}`,
              "Content-Type": "application/json",
            },
          });
          if (!response.ok) throw new Error(`Erreur Supabase: ${response.status}`);
          const page = await response.json();
          data = data.concat(page);
          if (page.length < pageSize) break;
          offset += pageSize;
          if (didCancel) return;
        }

        if (!didCancel) {
          const formatted = data.map((row) => ({
            date: row.date ? row.date.split("T")[0] : row.date,
            sold: row.sold || 0,
            free: row.free || 0,
            total: parseFloat(row.total) || 0,
          }));
          // Deduplicate by date (keep latest)
          const byDate = {};
          formatted.forEach((r) => { byDate[r.date] = r; });
          const result = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

          console.log("[EventPage] Supabase result:", { rawCount: data.length, formattedCount: result.length, first: result[0], last: result[result.length - 1] });
          cacheRef.current.set(cacheKey, result);
          setSalesData(result);
          setSalesLoading(false);
        }
      } catch (err) {
        if (!didCancel) {
          console.error("Supabase fetch error:", err);
          setSalesLoading(false);
        }
      }
    };

    fetchSales();
    return () => { didCancel = true; };
  }, [eventRecord?.id, supabaseUrl, supabaseAnonKey, baseId, refreshKey]);

  // --- Calculations ---
  const latestSales = salesData.length > 0 ? salesData[salesData.length - 1] : null;
  const sold = latestSales?.sold || 0;
  const totalNetRevenu = latestSales?.total || 0;

  const metrics = useMemo(() => calculateEventMetrics({
    capacity,
    fee: conditionsValues.artistFee,
    splitPercentage: conditionsValues.splitPercentage,
    approvedExpenses: conditionsValues.approvedExpenses,
    ticketPrice: ticketingValues.regularPrice,
    producerComps: ticketingValues.producerComps,
    promoterComps: ticketingValues.promoterComps,
    blockedSeats: ticketingValues.blockedSeats,
    salesTarget: ticketingValues.salesTarget,
    sold,
    totalNetRevenu,
  }), [capacity, conditionsValues, ticketingValues, sold, totalNetRevenu]);

  // --- Save handler ---
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Save conditions to Projets
      if (projetRecord && projetsTable) {
        const updates = {};
        if (artistFeeField) updates[artistFeeField.name] = conditionsValues.artistFee;
        if (splitPercentageField) updates[splitPercentageField.name] = conditionsValues.splitPercentage;
        if (approvedExpensesField) updates[approvedExpensesField.name] = conditionsValues.approvedExpenses;
        if (Object.keys(updates).length > 0) {
          await projetsTable.updateRecordAsync(projetRecord, updates);
        }
      }

      // Save billetterie + notes to Événements
      if (eventRecord && eventsTable) {
        const updates = {};
        if (regularPriceField) updates[regularPriceField.name] = ticketingValues.regularPrice;
        if (blockedSeatsField) updates[blockedSeatsField.name] = ticketingValues.blockedSeats;
        if (producerCompsField) updates[producerCompsField.name] = ticketingValues.producerComps;
        if (promoterCompsField) updates[promoterCompsField.name] = ticketingValues.promoterComps;
        if (salesTargetField) updates[salesTargetField.name] = ticketingValues.salesTarget;
        if (eventNotesField) updates[eventNotesField.name] = eventNotes;
        if (Object.keys(updates).length > 0) {
          await eventsTable.updateRecordAsync(eventRecord, updates);
        }
      }
    } catch (err) {
      console.error("Save error:", err);
      alert(`Erreur lors de la sauvegarde: ${err.message}`);
    }
    setSaving(false);
  }, [conditionsValues, ticketingValues, eventNotes, projetRecord, eventRecord, projetsTable, eventsTable, artistFeeField, splitPercentageField, approvedExpensesField, regularPriceField, blockedSeatsField, producerCompsField, promoterCompsField, salesTargetField, eventNotesField]);

  // --- Reset handler ---
  const handleReset = useCallback(() => {
    setConditionsValues({
      artistFee: getNum(projetRecord, artistFeeField),
      splitPercentage: getNum(projetRecord, splitPercentageField),
      approvedExpenses: getNum(projetRecord, approvedExpensesField),
      mealProvided: getStr(projetRecord, mealProvidedField),
      accommodation: getStr(projetRecord, accommodationField),
      transport: getStr(projetRecord, transportField),
    });
    setTicketingValues({
      regularPrice: getNum(eventRecord, regularPriceField),
      blockedSeats: getNum(eventRecord, blockedSeatsField),
      producerComps: getNum(eventRecord, producerCompsField),
      promoterComps: getNum(eventRecord, promoterCompsField),
      salesTarget: getNum(eventRecord, salesTargetField),
    });
    setEventNotes(getStr(eventRecord, eventNotesField));
  }, [projetRecord, eventRecord, artistFeeField, splitPercentageField, approvedExpensesField, mealProvidedField, accommodationField, transportField, regularPriceField, blockedSeatsField, producerCompsField, promoterCompsField, salesTargetField, eventNotesField]);

  // Parse start date for chart
  const startDateISO = startDate ? startDate.split(" ")[0] : "";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-xs dark:shadow-none">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-blue-blue hover:text-blue-blueDark1 font-medium">
            ← Retour
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-gray700 dark:text-gray-gray200">
              {performer || "Événement"}
            </h2>
            <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
              {formatFullDate(startDateISO)}{location ? ` — ${location}` : ""}
            </p>
          </div>
          <SelectBadge value={eventStatus} />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray700 dark:text-gray-gray200 hover:bg-gray-gray200 dark:hover:bg-gray-gray500 transition-colors"
          >
            Réinitialiser
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-blue text-white hover:bg-blue-blueDark1 transition-colors disabled:opacity-50"
          >
            {saving ? "..." : "Sauvegarder"}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard title="Revenus nets" value={fmtCurrency(totalNetRevenu)} color="green" />
        <KpiCard title="Objectif revenus" value={fmtCurrency(metrics.targetRevenue)} color="blue" />
        <KpiCard title="Billets vendus" value={fmtNumber(sold)} color="purple" />
        <KpiCard title="Taux de remplissage" value={fmtPercent(metrics.occupancyRate)} color="orange" />
      </div>

      {/* Progress Bars */}
      <div className="grid grid-cols-2 gap-3">
        <ProgressBar label="Taux de remplissage" percent={metrics.occupancyRate} color="#166ee1" />
        <ProgressBar label="Taux objectif" percent={metrics.targetRate} color="#d54401" />
      </div>

      {/* Row 1: Conditions | Progression des ventes */}
      <div className="grid grid-cols-2 gap-4">
        <SectionCard title="Conditions">
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <FormInput label="Cachet artiste" value={conditionsValues.artistFee} onChange={(v) => setConditionsValues((p) => ({ ...p, artistFee: v }))} suffix="$" />
              <FormInput label="Partage (%)" value={conditionsValues.splitPercentage} onChange={(v) => setConditionsValues((p) => ({ ...p, splitPercentage: v }))} suffix="%" />
              <FormInput label="Dépenses approuvées" value={conditionsValues.approvedExpenses} onChange={(v) => setConditionsValues((p) => ({ ...p, approvedExpenses: v }))} suffix="$" />
              <FormTextInput label="Repas" value={conditionsValues.mealProvided} onChange={(v) => setConditionsValues((p) => ({ ...p, mealProvided: v }))} />
              <FormTextInput label="Hébergement" value={conditionsValues.accommodation} onChange={(v) => setConditionsValues((p) => ({ ...p, accommodation: v }))} />
              <FormTextInput label="Transport" value={conditionsValues.transport} onChange={(v) => setConditionsValues((p) => ({ ...p, transport: v }))} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-gray500 dark:text-gray-gray400 mb-3 uppercase tracking-wide">Métriques</p>
              <CalculationMetric label="Break-even cachet" value={`${fmtNumber(metrics.breakEvenFee)} billets`} color="primary" />
              <CalculationMetric label="Break-even split" value={`${fmtNumber(metrics.breakEvenSplit)} billets`} color="primary" />
              <CalculationMetric label="Revenu potentiel" value={fmtCurrency(metrics.potentialRevenue)} color="green" />
              <CalculationMetric label="Règlement potentiel" value={fmtCurrency(metrics.potentialSettlement)} color="primary" />
              <CalculationMetric label="Profit promoteur pot." value={fmtCurrency(metrics.potentialPromoterProfit)} color="green" />
            </div>
          </div>
          {projetRecord && (
            <div className="mt-3">
              <button onClick={() => expandRecord(projetRecord)} className="text-sm text-blue-blue hover:text-blue-blueDark1 font-medium">
                Ouvrir le projet →
              </button>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Progression des ventes">
          <div className="flex justify-end mb-2">
            <button
              onClick={() => { cacheRef.current.clear(); setRefreshKey((k) => k + 1); }}
              className="text-sm text-blue-blue hover:text-blue-blueDark1"
              title="Rafraîchir les données"
            >
              ↺
            </button>
          </div>
          {salesLoading ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-sm text-gray-gray400">Chargement...</p>
            </div>
          ) : (
            <SalesChart
              salesData={salesData}
              capacity={capacity}
              salesTarget={ticketingValues.salesTarget || metrics.targetSold}
              eventStartDate={startDateISO}
            />
          )}
        </SectionCard>
      </div>

      {/* Row 2: Billetterie | Détails */}
      <div className="grid grid-cols-2 gap-4">
        <SectionCard title="Billetterie">
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <FormInput label="Prix régulier" value={ticketingValues.regularPrice} onChange={(v) => setTicketingValues((p) => ({ ...p, regularPrice: v }))} suffix="$" />
              <FormInput label="Places bloquées" value={ticketingValues.blockedSeats} onChange={(v) => setTicketingValues((p) => ({ ...p, blockedSeats: v }))} suffix="#" />
              <FormInput label="Faveurs producteur" value={ticketingValues.producerComps} onChange={(v) => setTicketingValues((p) => ({ ...p, producerComps: v }))} suffix="#" />
              <FormInput label="Faveurs diffuseur" value={ticketingValues.promoterComps} onChange={(v) => setTicketingValues((p) => ({ ...p, promoterComps: v }))} suffix="#" />
              <FormInput label="Objectif ventes" value={ticketingValues.salesTarget} onChange={(v) => setTicketingValues((p) => ({ ...p, salesTarget: v }))} suffix="#" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-gray500 dark:text-gray-gray400 mb-3 uppercase tracking-wide">Métriques</p>
              <CalculationMetric label="Capacité totale" value={fmtNumber(capacity)} color="primary" />
              <CalculationMetric label="Places vendables" value={fmtNumber(metrics.sellableTickets)} color="primary" />
              <CalculationMetric label="Prix net moyen" value={fmtCurrency(metrics.netPrice)} color="blue" />
              <CalculationMetric label="Revenu objectif" value={fmtCurrency(metrics.targetRevenue)} color="green" />
              <CalculationMetric label="Profit promoteur obj." value={fmtCurrency(metrics.targetPromoterProfit)} color="blue" />
            </div>
          </div>
          <div className="mt-3">
            <button onClick={() => expandRecord(eventRecord)} className="text-sm text-blue-blue hover:text-blue-blueDark1 font-medium">
              Ouvrir l'événement →
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Détails de l'événement">
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <p className="text-sm text-gray-gray400 mb-0.5">Statut</p>
              <p className="text-base font-medium text-gray-gray700 dark:text-gray-gray200 mb-3"><SelectBadge value={eventStatus} /></p>
            </div>
            <div>
              <p className="text-sm text-gray-gray400 mb-0.5">Type</p>
              <p className="text-base font-medium text-gray-gray700 dark:text-gray-gray200 mb-3">
                {eventTypeField ? <SelectBadge value={getColSelect(eventRecord, eventTypeField, base)} /> : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-gray400 mb-0.5">Date</p>
              <p className="text-base font-medium text-gray-gray700 dark:text-gray-gray200 mb-3">{formatFullDate(startDateISO)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-gray400 mb-0.5">Lieu</p>
              <p className="text-base font-medium text-gray-gray700 dark:text-gray-gray200 mb-3">{location || "—"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-gray-gray400 mb-0.5">Artiste</p>
              <p className="text-base font-medium text-gray-gray700 dark:text-gray-gray200 mb-3">{performer || "—"}</p>
            </div>
          </div>
          <FormTextarea label="Notes" value={eventNotes} onChange={setEventNotes} rows={3} />
          <div className="mt-3">
            <button onClick={() => expandRecord(eventRecord)} className="text-sm text-blue-blue hover:text-blue-blueDark1 font-medium">
              Ouvrir l'événement →
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

function EventPageApp() {
  const base = useBase();
  const { customPropertyValueByKey } = useCustomProperties(getCustomProperties);

  const eventsTable = customPropertyValueByKey.eventsTable;
  const projetsTable = customPropertyValueByKey.projetsTable;
  const eventStatusField = customPropertyValueByKey.eventStatusField;
  const eventTypeField = customPropertyValueByKey.eventTypeField;
  const startDateField = customPropertyValueByKey.startDateField;
  const locationField = customPropertyValueByKey.locationField;
  const performerField = customPropertyValueByKey.performerField;
  const eventNotesField = customPropertyValueByKey.eventNotesField;
  const capacityField = customPropertyValueByKey.capacityField;
  const regularPriceField = customPropertyValueByKey.regularPriceField;
  const blockedSeatsField = customPropertyValueByKey.blockedSeatsField;
  const producerCompsField = customPropertyValueByKey.producerCompsField;
  const promoterCompsField = customPropertyValueByKey.promoterCompsField;
  const salesTargetField = customPropertyValueByKey.salesTargetField;
  const projetLinkField = customPropertyValueByKey.projetLinkField;
  const artistFeeField = customPropertyValueByKey.artistFeeField;
  const splitPercentageField = customPropertyValueByKey.splitPercentageField;
  const approvedExpensesField = customPropertyValueByKey.approvedExpensesField;
  const mealProvidedField = customPropertyValueByKey.mealProvidedField;
  const accommodationField = customPropertyValueByKey.accommodationField;
  const transportField = customPropertyValueByKey.transportField;
  const colDateRep = customPropertyValueByKey.colDateRep;
  const colSalle = customPropertyValueByKey.colSalle;
  const colJoursRestants = customPropertyValueByKey.colJoursRestants;
  const colTotalBilletsVendus = customPropertyValueByKey.colTotalBilletsVendus;
  const colTotalBilletsGratuits = customPropertyValueByKey.colTotalBilletsGratuits;
  const colAssistance = customPropertyValueByKey.colAssistance;
  const colTauxRemplissage = customPropertyValueByKey.colTauxRemplissage;
  const colRevenus = customPropertyValueByKey.colRevenus;
  const colStatut = customPropertyValueByKey.colStatut;
  const supabaseUrl = customPropertyValueByKey.supabaseUrl;
  const supabaseAnonKey = customPropertyValueByKey.supabaseAnonKey;

  const eventRecords = useRecords(eventsTable);
  const projetRecords = useRecords(projetsTable);

  const [selectedEventId, setSelectedEventId] = useState(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const baseId = base.id;

  // Check configuration
  const isConfigured = eventsTable && projetsTable;

  // Column definitions for the events table
  const columns = useMemo(() => {
    const cols = [];
    if (performerField) cols.push({ key: "performer", label: "Artiste", field: performerField, type: "text" });
    if (colJoursRestants) cols.push({ key: "joursRestants", label: "J. restants", field: colJoursRestants, type: "text" });
    if (colDateRep) cols.push({ key: "dateRep", label: "Date", field: colDateRep, type: "text" });
    if (colSalle) cols.push({ key: "salle", label: "Salle", field: colSalle, type: "text" });
    if (capacityField) cols.push({ key: "capacity", label: "Capacité", field: capacityField, type: "number" });
    if (colTotalBilletsVendus) cols.push({ key: "vendus", label: "Vendus", field: colTotalBilletsVendus, type: "number" });
    if (colTotalBilletsGratuits) cols.push({ key: "gratuits", label: "Gratuits", field: colTotalBilletsGratuits, type: "number" });
    if (colAssistance) cols.push({ key: "assistance", label: "Assistance", field: colAssistance, type: "number" });
    if (colTauxRemplissage) cols.push({ key: "taux", label: "Taux remplissage", field: colTauxRemplissage, type: "progress" });
    if (colRevenus) cols.push({ key: "revenus", label: "Revenus", field: colRevenus, type: "currency" });
    if (colStatut) cols.push({ key: "statut", label: "Statut", field: colStatut, type: "select" });
    return cols;
  }, [performerField, colJoursRestants, colDateRep, colSalle, capacityField, colTotalBilletsVendus, colTotalBilletsGratuits, colAssistance, colTauxRemplissage, colRevenus, colStatut]);

  // Build events list
  const events = useMemo(() => {
    if (!eventRecords) return [];
    return eventRecords.map((record) => {
      const startDate = startDateField ? record.getCellValueAsString(startDateField) : "";
      const startDateISO = startDate ? startDate.split(" ")[0] : "";
      // Build column values for each configured column
      const colValues = {};
      columns.forEach((col) => {
        if (col.type === "select") {
          colValues[col.key] = getColSelect(record, col.field, base);
        } else if (col.type === "number" || col.type === "currency" || col.type === "progress") {
          const v = record.getCellValue(col.field);
          colValues[col.key] = typeof v === "number" ? v : parseFloat(v) || 0;
        } else {
          colValues[col.key] = record.getCellValueAsString(col.field) || "";
        }
      });
      return {
        id: record.id,
        record,
        rawDate: startDateISO,
        colValues,
      };
    }).sort((a, b) => (a.rawDate || "").localeCompare(b.rawDate || ""));
  }, [eventRecords, startDateField, columns, base]);

  // Filter events: upcoming vs all, then search
  const filteredEvents = useMemo(() => {
    let filtered = events;
    if (!showAll) {
      const today = new Date().toISOString().split("T")[0];
      filtered = filtered.filter((e) => !e.rawDate || e.rawDate >= today);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((e) => {
        const vals = e.colValues;
        return Object.values(vals).some((v) => {
          if (v && typeof v === "object" && v.text) return v.text.toLowerCase().includes(q);
          if (typeof v === "string") return v.toLowerCase().includes(q);
          return false;
        });
      });
    }
    return filtered;
  }, [events, showAll, search]);

  // Resolve selected event
  const selectedEvent = selectedEventId ? events.find((e) => e.id === selectedEventId) : null;
  const selectedEventRecord = selectedEvent?.record || null;

  // Resolve linked Projet for selected event
  const linkedProjetRecord = useMemo(() => {
    if (!selectedEventRecord || !projetLinkField) return null;
    const linkValue = selectedEventRecord.getCellValue(projetLinkField);
    if (!linkValue || !Array.isArray(linkValue) || linkValue.length === 0) return null;
    const projetId = linkValue[0].id;
    return projetRecords?.find((r) => r.id === projetId) || null;
  }, [selectedEventRecord, projetLinkField, projetRecords]);

  if (!isConfigured) {
    return (
      <div className="p-8 min-h-screen bg-gray-gray50 dark:bg-gray-gray800">
        <div className="max-w-lg mx-auto text-center mt-20 bg-white dark:bg-gray-gray700 rounded-lg p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-gray700 dark:text-gray-gray200 mb-4">Configuration requise</h2>
          <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
            Veuillez configurer les tables Événements et Projets dans les parametres de l'extension.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 min-h-screen bg-gray-gray50 dark:bg-gray-gray800">
      {selectedEvent ? (
        <DetailPage
          eventRecord={selectedEventRecord}
          projetRecord={linkedProjetRecord}
          base={base}
          eventsTable={eventsTable}
          projetsTable={projetsTable}
          eventStatusField={eventStatusField}
          eventTypeField={eventTypeField}
          startDateField={startDateField}
          locationField={locationField}
          performerField={performerField}
          eventNotesField={eventNotesField}
          capacityField={capacityField}
          regularPriceField={regularPriceField}
          blockedSeatsField={blockedSeatsField}
          producerCompsField={producerCompsField}
          promoterCompsField={promoterCompsField}
          salesTargetField={salesTargetField}
          artistFeeField={artistFeeField}
          splitPercentageField={splitPercentageField}
          approvedExpensesField={approvedExpensesField}
          mealProvidedField={mealProvidedField}
          accommodationField={accommodationField}
          transportField={transportField}
          supabaseUrl={supabaseUrl}
          supabaseAnonKey={supabaseAnonKey}
          baseId={baseId}
          onBack={() => setSelectedEventId(null)}
        />
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-gray700 dark:text-gray-gray200">Événements</h1>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-gray500 dark:text-gray-gray400 cursor-pointer select-none">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="rounded" />
                Afficher tout
              </label>
              <p className="text-sm text-gray-gray400">{filteredEvents.length} / {events.length}</p>
            </div>
          </div>
          <div className="mb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par artiste, lieu, date..."
              className="w-full px-3 py-2 text-sm border border-gray-gray200 dark:border-gray-gray600 rounded-md bg-white dark:bg-gray-gray800 text-gray-gray700 dark:text-gray-gray200 focus:outline-none focus:ring-1 focus:ring-blue-blue placeholder-gray-gray400"
            />
          </div>
          <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-xs dark:shadow-none">
            <EventsList events={filteredEvents} columns={columns} onSelect={(evt) => setSelectedEventId(evt.id)} base={base} eventRecords={eventRecords} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

initializeBlock({ interface: () => <EventPageApp /> });
