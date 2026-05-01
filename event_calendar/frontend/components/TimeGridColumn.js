import { useMemo } from "react";
import {
  GRID_END_HOUR,
  GRID_START_HOUR,
  HOUR_HEIGHT,
  getTimePosition,
  layoutOverlapping,
} from "../utils/timeGrid";

export function TimeGridColumn({
  cell,
  events,
  nameField1,
  nameField2,
  colorField,
  dateField,
  endDateField,
  base,
  onEventClick,
  EventComponent,
}) {
  const positioned = useMemo(() => {
    const items = events.map((record) => {
      const pos = getTimePosition(record, dateField, endDateField);
      return { record, ...pos };
    });
    return layoutOverlapping(items);
  }, [events, dateField, endDateField]);

  return (
    <div
      className={`relative ${cell.isToday ? "bg-blue-blueLight2/30 dark:bg-[#1a2a4a]/30" : ""}`}
      style={{ height: (GRID_END_HOUR - GRID_START_HOUR + 1) * HOUR_HEIGHT }}
    >
      {positioned.map((evt) => (
        <EventComponent
          key={evt.record.id}
          evt={evt}
          nameField1={nameField1}
          nameField2={nameField2}
          colorField={colorField}
          base={base}
          onEventClick={onEventClick}
        />
      ))}
    </div>
  );
}
