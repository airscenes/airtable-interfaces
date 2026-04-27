import { useState, useRef, useEffect } from "react";

const ChevronDown = ({ className = "" }) => (
  <svg
    className={className}
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M4 6l4 4 4-4"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function YearDropdown({ options = [], value = null, onChange, label = "" }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const select = (v) => {
    if (typeof onChange === "function") onChange(v);
    setOpen(false);
  };

  return (
    <div className="bn-year-dropdown relative inline-block" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="bn-year-dropdown-button inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-gray200 dark:border-gray-gray600 bg-white dark:bg-gray-gray700 hover:bg-gray-gray50 dark:hover:bg-gray-gray800 text-sm text-gray-gray700 dark:text-gray-gray200 transition-colors"
      >
        <span className="bn-year-dropdown-label">{value || label}</span>
        <ChevronDown className="bn-year-dropdown-caret text-gray-gray500 dark:text-gray-gray400" />
      </button>

      {open && (
        <div className="bn-year-dropdown-menu absolute left-0 top-full mt-1 z-20 min-w-[160px] rounded-md border border-gray-gray200 dark:border-gray-gray600 bg-white dark:bg-gray-gray700 shadow-lg py-1">
          {options.length === 0 ? (
            <div className="bn-year-dropdown-empty px-3 py-1.5 text-sm text-gray-gray400">
              Aucune année
            </div>
          ) : (
            options.map((opt) => {
              const name = typeof opt === "string" ? opt : opt?.name;
              if (!name) return null;
              const active = value === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => select(name)}
                  className={`bn-year-dropdown-item block w-full text-left px-3 py-1.5 text-sm ${
                    active
                      ? "bn-year-dropdown-item-active bg-blue-blueLight3 text-blue-blue"
                      : "text-gray-gray700 dark:text-gray-gray200 hover:bg-gray-gray50 dark:hover:bg-gray-gray800"
                  }`}
                >
                  {name}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
