import { useState, useMemo } from "react";
import {
  initializeBlock,
  useBase,
  useRecords,
} from "@airtable/blocks/interface/ui";
import { YearDropdown } from "./components/YearDropdown";
import { CampagnesMetaList } from "./components/CampagnesMetaList";
import "./style.css";

const findField = (table, name) =>
    table?.fields?.find(
    (f) => f?.name?.toLowerCase() === name.toLowerCase(),
  ) || null;

function App() {
  const base = useBase();
  const yearsTable = base?.tables?.find(
    (t) => t?.name?.toLowerCase() === "budget_annuel",
  ) || null;
  const campagnesMetaTable = base?.tables?.find(
    (t) => t?.name?.toLowerCase() === "campagnes_meta",
  ) || null;
  const budgetTable = base?.tables?.find(
    (t) => t?.name?.toLowerCase() === "budgets",
  ) || null;

  // Guard at the boundary: useRecords crashes on null tables. If the
  // budget_annuel table can't be found, render the widget with no options.
  if (!yearsTable || !yearsTable.id) {
    return (
      <div className="bn-app p-4 min-h-screen bg-white dark:bg-gray-gray800">
        <YearDropdown options={[]} value={null} onChange={() => {}} />
      </div>
    );
  }

  return (
    <AppInner
      yearsTable={yearsTable}
      campagnesMetaTable={campagnesMetaTable}
      budgetTable={budgetTable}
    />
  );
}

function AppInner({ yearsTable, campagnesMetaTable, budgetTable }) {
  const [year, setYear] = useState(null);

  // Records — useRecords always needs a real table, so optional tables fall
  // back to yearsTable when missing and we discard the result.
  const yearRecords = useRecords(yearsTable);
  const campagneRecordsRaw = useRecords(campagnesMetaTable || yearsTable);
  const campagneRecords = campagnesMetaTable ? campagneRecordsRaw : null;
  const budgetRecordsRaw = useRecords(budgetTable || yearsTable);
  const budgetRecords = budgetTable ? budgetRecordsRaw : null;

  // Fields on budget_annuel
  const yearField =
    findField(yearsTable, "années") || findField(yearsTable, "annees");
  const campagnesLinkField =
    findField(yearsTable, "campagnes_meta") ||
    yearsTable.fields?.find((f) =>
      f?.name?.toLowerCase().includes("campagne"),
    ) ||
    null;

  // Fields on Campagnes_META
  const nameField = findField(campagnesMetaTable, "name");
  const spendBudgetField = findField(campagnesMetaTable, "spend_budget");
  const budgetField = findField(campagnesMetaTable, "budget");
  const soldeField = findField(campagnesMetaTable, "solde");
  const probableField = findField(campagnesMetaTable, "Probable");
  const spendMediaField = findField(campagnesMetaTable, "spend_media");
  const spendProdField = findField(campagnesMetaTable, "spend_prod");

  // Fields on Budgets
  // `budgetNameField` points to the `Campagne` link field — `getCellValueAsString`
  // returns the linked Campagne's primary field value, which is the display name.
  const budgetNameField = findField(budgetTable, "Campagne");
  const budgetSpendTotalField = findField(budgetTable, "spend_total");
  const budgetSpendMediaField = findField(budgetTable, "spend_media");
  const budgetSpendProdField = findField(budgetTable, "spend_prod");
  const budgetCampagneMetaLinkField =
    findField(budgetTable, "campagnes_meta") ||
    budgetTable?.fields?.find((f) =>
      f?.name?.toLowerCase().includes("campagnes_meta"),
    ) ||
    null;

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
      <YearDropdown options={options} value={year} onChange={setYear} />
      <CampagnesMetaList
        records={visibleCampagnes}
        campagnesTable={campagnesMetaTable}
        nameField={nameField}
        spendBudgetField={spendBudgetField}
        budgetField={budgetField}
        soldeField={soldeField}
        probableField={probableField}
        spendMediaField={spendMediaField}
        spendProdField={spendProdField}
        yearByCampagneId={yearByCampagneId}
        budgetsByCampagneMetaId={budgetsByCampagneMetaId}
        budgetNameField={budgetNameField}
        budgetSpendTotalField={budgetSpendTotalField}
        budgetSpendMediaField={budgetSpendMediaField}
        budgetSpendProdField={budgetSpendProdField}
      />
    </div>
  );
}

initializeBlock({ interface: () => <App /> });
