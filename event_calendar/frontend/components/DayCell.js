import { EventPill } from "./EventPill";

export function DayCell({ cell, events, nameField1, nameField2, colorField, base, onEventClick }) {
  if (!cell.day) {
    return <div className="bg-gray-gray50 dark:bg-gray-gray900" />;
  }

  return (
    <div
      className={`p-1 border-t border-gray-gray100 dark:border-gray-gray700 ${
        cell.isToday ? "bg-blue-blueLight2 dark:bg-[#1a2a4a]" : "bg-white dark:bg-gray-gray800"
      }`}
    >
      <span
        className={`text-xs font-medium inline-block mb-0.5 ${
          cell.isToday
            ? "bg-blue-blueBright text-white rounded-full w-5 h-5 flex items-center justify-center"
            : "text-gray-gray500 dark:text-gray-gray300"
        }`}
      >
        {cell.day}
      </span>
      <div className="space-y-0.5">
        {events.map((record) => (
          <EventPill
            key={record.id}
            record={record}
            nameField1={nameField1}
            nameField2={nameField2}
            colorField={colorField}
            base={base}
            onClick={onEventClick}
          />
        ))}
      </div>
    </div>
  );
}
