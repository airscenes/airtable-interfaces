import { useState, useMemo, useEffect } from "react";
import {
  initializeBlock,
  useRecords,
  useCustomProperties,
} from "@airtable/blocks/interface/ui";
import { YearDropdown } from "./components/YearDropdown";
import { AnnualBudget } from "./components/AnnualBudget";
import { CampagnesMetaList } from "./components/CampagnesMetaList";
import "./style.css";

// --- Custom Properties Definition ---
// Tables and fields are configured per Interface page via the extension's
// properties panel — nothing is hard-coded. `defaultValue` pre-selects the
// table/field when a matching name exists, so a base laid out the expected
// way works out of the box but stays overridable.

const anyField = () => true;

// Resolve a Field by trying each candidate name in order (case-insensitive).
const findField = (table, ...names) => {
  if (!table) return undefined;
  for (const n of names) {
    const f = table.fields?.find(
      (x) => x?.name?.toLowerCase() === n.toLowerCase(),
    );
    if (f) return f;
  }
  return undefined;
};

function getCustomProperties(base) {
  const tables = base.tables;
  const exact = (...kw) =>
    tables.find((t) => kw.some((k) => t.name?.toLowerCase() === k));
  const includes = (...kw) =>
    tables.find((t) => kw.some((k) => t.name?.toLowerCase().includes(k)));

  const yearsTable = exact("budget annuel");
  const campagnesMetaTable = exact("campagnes_meta") || includes("campagne");
  const budgetTable = exact("budgets");

  // Field properties require a `table`; fall back to the first table when the
  // expected one is not found so the property panel still renders.
  const fb = tables[0];
  const yT = yearsTable || fb;
  const cT = campagnesMetaTable || fb;
  const bT = budgetTable || fb;

  return [
    // --- Tables ---
    { key: "yearsTable", label: "Table Budget Annuel (années)", type: "table", defaultValue: yearsTable },
    { key: "campagnesMetaTable", label: "Table Campagnes_META", type: "table", defaultValue: campagnesMetaTable },
    { key: "budgetTable", label: "Table Budgets", type: "table", defaultValue: budgetTable },

    // --- Champs Budget Annuel ---
    { key: "yearField", label: "Champ Années (Budget Annuel)", type: "field", table: yT, shouldFieldBeAllowed: anyField, defaultValue: findField(yearsTable, "années", "annees") },
    { key: "campagnesLinkField", label: "Lien Campagnes_META (Budget Annuel)", type: "field", table: yT, shouldFieldBeAllowed: anyField, defaultValue: findField(yearsTable, "campagnes_meta") },
    { key: "budgetAnnualTotalField", label: "Champ Budget Annuel Total (Budget Annuel)", type: "field", table: yT, shouldFieldBeAllowed: anyField, defaultValue: findField(yearsTable, "Budget Annuel Total") },
    { key: "budgetReviseTotalField", label: "Champ Budget Révisé Total (Budget Annuel)", type: "field", table: yT, shouldFieldBeAllowed: anyField, defaultValue: findField(yearsTable, "Budget Révisé Total") },

    // --- Champs Campagnes_META ---
    { key: "nameField", label: "Champ Name (Campagnes_META)", type: "field", table: cT, shouldFieldBeAllowed: anyField, defaultValue: findField(campagnesMetaTable, "name") },
    { key: "spendBudgetField", label: "Champ spend_budget (Campagnes_META)", type: "field", table: cT, shouldFieldBeAllowed: anyField, defaultValue: findField(campagnesMetaTable, "spend_budget") },
    { key: "budgetField", label: "Champ budget (Campagnes_META)", type: "field", table: cT, shouldFieldBeAllowed: anyField, defaultValue: findField(campagnesMetaTable, "budget") },
    { key: "percentField", label: "Champ Ratio Budget (Campagnes_META)", type: "field", table: cT, shouldFieldBeAllowed: anyField, defaultValue: findField(campagnesMetaTable, "Ratio Budget") },
    { key: "budgetReviseField", label: "Champ Budget Révisé (Campagnes_META)", type: "field", table: cT, shouldFieldBeAllowed: anyField, defaultValue: findField(campagnesMetaTable, "Budget Révisé") },
    { key: "probableField", label: "Champ Probable (Campagnes_META)", type: "field", table: cT, shouldFieldBeAllowed: anyField, defaultValue: findField(campagnesMetaTable, "Probable") },
    { key: "spendMediaField", label: "Champ spend_media (Campagnes_META)", type: "field", table: cT, shouldFieldBeAllowed: anyField, defaultValue: findField(campagnesMetaTable, "spend_media") },
    { key: "spendProdField", label: "Champ spend_prod (Campagnes_META)", type: "field", table: cT, shouldFieldBeAllowed: anyField, defaultValue: findField(campagnesMetaTable, "spend_prod") },

    // --- Champs Budgets ---
    { key: "budgetNameField", label: "Lien Campagne (Budgets)", type: "field", table: bT, shouldFieldBeAllowed: anyField, defaultValue: findField(budgetTable, "Campagne") },
    { key: "budgetIdentifiantField", label: "Champ identifiant_budget (Budgets)", type: "field", table: bT, shouldFieldBeAllowed: anyField, defaultValue: findField(budgetTable, "identifiant_budget") },
    { key: "budgetSpendTotalField", label: "Champ spend_total (Budgets)", type: "field", table: bT, shouldFieldBeAllowed: anyField, defaultValue: findField(budgetTable, "spend_total") },
    { key: "budgetSpendMediaField", label: "Champ spend_media (Budgets)", type: "field", table: bT, shouldFieldBeAllowed: anyField, defaultValue: findField(budgetTable, "spend_media") },
    { key: "budgetSpendProdField", label: "Champ spend_prod (Budgets)", type: "field", table: bT, shouldFieldBeAllowed: anyField, defaultValue: findField(budgetTable, "spend_prod") },
    { key: "budgetCampagneMetaLinkField", label: "Lien Campagnes_META (Budgets)", type: "field", table: bT, shouldFieldBeAllowed: anyField, defaultValue: findField(budgetTable, "campagnes_meta") },
  ];
}

