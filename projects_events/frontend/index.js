import { useState, useMemo, useCallback, useEffect } from "react";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function isSelectType(field) {
  if (!field) return false;
  try {
    const t = field.config.type;
    return t === FieldType.SINGLE_SELECT || t === FieldType.MULTIPLE_SELECTS || t === FieldType.MULTIPLE_LOOKUP_VALUES;
  } catch { return false; }
}

function isLinkType(field) {
  if (!field) return false;
  try {
    return field.config.type === FieldType.MULTIPLE_RECORD_LINKS;
  } catch { return false; }
}

function isNumericType(field) {
  if (!field) return false;
  try {
    const t = field.config.type;
    return t === FieldType.NUMBER || t === FieldType.CURRENCY || t === FieldType.PERCENT ||
           t === FieldType.FORMULA || t === FieldType.ROLLUP || t === FieldType.COUNT;
  } catch { return false; }
}

const fmtNumber = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });

const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : Number(v).toLocaleString("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });

// ─── Components ──────────────────────────────────────────────────────────────

function SelectBadge({ value }) {
  if (!value || !value.text) return <span className="text-gray-400">—</span>;
  const palette = value.color ? AIRTABLE_COLORS[value.color] : null;
  if (!palette) return <span>{value.text}</span>;
  return (
    <span
      style={{ backgroundColor: palette.bg, color: palette.text, padding: "2px 10px", borderRadius: 9999, fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", display: "inline-block" }}
    >
      {value.text}
    </span>
  );
}

function LinkedRecordPillsResolved({ table, links }) {
  const linkedRecords = useRecords(table);
  return (
    <div className="flex flex-wrap gap-1">
      {links.map((link) => {
        const resolved = linkedRecords?.find((r) => r.id === link.id);
        return (
          <button
            key={link.id}
            onClick={(e) => {
              e.stopPropagation();
              if (resolved) expandRecord(resolved);
            }}
            className="text-blue-blue hover:text-blue-blueDark1 text-sm underline decoration-dotted cursor-pointer bg-transparent border-none p-0"
            title={link.name || "Ouvrir"}
          >
            {link.name || "—"}
          </button>
        );
      })}
    </div>
  );
}

function LinkedRecordPills({ record, field, base }) {
  if (!field) return <span className="text-gray-400">—</span>;
  const raw = record.getCellValue(field);
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return <span className="text-gray-400">—</span>;
  }

  let linkedTable = null;
  try {
    const linkedTableId = field.config?.options?.linkedTableId;
    if (linkedTableId) linkedTable = base.tables.find((t) => t.id === linkedTableId) || null;
  } catch { /* ignore */ }

  if (linkedTable) {
    return <LinkedRecordPillsResolved table={linkedTable} links={raw} />;
  }

  // Fallback: show names without expandRecord
  return (
    <div className="flex flex-wrap gap-1">
      {raw.map((link) => (
        <span key={link.id} className="text-sm text-gray-700 dark:text-gray-200">{link.name || "—"}</span>
      ))}
    </div>
  );
}

function FieldValue({ record, field, base }) {
  if (!field) return <span className="text-gray-400">—</span>;

  if (isLinkType(field)) {
    return <LinkedRecordPills record={record} field={field} base={base} />;
  }

  if (isSelectType(field)) {
    const sel = getColSelect(record, field, base);
    return <SelectBadge value={sel} />;
  }

  if (isNumericType(field)) {
    const v = record.getCellValue(field);
    if (v == null) return <span className="text-gray-400">—</span>;
    // Formula/rollup fields can return strings — fall through to text rendering
    if (typeof v !== "number") return <span>{String(v)}</span>;
    try {
      if (field.config.type === FieldType.CURRENCY) return <span>{fmtCurrency(v)}</span>;
      if (field.config.type === FieldType.PERCENT) return <span>{fmtNumber(v * 100)}%</span>;
    } catch { /* fallthrough */ }
    return <span>{fmtNumber(v)}</span>;
  }

  const text = record.getCellValueAsString(field);
  return <span>{text || "—"}</span>;
}

// ─── Custom Properties ───────────────────────────────────────────────────────

function getCustomProperties(base) {
  const tables = base.tables;
  const projetsTable = tables.find((t) => t.name.toLowerCase().includes("projet")) || tables[0];
  const eventsTable = tables.find((t) => t.name.toLowerCase().includes("événement") || t.name.toLowerCase().includes("evenement")) || (tables.length > 1 ? tables[1] : tables[0]);

  if (!projetsTable) return [];

  const isAnyField = () => true;
  const isLinkField = (f) => f.config.type === FieldType.MULTIPLE_RECORD_LINKS;

  const findField = (table, keyword) =>
    table?.fields?.find((f) => f.name.toLowerCase().includes(keyword));

  const findLinkField = (table, keyword) =>
    table?.fields?.find((f) => f.config.type === FieldType.MULTIPLE_RECORD_LINKS && f.name.toLowerCase().includes(keyword));

  // --- Event → Projet link field ---
  const eventProjetLink = findLinkField(eventsTable, "projet") ||
    eventsTable?.fields?.find((f) => f.config.type === FieldType.MULTIPLE_RECORD_LINKS);

  // --- Linked tables (resolved from link fields on Projets) ---
  const spectaclesField = findField(projetsTable, "spectacle");
  const organismesField = findField(projetsTable, "organisme");
  const contactsField = findField(projetsTable, "contact");

  const findLinkedTableFromField = (field) => {
    try {
      const ltId = field?.config?.options?.linkedTableId;
      if (ltId) return base.tables.find((t) => t.id === ltId) || null;
    } catch { /* ignore */ }
    return null;
  };

  // These will be added to base.tables via custom properties type "table"
  const spectaclesTable = findLinkedTableFromField(spectaclesField) ||
    base.tables.find((t) => t.name.toLowerCase().includes("spectacle")) || null;
  const organismesTable = findLinkedTableFromField(organismesField) ||
    base.tables.find((t) => t.name.toLowerCase().includes("organis")) || null;
  const contactsTable = findLinkedTableFromField(contactsField) ||
    base.tables.find((t) => t.name.toLowerCase().includes("contact")) || null;

  return [
    // --- Tables ---
    { key: "projetsTable", label: "Table des projets", type: "table", defaultValue: projetsTable },
    { key: "eventsTable", label: "Table des événements", type: "table", defaultValue: eventsTable },
    { key: "spectaclesTable", label: "Table des spectacles", type: "table", defaultValue: spectaclesTable },
    { key: "organismesTable", label: "Table des organismes", type: "table", defaultValue: organismesTable },
    { key: "contactsTable", label: "Table des contacts", type: "table", defaultValue: contactsTable },

    // --- Lien Événements → Projets ---
    { key: "eventProjetLinkField", label: "Événements: Lien vers Projets", type: "field", table: eventsTable, shouldFieldBeAllowed: isLinkField, defaultValue: eventProjetLink },

    // --- Colonnes tableau Projets (7 hardcoded) ---
    { key: "colProjetId", label: "Projets: Identifiant", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "identifiant") || projetsTable?.fields?.[0] },
    { key: "colProjetVille", label: "Projets: Ville", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "ville") },
    { key: "colProjetDate", label: "Projets: Date au long", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "date") },
    { key: "colProjetSpectacles", label: "Projets: Spectacles", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "spectacle") },
    { key: "colProjetStatut", label: "Projets: Statut du contrat", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "statut") || findField(projetsTable, "contrat") },
    { key: "colProjetOrganismes", label: "Projets: Organismes", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "organisme") },
    { key: "colProjetContacts", label: "Projets: Contacts", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(projetsTable, "contact") },

    // --- Champs détail Projet (6 configurables) ---
    { key: "detailProjet1", label: "Détail Projet: Champ 1", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: projetsTable?.fields?.[0] || null },
    { key: "detailProjet2", label: "Détail Projet: Champ 2", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: projetsTable?.fields?.[1] || null },
    { key: "detailProjet3", label: "Détail Projet: Champ 3", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: projetsTable?.fields?.[2] || null },
    { key: "detailProjet4", label: "Détail Projet: Champ 4", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: projetsTable?.fields?.[3] || null },
    { key: "detailProjet5", label: "Détail Projet: Champ 5", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: projetsTable?.fields?.[4] || null },
    { key: "detailProjet6", label: "Détail Projet: Champ 6", type: "field", table: projetsTable, shouldFieldBeAllowed: isAnyField, defaultValue: projetsTable?.fields?.[5] || null },

    // --- Colonnes tableau Événements (6 configurables) ---
    { key: "colEvt1", label: "Événements liste: Champ 1", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: eventsTable?.fields?.[0] || null },
    { key: "colEvt2", label: "Événements liste: Champ 2", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "date") || eventsTable?.fields?.[1] || null },
    { key: "colEvt3", label: "Événements liste: Champ 3", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "lieu") || findField(eventsTable, "salle") || eventsTable?.fields?.[2] || null },
    { key: "colEvt4", label: "Événements liste: Champ 4", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "statut") || eventsTable?.fields?.[3] || null },
    { key: "colEvt5", label: "Événements liste: Champ 5", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: eventsTable?.fields?.[4] || null },
    { key: "colEvt6", label: "Événements liste: Champ 6", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: eventsTable?.fields?.[5] || null },

    // --- Champs détail Événement (6 configurables) ---
    { key: "detailEvt1", label: "Détail Événement: Champ 1", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: eventsTable?.fields?.[0] || null },
    { key: "detailEvt2", label: "Détail Événement: Champ 2", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "date") || eventsTable?.fields?.[1] || null },
    { key: "detailEvt3", label: "Détail Événement: Champ 3", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "lieu") || findField(eventsTable, "salle") || eventsTable?.fields?.[2] || null },
    { key: "detailEvt4", label: "Détail Événement: Champ 4", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: findField(eventsTable, "statut") || eventsTable?.fields?.[3] || null },
    { key: "detailEvt5", label: "Détail Événement: Champ 5", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: eventsTable?.fields?.[4] || null },
    { key: "detailEvt6", label: "Détail Événement: Champ 6", type: "field", table: eventsTable, shouldFieldBeAllowed: isAnyField, defaultValue: eventsTable?.fields?.[5] || null },
  ];
}

