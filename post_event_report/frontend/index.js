import {useMemo, useState} from 'react';
import {initializeBlock, useBase, useRecords, useCustomProperties} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import {pdf} from '@react-pdf/renderer';
import {fmtDateFr, isoDate, dayMsFromValue, parseTexteSoumis} from './format';
import {ReportPdf} from './reportPdf';
import './style.css';

// ============================================================================
// Suivi des rapports post-événement — Espace Saint-Denis
// ----------------------------------------------------------------------------
// Events grouped by day. A gérant "fills" a report from the portal, which
// creates a `formulaire_evenement` record (its `texte_soumis` holds the whole
// report as markdown; `Date de création` is the fill timestamp). The client
// then emails the day's reports to the recipient contacts with the per-day
// "Envoyer" button: one PDF for the day (one section per event) + the events'
// attachments, sent through the Make webhook. On success the extension stamps
// `rapport_post_evenement_date_envoi` on each of the day's filled events, so the
// "Envoyé" status persists. No server: Make answers Access-Control-Allow-Origin:*.
// ============================================================================

const MAKE_PAYLOAD_TYPE = 'rapport_quotidien_post_evenements';

// Interface page ids used to deep-link a filled report to its Airtable detail
// view (event page + `formulaire_evenement` record in the side panel). Exposed
// as string custom properties so they can be updated without a code change.
const DEFAULT_PAGE_ID = 'pagfJDSoH4zKAO8Pu';
const DEFAULT_HOME_PAGE_ID = 'pagrPhKpmIuakDRFR';
const DEFAULT_DETAIL_PAGE_ID = 'pago8KLPDlZcikKYM';

// Build the Airtable Interface URL that opens the event page with the linked
// `formulaire_evenement` record expanded in the detail panel. Mirrors the URL
// Airtable itself produces (raw base64 `detail` param).
function buildFormulaireUrl({baseId, pageId, homePageId, detailPageId, eventId, formulaireId}) {
    const detail = btoa(
        JSON.stringify({pageId: detailPageId, rowId: formulaireId, showComments: false, queryOriginHint: null}),
    );
    return `https://airtable.com/${baseId}/${pageId}/${eventId}?home=${homePageId}&detail=${detail}`;
}

// === HELPERS ===

function norm(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const isDateLike = (f) =>
    f.config.type === FieldType.DATE ||
    f.config.type === FieldType.DATE_TIME ||
    f.config.type === FieldType.CREATED_TIME ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.ROLLUP ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

const isWritableDateTime = (f) => f.config.type === FieldType.DATE_TIME;

const isTextLike = (f) =>
    f.config.type === FieldType.RICH_TEXT ||
    f.config.type === FieldType.MULTILINE_TEXT ||
    f.config.type === FieldType.SINGLE_LINE_TEXT ||
    f.config.type === FieldType.FORMULA;

const isLinkLike = (f) => f.config.type === FieldType.MULTIPLE_RECORD_LINKS;
const isAttachment = (f) => f.config.type === FieldType.MULTIPLE_ATTACHMENTS;
const isCheckbox = (f) => f.config.type === FieldType.CHECKBOX;
const isEmailLike = (f) =>
    f.config.type === FieldType.EMAIL ||
    f.config.type === FieldType.SINGLE_LINE_TEXT ||
    f.config.type === FieldType.FORMULA ||
    f.config.type === FieldType.ROLLUP ||
    f.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

function byName(table, pred, ...needles) {
    return table.fields.find((f) => pred(f) && needles.some((n) => norm(f.name).includes(norm(n))));
}

// Chunked base64 — `String.fromCharCode(...bytes)` blows the stack on a real PDF.
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

async function blobToBase64(blob) {
    return arrayBufferToBase64(await blob.arrayBuffer());
}

// Fetch an attachment URL and return its base64. Throws on a network/CORS error
// so the caller can skip that one file instead of aborting the whole send.
async function urlToBase64(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return blobToBase64(await res.blob());
}

// Image mime for an attachment (by mime, or by file extension when the mime is
// missing) — used to embed images inside the PDF. Returns null for non-images.
function imageMime(att) {
    const t = (att.type || '').toLowerCase();
    if (t.startsWith('image/')) return t;
    const m = (att.nom || '').toLowerCase().match(/\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|svg)$/);
    if (!m) return null;
    const ext = m[1];
    return 'image/' + (ext === 'jpg' ? 'jpeg' : ext === 'tif' ? 'tiff' : ext);
}

