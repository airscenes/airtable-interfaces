import { useState, useMemo, useRef, useEffect } from "react";
import {
  initializeBlock,
  useBase,
  useRecords,
  useCustomProperties,
  expandRecord,
} from "@airtable/blocks/interface/ui";
import { FieldType } from "@airtable/blocks/interface/models";
import "./style.css";

// ─── Constants ───────────────────────────────────────────────────────────────

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

const MONTHS_FR = [
  "Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre",
];

const DAYS_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseIsoDate(iso) {
  if (!iso) return null;
  const str = typeof iso === "string" ? iso : String(iso);
  const parts = str.split("T")[0].split("-");
  if (parts.length < 3) return null;
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
    day: parseInt(parts[2], 10),
  };
}

function parseIsoTime(iso) {
  if (!iso) return null;
  const str = typeof iso === "string" ? iso : String(iso);
  const tPart = str.split("T")[1];
  if (!tPart) return null;
  const timeParts = tPart.replace("Z", "").split(":");
  if (timeParts.length < 2) return null;
  return {
    hour: parseInt(timeParts[0], 10),
    minute: parseInt(timeParts[1], 10),
  };
}

function fmtTime(h, m) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toDateKey(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

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

function getEventColor(record, colorField, base) {
  const DEFAULT = { bg: "#e5e9f0", text: "#333" };
  if (!colorField) return DEFAULT;
  const raw = record.getCellValue(colorField);
  if (!raw) return DEFAULT;

  // Direct single select: {name, color}
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.name) {
    return AIRTABLE_COLORS[raw.color] || DEFAULT;
  }
  // Lookup / array: [{name, color}]
  if (Array.isArray(raw) && raw.length > 0 && raw[0]?.name) {
    return AIRTABLE_COLORS[raw[0].color] || DEFAULT;
  }
  // Fallback: resolve via choices
  const text = record.getCellValueAsString(colorField);
  if (text) {
    const choices = getFieldChoices(colorField, base);
    if (choices) {
      const match = choices.find((c) => c.name === text);
      if (match?.color) return AIRTABLE_COLORS[match.color] || DEFAULT;
    }
  }
  return DEFAULT;
}

// ─── Calendar grid builder ───────────────────────────────────────────────────

function buildCalendarGrid(year, month) {
  const now = new Date();
  const todayKey = toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

  // First day of month: convert JS Sunday=0 to Monday=0
  const jsDay = new Date(year, month - 1, 1).getDay();
  const offset = (jsDay + 6) % 7;

  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  // Padding before
  for (let i = 0; i < offset; i++) {
    cells.push({ day: null, dateKey: null, isToday: false });
  }
  // Days of month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = toDateKey(year, month, d);
    cells.push({ day: d, dateKey, isToday: dateKey === todayKey });
  }
  // Padding after (complete last week)
  while (cells.length % 7 !== 0) {
    cells.push({ day: null, dateKey: null, isToday: false });
  }

  // Chunk into weeks
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function buildDaysGrid(startDate, numDays) {
  const now = new Date();
  const todayKey = toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const cells = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const dateKey = toDateKey(y, m, day);
    cells.push({ day, dateKey, isToday: dateKey === todayKey, month: m, year: y });
  }
  return cells;
}

