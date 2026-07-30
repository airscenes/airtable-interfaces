import { useState, useMemo, useCallback } from "react";
import {
  useBase,
  useRecords,
  useCustomProperties,
  useGlobalConfig,
} from "@airtable/blocks/interface/ui";
import { AIRTABLE_COLORS } from "../utils/colors";
import {
  getCustomProperties,
  safeCellValue,
  safeCellString,
  extractLinkedRecords,
  getColSelect,
  sortRepsByDate,
} from "../utils/airtable";
import { SpectacleCard } from "./SpectacleCard";
import { HomeSalesChart } from "./HomeSalesChart";
import { DetailPage } from "./DetailPage";
import { AllEventsPage } from "./AllEventsPage";
import { ArtistsPage } from "./ArtistsPage";

// Reads a checkbox-like field as a plain boolean. An unchecked checkbox cell
// reads back as null and a lookup/rollup wraps its value in an array, so only
// an explicit true — bare or wrapped — counts as checked.
function readCheckbox(record, field) {
  if (!field) return false;
  const raw = safeCellValue(record, field);
  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0]?.value !== undefined ? raw[0].value : raw[0];
    return first === true;
  }
  return false;
}

// --- Config gate ---
// Runs only the config hooks (useBase / useCustomProperties / …) and the
// configuration guards. The interface SDK's useRecords() throws on a null
// table, so record-reading hooks live in <SalesChartLoaded> which is mounted
// ONLY once the required tables are present — that keeps every useRecords call
// off a null table while satisfying the rules-of-hooks (no hook after a return).

function SalesChartApp() {
  const base = useBase();
  const globalConfig = useGlobalConfig();
  const selectedSpectaclesTableId = globalConfig.get("spectaclesTable") || null;
  const selectedRepsTableId = globalConfig.get("representationsTable") || null;
  const getProps = useCallback(
    (b) => getCustomProperties(b, selectedSpectaclesTableId, selectedRepsTableId),
    [selectedSpectaclesTableId, selectedRepsTableId],
  );
  const { customPropertyValueByKey, errorState } = useCustomProperties(getProps);

  if (errorState) {
    return (
      <div className="p-6 text-center text-red-red dark:text-red-redLight1">
        Erreur de configuration : {errorState.message || "Erreur inconnue"}
      </div>
    );
  }

  const spectaclesTable = customPropertyValueByKey.spectaclesTable;
  const repsTable = customPropertyValueByKey.representationsTable;

  if (!spectaclesTable || !repsTable) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500">Veuillez configurer les tables dans les propriétés de l&apos;extension.</p>
      </div>
    );
  }

  const isConfigured =
    spectaclesTable &&
    repsTable &&
    customPropertyValueByKey.spectacleLinkField &&
    customPropertyValueByKey.repNameField &&
    customPropertyValueByKey.supabaseUrl &&
    customPropertyValueByKey.supabaseAnonKey;
  if (!isConfigured) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray200 mb-2">
            Configuration requise
          </p>
          <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
            Ouvrez le panneau des proprietes pour configurer les tables, les
            champs, l&apos;URL Supabase et la cle API.
          </p>
        </div>
      </div>
    );
  }

  return <SalesChartLoaded base={base} cp={customPropertyValueByKey} />;
}

// --- Loaded app ---
// Receives non-null spectacles/reps tables, so its useRecords calls are safe.