// Shown when the required tables are not configured for the current page.
function ConfigPrompt() {
  return (
    <div className="bn-app flex items-center justify-center min-h-screen p-8 bg-white dark:bg-gray-gray800">
      <div className="max-w-md text-center">
        <p className="text-sm text-gray-gray600 dark:text-gray-gray200">
          Veuillez configurer la table Budget Annuel (et, idéalement,
          Campagnes_META et Budgets) dans les propriétés de l&apos;extension.
        </p>
      </div>
    </div>
  );
}

function App() {
  const { customPropertyValueByKey, errorState } =
    useCustomProperties(getCustomProperties);

  if (errorState) {
    return <ConfigPrompt />;
  }

  const yearsTable = customPropertyValueByKey.yearsTable;

  // Guard at the boundary: useRecords crashes on null tables. If the
  // Budget Annuel table isn't configured, show the configuration prompt.
  if (!yearsTable || !yearsTable.id) {
    return <ConfigPrompt />;
  }

  return <AppInner cfg={customPropertyValueByKey} />;
}

function AppInner({ cfg }) {
  const {
    yearsTable,
    campagnesMetaTable,
    budgetTable,
    yearField,
    campagnesLinkField,
    budgetAnnualTotalField,
    budgetReviseTotalField,
    nameField,
    spendBudgetField,
    budgetField,
    percentField,
    budgetReviseField,
    probableField,
    spendMediaField,
    spendProdField,
    budgetNameField,
    budgetIdentifiantField,
    budgetSpendTotalField,
    budgetSpendMediaField,
    budgetSpendProdField,
    budgetCampagneMetaLinkField,
  } = cfg;

  const [year, setYear] = useState(null);

  // Records — useRecords always needs a real table, so optional tables fall
  // back to yearsTable when missing and we discard the result.
  const yearRecords = useRecords(yearsTable);
  const campagneRecordsRaw = useRecords(campagnesMetaTable || yearsTable);
  const campagneRecords = campagnesMetaTable ? campagneRecordsRaw : null;
  const budgetRecordsRaw = useRecords(budgetTable || yearsTable);
  const budgetRecords = budgetTable ? budgetRecordsRaw : null;

  // Dropdown options
  const options = useMemo(() => {
    if (!yearRecords || !yearField) return [];
    const seen = new Set();
    const out = [];
    for (const r of yearRecords) {
      const name = r.getCellValueAsString(yearField);
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    return out.sort((a, b) => b.localeCompare(a));
  }, [yearRecords, yearField]);

  useEffect(() => {
    if (year == null && options.length > 0) {
      setYear(options[0]);
    }
  }, [options, year]);

  // Reverse lookup: campagneId → year string. Same source as the filter.
  // If a campagne is linked from multiple years, the first match wins.
  const yearByCampagneId = useMemo(() => {
    const map = new Map();
    if (!yearRecords || !yearField || !campagnesLinkField) return map;
    for (const y of yearRecords) {
      const yearName = y.getCellValueAsString(yearField);
      if (!yearName) continue;
      const links = y.getCellValue(campagnesLinkField);
      if (!Array.isArray(links)) continue;
      for (const l of links) {
        if (l?.id && !map.has(l.id)) map.set(l.id, yearName);
      }
    }
    return map;
  }, [yearRecords, yearField, campagnesLinkField]);

  // Campagne ids allowed by the selected year (null = no filter → show all).
  const allowedIds = useMemo(() => {
    if (!year || !yearRecords || !yearField || !campagnesLinkField) return null;
    const rec = yearRecords.find(
      (r) => r.getCellValueAsString(yearField) === year,
    );
    if (!rec) return new Set();
    const links = rec.getCellValue(campagnesLinkField);
    if (!Array.isArray(links)) return new Set();
    return new Set(links.map((l) => l?.id).filter(Boolean));
  }, [year, yearRecords, yearField, campagnesLinkField]);

  const visibleCampagnes = useMemo(() => {
    if (!campagneRecords) return [];
    if (!allowedIds) return campagneRecords;
    return campagneRecords.filter((r) => allowedIds.has(r.id));
  }, [campagneRecords, allowedIds]);

  // Annual budget for the selected year, read from the matching year record.
  const annualBudgetForYear = useMemo(() => {
    if (!year || !yearRecords || !yearField || !budgetAnnualTotalField) return null;
    const rec = yearRecords.find(
      (r) => r.getCellValueAsString(yearField) === year,
    );
    if (!rec) return null;
    const v = rec.getCellValue(budgetAnnualTotalField);
    return typeof v === "number" ? v : null;
  }, [year, yearRecords, yearField, budgetAnnualTotalField]);

  // Sum of `budget` across the visible campagnes — what's been allocated.
  const sumOfBudgets = useMemo(() => {
    if (!visibleCampagnes || !budgetField) return 0;
    let sum = 0;
    for (const r of visibleCampagnes) {
      const v = r.getCellValue(budgetField);
      if (typeof v === "number") sum += v;
    }
    return sum;
  }, [visibleCampagnes, budgetField]);

  // Sum of `spend_budget` across the visible campagnes — what's been spent.
  const sumOfSpent = useMemo(() => {
    if (!visibleCampagnes || !spendBudgetField) return 0;
    let sum = 0;
    for (const r of visibleCampagnes) {
      const v = r.getCellValue(spendBudgetField);
      if (typeof v === "number") sum += v;
    }
    return sum;
  }, [visibleCampagnes, spendBudgetField]);

  // Sum of `Probable` across the visible campagnes — committed/expected amount.
  const sumProbable = useMemo(() => {
    if (!visibleCampagnes || !probableField) return 0;
    let sum = 0;
    for (const r of visibleCampagnes) {
      const v = r.getCellValue(probableField);
      if (typeof v === "number") sum += v;
    }
    return sum;
  }, [visibleCampagnes, probableField]);

  // Sum of `Budget Révisé` across the visible campagnes — the revised target.
  // This is the live source of truth; the year-level "Budget Révisé Total"
  // is kept in sync from this value via the useEffect below.
  const sumOfRevise = useMemo(() => {
    if (!visibleCampagnes || !budgetReviseField) return 0;
    let sum = 0;
    for (const r of visibleCampagnes) {
      const v = r.getCellValue(budgetReviseField);
      if (typeof v === "number") sum += v;
    }
    return sum;
  }, [visibleCampagnes, budgetReviseField]);

  // Write-back: whenever the sum changes and differs from the year record's
  // stored value, push the new sum into "Budget Révisé Total". This keeps
  // the year-level rollup in sync with the per-campagne Révisé column.
  useEffect(() => {
    if (!year || !yearRecords || !yearField || !budgetReviseTotalField) return;
    const rec = yearRecords.find(
      (r) => r.getCellValueAsString(yearField) === year,
    );
    if (!rec) return;
    const current = rec.getCellValue(budgetReviseTotalField);
    if (typeof current === "number" && current === sumOfRevise) return;
    yearsTable
      .updateRecordAsync(rec, { [budgetReviseTotalField.id]: sumOfRevise })
      .catch((e) => {
        console.error("Failed to sync Budget Révisé Total:", e);
      });
  }, [
    sumOfRevise,
    year,
    yearRecords,
    yearField,
    budgetReviseTotalField,
    yearsTable,
  ]);

  // Bucket Budgets by their Campagnes_META link → one entry per Meta with the
  // list of Budget records that belong to it. Spend values live on Budgets,
  // so we need the Records (not just refs) to read them per row.
  const budgetsByCampagneMetaId = useMemo(() => {
    const map = new Map();
    if (!budgetRecords || !budgetCampagneMetaLinkField) return map;
    for (const b of budgetRecords) {
      const links = b.getCellValue(budgetCampagneMetaLinkField);
      if (!Array.isArray(links)) continue;
      for (const l of links) {
        if (!l?.id) continue;
        const arr = map.get(l.id);
        if (arr) arr.push(b);
        else map.set(l.id, [b]);
      }
    }
    return map;
  }, [budgetRecords, budgetCampagneMetaLinkField]);

  return (
    <div className="bn-app p-4 min-h-screen bg-white dark:bg-gray-gray800 space-y-4">
      <div className="bn-budget-card-container">
        <div className="bn-budget-cards flex items-start gap-4 py-2">
          <YearDropdown options={options} value={year} onChange={setYear} />
          <AnnualBudget
            sumOfSpent={sumOfSpent}
            sumProbable={sumProbable}
            annualBudget={annualBudgetForYear}
            sumOfRevise={sumOfRevise}
            sumOfBudgets={sumOfBudgets}
          />
        </div>
      </div>
      <CampagnesMetaList
        records={visibleCampagnes}
        campagnesTable={campagnesMetaTable}
        nameField={nameField}
        spendBudgetField={spendBudgetField}
        budgetField={budgetField}
        percentField={percentField}
        budgetReviseField={budgetReviseField}
        probableField={probableField}
        spendMediaField={spendMediaField}
        spendProdField={spendProdField}
        yearByCampagneId={yearByCampagneId}
        budgetsByCampagneMetaId={budgetsByCampagneMetaId}
        budgetNameField={budgetNameField}
        budgetIdentifiantField={budgetIdentifiantField}
        budgetSpendTotalField={budgetSpendTotalField}
        budgetSpendMediaField={budgetSpendMediaField}
        budgetSpendProdField={budgetSpendProdField}
        annualBudget={annualBudgetForYear}
      />
    </div>
  );
}

initializeBlock({ interface: () => <App /> });