function build2WeeksGrid(refDate) {
  const monday = getMonday(refDate);
  const cells = buildDaysGrid(monday, 14);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function build3DaysGrid(refDate) {
  return buildDaysGrid(refDate, 3);
}

// ─── Event grouping ──────────────────────────────────────────────────────────

function groupEventsByDate(records, dateField) {
  const map = new Map();
  if (!dateField || !records) return map;
  for (const record of records) {
    const cellValue = record.getCellValue(dateField);
    if (!cellValue) continue;
    const parsed = parseIsoDate(cellValue);
    if (!parsed) continue;
    const key = toDateKey(parsed.year, parsed.month, parsed.day);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  return map;
}

// ─── Custom Properties ───────────────────────────────────────────────────────

function getCustomProperties(base) {
  const evtTable = base.tables.find(
    (t) => t.name.toLowerCase().includes("evenement") || t.name.toLowerCase().includes("événement")
  ) || base.tables[0];

  const projTable = base.tables.find(
    (t) => t.name.toLowerCase().includes("projet")
  ) || base.tables[1] || base.tables[0];

  const findField = (table, filter) => table?.fields?.find(filter) || null;

  const dateFields = evtTable?.fields?.filter((f) =>
    f.config.type === FieldType.DATE || f.config.type === FieldType.DATE_TIME
  ) || [];
  const dateField = dateFields[0] || null;
  const endDateField = dateFields[1] || null;

  const colorField = findField(evtTable, (f) =>
    f.config.type === FieldType.SINGLE_SELECT
  );

  const linkField = findField(evtTable, (f) =>
    f.config.type === FieldType.MULTIPLE_RECORD_LINKS &&
    f.name.toLowerCase().includes("projet")
  ) || findField(evtTable, (f) =>
    f.config.type === FieldType.MULTIPLE_RECORD_LINKS
  );

  return [
    {
      key: "eventsTable",
      label: "Table des evenements",
      type: "table",
      defaultValue: evtTable,
    },
    {
      key: "projetsTable",
      label: "Table des projets",
      type: "table",
      defaultValue: projTable,
    },
    {
      key: "dateField",
      label: "Champ date debut",
      type: "field",
      table: evtTable,
      shouldFieldBeAllowed: (f) =>
        f.config.type === FieldType.DATE || f.config.type === FieldType.DATE_TIME,
      defaultValue: dateField,
    },
    {
      key: "endDateField",
      label: "Champ date fin",
      type: "field",
      table: evtTable,
      shouldFieldBeAllowed: (f) =>
        f.config.type === FieldType.DATE || f.config.type === FieldType.DATE_TIME,
      defaultValue: endDateField,
    },
    {
      key: "nameField1",
      label: "Libelle 1",
      type: "field",
      table: evtTable,
      defaultValue: evtTable?.fields?.[0] || null,
    },
    {
      key: "nameField2",
      label: "Libelle 2",
      type: "field",
      table: evtTable,
      defaultValue: null,
    },
    {
      key: "colorField",
      label: "Champ couleur",
      type: "field",
      table: evtTable,
      shouldFieldBeAllowed: (f) =>
        f.config.type === FieldType.SINGLE_SELECT ||
        f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES,
      defaultValue: colorField,
    },
    {
      key: "projetLinkField",
      label: "Lien vers Projets",
      type: "field",
      table: evtTable,
      shouldFieldBeAllowed: (f) =>
        f.config.type === FieldType.MULTIPLE_RECORD_LINKS,
      defaultValue: linkField,
    },
  ];
}

// ─── Components ──────────────────────────────────────────────────────────────

function readFieldLabel(record, field) {
  if (!field) return null;
  const raw = record.getCellValue(field);
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw.map((r) => r.name || r).join(", ");
  if (raw.name) return raw.name;
  return String(raw);
}

function EventPill({ record, nameField1, nameField2, colorField, base, onClick }) {
  const color = getEventColor(record, colorField, base);
  const part1 = readFieldLabel(record, nameField1);
  const part2 = readFieldLabel(record, nameField2);
  let label = [part1, part2].filter(Boolean).join(" - ") || record.name;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(record); }}
      className="w-full text-left text-[11px] leading-tight truncate rounded px-1.5 py-0.5 cursor-pointer hover:opacity-80 transition-opacity"
      style={{ backgroundColor: color.bg, color: color.text }}
      title={label}
    >
      {label}
    </button>
  );
}

function DayCell({ cell, events, nameField1, nameField2, colorField, base, onEventClick }) {
  if (!cell.day) {
    return <div className="bg-gray-gray50 dark:bg-gray-gray900" />;
  }

  return (
    <div
      className={`p-1 border-t border-gray-gray100 dark:border-gray-gray700 ${
        cell.isToday ? "bg-blue-blueLight2 dark:bg-[#1a2a4a]" : "bg-white dark:bg-gray-gray800"
      }`}
    >
      <span
        className={`text-xs font-medium inline-block mb-0.5 ${
          cell.isToday
            ? "bg-blue-blueBright text-white rounded-full w-5 h-5 flex items-center justify-center"
            : "text-gray-gray500 dark:text-gray-gray300"
        }`}
      >
        {cell.day}
      </span>
      <div className="space-y-0.5">
        {events.map((record) => (
          <EventPill
            key={record.id}
            record={record}
            nameField1={nameField1}
            nameField2={nameField2}
            colorField={colorField}
            base={base}
            onClick={onEventClick}
          />
        ))}
      </div>
    </div>
  );
}