// ─── Projects Table ──────────────────────────────────────────────────────────

function ProjectsTable({ projects, columns, base, onSelect, search, onSearchChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold text-gray-700 dark:text-gray-200">Bookings</h1>
        <p className="text-base text-gray-400">{projects.length} projets</p>
      </div>
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Rechercher un projet..."
          className="w-full px-4 py-2.5 text-base border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-blue placeholder-gray-400"
        />
      </div>
      <div className="bg-white dark:bg-gray-700 rounded-lg shadow-xs dark:shadow-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-600">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((proj) => (
                <tr
                  key={proj.id}
                  onClick={() => onSelect(proj)}
                  className="border-b border-gray-75 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-gray-700 dark:text-gray-200">
                      <FieldValue
                        record={proj.record}
                        field={col.field}
                        base={base}
                                             />
                    </td>
                  ))}
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-10 text-center text-base text-gray-400">
                    Aucun projet trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Editable Event Detail ───────────────────────────────────────────────────

function EditableEventDetail({ eventRecord, fields, base, eventsTable }) {
  const [editValues, setEditValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Reset edit values when the selected event changes
  useEffect(() => {
    const vals = {};
    for (const f of fields) {
      const raw = eventRecord.getCellValue(f);
      if (isSelectType(f) || isLinkType(f)) {
        // Not editable inline — skip
        continue;
      }
      if (typeof raw === "number") {
        vals[f.id] = raw;
      } else {
        vals[f.id] = eventRecord.getCellValueAsString(f) || "";
      }
    }
    setEditValues(vals);
    setDirty(false);
  }, [eventRecord, fields]);

  const handleChange = useCallback((fieldId, value) => {
    setEditValues((prev) => ({ ...prev, [fieldId]: value }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updates = {};
      for (const f of fields) {
        if (isSelectType(f) || isLinkType(f)) continue;
        if (!(f.id in editValues)) continue;
        const val = editValues[f.id];
        if (isNumericType(f) && typeof val === "string") {
          const parsed = parseFloat(val.replace(/\s/g, "").replace(",", "."));
          updates[f.name] = isNaN(parsed) ? null : parsed;
        } else {
          updates[f.name] = val || null;
        }
      }
      if (Object.keys(updates).length > 0) {
        await eventsTable.updateRecordAsync(eventRecord, updates);
      }
      setDirty(false);
    } catch (err) {
      console.error("Save error:", err);
      alert(`Erreur lors de la sauvegarde: ${err.message}`);
    }
    setSaving(false);
  }, [editValues, fields, eventRecord, eventsTable]);

  return (
    <div className="bg-white dark:bg-gray-700 rounded-lg p-5 shadow-xs dark:shadow-none">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Détail de l&apos;événement
        </h3>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-blue text-white hover:bg-blue-blueDark1 transition-colors disabled:opacity-50"
            >
              {saving ? "..." : "Sauvegarder"}
            </button>
          )}
          <button
            onClick={() => expandRecord(eventRecord)}
            className="text-sm text-blue-blue hover:text-blue-blueDark1 font-medium"
          >
            Ouvrir →
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        {fields.map((f, i) => {
          const editable = !isSelectType(f) && !isLinkType(f);
          return (
            <div key={`${f.id}_${i}`}>
              <p className="text-sm text-gray-400 mb-1">{f.name}</p>
              {editable && f.id in editValues ? (
                <input
                  type={isNumericType(f) ? "number" : "text"}
                  value={editValues[f.id] ?? ""}
                  onChange={(e) => handleChange(f.id, e.target.value)}
                  className="w-full px-3 py-1.5 text-base border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-blue"
                />
              ) : (
                <div className="text-base font-medium text-gray-700 dark:text-gray-200">
                  <FieldValue record={eventRecord} field={f} base={base} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Linked Record Cards ─────────────────────────────────────────────────────

function LinkedRecordCardsResolved({ table, links }) {
  const records = useRecords(table);
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => {
        const resolved = records?.find((r) => r.id === link.id);
        return (
          <button
            key={link.id}
            onClick={(e) => {
              e.stopPropagation();
              if (resolved) expandRecord(resolved);
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-blue-blue transition-colors cursor-pointer text-left"
          >
            <div className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-600 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 6h8M4 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
              {link.name || "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}


function LinkedRecordCards({ record, field, linkedTable, label }) {
  if (!field) return null;
  const raw = record.getCellValue(field);
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;

  const links = raw.map((item) => ({
    id: item.id || String(Math.random()),
    name: item.name || item.value || String(item),
  }));

  return (
    <div>
      <p className="text-sm text-gray-400 mb-2">{label}</p>
      {linkedTable ? (
        <LinkedRecordCardsResolved table={linkedTable} links={links} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {links.map((link, i) => (
            <span key={link.id || i} className="flex items-center gap-2 px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200">
              {link.name || "—"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Project Drawer ──────────────────────────────────────────────────────────

function ProjectDrawer({
  projetRecord,
  detailFields,
  spectaclesField, spectaclesTable,
  organismesField, organismesTable,
  contactsField, contactsTable,
  linkedEvents,
  eventColumns,
  eventDetailFields,
  selectedEventId,
  onSelectEvent,
  base,
  eventsTable,
  onClose,
}) {
  const selectedEventRecord = selectedEventId
    ? linkedEvents.find((e) => e.id === selectedEventId)?.record || null
    : null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed top-0 right-0 h-full w-[70%] min-w-[400px] bg-gray-50 dark:bg-gray-800 shadow-xl z-50 flex flex-col overflow-hidden animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-2xl font-bold text-gray-700 dark:text-gray-200 truncate">
              {projetRecord.name || "Projet"}
            </h2>
            <button
              onClick={(e) => { e.stopPropagation(); expandRecord(projetRecord); }}
              className="text-sm text-blue-blue hover:text-blue-blueDark1 font-medium whitespace-nowrap"
            >
              Ouvrir →
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-300 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Linked record cards — single row at top */}
          <div className="grid grid-cols-3 gap-4">
            <LinkedRecordCards record={projetRecord} field={spectaclesField} linkedTable={spectaclesTable} label="Spectacles" />
            <LinkedRecordCards record={projetRecord} field={organismesField} linkedTable={organismesTable} label="Organismes" />
            <LinkedRecordCards record={projetRecord} field={contactsField} linkedTable={contactsTable} label="Contacts" />
          </div>

          {/* Project detail fields */}
          <div className="bg-white dark:bg-gray-700 rounded-lg p-5 shadow-xs dark:shadow-none space-y-5">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Détails du projet
            </h3>
            {detailFields.length > 0 && (
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                {detailFields.map((f) => (
                  <div key={f.id}>
                    <p className="text-sm text-gray-400 mb-1">{f.name}</p>
                    <div className="text-base font-medium text-gray-700 dark:text-gray-200">
                      <FieldValue record={projetRecord} field={f} base={base} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Linked events table */}
          <div className="bg-white dark:bg-gray-700 rounded-lg shadow-xs dark:shadow-none overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-600 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Événements liés
              </h3>
              <span className="text-sm text-gray-400">{linkedEvents.length}</span>
            </div>
            {linkedEvents.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-base">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-600">
                      {eventColumns.map((col) => (
                        <th key={col.key} className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linkedEvents.map((evt) => (
                      <tr
                        key={evt.id}
                        onClick={() => onSelectEvent(evt.id === selectedEventId ? null : evt.id)}
                        className={`border-b border-gray-75 dark:border-gray-600 cursor-pointer transition-colors ${
                          evt.id === selectedEventId
                            ? "bg-blue-blueLight3 dark:bg-[#1a2a4a]"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800"
                        }`}
                      >
                        {eventColumns.map((col) => (
                          <td key={col.key} className="px-4 py-3 text-gray-700 dark:text-gray-200">
                            <FieldValue record={evt.record} field={col.field} base={base} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-8 text-center text-base text-gray-400">
                Aucun événement lié à ce projet.
              </div>
            )}
          </div>

          {/* Selected event detail (editable) */}
          {selectedEventRecord && eventDetailFields.length > 0 && (
            <EditableEventDetail
              eventRecord={selectedEventRecord}
              fields={eventDetailFields}
              base={base}
              eventsTable={eventsTable}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

function ProjectsEventsApp() {
  const base = useBase();
  const { customPropertyValueByKey } = useCustomProperties(getCustomProperties);

  const projetsTable = customPropertyValueByKey.projetsTable;
  const eventsTable = customPropertyValueByKey.eventsTable;
  const eventProjetLinkField = customPropertyValueByKey.eventProjetLinkField;

  // Project list columns
  const colProjetId = customPropertyValueByKey.colProjetId;
  const colProjetVille = customPropertyValueByKey.colProjetVille;
  const colProjetDate = customPropertyValueByKey.colProjetDate;
  const colProjetSpectacles = customPropertyValueByKey.colProjetSpectacles;
  const colProjetStatut = customPropertyValueByKey.colProjetStatut;
  const colProjetOrganismes = customPropertyValueByKey.colProjetOrganismes;
  const colProjetContacts = customPropertyValueByKey.colProjetContacts;

  // Detail fields
  const detailProjetFields = [
    customPropertyValueByKey.detailProjet1,
    customPropertyValueByKey.detailProjet2,
    customPropertyValueByKey.detailProjet3,
    customPropertyValueByKey.detailProjet4,
    customPropertyValueByKey.detailProjet5,
    customPropertyValueByKey.detailProjet6,
  ].filter(Boolean);

  const eventColumnFields = [
    customPropertyValueByKey.colEvt1,
    customPropertyValueByKey.colEvt2,
    customPropertyValueByKey.colEvt3,
    customPropertyValueByKey.colEvt4,
    customPropertyValueByKey.colEvt5,
    customPropertyValueByKey.colEvt6,
  ].filter(Boolean);

  const detailEvtFields = [
    customPropertyValueByKey.detailEvt1,
    customPropertyValueByKey.detailEvt2,
    customPropertyValueByKey.detailEvt3,
    customPropertyValueByKey.detailEvt4,
    customPropertyValueByKey.detailEvt5,
    customPropertyValueByKey.detailEvt6,
  ].filter(Boolean);

  const projetRecords = useRecords(projetsTable);
  const eventRecords = useRecords(eventsTable);

  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [search, setSearch] = useState("");

  // Project list columns definition
  const projectColumns = useMemo(() => {
    const cols = [];
    if (colProjetId) cols.push({ key: "id", label: "Identifiant", field: colProjetId });
    if (colProjetVille) cols.push({ key: "ville", label: "Ville", field: colProjetVille });
    if (colProjetDate) cols.push({ key: "date", label: "Date", field: colProjetDate });
    if (colProjetSpectacles) cols.push({ key: "spectacles", label: "Spectacles", field: colProjetSpectacles });
    if (colProjetStatut) cols.push({ key: "statut", label: "Statut", field: colProjetStatut });
    if (colProjetOrganismes) cols.push({ key: "organismes", label: "Organismes", field: colProjetOrganismes });
    if (colProjetContacts) cols.push({ key: "contacts", label: "Contacts", field: colProjetContacts });
    return cols;
  }, [colProjetId, colProjetVille, colProjetDate, colProjetSpectacles, colProjetStatut, colProjetOrganismes, colProjetContacts]);

  // Event columns for the drawer table
  const eventColumns = useMemo(() => {
    return eventColumnFields.map((f, i) => ({ key: `evt${i}`, label: f.name, field: f }));
  }, [eventColumnFields]);

  // Build searchable project list
  const projects = useMemo(() => {
    if (!projetRecords) return [];
    let list = projetRecords.map((record) => {
      const searchText = projectColumns
        .map((col) => record.getCellValueAsString(col.field) || "")
        .join(" ")
        .toLowerCase();
      return { id: record.id, record, searchText };
    });
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.searchText.includes(q));
    }
    return list;
  }, [projetRecords, projectColumns, search]);

  // Resolve linked events for selected project
  const linkedEvents = useMemo(() => {
    if (!selectedProjectId || !eventRecords || !eventProjetLinkField) return [];
    return eventRecords
      .filter((record) => {
        const linkVal = record.getCellValue(eventProjetLinkField);
        if (!linkVal || !Array.isArray(linkVal)) return false;
        return linkVal.some((link) => link.id === selectedProjectId);
      })
      .map((record) => ({ id: record.id, record }));
  }, [selectedProjectId, eventRecords, eventProjetLinkField]);

  const selectedProjetRecord = selectedProjectId
    ? projetRecords?.find((r) => r.id === selectedProjectId) || null
    : null;

  // Auto-select first event when a new project is opened
  useEffect(() => {
    if (selectedProjectId) {
      const evts = eventRecords
        ?.filter((record) => {
          const linkVal = eventProjetLinkField ? record.getCellValue(eventProjetLinkField) : null;
          return Array.isArray(linkVal) && linkVal.some((link) => link.id === selectedProjectId);
        });
      setSelectedEventId(evts && evts.length > 0 ? evts[0].id : null);
    } else {
      setSelectedEventId(null);
    }
  }, [selectedProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectProject = useCallback((proj) => {
    setSelectedProjectId(proj.id);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedProjectId(null);
    setSelectedEventId(null);
  }, []);

  // Check configuration
  if (!projetsTable || !eventsTable) {
    return (
      <div className="p-8 min-h-screen bg-gray-50 dark:bg-gray-800">
        <div className="max-w-lg mx-auto text-center mt-20 bg-white dark:bg-gray-700 rounded-lg p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-700 dark:text-gray-200 mb-4">Configuration requise</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Veuillez configurer les tables Projets et Événements dans les paramètres de l&apos;extension.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 min-h-screen bg-gray-50 dark:bg-gray-800">
      <ProjectsTable
        projects={projects}
        columns={projectColumns}
        base={base}
               onSelect={handleSelectProject}
        search={search}
        onSearchChange={setSearch}
      />

      {selectedProjetRecord && (
        <ProjectDrawer
          projetRecord={selectedProjetRecord}
          detailFields={detailProjetFields}
          spectaclesField={colProjetSpectacles} spectaclesTable={customPropertyValueByKey.spectaclesTable}
          organismesField={colProjetOrganismes} organismesTable={customPropertyValueByKey.organismesTable}
          contactsField={colProjetContacts} contactsTable={customPropertyValueByKey.contactsTable}
          linkedEvents={linkedEvents}
          eventColumns={eventColumns}
          eventDetailFields={detailEvtFields}
          selectedEventId={selectedEventId}
          onSelectEvent={setSelectedEventId}
          base={base}
          eventsTable={eventsTable}
          onClose={handleCloseDrawer}
        />
      )}
    </div>
  );
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

initializeBlock({ interface: () => <ProjectsEventsApp /> });
