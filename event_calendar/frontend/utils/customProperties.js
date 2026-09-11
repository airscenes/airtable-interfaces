import { FieldType } from "@airtable/blocks/interface/models";

export function getCustomProperties(base) {
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
