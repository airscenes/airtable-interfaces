import { useState, useMemo } from "react";
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

  const dateField = findField(evtTable, (f) =>
    f.config.type === FieldType.DATE || f.config.type === FieldType.DATE_TIME
  );

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
      label: "Champ date",
      type: "field",
      table: evtTable,
      shouldFieldBeAllowed: (f) =>
        f.config.type === FieldType.DATE || f.config.type === FieldType.DATE_TIME,
      defaultValue: dateField,
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

// ─── Main App ────────────────────────────────────────────────────────────────

function CalendarApp() {
  const base = useBase();
  const { customPropertyValueByKey } = useCustomProperties(getCustomProperties);

  const eventsTable = customPropertyValueByKey.eventsTable;
  const projetsTable = customPropertyValueByKey.projetsTable;
  const dateField = customPropertyValueByKey.dateField;
  const nameField1 = customPropertyValueByKey.nameField1;
  const nameField2 = customPropertyValueByKey.nameField2;
  const colorField = customPropertyValueByKey.colorField;
  const projetLinkField = customPropertyValueByKey.projetLinkField;

  const eventRecords = useRecords(eventsTable);
  const projetRecords = useRecords(projetsTable);

  const now = new Date();
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(now.getMonth() + 1);

  const grid = useMemo(
    () => buildCalendarGrid(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const eventsByDate = useMemo(
    () => groupEventsByDate(eventRecords, dateField),
    [eventRecords, dateField]
  );

  function prevMonth() {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }

  function goToday() {
    const n = new Date();
    setCurrentYear(n.getFullYear());
    setCurrentMonth(n.getMonth() + 1);
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

  return (
    <div className="p-3 bg-white dark:bg-gray-gray900 text-gray-gray800 dark:text-gray-gray100">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            onClick={nextMonth}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <h2 className="text-lg font-semibold ml-1">
            {MONTHS_FR[currentMonth - 1]} {currentYear}
          </h2>
        </div>
        <button
          onClick={goToday}
          className="px-3 py-1 text-sm rounded-md border border-gray-gray200 dark:border-gray-gray600 hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 transition-colors"
        >
          Aujourd&apos;hui
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-gray-gray200 dark:border-gray-gray700 mb-0">
        {DAYS_SHORT.map((d) => (
          <div
            key={d}
            className="text-center text-xs font-medium text-gray-gray400 dark:text-gray-gray500 py-1.5"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="border border-gray-gray200 dark:border-gray-gray700 rounded-b-md overflow-hidden">
        {grid.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x divide-gray-gray100 dark:divide-gray-gray700">
            {week.map((cell, ci) => (
              <DayCell
                key={ci}
                cell={cell}
                events={cell.dateKey ? eventsByDate.get(cell.dateKey) || [] : []}
                nameField1={nameField1}
                nameField2={nameField2}
                colorField={colorField}
                base={base}
                onEventClick={handleEventClick}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

initializeBlock({ interface: () => <CalendarApp /> });
