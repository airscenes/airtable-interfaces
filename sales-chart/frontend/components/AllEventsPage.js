import { useRepFilters } from "../hooks/useRepFilters";
import { RepresentationsTable } from "./RepresentationsTable";

// --- All-events page: every event across all shows, mixed ---

export function AllEventsPage({ allReps, repRecords, onBack }) {
  const {
    showAll, setShowAll,
    filterVille, setFilterVille,
    filterSalle, setFilterSalle,
    uniqueVilles, uniqueSalles,
    filteredReps,
  } = useRepFilters(allReps);

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-medium text-blue-blue hover:text-blue-blueDark1
                     dark:text-blue-blueLight1 dark:hover:text-blue-blueLight2 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Retour
        </button>
        <h2 className="text-xl font-display font-bold text-gray-gray700 dark:text-gray-gray200">
          Tous les événements
        </h2>
      </div>
      <RepresentationsTable
        title="Événements"
        totalCount={allReps.length}
        filteredReps={filteredReps}
        uniqueVilles={uniqueVilles}
        uniqueSalles={uniqueSalles}
        filterVille={filterVille}
        setFilterVille={setFilterVille}
        filterSalle={filterSalle}
        setFilterSalle={setFilterSalle}
        showAll={showAll}
        setShowAll={setShowAll}
        repRecords={repRecords}
        showSpectacleCol
      />
    </div>
  );
}
