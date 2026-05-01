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
  GroupComponent,
  groupThreshold,
}) {
  const positioned = useMemo(() => {
    const items = events.map((record) => {
      const pos = getTimePosition(record, dateField, endDateField);
      return { record, ...pos };
    });

    if (GroupComponent && groupThreshold && groupThreshold > 1) {
      const buckets = new Map();
      for (const item of items) {
        const key = `${item.top}_${item.height}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(item);
      }
      const merged = [];
      for (const bucket of buckets.values()) {
        if (bucket.length >= groupThreshold) {
          const head = bucket[0];
          merged.push({
            isGroup: true,
            records: bucket.map((b) => b.record),
            top: head.top,
            height: head.height,
            startLabel: head.startLabel,
            endLabel: head.endLabel,
          });
        } else {
          for (const item of bucket) merged.push({ isGroup: false, ...item });
        }
      }
      return layoutOverlapping(merged);
    }

    return layoutOverlapping(items);
  }, [events, dateField, endDateField, GroupComponent, groupThreshold]);

  return (
    <div
      className={`relative ${cell.isToday ? "bg-blue-blueLight2/30 dark:bg-[#1a2a4a]/30" : ""}`}
      style={{ height: (GRID_END_HOUR - GRID_START_HOUR + 1) * HOUR_HEIGHT }}
    >
      {positioned.map((evt) =>
        evt.isGroup ? (
          <GroupComponent
            key={`group-${evt.top}-${evt.height}-${evt.col}`}
            group={evt}
            nameField1={nameField1}
            nameField2={nameField2}
            colorField={colorField}
            base={base}
            onEventClick={onEventClick}
          />
        ) : (
          <EventComponent
            key={evt.record.id}
            evt={evt}
            nameField1={nameField1}
            nameField2={nameField2}
            colorField={colorField}
            base={base}
            onEventClick={onEventClick}
          />
        )
      )}
    </div>
  );
}
