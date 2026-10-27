// --- Reading sales_report: the base's token, or the legacy anon key ---
//
// Two paths, chosen per installation by its custom properties:
// - salesApiUrl + salesApiToken: the Airscenes API (frontend repo,
//   /api/airtable/sales-report). The token belongs to ONE base and the server
//   resolves the base from it, so no base id is sent. It answers one page at
//   a time, { rows, next }, and we follow `next` until it is null.
// - supabaseUrl + supabaseAnonKey: PostgREST with the public anon key, the
//   legacy path, kept while bases move to their token. It goes once every base
//   has one.
// The token wins when both are filled in.
//
// A copy of this file lives in sales-chart/frontend/utils/salesReport.js: extensions
// share no code. Keep the two equal.

const CHUNK_SIZE = 150; // record ids per request, so URLs stay within limits
const PAGE_SIZE = 1000; // PostgREST's own row cap

export const salesSourceFrom = (cp, baseId) => ({
  baseId,
  salesApiToken: (cp.salesApiToken || "").trim(),
  salesApiUrl: (cp.salesApiUrl || "").trim(),
  supabaseAnonKey: (cp.supabaseAnonKey || "").trim(),
  supabaseUrl: (cp.supabaseUrl || "").trim(),
});

const usesToken = (source) => !!(source.salesApiUrl && source.salesApiToken);

export const hasSalesSource = (source) =>
  usesToken(source) || !!(source.supabaseUrl && source.supabaseAnonKey);

// A string that changes when the source does, for effect dependencies and caches.
export const salesSourceKey = (source) =>
  usesToken(source)
    ? `api|${source.salesApiUrl}|${source.salesApiToken}`
    : `anon|${source.supabaseUrl}|${source.supabaseAnonKey}|${source.baseId}`;

const fetchChunkWithToken = async (source, ids, isCancelled) => {
  const rows = [];
  let after = null;
  do {
    const url =
      `${source.salesApiUrl}?record_ids=${ids.join(",")}` +
      (after ? `&after=${encodeURIComponent(after)}` : "");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${source.salesApiToken}` },
    });
    if (response.status === 401) {
      throw new Error("Jeton des ventes refusé : vérifiez le jeton dans les réglages de l'extension.");
    }
    if (!response.ok) {
      throw new Error(`Erreur API ventes: ${response.status} ${response.statusText}`);
    }
    const page = await response.json();
    rows.push(...page.rows);
    after = page.next;
    if (isCancelled()) return null;
  } while (after);
  return rows;
};

const fetchChunkWithAnonKey = async (source, ids, columns, isCancelled) => {
  const baseUrl =
    `${source.supabaseUrl}/rest/v1/sales_report` +
    `?base_id=eq.${source.baseId}` +
    `&record_id=in.(${ids.join(",")})` +
    `&order=date.asc` +
    `&select=${columns}`;
  let rows = [];
  let offset = 0;
  while (true) {
    const response = await fetch(baseUrl + `&limit=${PAGE_SIZE}&offset=${offset}`, {
      headers: {
        apikey: source.supabaseAnonKey,
        Authorization: `Bearer ${source.supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Erreur Supabase: ${response.status} ${response.statusText}`);
    }
    const page = await response.json();
    rows = rows.concat(page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (isCancelled()) return null;
  }
  return rows;
};

// The sales_report rows of `recordIds`, or null if cancelled midway.
// `columns` is the legacy select list; the API always answers
// record_id, date, sold, free, total.
//
// Rows come back as the legacy path ordered them: each chunk by date
// ascending. The API orders by record then date, so each chunk is re-sorted
// (stably) — readers that keep the last report of a day rely on that order.
export async function fetchSalesReport(source, recordIds, columns, isCancelled = () => false) {
  const ids = [...new Set(recordIds)].filter(Boolean);
  let rows = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const page = usesToken(source)
      ? await fetchChunkWithToken(source, chunk, isCancelled)
      : await fetchChunkWithAnonKey(source, chunk, columns, isCancelled);
    if (page === null || isCancelled()) return null;
    if (usesToken(source)) page.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    rows = rows.concat(page);
  }
  return rows;
}
