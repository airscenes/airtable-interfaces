import { fmtTime, parseIsoTime, readDateCell } from "./dates";

export const HOUR_HEIGHT = 60;
export const GRID_START_HOUR = 0;
export const GRID_END_HOUR = 24;
export const DEFAULT_SCROLL_HOUR = 8;
export const HOURS = Array.from(
  { length: GRID_END_HOUR - GRID_START_HOUR + 1 },
  (_, i) => GRID_START_HOUR + i
);

export function getTimePosition(record, dateField, endDateField) {
  const startIso = readDateCell(record, dateField);
  const startTime = parseIsoTime(startIso);
  const startH = startTime ? startTime.hour : DEFAULT_SCROLL_HOUR;
  const startM = startTime ? startTime.minute : 0;

  let endH = startH + 1;
  let endM = startM;
  if (endDateField) {
    const endIso = readDateCell(record, endDateField);
    const endTime = parseIsoTime(endIso);
    if (endTime) {
      endH = endTime.hour;
      endM = endTime.minute;
    }
  }

  const top = (startH - GRID_START_HOUR) * HOUR_HEIGHT + startM;
  const bottom = (endH - GRID_START_HOUR) * HOUR_HEIGHT + endM;
  const height = Math.max(bottom - top, 20);

  return {
    top,
    height,
    startLabel: fmtTime(startH, startM),
    endLabel: fmtTime(endH, endM),
  };
}

export function layoutOverlapping(events) {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.top - b.top);
  const columns = [];
  for (const evt of sorted) {
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const last = columns[c][columns[c].length - 1];
      if (last.top + last.height <= evt.top) {
        columns[c].push(evt);
        evt.col = c;
        placed = true;
        break;
      }
    }
    if (!placed) {
      evt.col = columns.length;
      columns.push([evt]);
    }
  }
  const totalCols = columns.length;
  for (const evt of sorted) {
    evt.totalCols = totalCols;
  }
  return sorted;
}
