import { useState, useMemo, useEffect, useRef } from "react";
import {
  initializeBlock,
  useBase,
  useRecords,
  useCustomProperties,
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

function getCustomProperties(base) {
  const tables = base.tables;
  const spectaclesTable =
    tables.find((t) => t.name.toLowerCase().includes("spectacle")) || tables[0];
  const repsTable =
    tables.find((t) => t.name.toLowerCase().includes("repr")) ||
    tables[1] ||
    tables[0];

  const isLinkField = (field) =>
    field.config.type === FieldType.MULTIPLE_RECORD_LINKS;

  const isAttachmentField = (field) =>
    field.config.type === FieldType.MULTIPLE_ATTACHMENTS;

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

  const linkFields = repsTable.fields.filter(isLinkField);
  const attachmentFields = spectaclesTable.fields.filter(isAttachmentField);
  const numericFields = repsTable.fields.filter(isNumericField);
  const textFields = repsTable.fields.filter(isTextField);

  // Numeric fields from Spectacles table for KPIs
  const specNumericFields = spectaclesTable.fields.filter(isNumericField);

  // Smart defaults for table columns
  const findRepField = (keyword) =>
    repsTable.fields.find((f) => f.name.toLowerCase().includes(keyword));

  return [
    {
      key: "spectaclesTable",
      label: "Table des spectacles",
      type: "table",
      defaultValue: spectaclesTable,
    },
    {
      key: "imageField",
      label: "Champ image (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: attachmentFields[0],
    },
    {
      key: "cardSubtitleField",
      label: "Champ sous-titre carte (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "cardColorField",
      label: "Champ couleur carte (single select, dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "representationsTable",
      label: "Table des representations",
      type: "table",
      defaultValue: repsTable,
    },
    {
      key: "spectacleLinkField",
      label: "Champ lien Spectacle (dans Representations)",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isLinkField,
      defaultValue:
        linkFields.find((f) => f.name.toLowerCase().includes("spectacle")) ||
        linkFields[0],
    },
    {
      key: "repNameField",
      label: "Champ nom/date de la representation",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isTextField,
      defaultValue: textFields[0],
    },
    {
      key: "capacityField",
      label: "Champ Capacite totale (dans Representations)",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isNumericField,
      defaultValue:
        numericFields.find((f) => f.name.toLowerCase().includes("capacit")) ||
        numericFields[0],
    },
    {
      key: "revenuePotentialField",
      label: "Champ Potentiel en salle (dans Representations)",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isNumericField,
      defaultValue:
        numericFields.find((f) => f.name.toLowerCase().includes("potentiel")) ||
        numericFields.find((f) => f.name.toLowerCase().includes("revenu")),
    },
    // --- Table columns (Representations) ---
    {
      key: "colJoursRestants",
      label: "Colonne: Jours restants",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("jour") || findRepField("restant"),
    },
    {
      key: "colDateRep",
      label: "Colonne: Date representation",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("date"),
    },
    {
      key: "colSalle",
      label: "Colonne: Salle",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("salle"),
    },
    {
      key: "colVille",
      label: "Colonne: Ville",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("ville"),
    },
    {
      key: "colPlacesBloques",
      label: "Colonne: Places bloquees",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("bloqu"),
    },
    {
      key: "colBilletsDispo",
      label: "Colonne: Billets disponibles",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("disponib") || findRepField("billet"),
    },
    // --- KPIs (Spectacles) ---
    {
      key: "kpiField1",
      label: "KPI 1 (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
      defaultValue: specNumericFields[0],
    },
    {
      key: "kpiField2",
      label: "KPI 2 (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
      defaultValue: specNumericFields[1],
    },
    {
      key: "kpiField3",
      label: "KPI 3 (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
      defaultValue: specNumericFields[2],
    },
    {
      key: "kpiField4",
      label: "KPI 4 (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
      defaultValue: specNumericFields[3],
    },
    {
      key: "kpiField5",
      label: "KPI 5 (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
      defaultValue: specNumericFields[4],
    },
    {
      key: "kpiField6",
      label: "KPI 6 (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isNumericField,
      defaultValue: specNumericFields[5],
    },
    // --- Additional table columns (Representations) ---
    {
      key: "colTotalBilletsVendus",
      label: "Colonne: Total de billets vendus",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("vendu") || findRepField("billet"),
    },
    {
      key: "colTotalBilletsGratuits",
      label: "Colonne: Total de billets gratuits",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("gratuit"),
    },
    {
      key: "colAssistance",
      label: "Colonne: Assistance a ce jour",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("assistance"),
    },
    {
      key: "colTauxRemplissage",
      label: "Colonne: Taux de remplissage",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("remplissage") || findRepField("taux"),
    },
    {
      key: "colRevenus",
      label: "Colonne: Revenus totaux de billetterie",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("revenu") || findRepField("billetterie"),
    },
    {
      key: "colStatutRapport",
      label: "Colonne: Statut rapport",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("rapport"),
    },
    {
      key: "colObjectifRevenus",
      label: "Colonne: Objectif revenus producteur",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("objectif"),
    },
    {
      key: "colMiseAJour",
      label: "Colonne: Mise a jour des ventes",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("mise") || findRepField("update"),
    },
    {
      key: "colPriorisation",
      label: "Colonne: Priorisation Salles (SALLES)",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("priorisation"),
    },
    {
      key: "colBilleterieSalle",
      label: "Colonne: Billetterie Salle",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("billetterie"),
    },
    {
      key: "colNote",
      label: "Colonne: Note",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("note"),
    },
    {
      key: "colStatut",
      label: "Colonne: Statut",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("statut") || findRepField("status"),
    },
    {
      key: "colSiteWeb",
      label: "Colonne: Site web",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isAnyField,
      defaultValue: findRepField("site") || findRepField("web"),
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

function SalesChart({ data, capacity, revenueCapacity, height = 500 }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
          Aucune donnee de ventes pour cette representation.
        </p>
      </div>
    );
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
              yAxisId="left"
              orientation="left"
              stroke="#4a90d9"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) =>
                v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v
              }
              domain={[0, capacity || "auto"]}
              padding={{ top: 20, bottom: 10 }}
              label={{
                value: "Billets",
                angle: -90,
                position: "insideLeft",
                offset: -25,
                style: { fontSize: 11, fill: "#4a90d9", fontWeight: 600 },
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#6aa84f"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) =>
                `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} $`
              }
              domain={[0, revenueCapacity || "auto"]}
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
              formatter={(value, name) => {
                if (name === "Revenus ($)") {
                  return [
                    `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $`,
                    name,
                  ];
                }
                return [value.toLocaleString("fr-FR"), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="ventes"
              name="Ventes"
              stroke="#4a90d9"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="gratuits"
              name="Gratuits"
              stroke="#e06666"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              strokeDasharray="5 5"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="total_dollars"
              name="Revenus ($)"
              stroke="#6aa84f"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
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

function getColSelect(record, field, base) {
  if (!field) return { text: "", color: null };
  const raw = record.getCellValue(field);
  // Single-select: { id, name, color }
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.name) {
    return { text: raw.name, color: raw.color || null };
  }
  // Multiselect or lookup returning [{ id, name, color }, ...]
  if (Array.isArray(raw) && raw.length > 0 && raw[0]?.name) {
    return { text: raw[0].name, color: raw[0].color || null };
  }
  // Lookup returning plain strings — resolve color via field choices
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
  const [showAll, setShowAll] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterVille, setFilterVille] = useState("");
  const [filterSalle, setFilterSalle] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const cacheRef = useRef(new Map());

  // Stable string of selected rep IDs for useEffect dependency
  const selectedRepIdsStr = useMemo(
    () => [...selectedRepIds].sort().join(","),
    [selectedRepIds],
  );

  // Default filters: Statut = Confirmé, Site Web = En ligne, Date >= today
  const filteredRepsByStatus = useMemo(() => {
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

  // Unique cities and venues for filter dropdowns
  const uniqueVilles = useMemo(() => {
    const set = new Set(filteredRepsByStatus.map((r) => r.colVille).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [filteredRepsByStatus]);

  const uniqueSalles = useMemo(() => {
    const set = new Set(filteredRepsByStatus.map((r) => r.colSalle).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [filteredRepsByStatus]);

  // Apply city/venue filters
  const filteredReps = useMemo(() => {
    let reps = filteredRepsByStatus;
    if (filterVille) reps = reps.filter((r) => r.colVille === filterVille);
    if (filterSalle) reps = reps.filter((r) => r.colSalle === filterSalle);
    return reps;
  }, [filteredRepsByStatus, filterVille, filterSalle]);

  // Stable string of filtered rep IDs for cache key + useEffect dependency
  const allRepIds = useMemo(
    () => filteredReps.map((r) => r.id).join(","),
    [filteredReps],
  );

  // Reset stale filters when options change
  useEffect(() => {
    if (filterVille && !uniqueVilles.includes(filterVille)) setFilterVille("");
    if (filterSalle && !uniqueSalles.includes(filterSalle)) setFilterSalle("");
  }, [uniqueVilles, uniqueSalles, filterVille, filterSalle]);

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
          // Group rows by record_id, keyed by date (works for both all mode and multi-select)
          const byRecord = {};
          const allDatesSet = new Set();
          data.forEach((row) => {
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
          const recordIds = Object.keys(byRecord);
          let formatted;

          if (sortedDates.length > 0) {
            // Fill every calendar day; carry-forward per record
            // Cumulative data: values never decrease (use Math.max)
            // Use string-based date iteration to avoid UTC timezone shift
            const nextDay = (dateStr) => {
              const [y, m, d] = dateStr.split("-").map(Number);
              const dt = new Date(y, m - 1, d + 1);
              return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
            };
            const lastKnown = {};
            formatted = [];
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
                  if (!lastKnown[rid])
                    lastKnown[rid] = { sold: 0, free: 0, total: 0 };
                  lastKnown[rid].sold = Math.max(
                    lastKnown[rid].sold,
                    entry.sold,
                  );
                  lastKnown[rid].free = Math.max(
                    lastKnown[rid].free,
                    entry.free,
                  );
                  lastKnown[rid].total = Math.max(
                    lastKnown[rid].total,
                    entry.total,
                  );
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
          } else {
            formatted = [];
          }

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

  const localDateStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const activePreset = useMemo(() => {
    if (!dateFrom && !dateTo) return "all";
    const now = new Date();
    const ytdStart = `${now.getFullYear()}-01-01`;
    if (dateFrom === ytdStart && !dateTo) return "ytd";
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateFrom === localDateStr(yesterday) && dateTo === localDateStr(now))
      return "24h";
    for (const m of [3, 6, 12]) {
      const from = new Date(now);
      from.setMonth(from.getMonth() - m);
      if (dateFrom === localDateStr(from) && !dateTo) return m;
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
    return {
      ventesInPeriod: last.ventes - base.ventes,
      revenusInPeriod: last.total_dollars - base.total_dollars,
    };
  }, [filteredSalesData, salesData]);

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
  const setPreset = (preset) => {
    const now = new Date();
    if (preset === "all") {
      setDateFrom("");
      setDateTo("");
    } else if (preset === "24h") {
      const from = new Date(now);
      from.setDate(from.getDate() - 1);
      setDateFrom(localDateStr(from));
      setDateTo(localDateStr(now));
    } else if (preset === "ytd") {
      setDateFrom(`${now.getFullYear()}-01-01`);
      setDateTo("");
    } else {
      const from = new Date(now);
      from.setMonth(from.getMonth() - preset);
      setDateFrom(localDateStr(from));
      setDateTo("");
    }
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
    const presets = [
      { key: "24h", label: "24h" },
      { key: 3, label: "3m" },
      { key: 6, label: "6m" },
      { key: 12, label: "1an" },
      { key: "ytd", label: "YTD" },
      { key: "all", label: "Tout" },
    ];
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
          data={filteredSalesData}
          capacity={selectedRep ? selectedRep.capacity : totalCapacity}
          revenueCapacity={selectedRep ? selectedRep.revenuePotential : totalRevenuePotential}
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
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-gray600 dark:text-gray-gray300">
            Representations ({filteredReps.length}
            {filteredReps.length !== representations.length
              ? ` / ${representations.length}`
              : ""}
            )
          </h3>
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
            <table className="w-full text-sm text-gray-gray700 dark:text-gray-gray200" style={{ minWidth: 1600 }}>
              <thead>
                <tr className="bg-gray-gray75 dark:bg-gray-gray800 text-gray-gray600 dark:text-gray-gray300 text-left text-xs">
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
                  <th className="px-3 py-2 font-semibold">J. restants</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Salle</th>
                  <th className="px-3 py-2 font-semibold">Ville</th>
                  <th className="px-3 py-2 font-semibold text-right">
                    Capacite
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    Places bloq.
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    Billets dispo
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">Total vendus</th>
                  <th className="px-3 py-2 font-semibold text-right">Total gratuits</th>
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
                    onClick={() => {
                      setSelectedRepIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(rep.id)) {
                          next.delete(rep.id);
                        } else {
                          next.add(rep.id);
                        }
                        return next;
                      });
                    }}
                    className={`cursor-pointer border-t border-gray-gray100 dark:border-gray-gray600 transition-colors
                                            ${
                                              selectedRepIds.has(rep.id)
                                                ? "bg-blue-blueLight3 dark:bg-blue-blueDark1 font-medium"
                                                : "hover:bg-gray-gray25 dark:hover:bg-gray-gray600"
                                            }`}
                  >
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
                    <td className="px-3 py-2">{rep.colJoursRestants}</td>
                    <td className="px-3 py-2">{rep.colDateRep}</td>
                    <td className="px-3 py-2">{rep.colSalle}</td>
                    <td className="px-3 py-2">{rep.colVille}</td>
                    <td className="px-3 py-2 text-right">{fmtNumber(rep.colCapacite)}</td>
                    <td className="px-3 py-2 text-right">{fmtNumber(rep.colPlacesBloques)}</td>
                    <td className="px-3 py-2 text-right">{fmtNumber(rep.colBilletsDispo)}</td>
                    <td className="px-3 py-2 text-right">{fmtNumber(rep.colTotalBilletsVendus)}</td>
                    <td className="px-3 py-2 text-right">{fmtNumber(rep.colTotalBilletsGratuits)}</td>
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
                Aucune representation trouvee.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main App ---

function SalesChartApp() {
  const base = useBase();
  const { customPropertyValueByKey, errorState } =
    useCustomProperties(getCustomProperties);

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

  const spectacleRecords = useRecords(spectaclesTable);
  const repRecords = useRecords(repsTable);

  const [selectedSpectacleId, setSelectedSpectacleId] = useState(null);
  const [search, setSearch] = useState("");

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
      value: record.getCellValueAsString(field),
    }));
  }, [selectedSpectacleId, spectacleRecords, kpiFields]);

  // Build spectacle data with images
  const spectacles = useMemo(() => {
    if (!spectacleRecords) return [];

    // Aggregate total sold per spectacle from rep records
    const soldBySpectacle = {};
    if (repRecords && spectacleLinkField && colTotalBilletsVendus) {
      repRecords.forEach((rep) => {
        const links = rep.getCellValue(spectacleLinkField);
        if (!Array.isArray(links)) return;
        const raw = rep.getCellValue(colTotalBilletsVendus);
        const sold = typeof raw === "number" ? raw : parseFloat(raw) || 0;
        links.forEach((link) => {
          soldBySpectacle[link.id] = (soldBySpectacle[link.id] || 0) + sold;
        });
      });
    }

    return spectacleRecords
      .map((record) => {
        let imageUrl = null;
        if (imageField) {
          const cellValue = record.getCellValue(imageField);
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
        const subtitle = cardSubtitleField ? record.getCellValueAsString(cardSubtitleField) : "";
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
      .filter((s) => s.name)
      .sort((a, b) => b.totalSold - a.totalSold);
  }, [spectacleRecords, imageField, cardSubtitleField, cardColorField, base, repRecords, spectacleLinkField, colTotalBilletsVendus]);

  // Filter spectacles by search
  const filteredSpectacles = useMemo(() => {
    if (!search) return spectacles;
    const lower = search.toLowerCase();
    return spectacles.filter((s) => s.name.toLowerCase().includes(lower));
  }, [spectacles, search]);

  // Get representations for selected spectacle (with table column values)
  const representations = useMemo(() => {
    if (!repRecords || !selectedSpectacleId || !spectacleLinkField) return [];

    const getCol = (record, field) =>
      field ? record.getCellValueAsString(field) : "";

    return repRecords
      .filter((record) => {
        const linkValue = record.getCellValue(spectacleLinkField);
        if (!Array.isArray(linkValue)) return false;
        return linkValue.some((link) => link.id === selectedSpectacleId);
      })
      .map((record) => {
        let cap = null;
        if (capacityField) {
          const val = record.getCellValue(capacityField);
          cap = typeof val === "number" ? val : parseFloat(String(val)) || null;
        }
        let revPotential = null;
        if (revenuePotentialField) {
          const val = record.getCellValue(revenuePotentialField);
          revPotential =
            typeof val === "number" ? val : parseFloat(String(val)) || null;
        }
        // Raw values for filtering/sorting
        let rawDate = null;
        if (colDateRep) {
          const dv = record.getCellValue(colDateRep);
          if (dv) rawDate = new Date(dv);
        }
        const rawStatus = filterStatusField
          ? record.getCellValueAsString(filterStatusField)
          : "";
        const rawOnSale = colOnSale ? record.getCellValue(colOnSale) : null;

        const getNum = (field) => {
          if (!field) return null;
          const v = record.getCellValue(field);
          return typeof v === "number" ? v : null;
        };

        return {
          id: record.id,
          name: repNameField
            ? record.getCellValueAsString(repNameField)
            : record.name,
          capacity: cap,
          revenuePotential: revPotential,
          rawDate,
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
      .filter((r) => r.name)
      .sort((a, b) => {
        if (a.rawDate && b.rawDate) return a.rawDate - b.rawDate;
        if (a.rawDate) return -1;
        if (b.rawDate) return 1;
        return a.name.localeCompare(b.name, "fr");
      });
  }, [
    base,
    repRecords,
    selectedSpectacleId,
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
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un spectacle..."
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

initializeBlock({ interface: () => <SalesChartApp /> });
