import {callEdgeFunction, pgRestSelect} from './supabase.js';

// Where the royalty uploads go: the base's token, or the legacy anon key.
//
// - royaltiesApiUrl + royaltiesApiToken: the Airscenes API (frontend repo,
//   /api/airtable/royalty-upload). The token is the base's one — the same as
//   for the sales and the royalties — and the server resolves the client from
//   it, so no client id or upload secret is sent.
// - supabaseUrl + apiKey + clientId + uploadSecret: the Edge Functions and
//   PostgREST with the publishable key, the legacy path, kept while bases move
//   to their token.
// The token wins when both are filled in.

const trimmed = (v) => (v || '').trim();

export const usesRoyaltiesToken = (cfg) => !!(trimmed(cfg.royaltiesApiUrl) && trimmed(cfg.royaltiesApiToken));

// Settings still to fill in, as labels for the config gate. Empty = ready.
export function missingSettings(cfg) {
    if (usesRoyaltiesToken(cfg)) return [];
    // The token path was started: only its other half is missing.
    if (trimmed(cfg.royaltiesApiUrl) || trimmed(cfg.royaltiesApiToken)) {
        return [
            !trimmed(cfg.royaltiesApiUrl) && 'URL de l\'API d\'upload des royalties',
            !trimmed(cfg.royaltiesApiToken) && 'Jeton de la base',
        ].filter(Boolean);
    }
    return [
        !cfg.supabaseUrl && 'Supabase URL',
        !cfg.apiKey && 'Supabase Publishable Key',
        !cfg.clientId && 'Client UUID',
        !cfg.uploadSecret && 'Upload Secret',
    ].filter(Boolean);
}

// A string that changes when the source does, for effect dependencies.
export const royaltiesSourceKey = (cfg) =>
    usesRoyaltiesToken(cfg)
        ? `api|${trimmed(cfg.royaltiesApiUrl)}|${trimmed(cfg.royaltiesApiToken)}`
        : `anon|${cfg.supabaseUrl}|${cfg.apiKey}|${cfg.clientId}|${cfg.uploadSecret}`;

async function postRoyaltiesApi(cfg, body) {
    const res = await fetch(trimmed(cfg.royaltiesApiUrl), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${trimmed(cfg.royaltiesApiToken)}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    let payload;
    try {
        payload = await res.json();
    } catch {
        payload = null;
    }
    if (!res.ok) {
        const msg = res.status === 401
            ? 'Jeton refusé : vérifiez le jeton dans les réglages de l\'extension.'
            : res.status === 403
                ? 'Ce jeton n\'ouvre pas les royalties : sa base n\'est reliée à aucun client Airscènes.'
                : res.status === 429
                    ? 'Trop de requêtes : réessayez dans une minute.'
                    : payload?.error || `Erreur ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.payload = payload;
        throw err;
    }
    return payload;
}

const AUDIT_COLUMNS = 'id,filename,report_type,period,status,rows_imported,error_message,uploaded_at,imported_at';

// The four calls the upload screen makes, with the same answers on both paths:
// history() -> audit rows, status(id) -> one audit row (or undefined),
// requestUploadUrl() -> {audit_id, signed_url}, refresh() -> {files, rows}.
export function makeUploadClient(cfg) {
    if (usesRoyaltiesToken(cfg)) {
        return {
            history: async () => (await postRoyaltiesApi(cfg, {action: 'history'})).rows,
            status: async (auditId) => (await postRoyaltiesApi(cfg, {action: 'status', audit_id: auditId})).row,
            requestUploadUrl: ({filename, reportType, period}) =>
                postRoyaltiesApi(cfg, {
                    action: 'upload-url',
                    filename,
                    report_type: reportType,
                    ...(period ? {period} : {}),
                }),
            refresh: () => postRoyaltiesApi(cfg, {action: 'refresh'}),
        };
    }
    const {supabaseUrl, apiKey, clientId, uploadSecret} = cfg;
    return {
        history: () => pgRestSelect({
            supabaseUrl,
            apiKey,
            clientId,
            table: 'royalty_upload_audit',
            query: `select=${AUDIT_COLUMNS}&order=uploaded_at.desc&limit=50`,
        }),
        status: async (auditId) => (await pgRestSelect({
            supabaseUrl,
            apiKey,
            clientId,
            table: 'royalty_upload_audit',
            query: `id=eq.${auditId}&select=${AUDIT_COLUMNS}`,
        }))[0],
        requestUploadUrl: ({filename, reportType, period}) => callEdgeFunction({
            supabaseUrl,
            apiKey,
            clientId,
            uploadSecret,
            name: 'request-upload-url',
            body: {
                client_id: clientId,
                filename,
                report_type: reportType,
                ...(period ? {period} : {}),
            },
        }),
        refresh: () => callEdgeFunction({
            supabaseUrl,
            apiKey,
            clientId,
            uploadSecret,
            name: 'refresh-royalty-summary',
            body: {client_id: clientId},
        }),
    };
}
