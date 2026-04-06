import { useState, useMemo, useEffect, useRef } from "react";
import {
  initializeBlock,
  useBase,
  useRecords,
  useCustomProperties,
} from "@airtable/blocks/interface/ui";
import { FieldType } from "@airtable/blocks/interface/models";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import "./style.css";

// --- Helpers ---

const MONTHS_SHORT = ["jan", "fev", "mar", "avr", "mai", "jun", "jul", "aou", "sep", "oct", "nov", "dec"];

function formatMonth(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length < 2) return isoDate;
  const month = parseInt(parts[1], 10) - 1;
  const year = parts[0];
  return `${MONTHS_SHORT[month]} ${year}`;
}

const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "\u2014"
    : `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $`;

const fmtNumber = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "\u2014"
    : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });

// Chart color palette for tracks
const TRACK_COLORS = [
  "#4a90d9", "#6aa84f", "#e06666", "#f6b26b", "#8e7cc3",
  "#c27ba0", "#76a5af", "#d5a6bd", "#ffe599", "#a4c2f4",
  "#b6d7a8", "#ea9999", "#f9cb9c", "#b4a7d6", "#d5a6bd",
  "#a2c4c9", "#dd7e6b", "#93c47d", "#ffd966", "#6fa8dc",
];

// --- Custom Properties ---

function getCustomProperties(base) {
  const tables = base.tables;
  const spectaclesTable =
    tables.find((t) => t.name.toLowerCase().includes("spectacle")) || tables[0];
  const oeuvresTable =
    tables.find((t) => t.name.toLowerCase().includes("oeuvre")) ||
    tables.find((t) => t.name.toLowerCase().includes("piste")) ||
    tables[1] || tables[0];

  const isLinkField = (field) =>
    field.config.type === FieldType.MULTIPLE_RECORD_LINKS;

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
      label: "Table des spectacles",
      type: "table",
    },
    {
      key: "imageField",
      label: "Champ image (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "cardSubtitleField",
      label: "Champ sous-titre carte (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isAnyField,
    },
    {
      key: "oeuvresTable",
      label: "Table des oeuvres",
      type: "table",
    },
    {
      key: "oeuvresLinkField",
      label: "Champ lien Oeuvres (dans Spectacles)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isLinkField,
    },
    {
      key: "isrcField",
      label: "Champ ISRC (dans Oeuvres)",
      type: "field",
      table: oeuvresTable,
      shouldFieldBeAllowed: isTextField,
    },
    {
      key: "trackTitleField",
      label: "Champ titre de la piste (dans Oeuvres)",
      type: "field",
      table: oeuvresTable,
      shouldFieldBeAllowed: isTextField,
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
    {
      key: "clientId",
      label: "Client UUID (royalties)",
      type: "string",
      defaultValue: "",
    },
  ];
}

// --- Gallery Card ---

function getInitials(name) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

