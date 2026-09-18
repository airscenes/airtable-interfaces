import { useState, useMemo, useEffect } from "react";

// --- Shared date/show/city/venue filtering for the events table ---
// Used by both the per-spectacle detail page and the global all-events page.
export function useRepFilters(representations) {
  const [showAll, setShowAll] = useState(false);
  const [filterSpectacle, setFilterSpectacle] = useState(""); // spectacle record id
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

  // Linked shows as [{ id, name }], filtered by record id since an event may be
  // linked to several shows (and two shows could share a name).
  const uniqueSpectacles = useMemo(() => {
    const byId = new Map();
    filteredByDate.forEach((r) =>
      (r.spectacles || []).forEach((s) => {
        if (s.id && !byId.has(s.id)) byId.set(s.id, s);
      }),
    );
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [filteredByDate]);

  const filteredReps = useMemo(() => {
    let reps = filteredByDate;
    if (filterSpectacle) reps = reps.filter((r) => r.spectacleIds.includes(filterSpectacle));
    if (filterVille) reps = reps.filter((r) => r.colVille === filterVille);
    if (filterSalle) reps = reps.filter((r) => r.colSalle === filterSalle);
    return reps;
  }, [filteredByDate, filterSpectacle, filterVille, filterSalle]);

  // Reset stale filters when options change
  useEffect(() => {
    if (filterSpectacle && !uniqueSpectacles.some((s) => s.id === filterSpectacle)) setFilterSpectacle("");
    if (filterVille && !uniqueVilles.includes(filterVille)) setFilterVille("");
    if (filterSalle && !uniqueSalles.includes(filterSalle)) setFilterSalle("");
  }, [uniqueSpectacles, uniqueVilles, uniqueSalles, filterSpectacle, filterVille, filterSalle]);

  return {
    showAll, setShowAll,
    filterSpectacle, setFilterSpectacle,
    filterVille, setFilterVille,
    filterSalle, setFilterSalle,
    uniqueSpectacles, uniqueVilles, uniqueSalles,
    filteredReps,
  };
}
