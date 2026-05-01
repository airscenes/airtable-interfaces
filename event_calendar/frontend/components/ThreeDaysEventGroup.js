import { getEventColor } from "../utils/colors";
import { readFieldLabel } from "../utils/fields";

export function ThreeDaysEventGroup({
  group,
  nameField1,
  nameField2,
  colorField,
  base,
  onEventClick,
}) {
  const widthPct = 100 / group.totalCols;
  const leftPct = group.col * widthPct;
  return (
    <div
      className="absolute rounded overflow-hidden border-l-[3px] border-gray-gray400 bg-gray-gray100/70 dark:bg-gray-gray700/40 flex flex-col"
      style={{
        top: group.top,
        height: group.height,
        left: `${leftPct}%`,
        width: `calc(${widthPct}% - 2px)`,
      }}
    >
      <div className="shrink-0 px-1.5 pt-1 text-[10px] font-medium opacity-70">
        {group.startLabel} - {group.endLabel} · {group.records.length}
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-gray-gray200/60 dark:divide-gray-gray600/40">
        {group.records.map((record) => {
          const color = getEventColor(record, colorField, base);
          const part1 = readFieldLabel(record, nameField1);
          const part2 = readFieldLabel(record, nameField2);
          const label = [part1, part2].filter(Boolean).join(" - ") || record.name;
          return (
            <button
              key={record.id}
              onClick={(e) => { e.stopPropagation(); onEventClick(record); }}
              className="block w-full text-left px-1.5 py-1 text-[11px] leading-tight cursor-pointer hover:opacity-80 transition-opacity"
              style={{
                backgroundColor: color.bg + "22",
                color: color.text === "#fff" ? color.bg : color.text,
                borderLeft: `2px solid ${color.bg}`,
              }}
              title={label}
            >
              <div className="three-days-event-group__label font-medium">{label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
