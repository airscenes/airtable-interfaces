import { getEventColor } from "../utils/colors";
import { readFieldLabel } from "../utils/fields";

export function EventPill({ record, nameField1, nameField2, colorField, base, onClick }) {
  const color = getEventColor(record, colorField, base);
  const part1 = readFieldLabel(record, nameField1);
  const part2 = readFieldLabel(record, nameField2);
  const label = [part1, part2].filter(Boolean).join(" - ") || record.name;

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
