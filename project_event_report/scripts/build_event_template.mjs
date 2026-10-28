// Writes the default "rapports par événement" template to Rapport_evenements_template.xlsx.
// Customise it in Excel (logo, colours, extra text) keeping the ${…} tags and the two sheet
// names, then attach it to the producer's Organismes record (template field configured in the
// extension). Layout and tags are documented in frontend/eventTemplateDefault.js.
//
//   node scripts/build_event_template.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { buildDefaultEventTemplate } from "../frontend/eventTemplateDefault.js";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "Rapport_evenements_template.xlsx");
await buildDefaultEventTemplate(ExcelJS).xlsx.writeFile(out);
console.log(`Template written: ${out}`);