function SpectacleCard({ name, subtitle, imageUrl, onClick }) {
  const initials = getInitials(name);
  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm overflow-hidden cursor-pointer
                     hover:shadow-md transition-shadow duration-200 border border-gray-gray100 dark:border-gray-gray600"
    >
      <div className="w-full" style={{ height: 160, overflow: "hidden" }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            className="flex items-center justify-center h-full"
            style={{ backgroundColor: "#666" }}
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

// --- Royalties Chart ---

function RoyaltiesChart({ data, selectedIsrcs, height = 400 }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
          Aucune donnee de royalties pour cette periode.
        </p>
      </div>
    );
  }

  // If specific ISRCs selected, show stacked bars per track; otherwise total
  const trackKeys = selectedIsrcs.length > 0
    ? selectedIsrcs
    : [...new Set(data.flatMap((d) => Object.keys(d).filter((k) => k !== "month" && k !== "monthLabel" && k !== "total")))];

  return (
    <div className="bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm">
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 30, bottom: 5, left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" vertical={false} />
            <XAxis
              dataKey="monthLabel"
              tick={{ fontSize: 10 }}
              interval={0}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(2)} $`}
              label={{
                value: "Revenu net ($)",
                angle: -90,
                position: "insideLeft",
                offset: -15,
                style: { fontSize: 11, fill: "#4a90d9", fontWeight: 600 },
              }}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid #e0e0e0",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}
              formatter={(value, name) => [fmtCurrency(value), name]}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            {trackKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="revenue"
                fill={TRACK_COLORS[i % TRACK_COLORS.length]}
                name={key}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// --- Track List ---

function TrackList({ tracks, selectedIsrcs, onToggle, onSelectAll, onDeselectAll }) {
  const allSelected = selectedIsrcs.length === 0;
  return (
    <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100 dark:border-gray-gray600 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-gray100 dark:border-gray-gray600">
        <span className="text-xs font-semibold text-gray-gray600 dark:text-gray-gray300">
          Pistes ({tracks.length})
        </span>
        <button
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="text-xs text-blue-blue hover:text-blue-blueDark1 dark:text-blue-blueLight1 font-medium"
        >
          {allSelected ? "Deselectionner" : "Voir tout"}
        </button>
      </div>
      <div style={{ maxHeight: 350, overflowY: "auto" }}>
        {tracks.map((track, i) => {
          const isActive = allSelected || selectedIsrcs.includes(track.label);
          return (
            <div
              key={track.isrc}
              onClick={() => onToggle(track.label)}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors text-xs
                ${isActive ? "bg-blue-blueLight3 dark:bg-gray-gray600" : "hover:bg-gray-gray50 dark:hover:bg-gray-gray600"}`}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: TRACK_COLORS[i % TRACK_COLORS.length],
                  flexShrink: 0,
                }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-gray700 dark:text-gray-gray200 truncate">
                  {track.title || track.isrc}
                </p>
                <p className="text-gray-gray400 truncate">{track.isrc}</p>
              </div>
              <span className="text-gray-gray500 dark:text-gray-gray400 font-medium whitespace-nowrap">
                {fmtCurrency(track.totalRevenue)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Detail Page ---

function DetailPage({
  spectacle,
  oeuvresRecords,
  isrcField,
  trackTitleField,
  supabaseUrl,
  supabaseAnonKey,
  clientId,
  onBack,
}) {
  const [selectedIsrcs, setSelectedIsrcs] = useState([]);
  const [royaltiesData, setRoyaltiesData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const cacheRef = useRef(new Map());

  // Extract ISRCs from oeuvres records
  const tracks = useMemo(() => {
    if (!oeuvresRecords || !isrcField) return [];
    return oeuvresRecords
      .map((rec) => {
        const isrc = rec.getCellValueAsString(isrcField);
        const title = trackTitleField ? rec.getCellValueAsString(trackTitleField) : "";
        return { isrc, title, label: title || isrc, recordId: rec.id };
      })
      .filter((t) => t.isrc);
  }, [oeuvresRecords, isrcField, trackTitleField]);

  const isrcList = useMemo(() => tracks.map((t) => t.isrc), [tracks]);
  const isrcToLabel = useMemo(() => {
    const map = {};
    tracks.forEach((t) => { map[t.isrc] = t.label; });
    return map;
  }, [tracks]);

  // Fetch royalties from Supabase RPC
  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey || !clientId || isrcList.length === 0) {
      setRoyaltiesData(null);
      return;
    }

    const cacheKey = `${isrcList.join(",")}_${dateFrom}_${dateTo}_${refreshKey}`;
    let didCancel = false;

    const fetchRoyalties = async () => {
      if (cacheRef.current.has(cacheKey)) {
        if (!didCancel) {
          setRoyaltiesData(cacheRef.current.get(cacheKey));
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const body = {
          p_client_id: clientId,
          p_isrcs: isrcList,
          p_from: dateFrom || "2020-01-01",
          p_to: dateTo || "2030-12-31",
        };

        const response = await fetch(
          `${supabaseUrl}/rest/v1/rpc/get_royalties_summary`,
          {
            method: "POST",
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${supabaseAnonKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          },
        );

        if (!response.ok) {
          throw new Error(`Erreur Supabase: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!didCancel) {
          cacheRef.current.set(cacheKey, data);
          setRoyaltiesData(data);
          setLoading(false);
        }
      } catch (err) {
        if (!didCancel) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchRoyalties();
    return () => { didCancel = true; };
  }, [supabaseUrl, supabaseAnonKey, clientId, isrcList, dateFrom, dateTo, refreshKey]);

  // Transform raw data into chart format
  const { chartData, tracksWithRevenue } = useMemo(() => {
    if (!royaltiesData || royaltiesData.length === 0) {
      return { chartData: [], tracksWithRevenue: tracks.map((t) => ({ ...t, totalRevenue: 0 })) };
    }

    // Group by month
    const byMonth = {};
    const revByTrack = {};

    royaltiesData.forEach((row) => {
      const monthKey = row.reporting_month?.split("T")[0] || row.reporting_month;
      const label = isrcToLabel[row.isrc] || row.track_title || row.isrc;
      const rev = parseFloat(row.total_net_revenue) || 0;

      if (!byMonth[monthKey]) byMonth[monthKey] = { month: monthKey, monthLabel: formatMonth(monthKey) };
      byMonth[monthKey][label] = (byMonth[monthKey][label] || 0) + rev;
      byMonth[monthKey].total = (byMonth[monthKey].total || 0) + rev;

      revByTrack[row.isrc] = (revByTrack[row.isrc] || 0) + rev;
    });

    const chartData = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));

    const tracksWithRevenue = tracks.map((t) => ({
      ...t,
      totalRevenue: revByTrack[t.isrc] || 0,
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);

    return { chartData, tracksWithRevenue };
  }, [royaltiesData, tracks, isrcToLabel]);

  // KPIs
  const totalRevenue = useMemo(() => {
    if (!chartData.length) return 0;
    return chartData.reduce((sum, d) => sum + (d.total || 0), 0);
  }, [chartData]);

  const totalQuantity = useMemo(() => {
    if (!royaltiesData) return 0;
    return royaltiesData.reduce((sum, r) => sum + (parseInt(r.total_quantity) || 0), 0);
  }, [royaltiesData]);

  // Toggle track selection
  const handleToggle = (label) => {
    setSelectedIsrcs((prev) => {
      if (prev.length === 0) return [label];
      if (prev.includes(label)) {
        const next = prev.filter((l) => l !== label);
        return next.length === 0 ? [] : next;
      }
      return [...prev, label];
    });
  };

  // Presets
  const presets = [
    { key: 3, label: "3m" },
    { key: 6, label: "6m" },
    { key: 12, label: "1an" },
    { key: "all", label: "Tout" },
  ];

  const localDateStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const activePreset = useMemo(() => {
    if (!dateFrom && !dateTo) return "all";
    const now = new Date();
    for (const m of [3, 6, 12]) {
      const from = new Date(now);
      from.setMonth(from.getMonth() - m);
      if (dateFrom === localDateStr(from) && !dateTo) return m;
    }
    return null;
  }, [dateFrom, dateTo]);

  const setPreset = (preset) => {
    if (preset === "all") {
      setDateFrom("");
      setDateTo("");
    } else {
      const now = new Date();
      const from = new Date(now);
      from.setMonth(from.getMonth() - preset);
      setDateFrom(localDateStr(from));
      setDateTo("");
    }
  };

  const btnBase = "px-2 py-0.5 rounded text-xs font-medium transition-colors";
  const btnActive = "bg-blue-blue text-white";
  const btnInactive = "bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray200 dark:hover:bg-gray-gray500";
  const inputStyle = {
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 4,
    border: "1px solid #d0d5dd",
    backgroundColor: "#fff",
    color: "#333",
    width: 120,
  };

  // Chart content
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
          <p className="text-sm text-red-red dark:text-red-redLight1">{error}</p>
        </div>
      );
    }
    if (!royaltiesData || royaltiesData.length === 0) {
      return (
        <div className={placeholderClass}>
          <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
            {isrcList.length === 0 ? "Aucun ISRC dans les oeuvres liees." : "Aucune donnee de royalties."}
          </p>
        </div>
      );
    }

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
              maxLength={10}
              style={inputStyle}
            />
            <span className="text-xs text-gray-gray400">&mdash;</span>
            <input
              type="text"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="yyyy-mm-dd"
              maxLength={10}
              style={inputStyle}
            />
            <button
              onClick={() => { cacheRef.current.clear(); setRefreshKey((k) => k + 1); }}
              title="Rafraichir les donnees"
              className={`${btnBase} ${btnInactive}`}
            >
              &#8634;
            </button>
          </div>
        </div>

        {/* Mode label */}
        {selectedIsrcs.length > 0 ? (
          <button
            onClick={() => setSelectedIsrcs([])}
            className="flex items-center gap-1 text-xs font-medium text-blue-blue hover:text-blue-blueDark1
                         dark:text-blue-blueLight1 dark:hover:text-blue-blueLight2 transition-colors mb-1 mx-auto"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Voir le total ({selectedIsrcs.length} piste{selectedIsrcs.length > 1 ? "s" : ""})
          </button>
        ) : (
          <p className="text-xs text-gray-gray500 dark:text-gray-gray400 mb-1 text-center font-medium">
            Total &mdash; toutes les pistes
          </p>
        )}

        <RoyaltiesChart data={chartData} selectedIsrcs={selectedIsrcs} height={320} />
      </div>
    );
  })();

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
      {/* Back + title */}
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
          {spectacle.name}
        </h2>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100 dark:border-gray-gray600 p-4 text-center">
          <p className="text-2xl font-bold font-display text-gray-gray800 dark:text-gray-gray100">
            {fmtCurrency(totalRevenue)}
          </p>
          <p className="text-xs text-gray-gray400 mt-1">Revenu net total</p>
        </div>
        <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100 dark:border-gray-gray600 p-4 text-center">
          <p className="text-2xl font-bold font-display text-gray-gray800 dark:text-gray-gray100">
            {fmtNumber(totalQuantity)}
          </p>
          <p className="text-xs text-gray-gray400 mt-1">Streams / ventes</p>
        </div>
        <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100 dark:border-gray-gray600 p-4 text-center">
          <p className="text-2xl font-bold font-display text-gray-gray800 dark:text-gray-gray100">
            {tracks.length}
          </p>
          <p className="text-xs text-gray-gray400 mt-1">Pistes (ISRCs)</p>
        </div>
      </div>

      {/* Chart + Track List */}
      <div className="flex gap-5" style={{ minHeight: 400 }}>
        <div style={{ width: "65%" }}>{chartContent}</div>
        <div style={{ width: "35%" }}>
          <TrackList
            tracks={tracksWithRevenue}
            selectedIsrcs={selectedIsrcs}
            onToggle={handleToggle}
            onSelectAll={() => setSelectedIsrcs([])}
            onDeselectAll={() => setSelectedIsrcs([tracksWithRevenue[0]?.label].filter(Boolean))}
          />
        </div>
      </div>
    </div>
  );
}

// --- Main App ---

function RoyaltiesApp() {
  const base = useBase();
  const customProperties = useCustomProperties(getCustomProperties, base);

  const spectaclesTable = customProperties.spectaclesTable;
  const oeuvresTable = customProperties.oeuvresTable;
  const imageField = customProperties.imageField;
  const cardSubtitleField = customProperties.cardSubtitleField;
  const oeuvresLinkField = customProperties.oeuvresLinkField;
  const isrcField = customProperties.isrcField;
  const trackTitleField = customProperties.trackTitleField;
  const supabaseUrl = customProperties.supabaseUrl;
  const supabaseAnonKey = customProperties.supabaseAnonKey;
  const clientId = customProperties.clientId;

  const spectaclesRecords = useRecords(spectaclesTable);
  const oeuvresRecords = useRecords(oeuvresTable);

  const [selectedSpectacleId, setSelectedSpectacleId] = useState(null);

  // Build spectacles list
  const spectacles = useMemo(() => {
    if (!spectaclesRecords) return [];
    return spectaclesRecords.map((rec) => {
      let imageUrl = null;
      if (imageField) {
        const attachments = rec.getCellValue(imageField);
        if (Array.isArray(attachments) && attachments.length > 0) {
          imageUrl = attachments[0].thumbnails?.large?.url || attachments[0].url;
        }
      }
      const subtitle = cardSubtitleField ? rec.getCellValueAsString(cardSubtitleField) : "";
      return {
        id: rec.id,
        name: rec.name,
        subtitle,
        imageUrl,
        record: rec,
      };
    });
  }, [spectaclesRecords, imageField, cardSubtitleField]);

  // Get oeuvres linked to selected spectacle
  const selectedSpectacle = spectacles.find((s) => s.id === selectedSpectacleId);

  const linkedOeuvres = useMemo(() => {
    if (!selectedSpectacle || !oeuvresLinkField || !oeuvresRecords) return [];
    const linkedIds = new Set();
    const links = selectedSpectacle.record.getCellValue(oeuvresLinkField);
    if (Array.isArray(links)) {
      links.forEach((link) => linkedIds.add(link.id));
    }
    return oeuvresRecords.filter((rec) => linkedIds.has(rec.id));
  }, [selectedSpectacle, oeuvresLinkField, oeuvresRecords]);

  if (selectedSpectacle) {
    return (
      <DetailPage
        spectacle={selectedSpectacle}
        oeuvresRecords={linkedOeuvres}
        isrcField={isrcField}
        trackTitleField={trackTitleField}
        supabaseUrl={supabaseUrl}
        supabaseAnonKey={supabaseAnonKey}
        clientId={clientId}
        onBack={() => setSelectedSpectacleId(null)}
      />
    );
  }

  // Gallery view
  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
      <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray200 mb-5">
        Royalties par spectacle
      </h1>
      {spectacles.length === 0 ? (
        <p className="text-sm text-gray-gray400">Aucun spectacle trouve.</p>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {spectacles.map((spec) => (
            <SpectacleCard
              key={spec.id}
              name={spec.name}
              subtitle={spec.subtitle}
              imageUrl={spec.imageUrl}
              onClick={() => setSelectedSpectacleId(spec.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

initializeBlock({ interface: () => <RoyaltiesApp /> });
