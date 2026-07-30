import { useState, useMemo, useEffect } from "react";

// --- Shared date/city/venue filtering for the events table ---
// Used by both the per-spectacle detail page and the global all-events page.
export function useRepFilters(representations) {
  const [showAll, setShowAll] = useState(false);
  const [filterVille, setFilterVille] = useState("");
  const [filterSalle, setFilterSalle] = useState("");

  // Default filter: upcoming events only (date >= today). Everything else
  // (statut, site web, en vente) is deliberately NOT filtered — those values
  // vary too much from one base to the next to be a safe default, and are
  // visible as columns in the table anyway.
  const filteredByDate = useMemo(() => {
    if (showAll) return representations;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return representations.filter((rep) => !(rep.rawDate && rep.rawDate < today));
  }, [representations, showAll]);

  const uniqueVilles = useMemo(() => {
    const set = new Set(filteredByDate.map((r) => r.colVille).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [filteredByDate]);

  const uniqueSalles = useMemo(() => {
    const set = new Set(filteredByDate.map((r) => r.colSalle).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [filteredByDate]);

  const filteredReps = useMemo(() => {
    let reps = filteredByDate;
    if (filterVille) reps = reps.filter((r) => r.colVille === filterVille);
    if (filterSalle) reps = reps.filter((r) => r.colSalle === filterSalle);
    return reps;
  }, [filteredByDate, filterVille, filterSalle]);

  // Reset stale filters when options change
  useEffect(() => {
    if (filterVille && !uniqueVilles.includes(filterVille)) setFilterVille("");
    if (filterSalle && !uniqueSalles.includes(filterSalle)) setFilterSalle("");
  }, [uniqueVilles, uniqueSalles, filterVille, filterSalle]);

  return {
    showAll, setShowAll,
    filterVille, setFilterVille,
    filterSalle, setFilterSalle,
    uniqueVilles, uniqueSalles,
    filteredReps,
  };
}