const HOUR_HEIGHT = 60;
const GRID_START_HOUR = 0;
const GRID_END_HOUR = 24;
const DEFAULT_SCROLL_HOUR = 8;
const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR + 1 }, (_, i) => GRID_START_HOUR + i);

function getTimePosition(record, dateField, endDateField) {
  const startRaw = record.getCellValue(dateField);
  const startTime = parseIsoTime(startRaw);
  const startH = startTime ? startTime.hour : DEFAULT_SCROLL_HOUR;
  const startM = startTime ? startTime.minute : 0;

  let endH = startH + 1;
  let endM = startM;
  if (endDateField) {
    const endRaw = record.getCellValue(endDateField);
    const endTime = parseIsoTime(endRaw);
    if (endTime) {
      endH = endTime.hour;
      endM = endTime.minute;
    }
  }

  const top = (startH - GRID_START_HOUR) * HOUR_HEIGHT + startM;
  const bottom = (endH - GRID_START_HOUR) * HOUR_HEIGHT + endM;
  const height = Math.max(bottom - top, 20);

  return {
    top,
    height,
    startLabel: fmtTime(startH, startM),
    endLabel: fmtTime(endH, endM),
  };
}

function layoutOverlapping(events) {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.top - b.top);
  const columns = [];
  for (const evt of sorted) {
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const last = columns[c][columns[c].length - 1];
      if (last.top + last.height <= evt.top) {
        columns[c].push(evt);
        evt.col = c;
        placed = true;
        break;
      }
    }
    if (!placed) {
      evt.col = columns.length;
      columns.push([evt]);
    }
  }
  const totalCols = columns.length;
  for (const evt of sorted) {
    evt.totalCols = totalCols;
  }
  return sorted;
}