function SalesChartLoaded({ base, cp }) {
  const spectaclesTable = cp.spectaclesTable;
  const imageField = cp.imageField;
  const cardSubtitleField = cp.cardSubtitleField;
  const cardColorField = cp.cardColorField;
  const repsTable = cp.representationsTable;
  const spectacleLinkField = cp.spectacleLinkField;
  const repNameField = cp.repNameField;
  const capacityField = cp.capacityField;
  const revenuePotentialField = cp.revenuePotentialField;
  const colJoursRestants = cp.colJoursRestants;
  const colDateRep = cp.colDateRep;
  const colSalle = cp.colSalle;
  const colVille = cp.colVille;
  const colPlacesBloques = cp.colPlacesBloques;
  const colBilletsDispo = cp.colBilletsDispo;
  const kpiField1 = cp.kpiField1;
  const kpiField2 = cp.kpiField2;
  const kpiField3 = cp.kpiField3;
  const kpiField4 = cp.kpiField4;
  const kpiField5 = cp.kpiField5;
  const kpiField6 = cp.kpiField6;
  const colTotalBilletsVendus = cp.colTotalBilletsVendus;
  const colTotalBilletsGratuits = cp.colTotalBilletsGratuits;
  const colAssistance = cp.colAssistance;
  const colTauxRemplissage = cp.colTauxRemplissage;
  const colRevenus = cp.colRevenus;
  const colStatutRapport = cp.colStatutRapport;
  const colObjectifRevenus = cp.colObjectifRevenus;
  const colMiseAJour = cp.colMiseAJour;
  const colPriorisation = cp.colPriorisation;
  const colBilleterieSalle = cp.colBilleterieSalle;
  const colNote = cp.colNote;
  const colStatut = cp.colStatut;
  const colSiteWeb = cp.colSiteWeb;
  const freeEventField = cp.freeEventField;
  const supabaseUrl = cp.supabaseUrl;
  const supabaseAnonKey = cp.supabaseAnonKey;
  // Artist link lives on the Projets/Spectacles table (the reverse of the
  // Artistes → Projets link), so we read it from the already-loaded spectacle
  // records — no separate Artistes table to load.
  const spectacleArtisteField = cp.spectacleArtisteField;

  const spectacleRecords = useRecords(spectaclesTable);
  const repRecords = useRecords(repsTable);

  const [selectedSpectacleId, setSelectedSpectacleId] = useState(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("gallery"); // "gallery" | "events" | "artists"

  // Get KPI data for selected spectacle from configured fields
  const kpiFields = useMemo(
    () =>
      [kpiField1, kpiField2, kpiField3, kpiField4, kpiField5, kpiField6].filter(
        Boolean,
      ),
    [kpiField1, kpiField2, kpiField3, kpiField4, kpiField5, kpiField6],
  );

  const spectacleKPIs = useMemo(() => {
    if (!selectedSpectacleId || !spectacleRecords || kpiFields.length === 0)
      return [];
    const record = spectacleRecords.find((r) => r.id === selectedSpectacleId);
    if (!record) return [];
    return kpiFields.map((field) => ({
      label: field.name,
      value: safeCellString(record, field),
    }));
  }, [selectedSpectacleId, spectacleRecords, kpiFields]);

  // Build spectacle data with images
  const spectacles = useMemo(() => {
    if (!spectacleRecords) return [];

    // Track which spectacles have at least one representation
    const spectaclesWithReps = new Set();
    if (repRecords && spectacleLinkField) {
      repRecords.forEach((rep) => {
        const links = extractLinkedRecords(safeCellValue(rep, spectacleLinkField));
        links.forEach((link) => spectaclesWithReps.add(link.id));
      });
    }

    // Aggregate total sold per spectacle from rep records
    const soldBySpectacle = {};
    if (repRecords && spectacleLinkField && colTotalBilletsVendus) {
      repRecords.forEach((rep) => {
        const links = extractLinkedRecords(safeCellValue(rep, spectacleLinkField));
        if (links.length === 0) return;
        const raw = safeCellValue(rep, colTotalBilletsVendus);
        const sold = typeof raw === "number" ? raw : parseFloat(raw) || 0;
        const seen = new Set();
        links.forEach((link) => {
          if (seen.has(link.id)) return;
          seen.add(link.id);
          soldBySpectacle[link.id] = (soldBySpectacle[link.id] || 0) + sold;
        });
      });
    }

    return spectacleRecords
      .map((record) => {
        let imageUrl = null;
        if (imageField) {
          const cellValue = safeCellValue(record, imageField);
          if (Array.isArray(cellValue) && cellValue.length > 0) {
            const first = cellValue[0];
            // Direct attachment: {url, thumbnails, ...}
            // Lookup of attachment: {linkedRecordId, value: {url, thumbnails, ...}}
            const att = first.url ? first : (first.value && first.value.url ? first.value : null);
            if (att && att.url) {
              const thumb = att.thumbnails;
              imageUrl = (thumb && thumb.large && thumb.large.url) || att.url;
            }
          }
        }
        const subtitle = safeCellString(record, cardSubtitleField);
        const colorSelect = cardColorField ? getColSelect(record, cardColorField, base) : null;
        const airtableColor = colorSelect?.color ? AIRTABLE_COLORS[colorSelect.color] : null;
        return {
          id: record.id,
          name: record.name || "",
          imageUrl,
          subtitle,
          placeholderColor: airtableColor ? airtableColor.bg : null,
          totalSold: soldBySpectacle[record.id] || 0,
        };
      })
      .filter((s) => s.name && spectaclesWithReps.has(s.id))
      .sort((a, b) => b.totalSold - a.totalSold);
  }, [spectacleRecords, imageField, cardSubtitleField, cardColorField, base, repRecords, spectacleLinkField, colTotalBilletsVendus]);

  // Filter spectacles by search
  const filteredSpectacles = useMemo(() => {
    if (!search) return spectacles;
    const lower = search.toLowerCase();
    return spectacles.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        (s.subtitle && s.subtitle.toLowerCase().includes(lower)),
    );
  }, [spectacles, search]);

  // Build every event (representation) across all shows, with table column
  // values. The per-spectacle detail list and the mixed all-events list are
  // both derived from this.
  const allRepresentations = useMemo(() => {
    if (!repRecords || !spectacleLinkField) return [];

    const getCol = (record, field) => safeCellString(record, field);

    return repRecords
      .map((record) => {
        const links = extractLinkedRecords(safeCellValue(record, spectacleLinkField));
        let cap = null;
        if (capacityField) {
          const val = safeCellValue(record, capacityField);
          cap = typeof val === "number" ? val : parseFloat(String(val)) || null;
        }
        let revPotential = null;
        if (revenuePotentialField) {
          const val = safeCellValue(record, revenuePotentialField);
          revPotential =
            typeof val === "number" ? val : parseFloat(String(val)) || null;
        }
        // Raw values for filtering/sorting
        let rawDate = null;
        let dateRepIso = null;
        if (colDateRep) {
          const dv = safeCellValue(record, colDateRep);
          if (dv) {
            rawDate = new Date(dv);
            // Date/DateTime cells return an ISO string; slice to YYYY-MM-DD to
            // avoid the new Date()→local off-by-one shift in UTC-N timezones.
            if (typeof dv === "string") dateRepIso = dv.slice(0, 10);
          }
        }
        const getNum = (field) => {
          if (!field) return null;
          const v = safeCellValue(record, field);
          return typeof v === "number" ? v : null;
        };

        return {
          id: record.id,
          spectacleIds: links.map((l) => l.id),
          spectacleName: links.map((l) => l.name).filter(Boolean).join(", "),
          name: repNameField
            ? safeCellString(record, repNameField)
            : record.name,
          capacity: cap,
          revenuePotential: revPotential,
          rawDate,
          dateRepIso,
          isFree: readCheckbox(record, freeEventField),
          colJoursRestants: getCol(record, colJoursRestants),
          colDateRep: getCol(record, colDateRep),
          colSalle: getCol(record, colSalle),
          colVille: getCol(record, colVille),
          colCapacite: getNum(capacityField),
          colPlacesBloques: getNum(colPlacesBloques),
          colBilletsDispo: getNum(colBilletsDispo),
          colTotalBilletsVendus: getNum(colTotalBilletsVendus),
          colTotalBilletsGratuits: getNum(colTotalBilletsGratuits),
          colAssistance: getNum(colAssistance),
          colTauxRemplissage: getNum(colTauxRemplissage),
          colRevenus: getNum(colRevenus),
          colStatutRapport: getColSelect(record, colStatutRapport, base),
          colObjectifRevenus: getNum(colObjectifRevenus),
          colMiseAJour: getColSelect(record, colMiseAJour, base),
          colPriorisation: getColSelect(record, colPriorisation, base),
          colBilleterieSalle: getColSelect(record, colBilleterieSalle, base),
          colNote: getColSelect(record, colNote, base),
          colStatut: getColSelect(record, colStatut, base),
          colSiteWeb: getColSelect(record, colSiteWeb, base),
        };
      })
      .filter((r) => r.name);
  }, [
    base,
    repRecords,
    spectacleLinkField,
    repNameField,
    capacityField,
    revenuePotentialField,
    colJoursRestants,
    colDateRep,
    colSalle,
    colVille,
    colPlacesBloques,
    colBilletsDispo,
    colTotalBilletsVendus,
    colTotalBilletsGratuits,
    colAssistance,
    colTauxRemplissage,
    colRevenus,
    colStatutRapport,
    colObjectifRevenus,
    colMiseAJour,
    colPriorisation,
    colBilleterieSalle,
    colNote,
    colStatut,
    colSiteWeb,
    freeEventField,
  ]);

  // All events, sorted chronologically (for the mixed all-events page)
  const allRepresentationsSorted = useMemo(
    () => sortRepsByDate(allRepresentations),
    [allRepresentations],
  );

  // Artist sections for the "par artistes" view, hierarchy Artiste → Spectacles
  // → Dates. Only upcoming shows (rawDate >= today). For each projet (spectacle)
  // we read its linked artist(s) from spectacleArtisteField on the already-loaded
  // spectacle records, then nest the projet under each of its artists. Artists
  // sorted by name ("Nom de scène"); within an artist, projets by name; within a
  // projet, shows oldest→newest.
  const artistSections = useMemo(() => {
    if (!spectacleRecords || !spectacleArtisteField) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // projet id -> { projetName, artists: [{ id, name }] }
    const metaBySpectacle = {};
    spectacleRecords.forEach((rec) => {
      metaBySpectacle[rec.id] = {
        projetName: rec.name || "",
        artists: extractLinkedRecords(safeCellValue(rec, spectacleArtisteField)),
      };
    });
    // projet id -> [upcoming reps]
    const showsByProjet = new Map();
    allRepresentations
      .filter((r) => r.rawDate && r.rawDate >= today)
      .forEach((rep) => {
        rep.spectacleIds.forEach((sid) => {
          if (!showsByProjet.has(sid)) showsByProjet.set(sid, []);
          showsByProjet.get(sid).push(rep);
        });
      });
    // nest projets under their artist(s)
    const byArtist = new Map(); // artistId -> { id, name, spectacles: [] }
    showsByProjet.forEach((shows, sid) => {
      const meta = metaBySpectacle[sid];
      if (!meta) return;
      const projet = {
        id: sid,
        projetName: meta.projetName,
        shows: [...shows].sort((a, b) => a.rawDate - b.rawDate),
      };
      const artists = meta.artists.length ? meta.artists : [{ id: "__none__", name: "(Sans artiste)" }];
      artists.forEach((a) => {
        const key = a.id || "__none__";
        if (!byArtist.has(key)) byArtist.set(key, { id: key, name: a.name || "(Sans artiste)", spectacles: [] });
        byArtist.get(key).spectacles.push(projet);
      });
    });
    return [...byArtist.values()]
      .map((art) => ({
        ...art,
        spectacles: art.spectacles.sort((x, y) => x.projetName.localeCompare(y.projetName, "fr")),
      }))
      .filter((art) => art.spectacles.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [spectacleRecords, spectacleArtisteField, allRepresentations]);

  // Events for the selected spectacle only (for the detail page)
  const representations = useMemo(() => {
    if (!selectedSpectacleId) return [];
    return sortRepsByDate(
      allRepresentations.filter((r) => r.spectacleIds.includes(selectedSpectacleId)),
    );
  }, [allRepresentations, selectedSpectacleId]);

  // Get selected spectacle data
  const selectedSpectacle = useMemo(() => {
    return spectacles.find((s) => s.id === selectedSpectacleId) || null;
  }, [spectacles, selectedSpectacleId]);

  // --- All-events Page ---
  if (view === "events") {
    return (
      <AllEventsPage
        allReps={allRepresentationsSorted}
        repRecords={repRecords}
        onBack={() => setView("gallery")}
      />
    );
  }

  // --- Artists Page ---
  if (view === "artists") {
    if (!spectacleArtisteField) {
      return <ArtistsConfigNeeded onBack={() => setView("gallery")} />;
    }
    return (
      <ArtistsPage
        artists={artistSections}
        supabaseUrl={supabaseUrl}
        supabaseAnonKey={supabaseAnonKey}
        baseId={base.id}
        onBack={() => setView("gallery")}
      />
    );
  }

  // --- Detail Page ---
  if (selectedSpectacle) {
    return (
      <DetailPage
        spectacle={selectedSpectacle}
        representations={representations}
        spectacleKPIs={spectacleKPIs}
        supabaseUrl={supabaseUrl}
        supabaseAnonKey={supabaseAnonKey}
        baseId={base.id}
        onBack={() => setSelectedSpectacleId(null)}
        repRecords={repRecords}
      />
    );
  }

  // --- Gallery Page ---
  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-xl font-display font-bold text-gray-gray700 dark:text-gray-gray200">
          Spectacles
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView("artists")}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md
                       bg-blue-blue text-white hover:bg-blue-blueDark1 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
            Spectacles par artiste
          </button>
          <button
            onClick={() => setView("events")}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md
                       bg-blue-blue text-white hover:bg-blue-blueDark1 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Tous les événements
          </button>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un spectacle ou un artiste..."
            style={{
              fontSize: 13,
              padding: "6px 12px",
              borderRadius: 6,
              border: "2px solid #d0d5dd",
              backgroundColor: "#fff",
              color: "#333",
              width: 260,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Overview: total sales across every representation */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-gray600 dark:text-gray-gray300 mb-2">
          Ventes globales
        </h3>
        <HomeSalesChart
          repIds={(repRecords || []).map((r) => r.id)}
          supabaseUrl={supabaseUrl}
          supabaseAnonKey={supabaseAnonKey}
          baseId={base.id}
        />
      </div>

      {filteredSpectacles.length === 0 && (
        <div className="flex items-center justify-center h-64">
          <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
            {search ? "Aucun spectacle trouve." : "Aucun spectacle disponible."}
          </p>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 16,
        }}
      >
        {filteredSpectacles.map((spectacle) => (
          <SpectacleCard
            key={spectacle.id}
            name={spectacle.name}
            subtitle={spectacle.subtitle}
            imageUrl={spectacle.imageUrl}
            placeholderColor={spectacle.placeholderColor}
            onClick={() => setSelectedSpectacleId(spectacle.id)}
          />
        ))}
      </div>
    </div>
  );
}

// Shown when the user opens "Spectacles par artiste" before configuring the
// artists table / link field.
function ArtistsConfigNeeded({ onBack }) {
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
          Spectacles par artistes
        </h2>
      </div>
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-gray-gray500 dark:text-gray-gray400 text-center" style={{ maxWidth: 460 }}>
          Configurez le « Champ Artiste (dans Projets/Spectacles) » dans les
          propriétés de l&apos;extension pour afficher cette vue.
        </p>
      </div>
    </div>
  );
}

// Force a full remount of SalesChartApp whenever the user picks a different
// table in the config panel. useCustomProperties only re-evaluates getCustomProperties
// on schema changes, so without remounting, the field-pickers stay scoped to the
// previously selected table and show the wrong fields.
export function SalesChartRoot() {
  const globalConfig = useGlobalConfig();
  const spectId = globalConfig.get("spectaclesTable") || "_";
  const repId = globalConfig.get("representationsTable") || "_";
  return <SalesChartApp key={`${spectId}::${repId}`} />;
}
