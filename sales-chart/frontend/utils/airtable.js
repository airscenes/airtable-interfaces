import { FieldType } from "@airtable/blocks/interface/models";

// --- Custom Properties Definition ---

export function getCustomProperties(base, selectedSpectaclesTableId, selectedRepsTableId) {
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

  // Boolean-ish fields. Restricting the picker (plus the runtime guard in
  // App.js) keeps a numeric field from being read as a true/false flag.
  const isCheckboxLikeField = (field) =>
    field.config.type === FieldType.CHECKBOX ||
    field.config.type === FieldType.FORMULA ||
    field.config.type === FieldType.ROLLUP ||
    field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

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
      key: "spectacleArtisteField",
      label: "Champ Artiste (lien vers Artistes, dans Projets)",
      type: "field",
      table: spectaclesTable,
      shouldFieldBeAllowed: isLinkOrLookupField,
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
    // Free events are tinted in the table so it is obvious at a glance that
    // there is no ticket promo to monitor for them.
    {
      key: "freeEventField",
      label: "Champ Evenement gratuit (case a cocher)",
      type: "field",
      table: repsTable,
      shouldFieldBeAllowed: isCheckboxLikeField,
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

// --- Select field helper (returns { text, color }) ---

export function getFieldChoices(field, base) {
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

export function safeCellValue(record, field) {
  if (!field) return null;
  try { return record.getCellValue(field); } catch { return null; }
}

// Normalizes a MULTIPLE_RECORD_LINKS or MULTIPLE_LOOKUP_VALUES (of a link)
// cell value into a flat [{id, name}, ...] array.
export function extractLinkedRecords(cellValue) {
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

export function safeCellString(record, field) {
  if (!field) return "";
  try { return record.getCellValueAsString(field); } catch { return ""; }
}

export function getColSelect(record, field, base) {
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

// --- Shared sort: chronological by event date, then name ---

export function sortRepsByDate(reps) {
  return [...reps].sort((a, b) => {
    if (a.rawDate && b.rawDate) return a.rawDate - b.rawDate;
    if (a.rawDate) return -1;
    if (b.rawDate) return 1;
    return a.name.localeCompare(b.name, "fr");
  });
}
