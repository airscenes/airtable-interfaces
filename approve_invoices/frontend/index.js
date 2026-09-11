import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  initializeBlock,
  useBase,
  useRecords,
  useCustomProperties,
  expandRecord,
} from "@airtable/blocks/interface/ui";
import { FieldType } from "@airtable/blocks/interface/models";
import { CaretRightIcon, PaperclipIcon, CheckCircleIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
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

const fmtNumber = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });

const fmtCurrency = (v) =>
  v == null || (typeof v === "number" && isNaN(v))
    ? "—"
    : Number(v).toLocaleString("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });

function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Components ──────────────────────────────────────────────────────────────

function SelectBadge({ value }) {
  if (!value || !value.text) return <span className="text-gray-400">—</span>;
  const palette = value.color ? AIRTABLE_COLORS[value.color] : null;
  if (!palette) return <span>{value.text}</span>;
  return (
    <span
      style={{ backgroundColor: palette.bg, color: palette.text, padding: "1px 8px", borderRadius: 9999, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}
    >
      {value.text}
    </span>
  );
}

function KpiCard({ label, value }) {
  return (
    <div className="bg-white dark:bg-gray-gray700 rounded-lg px-5 py-3 shadow-sm border border-gray-200 dark:border-gray-600 min-w-[140px]">
      <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-medium mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</div>
    </div>
  );
}

function Toast({ result, onDismiss }) {
  useEffect(() => {
    if (result?.success) {
      const timer = setTimeout(onDismiss, 3000);
      return () => clearTimeout(timer);
    }
  }, [result, onDismiss]);

  if (!result) return null;
  return (
    <div
      className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-lg text-white font-medium ${
        result.success ? "bg-green-600" : "bg-red-600"
      }`}
    >
      <div className="flex items-center gap-2">
        <span>{result.message}</span>
        {!result.success && (
          <button onClick={onDismiss} className="ml-2 text-white/80 hover:text-white text-lg leading-none">&times;</button>
        )}
      </div>
    </div>
  );
}

function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmLabel, loading }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onCancel} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-gray-gray700 rounded-lg p-6 shadow-xl max-w-md w-full">
        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">{title}</h3>
        <p className="text-gray-600 dark:text-gray-300 mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
            {confirmLabel || "Confirmer"}
          </button>
        </div>
      </div>
    </>
  );
}

function CellValue({ record, field, base }) {
  if (!field) return <span className="text-gray-400">—</span>;
  const val = record.getCellValue(field);

  // Attachment — thumbnail cliquable
  try {
    if (field.config.type === FieldType.MULTIPLE_ATTACHMENTS) {
      if (!val || val.length === 0) return <span className="text-gray-400">—</span>;
      const att = val[0];
      const thumb = att.thumbnails?.small?.url || att.thumbnails?.large?.url || att.url;
      return (
        <a href={att.url} target="_blank" rel="noopener noreferrer" className="inline-block">
          <img
            src={thumb}
            alt={att.filename || "Facture"}
            className="h-8 w-8 object-cover rounded border border-gray-200 dark:border-gray-600 hover:opacity-80 transition-opacity"
          />
        </a>
      );
    }
  } catch { /* ignore */ }

  // Checkbox
  try {
    if (field.config.type === FieldType.CHECKBOX) {
      return val ? <CheckCircleIcon size={16} weight="fill" className="text-green-600" /> : <span className="text-gray-400">—</span>;
    }
  } catch { /* ignore */ }

  // URL
  try {
    if (field.config.type === FieldType.URL) {
      if (!val) return <span className="text-gray-400">—</span>;
      const display = val.length > 30 ? val.slice(0, 30) + "..." : val;
      return (
        <a href={val} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 underline">
          {display}
        </a>
      );
    }
  } catch { /* ignore */ }

  // Numeric — check value first
  if (typeof val === "number") return <span>{fmtCurrency(val)}</span>;
  if (Array.isArray(val) && val.length > 0 && typeof val[0] === "number") return <span>{fmtCurrency(val[0])}</span>;

  // Formula/Rollup/Currency that returns null → treat as 0
  try {
    const ft = field.config.type;
    if ((ft === FieldType.FORMULA || ft === FieldType.ROLLUP || ft === FieldType.CURRENCY ||
         ft === FieldType.NUMBER || ft === FieldType.COUNT || ft === FieldType.PERCENT) && val == null) {
      return <span>{fmtCurrency(0)}</span>;
    }
  } catch { /* ignore */ }

  // Select
  const sel = getColSelect(record, field, base);
  if (sel.color) return <SelectBadge value={sel} />;
  if (sel.text) return <span>{sel.text}</span>;

  // Default — get string representation
  const str = record.getCellValueAsString(field);

  // URL check
  if (str && (str.startsWith("http://") || str.startsWith("https://"))) {
    const display = str.length > 30 ? str.slice(0, 30) + "..." : str;
    return (
      <a href={str} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 underline">
        {display}
      </a>
    );
  }
  return <span>{str || "—"}</span>;
}

function DepensesTable({ depenses, columns, base }) {
  if (!depenses || depenses.length === 0) {
    return <div className="text-base text-gray-400 dark:text-gray-500 pl-10 py-2">Aucune depense</div>;
  }
  return (
    <div className="pl-8 pr-2 pb-2">
      <table className="w-full text-base">
        <thead>
          <tr className="text-sm text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-600">
            {columns.map((col) => (
              <th key={col.key} className="px-3 py-1.5 text-left font-medium">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {depenses.map((dep) => (
            <tr key={dep.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-1.5">
                  <CellValue record={dep} field={col.field} base={base} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Custom Properties ───────────────────────────────────────────────────────

function buildCustomProperties(base, valuesRef) {
  const current = valuesRef.current || {};
  const facturesTable = current.facturesTable
    || base.tables.find((t) => t.name.toLowerCase().includes("facture")) || base.tables[0];
  const depensesTable = current.depensesTable
    || base.tables.find((t) => t.name.toLowerCase().includes("depense") || t.name.toLowerCase().includes("expense")) || (base.tables[1] || base.tables[0]);
  const transactionsTable = current.transactionsTable
    || base.tables.find((t) => {
      const n = t.name.toLowerCase();
      return n.includes("transaction") || n.includes("paiement");
    }) || base.tables[0];

  const isCheckbox = (f) => { try { return f.config.type === FieldType.CHECKBOX; } catch { return false; } };
  const isLink = (f) => { try { return f.config.type === FieldType.MULTIPLE_RECORD_LINKS; } catch { return false; } };
  const isAttachment = (f) => { try { return f.config.type === FieldType.MULTIPLE_ATTACHMENTS; } catch { return false; } };
  const isDate = (f) => { try { return f.config.type === FieldType.DATE || f.config.type === FieldType.DATE_TIME; } catch { return false; } };
  const isNumeric = (f) => { try { const t = f.config.type; return t === FieldType.NUMBER || t === FieldType.CURRENCY || t === FieldType.PERCENT; } catch { return false; } };
  const isSingleSelect = (f) => { try { return f.config.type === FieldType.SINGLE_SELECT; } catch { return false; } };

  // Helper: build a field property, only include defaultValue if found (undefined crashes SDK)
  const fieldProp = (key, label, table, opts = {}) => {
    const prop = { key, label, type: "field", table };
    if (opts.shouldFieldBeAllowed) prop.shouldFieldBeAllowed = opts.shouldFieldBeAllowed;
    if (opts.defaultValue) prop.defaultValue = opts.defaultValue;
    return prop;
  };

  const findField = (table, predicate) => {
    try { return table?.fields.find((f) => { try { return predicate(f); } catch { return false; } }); } catch { return undefined; }
  };

  return [
    // Tables
    { key: "facturesTable", label: "Table Factures", type: "table", defaultValue: facturesTable },
    { key: "depensesTable", label: "Table Depenses", type: "table", defaultValue: depensesTable },

    // Link
    fieldProp("depFactureLinkField", "Lien Depenses → Factures", depensesTable, {
      shouldFieldBeAllowed: isLink,
      defaultValue: findField(depensesTable, (f) => isLink(f) && f.name.toLowerCase().includes("facture")),
    }),

    // Factures columns
    fieldProp("colFactureNum", "Facture: Numero", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.config.type === FieldType.SINGLE_LINE_TEXT) || facturesTable?.fields[0],
    }),
    fieldProp("colDateFacture", "Facture: Date", facturesTable, {
      shouldFieldBeAllowed: isDate,
      defaultValue: findField(facturesTable, isDate),
    }),
    fieldProp("colTotalNet", "Facture: Total net", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("total net")),
    }),
    fieldProp("colTotalBrut", "Facture: Total brut", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("total brut")),
    }),
    fieldProp("colFactureAttachment", "Facture: Piece jointe", facturesTable, {
      shouldFieldBeAllowed: isAttachment,
      defaultValue: findField(facturesTable, isAttachment),
    }),
    fieldProp("colNotes", "Facture: Notes", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("note")),
    }),
    fieldProp("colStatut", "Facture: Statut", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("statut")),
    }),
    fieldProp("colEcriture", "Facture: Ecriture", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("ecriture")),
    }),
    fieldProp("colFournisseur", "Facture: Fournisseur", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("fournisseur")),
    }),
    fieldProp("colDatePaiement", "Facture: Date de paiement", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("date") && f.name.toLowerCase().includes("paiement")),
    }),
    fieldProp("colTotalPaiements", "Facture: Total paiements", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("total paiement")),
    }),
    fieldProp("colSolde", "Facture: Solde", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("solde")),
    }),
    fieldProp("colApprouvee", "Facture: Approuvee", facturesTable, {
      shouldFieldBeAllowed: isCheckbox,
      defaultValue: findField(facturesTable, (f) => isCheckbox(f) && f.name.toLowerCase().includes("approuv")),
    }),
    fieldProp("colUrlDropbox", "Facture: URL Dropbox", facturesTable, {
      defaultValue: findField(facturesTable, (f) => f.name.toLowerCase().includes("dropbox") || f.name.toLowerCase().includes("url")),
    }),

    // Action fields
    fieldProp("exclureField", "Facture: Champ Exclure (checkbox)", facturesTable, {
      shouldFieldBeAllowed: isCheckbox,
      defaultValue: findField(facturesTable, (f) => isCheckbox(f) && f.name.toLowerCase().includes("exclu")),
    }),

    // Status value written on the facture when paid (mode "date"). String so it
    // matches the single-select option name (or free text). Auto-detect a "pay*" choice.
    (() => {
      const choices = getFieldChoices(current.colStatut, base) || [];
      const payeChoice = choices.find((c) => c.name.toLowerCase().includes("pay"));
      const prop = { key: "statutPayeValue", label: "Statut: valeur quand payée", type: "string" };
      if (payeChoice) prop.defaultValue = payeChoice.name;
      return prop;
    })(),

    // Depenses columns
    fieldProp("colDepName", "Depense: Nom", depensesTable, {
      defaultValue: depensesTable?.fields[0] || undefined,
    }),
    fieldProp("colCanaux", "Depense: Canaux", depensesTable, {
      defaultValue: findField(depensesTable, (f) => f.name.toLowerCase().includes("canaux") || f.name.toLowerCase().includes("canal")),
    }),
    fieldProp("colMontant", "Depense: Montant", depensesTable, {
      defaultValue: findField(depensesTable, (f) => f.name.toLowerCase().includes("montant")),
    }),
    fieldProp("colTPS", "Depense: TPS", depensesTable, {
      defaultValue: findField(depensesTable, (f) => f.name.toLowerCase() === "tps"),
    }),
    fieldProp("colTVQ", "Depense: TVQ", depensesTable, {
      defaultValue: findField(depensesTable, (f) => f.name.toLowerCase() === "tvq"),
    }),
    fieldProp("colDepTotalBrut", "Depense: Total brut", depensesTable, {
      defaultValue: findField(depensesTable, (f) => f.name.toLowerCase().includes("total brut")),
    }),
    fieldProp("colTaxesApplicables", "Depense: Taxes applicables", depensesTable, {
      defaultValue: findField(depensesTable, (f) => f.name.toLowerCase().includes("taxe")),
    }),
    fieldProp("colDepNotes", "Depense: Notes", depensesTable, {
      defaultValue: findField(depensesTable, (f) => f.name.toLowerCase().includes("note")),
    }),

    // Mode
    {
      key: "actionMode", label: "Mode du bouton", type: "enum",
      possibleValues: [
        { value: "qb", label: "Approbation QB (checkbox)" },
        { value: "date", label: "Creer transactions de paiement" },
      ],
      defaultValue: "qb",
    },

    // Transactions table + fields (mode "date")
    { key: "transactionsTable", label: "Table Transactions", type: "table", defaultValue: transactionsTable },
    fieldProp("txnDateField", "Transaction: Date", transactionsTable, {
      shouldFieldBeAllowed: isDate,
      defaultValue: findField(transactionsTable, isDate),
    }),
    fieldProp("txnMontantField", "Transaction: Montant", transactionsTable, {
      shouldFieldBeAllowed: isNumeric,
      defaultValue: findField(transactionsTable, (f) => isNumeric(f) && (f.name.toLowerCase().includes("montant") || f.name.toLowerCase().includes("total"))),
    }),
    fieldProp("txnLinkFactureField", "Transaction: Lien Facture", transactionsTable, {
      shouldFieldBeAllowed: isLink,
      defaultValue: findField(transactionsTable, (f) => isLink(f) && f.name.toLowerCase().includes("facture")),
    }),
    fieldProp("txnModePaiementField", "Transaction: Mode de paiement", transactionsTable, {
      shouldFieldBeAllowed: (f) => {
        try {
          const t = f.config.type;
          return t === FieldType.SINGLE_SELECT || t === FieldType.SINGLE_LINE_TEXT || t === FieldType.MULTILINE_TEXT;
        } catch { return false; }
      },
      defaultValue: findField(transactionsTable, (f) => isSingleSelect(f) && f.name.toLowerCase().includes("mode"))
        || findField(transactionsTable, (f) => f.name.toLowerCase().includes("mode")),
    }),
  ];
}

// ─── Main App ────────────────────────────────────────────────────────────────

function ApprobationFacturesApp() {
  const base = useBase();
  const valuesRef = useRef({});
  const [selectedTableIds, setSelectedTableIds] = useState({});
  const getProps = useCallback(
    (b) => buildCustomProperties(b, valuesRef),
    // Force re-eval when any table selection changes so dependent field pickers
    // re-bind to the user-chosen table instead of the auto-detected default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedTableIds.facturesTable, selectedTableIds.depensesTable, selectedTableIds.transactionsTable]
  );
  const { customPropertyValueByKey, errorState } = useCustomProperties(getProps);
  valuesRef.current = customPropertyValueByKey;
  useEffect(() => {
    const next = {
      facturesTable: customPropertyValueByKey?.facturesTable?.id,
      depensesTable: customPropertyValueByKey?.depensesTable?.id,
      transactionsTable: customPropertyValueByKey?.transactionsTable?.id,
    };
    setSelectedTableIds((prev) =>
      prev.facturesTable === next.facturesTable &&
      prev.depensesTable === next.depensesTable &&
      prev.transactionsTable === next.transactionsTable
        ? prev
        : next
    );
  }, [customPropertyValueByKey]);

  const facturesTable = customPropertyValueByKey.facturesTable;
  const depensesTable = customPropertyValueByKey.depensesTable;

  if (errorState) {
    return (
      <div className="p-8 min-h-screen bg-gray-gray50 dark:bg-gray-gray800">
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-lg mx-auto mt-10">
          <h2 className="text-lg font-bold text-red-700 dark:text-red-300 mb-2">Erreur de configuration</h2>
          <p className="text-red-600 dark:text-red-400">{errorState.message || "Verifiez les custom properties."}</p>
        </div>
      </div>
    );
  }

  if (!facturesTable || !depensesTable) {
    return (
      <div className="p-8 min-h-screen bg-gray-gray50 dark:bg-gray-gray800">
        <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 max-w-lg mx-auto mt-10">
          <h2 className="text-lg font-bold text-yellow-700 dark:text-yellow-300 mb-2">Configuration requise</h2>
          <p className="text-yellow-600 dark:text-yellow-400">Configurez les tables Factures et Depenses dans les custom properties.</p>
        </div>
      </div>
    );
  }

  return <ApprobationContent base={base} customPropertyValueByKey={customPropertyValueByKey} facturesTable={facturesTable} depensesTable={depensesTable} />;
}

function ApprobationContent({ base, customPropertyValueByKey, facturesTable, depensesTable }) {
  // Fields - Factures
  const depFactureLinkField = customPropertyValueByKey.depFactureLinkField;
  const colFactureNum = customPropertyValueByKey.colFactureNum;
  const colDateFacture = customPropertyValueByKey.colDateFacture;
  const colTotalNet = customPropertyValueByKey.colTotalNet;
  const colTotalBrut = customPropertyValueByKey.colTotalBrut;
  const colFactureAttachment = customPropertyValueByKey.colFactureAttachment;
  const colNotes = customPropertyValueByKey.colNotes;
  const colStatut = customPropertyValueByKey.colStatut;
  const colEcriture = customPropertyValueByKey.colEcriture;
  const colFournisseur = customPropertyValueByKey.colFournisseur;
  const colDatePaiement = customPropertyValueByKey.colDatePaiement;
  const colTotalPaiements = customPropertyValueByKey.colTotalPaiements;
  const colSolde = customPropertyValueByKey.colSolde;
  const colApprouvee = customPropertyValueByKey.colApprouvee;
  const colUrlDropbox = customPropertyValueByKey.colUrlDropbox;
  const exclureField = customPropertyValueByKey.exclureField;
  const statutPayeValue = customPropertyValueByKey.statutPayeValue;

  // Fields - Depenses
  const colDepName = customPropertyValueByKey.colDepName;
  const colCanaux = customPropertyValueByKey.colCanaux;
  const colMontant = customPropertyValueByKey.colMontant;
  const colTPS = customPropertyValueByKey.colTPS;
  const colTVQ = customPropertyValueByKey.colTVQ;
  const colDepTotalBrut = customPropertyValueByKey.colDepTotalBrut;
  const colTaxesApplicables = customPropertyValueByKey.colTaxesApplicables;
  const colDepNotes = customPropertyValueByKey.colDepNotes;

  // Mode
  const actionMode = customPropertyValueByKey.actionMode || "qb";
  const transactionsTable = customPropertyValueByKey.transactionsTable;
  const txnDateField = customPropertyValueByKey.txnDateField;
  const txnMontantField = customPropertyValueByKey.txnMontantField;
  const txnLinkFactureField = customPropertyValueByKey.txnLinkFactureField;
  const txnModePaiementField = customPropertyValueByKey.txnModePaiementField;

  // Records - tables are guaranteed to exist here
  const factureRecords = useRecords(facturesTable);
  const depenseRecords = useRecords(depensesTable);

  // State
  const [expandedIds, setExpandedIds] = useState(new Set());
  // Exclusion is kept in local UI state (instant) and only written to Airtable
  // when the action button runs. Initialized once from the stored field values.
  const [excludedIds, setExcludedIds] = useState(() => new Set());
  const excludedInitRef = useRef(false);
  // Selection for "date" mode — all selected by default, initialized once from factureRecords.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectedInitRef = useRef(false);
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getTodayISO);
  const [selectedMode, setSelectedMode] = useState("");

  // Mode de paiement choices (from txnModePaiementField single select options)
  const modeChoices = useMemo(() => getFieldChoices(txnModePaiementField, base) || [], [txnModePaiementField, base]);

  useEffect(() => {
    if (!selectedMode && modeChoices.length > 0) setSelectedMode(modeChoices[0].name);
  }, [modeChoices, selectedMode]);

  // Seed local exclusion state from stored field values, once.
  useEffect(() => {
    if (excludedInitRef.current || !factureRecords || !exclureField) return;
    const init = new Set();
    for (const r of factureRecords) {
      if (r.getCellValue(exclureField)) init.add(r.id);
    }
    setExcludedIds(init);
    excludedInitRef.current = true;
  }, [factureRecords, exclureField]);

  // Initialize selection to all factures, once.
  useEffect(() => {
    if (selectedInitRef.current || !factureRecords) return;
    setSelectedIds(new Set(factureRecords.map((r) => r.id)));
    selectedInitRef.current = true;
  }, [factureRecords]);

  // Toggle accordion
  const toggleExpand = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Facture data
  const factures = useMemo(() => {
    if (!factureRecords) return [];
    return factureRecords.map((record) => {
      const totalNet = colTotalNet ? record.getCellValue(colTotalNet) : null;
      const totalBrut = colTotalBrut ? record.getCellValue(colTotalBrut) : null;
      const isExcluded = excludedIds.has(record.id);
      const isApproved = colApprouvee ? !!record.getCellValue(colApprouvee) : false;
      return { id: record.id, record, totalNet: typeof totalNet === "number" ? totalNet : parseFloat(totalNet) || 0, totalBrut: typeof totalBrut === "number" ? totalBrut : parseFloat(totalBrut) || 0, isExcluded, isApproved };
    });
  }, [factureRecords, colTotalNet, colTotalBrut, excludedIds, colApprouvee]);

  // Group by Fournisseur
  const groupedByFournisseur = useMemo(() => {
    if (!colFournisseur || factures.length === 0) return [{ supplier: "", factures, totalNet: factures.reduce((s, f) => s + f.totalNet, 0), totalBrut: factures.reduce((s, f) => s + f.totalBrut, 0), count: factures.length }];
    const map = new Map();
    for (const f of factures) {
      const name = f.record.getCellValueAsString(colFournisseur) || "(sans fournisseur)";
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(f);
    }
    return Array.from(map.entries()).map(([supplier, items]) => ({
      supplier,
      factures: items,
      totalNet: items.reduce((s, f) => s + f.totalNet, 0),
      totalBrut: items.reduce((s, f) => s + f.totalBrut, 0),
      count: items.length,
    }));
  }, [factures, colFournisseur]);

  // KPIs
  const kpis = useMemo(() => ({
    count: factures.length,
    totalNet: factures.reduce((s, f) => s + f.totalNet, 0),
    totalBrut: factures.reduce((s, f) => s + f.totalBrut, 0),
    approvableCount: actionMode === "date"
      ? factures.filter((f) => selectedIds.has(f.id)).length
      : factures.filter((f) => !f.isExcluded && !f.isApproved).length,
    excludedCount: factures.filter((f) => f.isExcluded).length,
  }), [factures, actionMode, selectedIds]);

  // Get depenses for a facture
  const getDepensesForFacture = useCallback((factureId) => {
    if (!depenseRecords || !depFactureLinkField) return [];
    return depenseRecords.filter((dep) => {
      const links = dep.getCellValue(depFactureLinkField);
      if (!Array.isArray(links)) return false;
      return links.some((link) => link.id === factureId);
    });
  }, [depenseRecords, depFactureLinkField]);

  // Depenses column definitions
  const depColumns = useMemo(() => [
    { key: "name", label: "Depenses", field: colDepName },
    { key: "canaux", label: "Canaux", field: colCanaux },
    { key: "montant", label: "Montant", field: colMontant },
    { key: "tps", label: "TPS", field: colTPS },
    { key: "tvq", label: "TVQ", field: colTVQ },
    { key: "totalBrut", label: "Total brut", field: colDepTotalBrut },
    { key: "taxes", label: "Taxes applicables", field: colTaxesApplicables },
    { key: "notes", label: "Notes", field: colDepNotes },
  ].filter((c) => c.field), [colDepName, colCanaux, colMontant, colTPS, colTVQ, colDepTotalBrut, colTaxesApplicables, colDepNotes]);

  // Facture column definitions (for header)
  // width: optional fixed width in px (otherwise flex-1 min-w-[100px])
  const factureColumns = useMemo(() => [
    { key: "num", label: "Facture", field: colFactureNum },
    { key: "date", label: "Date de la facture", field: colDateFacture, width: 110 },
    { key: "fournisseur", label: "Fournisseur", field: colFournisseur },
    { key: "totalNet", label: "Total net", field: colTotalNet, width: 100, align: "right" },
    { key: "totalBrut", label: "Total brute", field: colTotalBrut, width: 100, align: "right" },
    { key: "statut", label: "Statut", field: colStatut, width: 110 },
    { key: "datePaiement", label: "Date de paiement", field: colDatePaiement, width: 110 },
    { key: "totalPaiements", label: "Total paiements", field: colTotalPaiements, width: 110, align: "right" },
    { key: "solde", label: "Solde", field: colSolde, width: 100, align: "right" },
    { key: "attachment", label: "Facture", field: colFactureAttachment, width: 70 },
    { key: "approuvee", label: "Approuvee", field: colApprouvee, width: 80 },
    { key: "notes", label: "Notes", field: colNotes },
    { key: "ecriture", label: "Ecriture", field: colEcriture, width: 90 },
    { key: "urlDropbox", label: "URL Dropbox", field: colUrlDropbox },
  ].filter((c) => c.field), [colFactureNum, colDateFacture, colFournisseur, colTotalNet, colTotalBrut, colStatut, colDatePaiement, colTotalPaiements, colSolde, colFactureAttachment, colApprouvee, colUrlDropbox, colNotes, colEcriture]);

  // Helper to compute column className + inline style
  const colSizing = useCallback((col) => {
    if (col.width) return { className: "flex-shrink-0", style: { width: col.width } };
    return { className: "flex-1 min-w-[100px]", style: undefined };
  }, []);

  // Check write permissions
  const canUpdate = useMemo(() => {
    if (!facturesTable) return false;
    try { return facturesTable.hasPermissionToUpdateRecords(); } catch { return false; }
  }, [facturesTable]);

  const canCreateTxn = useMemo(() => {
    if (!transactionsTable) return false;
    try { return transactionsTable.hasPermissionToCreateRecords(); } catch { return false; }
  }, [transactionsTable]);

  // Approve handler
  const DRY_RUN = false; // Set to false to enable real writes

  const handleApprove = useCallback(async () => {
    setShowConfirm(false);
    setApproving(true);
    setApproveResult(null);

    try {
      console.log("[DEBUG] actionMode:", actionMode, "| colApprouvee:", colApprouvee);
      const toApprove = actionMode === "date"
        ? factures.filter((f) => selectedIds.has(f.id))
        : factures.filter((f) => !f.isExcluded && !f.isApproved);
      if (toApprove.length === 0) {
        setApproveResult({ success: true, message: "Aucune facture a approuver." });
        setApproving(false);
        return;
      }

      if (actionMode === "qb" && colApprouvee) {
        if (!canUpdate && !DRY_RUN) {
          throw new Error("Permission refusee. Activez 'Modifier les entrees dans le texte' dans les Actions d'utilisateur de la page.");
        }
        // Persist the local exclusion state and approve the non-excluded ones in one pass.
        const approveIds = new Set(toApprove.map((f) => f.id));
        const updates = factures.map((f) => {
          const fields = {};
          if (exclureField) fields[exclureField.name] = f.isExcluded;
          if (approveIds.has(f.id)) fields[colApprouvee.name] = true;
          return { id: f.id, fields };
        }).filter((u) => Object.keys(u.fields).length > 0);
        if (DRY_RUN) {
          console.log("[DRY RUN] Mode: qb | Field:", colApprouvee.name);
          console.log("[DRY RUN] Records to update:", updates.length);
          console.table(updates.map((u) => ({ id: u.id, ...u.fields })));
          setApproveResult({ success: true, message: `[DRY RUN] ${updates.length} facture(s) seraient approuvee(s). Voir console.` });
        } else {
          for (let i = 0; i < updates.length; i += 50) {
            await facturesTable.updateRecordsAsync(updates.slice(i, i + 50));
          }
          setApproveResult({ success: true, message: `${toApprove.length} facture(s) approuvee(s).` });
        }
      } else if (actionMode === "date") {
        if (!transactionsTable || !txnDateField || !txnMontantField || !txnLinkFactureField) {
          throw new Error("Configuration incomplete : table Transactions et champs Date / Montant / Lien Facture requis.");
        }
        if (!canCreateTxn && !DRY_RUN) {
          throw new Error("Permission refusee pour creer des transactions. Activez 'Ajouter des entrees' dans les Actions d'utilisateur de la page.");
        }
        const creates = toApprove.map((f) => {
          const fields = {
            [txnDateField.name]: selectedDate,
            [txnMontantField.name]: f.totalBrut,
            [txnLinkFactureField.name]: [{ id: f.id }],
          };
          if (txnModePaiementField && selectedMode) {
            fields[txnModePaiementField.name] = { name: selectedMode };
          }
          return { fields };
        });
        // Batch update the paid factures' Statut so the list reflects it immediately.
        // SINGLE_SELECT expects { name }, otherwise write the raw string.
        const statutIsSelect = (() => { try { return colStatut?.config?.type === FieldType.SINGLE_SELECT; } catch { return false; } })();
        const statutUpdates = (colStatut && statutPayeValue)
          ? toApprove.map((f) => ({
              id: f.id,
              fields: { [colStatut.name]: statutIsSelect ? { name: statutPayeValue } : statutPayeValue },
            }))
          : [];
        if (DRY_RUN) {
          console.log("[DRY RUN] Mode: date (creer transactions) | Date:", selectedDate, "| Mode paiement:", selectedMode);
          console.log("[DRY RUN] Transactions a creer:", creates.length);
          console.table(creates.map((c) => c.fields));
          if (statutUpdates.length) {
            console.log("[DRY RUN] Statut a mettre a jour:", colStatut.name, "=>", statutPayeValue, "sur", statutUpdates.length, "facture(s)");
            console.table(statutUpdates.map((u) => ({ id: u.id, ...u.fields })));
          }
          setApproveResult({ success: true, message: `[DRY RUN] ${creates.length} transaction(s) seraient creee(s). Voir console.` });
        } else {
          for (let i = 0; i < creates.length; i += 50) {
            await transactionsTable.createRecordsAsync(creates.slice(i, i + 50));
          }
          if (statutUpdates.length) {
            if (!canUpdate) {
              throw new Error("Transactions creees, mais permission refusee pour mettre a jour le Statut des factures. Activez 'Modifier les entrees' dans les Actions d'utilisateur de la page.");
            }
            for (let i = 0; i < statutUpdates.length; i += 50) {
              await facturesTable.updateRecordsAsync(statutUpdates.slice(i, i + 50));
            }
          }
          setApproveResult({ success: true, message: `${creates.length} transaction(s) creee(s).${statutUpdates.length ? ` Statut mis a jour sur ${statutUpdates.length} facture(s).` : ""}` });
        }
      } else {
        throw new Error("Configuration incomplete : verifiez le mode et les champs configures.");
      }
    } catch (err) {
      console.error("Approve error:", err);
      setApproveResult({ success: false, message: `Erreur: ${err.message}` });
    }
    setApproving(false);
  }, [factures, facturesTable, colApprouvee, colStatut, statutPayeValue, exclureField, actionMode, selectedDate, selectedMode, selectedIds, canUpdate, canCreateTxn, transactionsTable, txnDateField, txnMontantField, txnLinkFactureField, txnModePaiementField]);

  // Toggle exclure checkbox (UI only — persisted on action button)
  const handleToggleExclure = useCallback((recordId) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }, []);

  // Toggle exclure for all visible factures: check all, or uncheck all if all already checked
  const allExcluded = factures.length > 0 && factures.every((f) => f.isExcluded);
  const handleToggleAllExclure = useCallback(() => {
    setExcludedIds(allExcluded ? new Set() : new Set(factures.map((f) => f.id)));
  }, [factures, allExcluded]);

  // Toggle selection checkbox (date mode only — UI only)
  const handleToggleSelected = useCallback((recordId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }, []);

  const allSelected = factures.length > 0 && factures.every((f) => selectedIds.has(f.id));
  const handleToggleAllSelected = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(factures.map((f) => f.id)));
  }, [factures, allSelected]);

  // Dismiss toast
  const dismissResult = useCallback(() => setApproveResult(null), []);

  // ─── Render ────────────────────────────────────────────────────────────────

  const buttonLabel = actionMode === "date" ? "Payer les factures" : "Approuver les factures";
  const confirmTitle = actionMode === "date" ? "Confirmer le paiement" : "Confirmer l'approbation";
  const confirmMsg = actionMode === "date"
    ? `Creer ${kpis.approvableCount} transaction(s) datee(s) du ${selectedDate}${selectedMode ? ` (${selectedMode})` : ""} ?`
    : `Approuver ${kpis.approvableCount} facture(s) ?${kpis.excludedCount > 0 ? ` (${kpis.excludedCount} exclue(s))` : ""}`;

  return (
    <div className="p-4 min-h-screen bg-gray-gray50 dark:bg-gray-gray800">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{actionMode === "date" ? "Payables" : "Approbation Factures"}</h1>
        <div className="flex items-center gap-4 flex-1 justify-center">
          <KpiCard label="Factures" value={fmtNumber(kpis.count)} />
          <KpiCard label="Total net" value={fmtCurrency(kpis.totalNet)} />
          <KpiCard label="Total brut" value={fmtCurrency(kpis.totalBrut)} />
        </div>
        <div className="flex items-center gap-3">
          {actionMode === "date" && (
            <>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-gray700 text-gray-800 dark:text-gray-100 text-sm"
              />
              {modeChoices.length > 0 ? (
                <select
                  value={selectedMode}
                  onChange={(e) => setSelectedMode(e.target.value)}
                  className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-gray700 text-gray-800 dark:text-gray-100 text-sm"
                >
                  {modeChoices.map((c) => (
                    <option key={c.id || c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              ) : txnModePaiementField ? (
                <input
                  type="text"
                  value={selectedMode}
                  onChange={(e) => setSelectedMode(e.target.value)}
                  placeholder="Mode de paiement"
                  className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-gray700 text-gray-800 dark:text-gray-100 text-sm"
                />
              ) : null}
            </>
          )}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={approving || kpis.approvableCount === 0}
            className="px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {approving && <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
            {buttonLabel}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-200 dark:border-gray-600 overflow-x-auto">
        {/* Header */}
        <div className="min-w-[1200px]">
          <div className="flex items-center text-sm uppercase text-gray-500 dark:text-gray-400 font-medium border-b border-gray-200 dark:border-gray-600 px-2">
            <div className="flex-shrink-0 w-[30px]" /> {/* open record button space */}
            <div className="flex-shrink-0 w-8" /> {/* chevron space */}
            {factureColumns.map((col) => {
              const s = colSizing(col);
              return <div key={col.key} className={`px-3 py-2 ${col.align === "right" ? "text-right" : ""} ${s.className}`} style={s.style}>{col.label}</div>;
            })}
            {exclureField && actionMode !== "date" && (
              <div className="flex-shrink-0 px-3 py-2 w-[80px] flex items-center justify-center gap-1.5">
                <span>Exclure</span>
                <input
                  type="checkbox"
                  checked={allExcluded}
                  onChange={handleToggleAllExclure}
                  disabled={factures.length === 0}
                  title={allExcluded ? "Tout décocher" : "Tout cocher"}
                  className="w-3.5 h-3.5 accent-red-500 cursor-pointer disabled:opacity-50"
                />
              </div>
            )}
            {actionMode === "date" && (
              <div className="flex-shrink-0 px-3 py-2 w-[80px] flex items-center justify-center gap-1.5">
                <span>Payer</span>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={handleToggleAllSelected}
                  disabled={factures.length === 0}
                  title={allSelected ? "Tout décocher" : "Tout cocher"}
                  className="w-3.5 h-3.5 accent-blue-500 cursor-pointer disabled:opacity-50"
                />
              </div>
            )}
          </div>

          {/* Facture rows grouped by Fournisseur */}
          {factures.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">Aucune facture a afficher</div>
          ) : (
            groupedByFournisseur.map((group) => (
              <div key={group.supplier}>
                {/* Group header — subtle separator */}
                {colFournisseur && (
                  <div className="flex items-center border-b border-gray-200 dark:border-gray-600 px-2 bg-gray-50 dark:bg-gray-600/20">
                    <div className="flex-shrink-0 w-[30px]" />
                    <div className="flex-shrink-0 w-8" />
                    {/* Every cell is sized exactly like a detail-row cell, so the sums align perfectly.
                        The supplier name is absolutely positioned (out of flow) over the first cell,
                        so it can overflow to the right without shifting any column. */}
                    {factureColumns.map((col, idx) => {
                      const s = colSizing(col);
                      const alignCls = col.align === "right" ? "text-right" : "";
                      if (idx === 0) return (
                        <div key={col.key} className={`relative px-3 py-2.5 ${s.className}`} style={s.style}>
                          <div className="absolute inset-y-0 left-0 flex items-center px-3 text-lg font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap pointer-events-none">{group.supplier} &middot; {group.count}</div>
                        </div>
                      );
                      if (col.key === "totalNet") return <div key={col.key} className={`px-2 py-2.5 text-sm font-bold tracking-tight text-gray-700 dark:text-gray-200 truncate ${alignCls} ${s.className}`} style={s.style}>{fmtCurrency(group.totalNet)}</div>;
                      if (col.key === "totalBrut") return <div key={col.key} className={`px-2 py-2.5 text-sm font-bold tracking-tight text-gray-700 dark:text-gray-200 truncate ${alignCls} ${s.className}`} style={s.style}>{fmtCurrency(group.totalBrut)}</div>;
                      return <div key={col.key} className={`px-3 py-2.5 ${s.className}`} style={s.style} />;
                    })}
                    {exclureField && actionMode !== "date" && <div className="flex-shrink-0 px-3 py-2.5 w-[80px]" />}
                    {actionMode === "date" && <div className="flex-shrink-0 px-3 py-2.5 w-[80px]" />}
                  </div>
                )}
                {/* Facture rows in this group */}
                {group.factures.map((facture) => {
                  const isExpanded = expandedIds.has(facture.id);
                  const depenses = isExpanded ? getDepensesForFacture(facture.id) : [];
                  return (
                    <div key={facture.id} className={facture.isExcluded ? "opacity-50" : ""}>
                      <div
                        className={`flex items-center px-2 border-b border-gray-100 dark:border-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600/50 transition-colors ${
                          isExpanded ? "bg-gray-50 dark:bg-gray-600/30" : ""
                        }`}
                        onClick={() => toggleExpand(facture.id)}
                      >
                        <div className="flex-shrink-0 px-1 py-2.5 w-[30px] flex items-center justify-center" onClick={(e) => { e.stopPropagation(); try { expandRecord(facture.record); } catch (err) { console.error("expandRecord error:", err); } }}>
                          <ArrowSquareOutIcon size={16} className="text-gray-400 hover:text-blue-500 cursor-pointer" />
                        </div>
                        <div className="flex-shrink-0 w-8 flex items-center justify-center">
                          <CaretRightIcon
                            size={14}
                            className={`text-gray-400 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                          />
                        </div>
                        {factureColumns.map((col) => {
                          const s = colSizing(col);
                          return (
                            <div key={col.key} className={`px-3 py-2.5 text-base text-gray-700 dark:text-gray-200 truncate ${col.align === "right" ? "text-right" : ""} ${s.className}`} style={s.style}>
                              <CellValue record={facture.record} field={col.field} base={base} />
                            </div>
                          );
                        })}
                        {exclureField && actionMode !== "date" && (
                          <div className="flex-shrink-0 px-3 py-2.5 w-[80px] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={facture.isExcluded}
                              onChange={() => handleToggleExclure(facture.id)}
                              className="w-4 h-4 accent-red-500 cursor-pointer"
                            />
                          </div>
                        )}
                        {actionMode === "date" && (
                          <div className="flex-shrink-0 px-3 py-2.5 w-[80px] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(facture.id)}
                              onChange={() => handleToggleSelected(facture.id)}
                              className="w-4 h-4 accent-blue-500 cursor-pointer"
                            />
                          </div>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="bg-gray-25 dark:bg-gray-750 border-b border-gray-200 dark:border-gray-600">
                          <DepensesTable depenses={depenses} columns={depColumns} base={base} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={showConfirm}
        title={confirmTitle}
        message={confirmMsg}
        confirmLabel={buttonLabel}
        onConfirm={handleApprove}
        onCancel={() => setShowConfirm(false)}
        loading={approving}
      />

      {/* Toast */}
      <Toast result={approveResult} onDismiss={dismissResult} />
    </div>
  );
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

initializeBlock({ interface: () => <ApprobationFacturesApp /> });