function TimeGridColumn({ cell, events, nameField1, nameField2, colorField, dateField, endDateField, base, onEventClick }) {
  const positioned = useMemo(() => {
    const items = events.map((record) => {
      const pos = getTimePosition(record, dateField, endDateField);
      return { record, ...pos };
    });
    return layoutOverlapping(items);
  }, [events, dateField, endDateField]);

  return (
    <div className={`relative ${cell.isToday ? "bg-blue-blueLight2/30 dark:bg-[#1a2a4a]/30" : ""}`}
      style={{ height: (GRID_END_HOUR - GRID_START_HOUR + 1) * HOUR_HEIGHT }}
    >
      {positioned.map((evt) => {
        const color = getEventColor(evt.record, colorField, base);
        const part1 = readFieldLabel(evt.record, nameField1);
        const part2 = readFieldLabel(evt.record, nameField2);
        const label = [part1, part2].filter(Boolean).join(" - ") || evt.record.name;
        const widthPct = 100 / evt.totalCols;
        const leftPct = evt.col * widthPct;
        return (
          <button
            key={evt.record.id}
            onClick={(e) => { e.stopPropagation(); onEventClick(evt.record); }}
            className="absolute rounded px-1.5 py-1 text-[11px] leading-tight overflow-hidden cursor-pointer hover:opacity-80 transition-opacity border-l-[3px]"
            style={{
              top: evt.top,
              height: evt.height,
              left: `${leftPct}%`,
              width: `calc(${widthPct}% - 2px)`,
              backgroundColor: color.bg + "22",
              borderLeftColor: color.bg,
              color: color.text === "#fff" ? color.bg : color.text,
            }}
            title={`${label}\n${evt.startLabel} - ${evt.endLabel}`}
          >
            <div className="font-medium truncate">{label}</div>
            <div className="text-[10px] opacity-70">{evt.startLabel} - {evt.endLabel}</div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

function CalendarApp() {
  const base = useBase();
  const { customPropertyValueByKey } = useCustomProperties(getCustomProperties);

  const eventsTable = customPropertyValueByKey.eventsTable;
  const projetsTable = customPropertyValueByKey.projetsTable;
  const dateField = customPropertyValueByKey.dateField;
  const endDateField = customPropertyValueByKey.endDateField;
  const nameField1 = customPropertyValueByKey.nameField1;
  const nameField2 = customPropertyValueByKey.nameField2;
  const colorField = customPropertyValueByKey.colorField;
  const projetLinkField = customPropertyValueByKey.projetLinkField;

  const eventRecords = useRecords(eventsTable);
  const projetRecords = useRecords(projetsTable);

  const [viewMode, setViewMode] = useState("month");
  const [refDate, setRefDate] = useState(() => new Date());
  const timeGridRef = useRef(null);

  useEffect(() => {
    if (viewMode === "3days" && timeGridRef.current) {
      timeGridRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, [viewMode, refDate]);

  const currentYear = refDate.getFullYear();
  const currentMonth = refDate.getMonth() + 1;

  const monthGrid = useMemo(
    () => buildCalendarGrid(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const twoWeeksGrid = useMemo(
    () => build2WeeksGrid(refDate),
    [refDate]
  );

  const threeDaysGrid = useMemo(
    () => build3DaysGrid(refDate),
    [refDate]
  );

  const eventsByDate = useMemo(
    () => groupEventsByDate(eventRecords, dateField),
    [eventRecords, dateField]
  );

  function goPrev() {
    setRefDate((d) => {
      const next = new Date(d);
      if (viewMode === "month") {
        next.setMonth(next.getMonth() - 1);
      } else if (viewMode === "2weeks") {
        next.setDate(next.getDate() - 14);
      } else {
        next.setDate(next.getDate() - 3);
      }
      return next;
    });
  }

  function goNext() {
    setRefDate((d) => {
      const next = new Date(d);
      if (viewMode === "month") {
        next.setMonth(next.getMonth() + 1);
      } else if (viewMode === "2weeks") {
        next.setDate(next.getDate() + 14);
      } else {
        next.setDate(next.getDate() + 3);
      }
      return next;
    });
  }

  function goToday() {
    setRefDate(new Date());
  }

  function getHeaderTitle() {
    if (viewMode === "month") {
      return `${MONTHS_FR[currentMonth - 1]} ${currentYear}`;
    }
    if (viewMode === "2weeks") {
      const monday = getMonday(refDate);
      const end = new Date(monday);
      end.setDate(end.getDate() + 13);
      const startDay = monday.getDate();
      const startMonth = MONTHS_FR[monday.getMonth()];
      const endDay = end.getDate();
      const endMonth = MONTHS_FR[end.getMonth()];
      const endYear = end.getFullYear();
      if (monday.getMonth() === end.getMonth()) {
        return `${startDay} - ${endDay} ${endMonth} ${endYear}`;
      }
      return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${endYear}`;
    }
    // 3days
    const start = refDate;
    const end = new Date(refDate);
    end.setDate(end.getDate() + 2);
    const startDay = start.getDate();
    const startMonth = MONTHS_FR[start.getMonth()];
    const endDay = end.getDate();
    const endMonth = MONTHS_FR[end.getMonth()];
    const endYear = end.getFullYear();
    if (start.getMonth() === end.getMonth()) {
      return `${startDay} - ${endDay} ${endMonth} ${endYear}`;
    }
    return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${endYear}`;
  }

  function handleEventClick(eventRecord) {
    if (projetLinkField) {
      const linkValue = eventRecord.getCellValue(projetLinkField);
      if (Array.isArray(linkValue) && linkValue.length > 0) {
        const projetRecord = projetRecords?.find((r) => r.id === linkValue[0].id);
        if (projetRecord) {
          expandRecord(projetRecord);
          return;
        }
      }
    }
    expandRecord(eventRecord);
  }

  const viewBtnClass = (mode) =>
    `px-3 py-1 text-sm rounded-md transition-colors ${
      viewMode === mode
        ? "bg-blue-blueBright text-white"
        : "border border-gray-gray200 dark:border-gray-gray600 hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300"
    }`;

  const cellProps = { nameField1, nameField2, colorField, base, onEventClick: handleEventClick };

  return (
    <div className="p-3 bg-white dark:bg-gray-gray900 text-gray-gray800 dark:text-gray-gray100">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            onClick={goNext}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <h2 className="text-lg font-semibold ml-1">
            {getHeaderTitle()}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => setViewMode("month")} className={viewBtnClass("month")}>Mois</button>
            <button onClick={() => setViewMode("2weeks")} className={viewBtnClass("2weeks")}>2 Sem.</button>
            <button onClick={() => setViewMode("3days")} className={viewBtnClass("3days")}>3 Jours</button>
          </div>
          <button
            onClick={goToday}
            className="px-3 py-1 text-sm rounded-md border border-gray-gray200 dark:border-gray-gray600 hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 transition-colors"
          >
            Aujourd&apos;hui
          </button>
        </div>
      </div>

      {/* Month view */}
      {viewMode === "month" && (
        <>
          <div className="grid grid-cols-7 border-b border-gray-gray200 dark:border-gray-gray700 mb-0">
            {DAYS_SHORT.map((d) => (
              <div key={d} className="text-center text-xs font-medium text-gray-gray400 dark:text-gray-gray500 py-1.5">
                {d}
              </div>
            ))}
          </div>
          <div className="border border-gray-gray200 dark:border-gray-gray700 rounded-b-md overflow-hidden">
            {monthGrid.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 divide-x divide-gray-gray100 dark:divide-gray-gray700">
                {week.map((cell, ci) => (
                  <DayCell
                    key={ci}
                    cell={cell}
                    events={cell.dateKey ? eventsByDate.get(cell.dateKey) || [] : []}
                    {...cellProps}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* 2 weeks view */}
      {viewMode === "2weeks" && (
        <>
          <div className="grid grid-cols-7 border-b border-gray-gray200 dark:border-gray-gray700 mb-0">
            {DAYS_SHORT.map((d) => (
              <div key={d} className="text-center text-xs font-medium text-gray-gray400 dark:text-gray-gray500 py-1.5">
                {d}
              </div>
            ))}
          </div>
          <div className="border border-gray-gray200 dark:border-gray-gray700 rounded-b-md overflow-hidden">
            {twoWeeksGrid.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 divide-x divide-gray-gray100 dark:divide-gray-gray700">
                {week.map((cell, ci) => (
                  <DayCell
                    key={ci}
                    cell={cell}
                    events={cell.dateKey ? eventsByDate.get(cell.dateKey) || [] : []}
                    {...cellProps}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* 3 days time-grid view */}
      {viewMode === "3days" && (
        <>
          {/* Day headers with left gutter */}
          <div className="flex border-b border-gray-gray200 dark:border-gray-gray700">
            <div className="w-14 shrink-0" />
            <div className="grid grid-cols-3 flex-1">
              {threeDaysGrid.map((cell) => {
                const jsDate = new Date(cell.year, cell.month - 1, cell.day);
                const dayOfWeek = (jsDate.getDay() + 6) % 7;
                return (
                  <div key={cell.dateKey} className={`text-center text-xs font-medium py-2 ${cell.isToday ? "text-blue-blueBright" : "text-gray-gray400 dark:text-gray-gray500"}`}>
                    <div>{DAYS_SHORT[dayOfWeek]}.</div>
                    <div className={`text-lg font-semibold ${cell.isToday ? "text-blue-blueBright" : "text-gray-gray700 dark:text-gray-gray200"}`}>{cell.day}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Time grid */}
          <div ref={timeGridRef} className="border border-gray-gray200 dark:border-gray-gray700 rounded-b-md overflow-auto" style={{ maxHeight: "calc(100vh - 140px)" }}>
            <div className="flex">
              {/* Hour labels */}
              <div className="w-14 shrink-0">
                {HOURS.map((h) => (
                  <div key={h} className="text-right pr-2 text-[11px] text-gray-gray400 dark:text-gray-gray500" style={{ height: HOUR_HEIGHT }}>
                    {fmtTime(h, 0)}
                  </div>
                ))}
              </div>
              {/* Day columns */}
              <div className="grid grid-cols-3 flex-1 divide-x divide-gray-gray100 dark:divide-gray-gray700">
                {threeDaysGrid.map((cell) => (
                  <div key={cell.dateKey} className="relative">
                    {/* Hour lines */}
                    {HOURS.map((h) => (
                      <div key={h} className="border-t border-gray-gray100 dark:border-gray-gray700" style={{ height: HOUR_HEIGHT }} />
                    ))}
                    {/* Events overlay */}
                    <div className="absolute inset-0">
                      <TimeGridColumn
                        cell={cell}
                        events={cell.dateKey ? eventsByDate.get(cell.dateKey) || [] : []}
                        nameField1={nameField1}
                        nameField2={nameField2}
                        colorField={colorField}
                        dateField={dateField}
                        endDateField={endDateField}
                        base={base}
                        onEventClick={handleEventClick}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

initializeBlock({ interface: () => <CalendarApp /> });
