import { DAYS_SHORT } from "../utils/dates";
import { DayCell } from "./DayCell";

// Shared layout for "month" and "2 weeks" views: weekday header + grid of DayCells.
export function WeeksGridView({ weeks, eventsByDate, cellProps }) {
  return (
    <>
      <div className="grid grid-cols-7 border-b border-gray-gray200 dark:border-gray-gray700 mb-0">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-gray-gray400 dark:text-gray-gray500 py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="border border-gray-gray200 dark:border-gray-gray700 rounded-b-md overflow-hidden">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x divide-gray-gray100 dark:divide-gray-gray700">
            {week.map((cell, ci) => (
              <DayCell
                key={ci}
                cell={cell}
                events={cell.dateKey ? eventsByDate.get(cell.dateKey) || [] : []}
                {...cellProps}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
