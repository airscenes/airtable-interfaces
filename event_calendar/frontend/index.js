import { useMemo, useState } from "react";
import {
  expandRecord,
  initializeBlock,
  useBase,
  useCustomProperties,
  useRecords,
} from "@airtable/blocks/interface/ui";
import {
  MONTHS_FR,
  build2WeeksGrid,
  build3DaysGrid,
  buildCalendarGrid,
  getMonday,
  groupEventsByDate,
} from "./utils/dates";
import { getCustomProperties } from "./utils/customProperties";
import { CalendarHeader } from "./components/CalendarHeader";
import { ThreeDaysView } from "./components/ThreeDaysView";
import { WeeksGridView } from "./components/WeeksGridView";
import "./style.css";

function CalendarApp() {
  const base = useBase();
  const { customPropertyValueByKey } = useCustomProperties(getCustomProperties);

  const eventsTable = customPropertyValueByKey.eventsTable;
  const projetsTable = customPropertyValueByKey.projetsTable;
  const dateField = customPropertyValueByKey.dateField;
  const endDateField = customPropertyValueByKey.endDateField;
  const nameField1 = customPropertyValueByKey.nameField1;
  const nameField2 = customPropertyValueByKey.nameField2;
  const colorField = customPropertyValueByKey.colorField;
  const projetLinkField = customPropertyValueByKey.projetLinkField;

  const eventRecords = useRecords(eventsTable);
  const projetRecords = useRecords(projetsTable);

  const [viewMode, setViewMode] = useState("month");
  const [refDate, setRefDate] = useState(() => new Date());

  const currentYear = refDate.getFullYear();
  const currentMonth = refDate.getMonth() + 1;

  const monthGrid = useMemo(
    () => buildCalendarGrid(currentYear, currentMonth),
    [currentYear, currentMonth]
  );
  const twoWeeksGrid = useMemo(() => build2WeeksGrid(refDate), [refDate]);
  const threeDaysGrid = useMemo(() => build3DaysGrid(refDate), [refDate]);
  const eventsByDate = useMemo(
    () => groupEventsByDate(eventRecords, dateField),
    [eventRecords, dateField]
  );

  function goPrev() {
    setRefDate((d) => {
      const next = new Date(d);
      if (viewMode === "month") next.setMonth(next.getMonth() - 1);
      else if (viewMode === "2weeks") next.setDate(next.getDate() - 14);
      else next.setDate(next.getDate() - 3);
      return next;
    });
  }

  function goNext() {
    setRefDate((d) => {
      const next = new Date(d);
      if (viewMode === "month") next.setMonth(next.getMonth() + 1);
      else if (viewMode === "2weeks") next.setDate(next.getDate() + 14);
      else next.setDate(next.getDate() + 3);
      return next;
    });
  }

  function goToday() {
    setRefDate(new Date());
  }

  function getHeaderTitle() {
    if (viewMode === "month") {
      return `${MONTHS_FR[currentMonth - 1]} ${currentYear}`;
    }
    if (viewMode === "2weeks") {
      const monday = getMonday(refDate);
      const end = new Date(monday);
      end.setDate(end.getDate() + 13);
      const startDay = monday.getDate();
      const startMonth = MONTHS_FR[monday.getMonth()];
      const endDay = end.getDate();
      const endMonth = MONTHS_FR[end.getMonth()];
      const endYear = end.getFullYear();
      if (monday.getMonth() === end.getMonth()) {
        return `${startDay} - ${endDay} ${endMonth} ${endYear}`;
      }
      return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${endYear}`;
    }
    // 3days
    const start = refDate;
    const end = new Date(refDate);
    end.setDate(end.getDate() + 2);
    const startDay = start.getDate();
    const startMonth = MONTHS_FR[start.getMonth()];
    const endDay = end.getDate();
    const endMonth = MONTHS_FR[end.getMonth()];
    const endYear = end.getFullYear();
    if (start.getMonth() === end.getMonth()) {
      return `${startDay} - ${endDay} ${endMonth} ${endYear}`;
    }
    return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${endYear}`;
  }

  function handleEventClick(eventRecord) {
    if (projetLinkField) {
      const linkValue = eventRecord.getCellValue(projetLinkField);
      if (Array.isArray(linkValue) && linkValue.length > 0) {
        const projetRecord = projetRecords?.find((r) => r.id === linkValue[0].id);
        if (projetRecord) {
          expandRecord(projetRecord);
          return;
        }
      }
    }
    expandRecord(eventRecord);
  }

  const cellProps = { nameField1, nameField2, colorField, base, onEventClick: handleEventClick };

  return (
    <div className="p-3 bg-white dark:bg-gray-gray900 text-gray-gray800 dark:text-gray-gray100" style={{ zoom: 1.25 }}>
      <CalendarHeader
        title={getHeaderTitle()}
        viewMode={viewMode}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onChangeView={setViewMode}
      />

      {viewMode === "month" && (
        <WeeksGridView weeks={monthGrid} eventsByDate={eventsByDate} cellProps={cellProps} />
      )}

      {viewMode === "2weeks" && (
        <WeeksGridView weeks={twoWeeksGrid} eventsByDate={eventsByDate} cellProps={cellProps} />
      )}

      {viewMode === "3days" && (
        <ThreeDaysView
          days={threeDaysGrid}
          refDate={refDate}
          eventsByDate={eventsByDate}
          nameField1={nameField1}
          nameField2={nameField2}
          colorField={colorField}
          dateField={dateField}
          endDateField={endDateField}
          base={base}
          onEventClick={handleEventClick}
        />
      )}
    </div>
  );
}

initializeBlock({ interface: () => <CalendarApp /> });
