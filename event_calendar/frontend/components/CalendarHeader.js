const ChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function CalendarHeader({ title, viewMode, onPrev, onNext, onToday, onChangeView }) {
  const viewBtnClass = (mode) =>
    `px-3 py-1 text-sm rounded-md transition-colors ${
      viewMode === mode
        ? "bg-blue-blueBright text-white"
        : "border border-gray-gray200 dark:border-gray-gray600 hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300"
    }`;

  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 transition-colors"
        >
          <ChevronLeft />
        </button>
        <button
          onClick={onNext}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 transition-colors"
        >
          <ChevronRight />
        </button>
        <h2 className="text-lg font-semibold ml-1">{title}</h2>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => onChangeView("month")} className={viewBtnClass("month")}>Mois</button>
          <button onClick={() => onChangeView("2weeks")} className={viewBtnClass("2weeks")}>2 Sem.</button>
          <button onClick={() => onChangeView("3days")} className={viewBtnClass("3days")}>3 Jours</button>
        </div>
        <button
          onClick={onToday}
          className="px-3 py-1 text-sm rounded-md border border-gray-gray200 dark:border-gray-gray600 hover:bg-gray-gray100 dark:hover:bg-gray-gray700 text-gray-gray600 dark:text-gray-gray300 transition-colors"
        >
          Aujourd&apos;hui
        </button>
      </div>
    </div>
  );
}
