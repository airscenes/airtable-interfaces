import { AIRTABLE_COLORS } from "../utils/colors";

// --- SelectBadge: renders a colored pill for single-select values ---

export function SelectBadge({ value }) {
  if (!value || !value.text) return <span className="text-gray-gray400">—</span>;
  const palette = value.color ? AIRTABLE_COLORS[value.color] : null;
  if (!palette) return <span>{value.text}</span>;
  return (
    <span style={{ backgroundColor: palette.bg, color: palette.text, padding: "1px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", display: "inline-block" }}>
      {value.text}
    </span>
  );
}
