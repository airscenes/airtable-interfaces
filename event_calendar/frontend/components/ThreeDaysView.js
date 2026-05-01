import { useEffect, useRef } from "react";
import { DAYS_SHORT, fmtTime } from "../utils/dates";
import {
  DEFAULT_SCROLL_HOUR,
  HOURS,
  HOUR_HEIGHT,
} from "../utils/timeGrid";
import { ThreeDaysEventBlock } from "./ThreeDaysEventBlock";
import { ThreeDaysEventGroup } from "./ThreeDaysEventGroup";
import { TimeGridColumn } from "./TimeGridColumn";

export function ThreeDaysView({
  days,
  refDate,
  eventsByDate,
  nameField1,
  nameField2,
  colorField,
  dateField,
  endDateField,
  base,
  onEventClick,
}) {
  const timeGridRef = useRef(null);

  useEffect(() => {
    if (timeGridRef.current) {
      timeGridRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, [refDate]);

  return (
    <>
      {/* Day headers with left gutter */}
      <div className="flex border-b border-gray-gray200 dark:border-gray-gray700">
        <div className="w-14 shrink-0" />
        <div className="grid grid-cols-3 flex-1">
          {days.map((cell) => {
            const jsDate = new Date(cell.year, cell.month - 1, cell.day);
            const dayOfWeek = (jsDate.getDay() + 6) % 7;
            return (
              <div
                key={cell.dateKey}
                className={`text-center text-xs font-medium py-2 ${
                  cell.isToday ? "text-blue-blueBright" : "text-gray-gray400 dark:text-gray-gray500"
                }`}
              >
                <div>{DAYS_SHORT[dayOfWeek]}.</div>
                <div
                  className={`text-lg font-semibold ${
                    cell.isToday ? "text-blue-blueBright" : "text-gray-gray700 dark:text-gray-gray200"
                  }`}
                >
                  {cell.day}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Time grid */}
      <div
        ref={timeGridRef}
        className="border border-gray-gray200 dark:border-gray-gray700 rounded-b-md overflow-auto"
        style={{ maxHeight: "calc(100vh - 140px)" }}
      >
        <div className="flex">
          {/* Hour labels */}
          <div className="w-14 shrink-0">
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-right pr-2 text-[11px] text-gray-gray400 dark:text-gray-gray500"
                style={{ height: HOUR_HEIGHT }}
              >
                {fmtTime(h, 0)}
              </div>
            ))}
          </div>
          {/* Day columns */}
          <div className="grid grid-cols-3 flex-1 divide-x divide-gray-gray100 dark:divide-gray-gray700">
            {days.map((cell) => (
              <div key={cell.dateKey} className="relative">
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="border-t border-gray-gray100 dark:border-gray-gray700"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}
                {/* Events overlay */}
                <div className="absolute inset-0">
                  <TimeGridColumn
                    cell={cell}
                    events={cell.dateKey ? eventsByDate.get(cell.dateKey) || [] : []}
                    nameField1={nameField1}
                    nameField2={nameField2}
                    colorField={colorField}
                    dateField={dateField}
                    endDateField={endDateField}
                    base={base}
                    onEventClick={onEventClick}
                    EventComponent={ThreeDaysEventBlock}
                    GroupComponent={ThreeDaysEventGroup}
                    groupThreshold={3}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
