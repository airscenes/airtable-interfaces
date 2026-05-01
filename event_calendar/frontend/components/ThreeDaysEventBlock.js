import { getEventColor } from "../utils/colors";
import { readFieldLabel } from "../utils/fields";

export function ThreeDaysEventBlock({
  evt,
  nameField1,
  nameField2,
  colorField,
  base,
  onEventClick,
}) {
  const color = getEventColor(evt.record, colorField, base);
  const part1 = readFieldLabel(evt.record, nameField1);
  const part2 = readFieldLabel(evt.record, nameField2);
  const label = [part1, part2].filter(Boolean).join(" - ") || evt.record.name;
  const widthPct = 100 / evt.totalCols;
  const leftPct = evt.col * widthPct;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onEventClick(evt.record); }}
      className="absolute rounded px-1.5 py-1 text-[11px] leading-tight cursor-pointer hover:opacity-80 transition-opacity border-l-[3px]"
      style={{
        top: evt.top,
        height: evt.height,
        left: `${leftPct}%`,
        width: `calc(${widthPct}% - 2px)`,
        backgroundColor: color.bg + "22",
        borderLeftColor: color.bg,
        color: color.text === "#fff" ? color.bg : color.text,
      }}
      title={`${label}\n${evt.startLabel} - ${evt.endLabel}`}
    >
      <div className="three-days-event-block__hours text-[10px] opacity-70">{evt.startLabel} - {evt.endLabel}</div>
      <div className="three-days-event-block__label font-medium">{label}</div>
    </button>
  );
}
