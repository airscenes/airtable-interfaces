import { useState, useCallback, useEffect, useRef } from "react";

// User-resized column widths ({ columnKey: px }), persisted in localStorage so
// they survive reloads. Shared by every events table of the extension. Storage
// may be unavailable (private window, blocked site data): the table then just
// falls back to default widths.
const STORAGE_KEY = "sales-chart:colWidths";
export const MIN_COL_WIDTH = 50;

function loadWidths() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveWidths(widths) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Storage unavailable: widths only last for this session.
  }
}

export function useColumnWidths() {
  const [widths, setWidths] = useState(loadWidths);
  // Listeners of an in-progress drag, removed if the table unmounts mid-drag.
  const stopDragRef = useRef(null);
  useEffect(() => () => stopDragRef.current?.(), []);

  // Starts a drag from a header's resize handle. Widths update live while
  // dragging and are persisted once on release.
  const startResize = useCallback((key, startWidth, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let latest = startWidth;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev) => {
      latest = Math.max(MIN_COL_WIDTH, Math.round(startWidth + ev.clientX - startX));
      setWidths((prev) => (prev[key] === latest ? prev : { ...prev, [key]: latest }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      stopDragRef.current = null;
    };
    const onUp = () => {
      stop();
      setWidths((prev) => {
        const next = { ...prev, [key]: latest };
        saveWidths(next);
        return next;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    stopDragRef.current = stop;
  }, []);

  // Back to the column's default width.
  const resetWidth = useCallback((key) => {
    setWidths((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      saveWidths(next);
      return next;
    });
  }, []);

  return { widths, startResize, resetWidth };
}
