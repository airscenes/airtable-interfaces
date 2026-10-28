// "Rapports par événement" UI: pick events of a spectacle (date range + checkboxes) and download
// one Excel with a "Sommaire" tab and one tab per event. Logic in eventReportsExcel.js.

import { useState, useMemo, useEffect } from "react";
import { buildEventReports, exportEventReports, localIsoDate, fmtCurrency, round2, pad } from "./eventReportsExcel";

function monthBounds() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}

const inputClass =
  "bg-white dark:bg-gray-gray700 border border-gray-gray200 dark:border-gray-gray600 rounded " +
  "px-3 py-1.5 text-sm text-gray-gray700 dark:text-gray-gray100";

/**
 * @param events          Événements records of the selected spectacle (any date)
 * @param revenusRecords  all Revenus records (filtered per event through the link field)
 * @param cfg             fields, see buildEventReports
 * @param template        { url, label } resolved from the spectacle's producteur
 * @param etatEventIds    Set of event ids already linked to an État de compte (info badge only)
 */
export function EventReportsPanel({ events, revenusRecords, depensesRecords, cfg, spectacleName, producteurName, template, etatEventIds }) {
  const [{ from, to }, setRange] = useState(monthBounds);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const reports = useMemo(() => {
    const inRange = events.filter((ev) => {
      const d = cfg.dateField ? localIsoDate(ev.getCellValue(cfg.dateField)) : "";
      return d && (!from || d >= from) && (!to || d <= to);
    });
    return buildEventReports(inRange, revenusRecords, cfg, depensesRecords)
      .sort((a, b) => a.date.localeCompare(b.date) || a.nom.localeCompare(b.nom, "fr"));
  }, [events, revenusRecords, depensesRecords, cfg, from, to]);

  // Everything in the range starts checked; re-checked only when the set of events changes
  // (not on every record update, which would undo the user's unchecking).
  const rangeKey = reports.map((r) => r.id).join(",");
  useEffect(() => {
    setSelected(new Set(rangeKey ? rangeKey.split(",") : []));
    setMsg(null);
  }, [rangeKey]);

  const chosen = reports.filter((r) => selected.has(r.id));
  const sum = (key) => round2(chosen.reduce((s, r) => s + r[key], 0));

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleExport = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    setMsg("Génération du rapport…");
    try {
      await exportEventReports({ templateUrl: template.url, spectacleName, producteurName, dateFrom: from, dateTo: to, reports: chosen });
      setMsg(`Rapport téléchargé (${chosen.length} onglet${chosen.length > 1 ? "s" : ""}).`);
    } catch (err) {
      console.error("Event reports export failed:", err);
      setMsg(`Erreur : ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const missing = [
    !cfg.dateField && "Champ Date (Événements)",
    !cfg.revenusEvenementLinkField && "Lien Événements (Revenus)",
    !cfg.revenusMontantField && "Champ Montant (Revenus)",
  ].filter(Boolean);

  return (
    <div>
      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4 flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-gray600 dark:text-gray-gray300">Du</span>
          <input type="date" value={from} max={to || undefined} className={inputClass}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-gray600 dark:text-gray-gray300">Au</span>
          <input type="date" value={to} min={from || undefined} className={inputClass}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </label>
        <div className="flex items-center gap-3 text-sm">
          <button className="text-blue-blue hover:underline" onClick={() => setSelected(new Set(reports.map((r) => r.id)))}>
            Tout cocher
          </button>
          <button className="text-blue-blue hover:underline" onClick={() => setSelected(new Set())}>
            Tout décocher
          </button>
        </div>
        <div className="text-xs text-gray-gray500 dark:text-gray-gray300 ml-auto">
          {template.label}
        </div>
      </div>

      {missing.length > 0 && (
        <div className="bg-yellow-yellowLight1 text-gray-gray700 rounded p-3 mb-4 text-sm">
          À configurer dans les propriétés de l&apos;extension : {missing.join(", ")}.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {[["Revenus", sum("totalRevenus"), "text-green-greenDark1"], ["Dépenses", sum("totalDepenses"), "text-red-redDark1"], ["Solde", sum("solde"), "text-blue-blueDark1"]].map(([label, value, color]) => (
          <div key={label} className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4">
            <div className="text-sm text-gray-gray500 dark:text-gray-gray300 uppercase tracking-wide">{label} ({chosen.length})</div>
            <div className={`text-3xl font-display font-bold mt-1 ${color}`}>{fmtCurrency(value)}</div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm p-4 mb-4 overflow-x-auto">
        {reports.length === 0 ? (
          <div className="text-sm text-gray-gray500 italic">Aucun événement dans cette plage de dates.</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-gray50 dark:bg-gray-gray800">
              <tr className="text-gray-gray700 dark:text-gray-gray100">
                <th className="p-2" style={{ width: 32 }}>
                  <input type="checkbox" checked={chosen.length === reports.length}
                    onChange={(e) => setSelected(new Set(e.target.checked ? reports.map((r) => r.id) : []))} />
                </th>
                <th className="text-left p-2 font-medium">Date</th>
                <th className="text-left p-2 font-medium">Événement</th>
                <th className="text-left p-2 font-medium">Lieu</th>
                <th className="text-right p-2 font-medium">Revenus</th>
                <th className="text-right p-2 font-medium">Dépenses</th>
                <th className="text-right p-2 font-medium">Solde</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} onClick={() => toggle(r.id)}
                  className="border-b border-gray-gray100 dark:border-gray-gray700 hover:bg-gray-gray50 dark:hover:bg-gray-gray800 cursor-pointer text-gray-gray700 dark:text-gray-gray100">
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="p-2 whitespace-nowrap">{r.date}</td>
                  <td className="p-2">
                    {r.nom}
                    {etatEventIds && etatEventIds.has(r.id) && (
                      <span className="ml-2 text-xs text-green-greenDark1" title="Déjà inclus dans un État de compte (information seulement)">
                        ✓ état de compte
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-gray-gray600 dark:text-gray-gray300">{r.lieu}</td>
                  <td className="p-2 text-right whitespace-nowrap">{fmtCurrency(r.totalRevenus)}</td>
                  <td className="p-2 text-right whitespace-nowrap">{fmtCurrency(r.totalDepenses)}</td>
                  <td className="p-2 text-right whitespace-nowrap font-semibold">{fmtCurrency(r.solde)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 flex-wrap">
        <span className="text-xs text-gray-gray500 dark:text-gray-gray300">
          Téléchargement seulement : ne crée pas d&apos;État de compte et ne clôture pas la période.
        </span>
        {msg && <span className="text-sm text-gray-gray600 dark:text-gray-gray200">{msg}</span>}
        <button
          onClick={handleExport}
          disabled={!chosen.length || busy || missing.length > 0}
          className="bg-blue-blue text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Génération…" : `Générer l'Excel (${chosen.length} onglet${chosen.length > 1 ? "s" : ""})`}
        </button>
      </div>
    </div>
  );
}
