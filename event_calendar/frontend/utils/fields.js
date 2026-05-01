export function readFieldLabel(record, field) {
  if (!field) return null;
  const raw = record.getCellValue(field);
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw.map((r) => r.name || r).join(", ");
  if (raw.name) return raw.name;
  return String(raw);
}