// === CUSTOM PROPERTIES ===

function getCustomProperties(base) {
    const eventsTable = base.tables.find((t) => norm(t.name).includes('evenement') && !norm(t.name).includes('formulaire')) || base.tables[0];
    const formulaireTable = base.tables.find((t) => norm(t.name).includes('formulaire')) || base.tables[0];
    const contactsTable = base.tables.find((t) => norm(t.name).includes('contact')) || base.tables[0];

    return [
        {key: 'eventsTable', label: 'Table des événements', type: 'table', defaultValue: eventsTable},
        {
            key: 'dateField',
            label: "Date de l'événement",
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue: byName(eventsTable, isDateLike, 'date'),
        },
        {
            key: 'dateEnvoiField',
            label: 'Champ « Date d\'envoi du rapport » (estampillé à l\'envoi)',
            type: 'field',
            table: eventsTable,
            shouldFieldBeAllowed: isWritableDateTime,
            defaultValue: byName(eventsTable, isWritableDateTime, 'rapport_post_evenement_date_envoi'),
        },
        // The submitted reports live in a separate table, linked to the events.
        {key: 'formulaireTable', label: 'Table des formulaires soumis', type: 'table', defaultValue: formulaireTable},
        {
            key: 'texteField',
            label: 'Texte soumis (sur les formulaires)',
            type: 'field',
            table: formulaireTable,
            shouldFieldBeAllowed: isTextLike,
            // Exact-ish: avoid the greedy 'rapport' needle, which matches the
            // primary "Nom du rapport" formula instead of the submitted text.
            defaultValue: byName(formulaireTable, isTextLike, 'texte_soumis', 'texte_rapport', 'texte'),
        },
        {
            key: 'formulaireLinkField',
            label: 'Lien vers l\'événement (sur les formulaires)',
            type: 'field',
            table: formulaireTable,
            shouldFieldBeAllowed: isLinkLike,
            defaultValue: byName(formulaireTable, isLinkLike, 'evenement', 'événement'),
        },
        {
            key: 'piecesJointesField',
            label: 'Pièces jointes (sur les formulaires)',
            type: 'field',
            table: formulaireTable,
            shouldFieldBeAllowed: isAttachment,
            defaultValue: byName(formulaireTable, isAttachment, 'pieces_jointes', 'piece', 'jointe'),
        },
        {
            key: 'dateCreationField',
            label: 'Date de création / soumission (sur les formulaires)',
            type: 'field',
            table: formulaireTable,
            shouldFieldBeAllowed: isDateLike,
            defaultValue: byName(formulaireTable, isDateLike, 'création', 'creation', 'date'),
        },
        // Recipients: contacts whose global "rapports" checkbox is ticked.
        {key: 'contactsTable', label: 'Table des contacts', type: 'table', defaultValue: contactsTable},
        {
            key: 'contactEmailField',
            label: 'Courriel (sur les contacts)',
            type: 'field',
            table: contactsTable,
            shouldFieldBeAllowed: isEmailLike,
            defaultValue: byName(contactsTable, isEmailLike, 'courriel', 'email', 'mail'),
        },
        {
            key: 'contactFlagField',
            label: 'Case « destinataire des rapports » (sur les contacts)',
            type: 'field',
            table: contactsTable,
            shouldFieldBeAllowed: isCheckbox,
            defaultValue: byName(contactsTable, isCheckbox, 'rapports'),
        },
        {key: 'webhookUrl', label: 'URL du webhook Make', type: 'string', defaultValue: ''},
        {key: 'webhookToken', label: 'Jeton du webhook Make', type: 'string', defaultValue: ''},
        // Deep-link to the filled report's Airtable detail view (page ids).
        {key: 'interfacePageId', label: 'ID page interface (événements)', type: 'string', defaultValue: DEFAULT_PAGE_ID},
        {key: 'interfaceHomePageId', label: 'ID page « home »', type: 'string', defaultValue: DEFAULT_HOME_PAGE_ID},
        {key: 'interfaceDetailPageId', label: 'ID page détail (formulaire)', type: 'string', defaultValue: DEFAULT_DETAIL_PAGE_ID},
    ];
}

// === MAIN APP ===

function SuiviRapportsApp() {
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const eventsTable = customPropertyValueByKey.eventsTable;
    const dateField = customPropertyValueByKey.dateField;
    const dateEnvoiField = customPropertyValueByKey.dateEnvoiField;
    const formulaireTable = customPropertyValueByKey.formulaireTable;
    const texteField = customPropertyValueByKey.texteField;
    const formulaireLinkField = customPropertyValueByKey.formulaireLinkField;
    const piecesJointesField = customPropertyValueByKey.piecesJointesField;
    const dateCreationField = customPropertyValueByKey.dateCreationField;
    const contactsTable = customPropertyValueByKey.contactsTable;
    const contactEmailField = customPropertyValueByKey.contactEmailField;
    const contactFlagField = customPropertyValueByKey.contactFlagField;
    const webhookUrl = String(customPropertyValueByKey.webhookUrl ?? '').trim();
    const webhookToken = String(customPropertyValueByKey.webhookToken ?? '').trim();
    const interfacePageId = String(customPropertyValueByKey.interfacePageId ?? '').trim();
    const interfaceHomePageId = String(customPropertyValueByKey.interfaceHomePageId ?? '').trim();
    const interfaceDetailPageId = String(customPropertyValueByKey.interfaceDetailPageId ?? '').trim();

    const base = useBase();
    const records = useRecords(eventsTable ?? null);
    const formulaireRecords = useRecords(formulaireTable ?? null);
    const contactRecords = useRecords(contactsTable ?? null);

    // {dayMs, status: 'confirming'|'sending'|'error', message?} for the acting day.
    const [pending, setPending] = useState(null);

    const configured = Boolean(eventsTable && dateField && formulaireTable && texteField && formulaireLinkField);

    // eventId → latest submitted formulaire record (by Date de création).
    const formulaireByEvent = useMemo(() => {
        const map = new Map();
        if (!formulaireLinkField) return map;
        for (const fr of formulaireRecords ?? []) {
            const links = fr.getCellValue(formulaireLinkField);
            if (!Array.isArray(links)) continue;
            const created = dateCreationField ? fr.getCellValue(dateCreationField) : null;
            const createdMs = created ? new Date(created).getTime() : 0;
            for (const link of links) {
                const prev = map.get(link.id);
                if (!prev || createdMs >= prev.createdMs) map.set(link.id, {record: fr, createdMs});
            }
        }
        return map;
    }, [formulaireRecords, formulaireLinkField, dateCreationField]);

    const filledFor = (record) => formulaireByEvent.get(record.id) ?? null;
    const sentAt = (record) => (dateEnvoiField ? record.getCellValue(dateEnvoiField) : null);

    // Events grouped by day, most recent first.
    const days = useMemo(() => {
        if (!configured) return [];
        const byDay = new Map();
        for (const r of records ?? []) {
            const ms = dayMsFromValue(r.getCellValue(dateField)) ?? dayMsFromValue(r.getCellValueAsString(dateField));
            if (ms === null) continue;
            if (!byDay.has(ms)) byDay.set(ms, []);
            byDay.get(ms).push(r);
        }
        return Array.from(byDay.entries())
            .sort((a, b) => b[0] - a[0])
            .map(([ms, recs]) => ({
                ms,
                recs: recs.sort((a, b) =>
                    a.getCellValueAsString(eventsTable.primaryField).localeCompare(
                        b.getCellValueAsString(eventsTable.primaryField),
                        'fr',
                    ),
                ),
            }));
    }, [configured, records, dateField, eventsTable]);

    // Contacts whose "rapports" checkbox is ticked, deduplicated by email.
    const recipients = useMemo(() => {
        if (!contactEmailField || !contactFlagField) return [];
        const seen = new Set();
        for (const r of contactRecords ?? []) {
            if (r.getCellValue(contactFlagField) !== true) continue;
            const email = r.getCellValueAsString(contactEmailField).trim();
            if (email.includes('@')) seen.add(email);
        }
        return Array.from(seen);
    }, [contactRecords, contactEmailField, contactFlagField]);

    const sendBlocker = useMemo(() => {
        if (!webhookUrl) return "L'URL du webhook Make n'est pas configurée.";
        if (!contactEmailField || !contactFlagField) return 'Les champs des destinataires ne sont pas configurés.';
        if (!dateEnvoiField) return "Le champ « Date d'envoi » n'est pas configuré.";
        if (!recipients.length) return "Aucun contact n'est coché comme destinataire.";
        return null;
    }, [webhookUrl, contactEmailField, contactFlagField, dateEnvoiField, recipients]);

    const readTexte = (formulaireRecord) => {
        const raw = formulaireRecord.getCellValue(texteField);
        return typeof raw === 'string' ? raw : formulaireRecord.getCellValueAsString(texteField);
    };

    const sendDay = async (day) => {
        if (sendBlocker) return;
        // Every event of the day — a missing report is included as "non soumis"
        // so the daily report can still go out.
        const items = day.recs.map((r) => ({event: r, formulaire: filledFor(r)?.record ?? null}));
        setPending({dayMs: day.ms, status: 'sending'});
        try {
            const date = isoDate(day.ms);

            // Fetch each event's attachments once (base64) — reused for both the
            // images embedded in the PDF and the email's `fichiers`. A piece that
            // can't be fetched (network/CORS) is skipped, not fatal.
            for (const item of items) {
                item.attachments = [];
                const atts =
                    item.formulaire && piecesJointesField
                        ? item.formulaire.getCellValue(piecesJointesField) || []
                        : [];
                for (const a of atts) {
                    try {
                        item.attachments.push({nom: a.filename, type: a.type || '', base64: await urlToBase64(a.url)});
                    } catch (err) {
                        console.warn('[post_event_report] pièce jointe non récupérée:', a.filename, err);
                    }
                }
            }

            const reportData = {
                dateFr: fmtDateFr(day.ms),
                events: items.map(({event, formulaire, attachments}) => ({
                    identifiant: event.getCellValueAsString(eventsTable.primaryField).trim(),
                    submitted: Boolean(formulaire),
                    blocks: formulaire ? parseTexteSoumis(readTexte(formulaire)) : [],
                    images: (attachments || [])
                        .map((a) => {
                            const mime = imageMime(a);
                            return mime ? `data:${mime};base64,${a.base64}` : null;
                        })
                        .filter(Boolean),
                })),
            };

            // Attempt the PDF with embedded images; if react-pdf can't decode an
            // image it throws, so fall back to a text-only PDF (the images still
            // ride along as email attachments below).
            let blob;
            try {
                blob = await pdf(<ReportPdf data={reportData} />).toBlob();
            } catch (err) {
                console.warn('[post_event_report] PDF avec images a échoué, repli sans images:', err);
                const noImages = {...reportData, events: reportData.events.map((e) => ({...e, images: []}))};
                blob = await pdf(<ReportPdf data={noImages} />).toBlob();
            }

            // Email files: the PDF first, then every fetched attachment.
            const fichiers = [{nom: `rapport-post-evenement-${date}.pdf`, base64: await blobToBase64(blob)}];
            for (const item of items) {
                for (const a of item.attachments || []) {
                    fichiers.push({nom: a.nom, base64: a.base64});
                }
            }

            const form = new FormData();
            form.append(
                'payload',
                JSON.stringify({
                    token: webhookToken,
                    type: MAKE_PAYLOAD_TYPE,
                    date,
                    sujet: `Rapport post-événement — ${fmtDateFr(day.ms)}`,
                    destinataires: recipients,
                    destinataires_str: recipients.join(', '),
                    fichiers,
                }),
            );
            const res = await fetch(webhookUrl, {method: 'POST', body: form});
            if (!res.ok) throw new Error(`Make a répondu ${res.status}`);
            // Persist "envoyé" on every event of the day (the daily report covers
            // the whole day, submitted or not).
            const nowISO = new Date().toISOString();
            await eventsTable.updateRecordsAsync(
                day.recs.map((r) => ({id: r.id, fields: {[dateEnvoiField.id]: nowISO}})),
            );
            setPending(null);
        } catch (err) {
            setPending({dayMs: day.ms, status: 'error', message: err instanceof Error ? err.message : 'Envoi échoué'});
        }
    };

    if (errorState) {
        return <div className="p-4 text-sm text-red-600">{errorState.error?.message ?? 'Erreur de configuration'}</div>;
    }

    if (!configured) {
        return (
            <div className="p-4 text-sm text-gray-600">
                Configurez l&apos;extension : table des événements + champ Date, et table des formulaires (texte soumis
                + lien vers l&apos;événement).
            </div>
        );
    }

    const badge = (ok, label) => (
        <span
            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                ok ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
            }`}
        >
            {label}
        </span>
    );

    const navBtn = 'rounded border border-gray-300 bg-white px-2 py-1 text-sm enabled:hover:bg-gray-50 disabled:opacity-40';

    return (
        <div className="min-h-screen bg-gray-100 p-4 text-gray-900">
            <div className="mx-auto max-w-4xl">
                <h1 className="mb-1 text-lg font-semibold">Suivi des rapports post-événement</h1>
                <p className="mb-4 text-sm text-gray-500">
                    {recipients.length} destinataire{recipients.length > 1 ? 's' : ''} coché
                    {recipients.length > 1 ? 's' : ''}.
                    {sendBlocker ? <span className="ml-1 text-amber-600">{sendBlocker}</span> : null}
                </p>

                {days.length === 0 ? (
                    <p className="py-12 text-center text-sm text-gray-500">Aucun événement daté.</p>
                ) : (
                    days.map((day) => {
                        const {ms, recs} = day;
                        const remplis = recs.filter((r) => filledFor(r)).length;
                        const envoyes = recs.filter((r) => Boolean(sentAt(r))).length;
                        const rowPending = pending && pending.dayMs === ms;
                        return (
                            <div key={ms} className="mb-5 overflow-hidden rounded-lg bg-white shadow-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2">
                                    <div>
                                        <h2 className="text-sm font-semibold capitalize text-gray-900">{fmtDateFr(ms)}</h2>
                                        <p className="text-xs text-gray-500">
                                            {recs.length} événement{recs.length > 1 ? 's' : ''} · {recs.length} rapport
                                            {recs.length > 1 ? 's' : ''} attendu{recs.length > 1 ? 's' : ''} — {remplis}{' '}
                                            rempli{remplis > 1 ? 's' : ''}
                                        </p>
                                    </div>
                                    {/* Per-day send (two-step confirm — this emails real people). */}
                                    {rowPending && pending.status === 'confirming' ? (
                                        <span className="inline-flex items-center gap-2">
                                            <span className="text-xs text-gray-600">
                                                Envoyer le rapport journalier à {recipients.length} destinataire
                                                {recipients.length > 1 ? 's' : ''} ?
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => sendDay(day)}
                                                className="rounded bg-[#13324b] px-3 py-1 text-xs font-medium text-white hover:bg-[#1d4a6d]"
                                            >
                                                Confirmer
                                            </button>
                                            <button type="button" onClick={() => setPending(null)} className={navBtn}>
                                                Annuler
                                            </button>
                                        </span>
                                    ) : rowPending && pending.status === 'sending' ? (
                                        <span className="text-xs text-gray-500">Envoi…</span>
                                    ) : (
                                        <span className="inline-flex items-center gap-2">
                                            {rowPending && pending.status === 'error' && (
                                                <span className="text-xs text-red-600">{pending.message}</span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setPending({dayMs: ms, status: 'confirming'})}
                                                disabled={Boolean(sendBlocker)}
                                                title={sendBlocker ?? undefined}
                                                className="rounded bg-[#13324b] px-3 py-1 text-xs font-medium text-white enabled:hover:bg-[#1d4a6d] disabled:opacity-40"
                                            >
                                                {envoyes > 0 ? 'Renvoyer le rapport journalier' : 'Envoyer le rapport journalier'}
                                            </button>
                                        </span>
                                    )}
                                </div>
                                <table className="w-full text-sm">
                                    <tbody>
                                        {recs.map((record) => {
                                            const filled = filledFor(record);
                                            const url =
                                                filled && base && interfacePageId && interfaceHomePageId && interfaceDetailPageId
                                                    ? buildFormulaireUrl({
                                                          baseId: base.id,
                                                          pageId: interfacePageId,
                                                          homePageId: interfaceHomePageId,
                                                          detailPageId: interfaceDetailPageId,
                                                          eventId: record.id,
                                                          formulaireId: filled.record.id,
                                                      })
                                                    : null;
                                            return (
                                                <tr key={record.id} className="border-b border-gray-100 last:border-0">
                                                    <td className="px-4 py-2">
                                                        {record.getCellValueAsString(eventsTable.primaryField) || 'Sans titre'}
                                                    </td>
                                                    <td className="w-32 px-4 py-2 text-right whitespace-nowrap">
                                                        {filled ? (
                                                            url ? (
                                                                <a
                                                                    href={url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    title="Ouvrir le rapport soumis"
                                                                    className="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 hover:bg-green-200 hover:underline"
                                                                >
                                                                    Rempli
                                                                </a>
                                                            ) : (
                                                                badge(true, 'Rempli')
                                                            )
                                                        ) : (
                                                            badge(false, 'Non rempli')
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

initializeBlock({interface: () => <SuiviRapportsApp />});
