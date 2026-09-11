import {useState, useEffect, useCallback, useRef} from 'react';
import {
    callEdgeFunction,
    uploadToSignedUrl,
    pgRestSelect,
} from '../lib/supabase.js';

const MAX_BYTES = 50 * 1024 * 1024;
const FILENAME_RE = /^[\w. -]+\.csv$/i;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180000;

const STATUS_LABELS = {
    pending: 'En cours d\'import...',
    imported: 'Importé',
    failed: 'Échec',
};

const STATUS_COLORS = {
    pending: 'text-orange-orange',
    imported: 'text-green-green',
    failed: 'text-red-red',
};

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso) {
    if (!iso) return '';
    const [datePart, timePart = ''] = iso.split('T');
    const hm = timePart.slice(0, 5);
    return hm ? `${datePart} ${hm}` : datePart;
}

async function pollAuditStatus({supabaseUrl, apiKey, clientId, auditId}) {
    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
        const rows = await pgRestSelect({
            supabaseUrl,
            apiKey,
            clientId,
            table: 'royalty_upload_audit',
            query: `id=eq.${auditId}&select=status,rows_imported,error_message,imported_at`,
        });
        const row = rows[0];
        if (row?.status === 'imported') {
            return {ok: true, rows: row.rows_imported};
        }
        if (row?.status === 'failed') {
            return {ok: false, error: row.error_message || 'Échec inconnu'};
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return {ok: null, error: 'Délai dépassé. L\'import est peut-être encore en cours.'};
}

export default function RoyaltiesUpload({supabaseUrl, apiKey, clientId}) {
    const [file, setFile] = useState(null);
    const [validationError, setValidationError] = useState(null);
    const [phase, setPhase] = useState('idle'); // idle | uploading | importing | done | error
    const [progress, setProgress] = useState(0);
    const [resultMessage, setResultMessage] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef(null);

    const refreshHistory = useCallback(async () => {
        if (!supabaseUrl || !apiKey || !clientId) return;
        setHistoryLoading(true);
        setHistoryError(null);
        try {
            const rows = await pgRestSelect({
                supabaseUrl,
                apiKey,
                clientId,
                table: 'royalty_upload_audit',
                query:
                    'select=id,filename,status,rows_imported,error_message,uploaded_at,imported_at' +
                    '&order=uploaded_at.desc&limit=50',
            });
            setHistory(rows);
        } catch (err) {
            setHistoryError(err.message);
        } finally {
            setHistoryLoading(false);
        }
    }, [supabaseUrl, apiKey, clientId]);

    useEffect(() => {
        refreshHistory();
    }, [refreshHistory]);

    const validateFile = (f) => {
        if (!f) return 'Aucun fichier sélectionné.';
        if (!FILENAME_RE.test(f.name)) {
            return 'Nom de fichier invalide. Utilisez uniquement des lettres, chiffres, espaces, points, tirets, et l\'extension .csv.';
        }
        if (!f.name.toLowerCase().endsWith('.csv')) {
            return 'Seuls les fichiers .csv sont acceptés.';
        }
        if (f.size > MAX_BYTES) {
            return `Fichier trop volumineux (${formatBytes(f.size)}). Maximum : 50 MB.`;
        }
        if (f.size === 0) return 'Fichier vide.';
        return null;
    };

    const onPickFile = (f) => {
        setValidationError(null);
        setResultMessage(null);
        setErrorMessage(null);
        setPhase('idle');
        const err = validateFile(f);
        if (err) {
            setFile(null);
            setValidationError(err);
            return;
        }
        setFile(f);
    };

    const onDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPickFile(f);
    };

    const onUpload = async () => {
        if (!file) return;
        setPhase('uploading');
        setProgress(0);
        setErrorMessage(null);
        setResultMessage(null);

        let signed;
        try {
            signed = await callEdgeFunction({
                supabaseUrl,
                apiKey,
                clientId,
                name: 'request-upload-url',
                body: {client_id: clientId, filename: file.name},
            });
        } catch (err) {
            setPhase('error');
            if (err.status === 404) {
                setErrorMessage('Client introuvable. Vérifiez la configuration de l\'extension.');
            } else if (err.status === 400) {
                setErrorMessage(err.message || 'Requête invalide.');
            } else {
                setErrorMessage(`Impossible d\'obtenir l'URL d'upload : ${err.message}`);
            }
            return;
        }

        try {
            await uploadToSignedUrl({
                signedUrl: signed.signed_url,
                file,
                contentType: 'text/csv',
                onProgress: (p) => setProgress(p),
            });
        } catch (err) {
            setPhase('error');
            setErrorMessage(`Erreur d'upload : ${err.message}`);
            return;
        }

        setPhase('importing');
        refreshHistory();

        const result = await pollAuditStatus({
            supabaseUrl,
            apiKey,
            clientId,
            auditId: signed.audit_id,
        });

        if (result.ok === true) {
            setPhase('done');
            setResultMessage(`${result.rows?.toLocaleString('fr-FR') ?? '?'} lignes importées avec succès.`);
            setFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } else if (result.ok === false) {
            setPhase('error');
            setErrorMessage(`Échec de l'import : ${result.error}`);
        } else {
            setPhase('error');
            setErrorMessage(result.error);
        }
        refreshHistory();
    };

    const canUpload = file && !validationError && (phase === 'idle' || phase === 'done' || phase === 'error');

    return (
        <div className="space-y-5">
            {/* Drop zone */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                    dragOver
                        ? 'border-blue-blue bg-blue-blueLight3 dark:bg-gray-gray600'
                        : 'border-gray-gray200 dark:border-gray-gray600 bg-white dark:bg-gray-gray700 hover:border-blue-blueLight1'
                }`}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    style={{display: 'none'}}
                    onChange={(e) => onPickFile(e.target.files?.[0])}
                />
                {file ? (
                    <div>
                        <p className="text-sm font-semibold text-gray-gray700 dark:text-gray-gray200">
                            {file.name}
                        </p>
                        <p className="text-xs text-gray-gray400 mt-1">{formatBytes(file.size)}</p>
                        <p className="text-xs text-blue-blue mt-2">Cliquer pour changer de fichier</p>
                    </div>
                ) : (
                    <div>
                        <p className="text-sm font-semibold text-gray-gray600 dark:text-gray-gray300">
                            Glissez un fichier CSV ici, ou cliquez pour sélectionner
                        </p>
                        <p className="text-xs text-gray-gray400 mt-2">
                            Rapport Believe Royalties · CSV uniquement · 50 MB max
                        </p>
                    </div>
                )}
            </div>

            {validationError && (
                <div className="rounded-lg bg-red-redLight3 dark:bg-red-redDusty/20 border border-red-redLight2 p-3 text-sm text-red-redDark1 dark:text-red-redLight1">
                    {validationError}
                </div>
            )}

            {/* Action button + status */}
            <div className="flex items-center gap-3">
                <button
                    onClick={onUpload}
                    disabled={!canUpload || phase === 'uploading' || phase === 'importing'}
                    className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                        canUpload && phase !== 'uploading' && phase !== 'importing'
                            ? 'bg-blue-blue text-white hover:bg-blue-blueDark1'
                            : 'bg-gray-gray200 dark:bg-gray-gray600 text-gray-gray400 cursor-not-allowed'
                    }`}
                >
                    {phase === 'uploading' ? 'Upload en cours...'
                        : phase === 'importing' ? 'Import en cours...'
                        : 'Uploader le rapport'}
                </button>

                {phase === 'uploading' && (
                    <div className="flex items-center gap-2 flex-1">
                        <div className="flex-1 h-2 bg-gray-gray100 dark:bg-gray-gray600 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-blue transition-all"
                                style={{width: `${Math.round(progress * 100)}%`}}
                            />
                        </div>
                        <span className="text-xs text-gray-gray500">{Math.round(progress * 100)}%</span>
                    </div>
                )}

                {phase === 'importing' && (
                    <div className="flex items-center gap-2 text-sm text-gray-gray500">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-blue" />
                        <span>Fichier reçu, import en cours...</span>
                    </div>
                )}
            </div>

            {/* Result */}
            {phase === 'done' && resultMessage && (
                <div className="rounded-lg bg-green-greenLight3 dark:bg-green-greenDusty/20 border border-green-greenLight2 p-3 text-sm text-green-greenDark1 dark:text-green-greenLight1">
                    {resultMessage}
                </div>
            )}
            {phase === 'error' && errorMessage && (
                <div className="rounded-lg bg-red-redLight3 dark:bg-red-redDusty/20 border border-red-redLight2 p-3 text-sm text-red-redDark1 dark:text-red-redLight1">
                    {errorMessage}
                </div>
            )}

            {/* History */}
            <div className="bg-white dark:bg-gray-gray700 rounded-lg border border-gray-gray100 dark:border-gray-gray600 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-gray100 dark:border-gray-gray600 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-gray600 dark:text-gray-gray300">
                        Historique ({history.length})
                    </span>
                    <div className="flex items-center gap-2">
                        {historyLoading && <span className="text-xs text-gray-gray400">Chargement...</span>}
                        <button
                            onClick={refreshHistory}
                            title="Rafraîchir"
                            className="text-xs px-2 py-1 rounded bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray200 dark:hover:bg-gray-gray500"
                        >
                            &#8634;
                        </button>
                    </div>
                </div>
                {historyError ? (
                    <div className="p-3 text-sm text-red-red">Erreur : {historyError}</div>
                ) : history.length === 0 ? (
                    <div className="p-4 text-xs text-gray-gray400 text-center">
                        Aucun upload pour l'instant.
                    </div>
                ) : (
                    <div style={{maxHeight: 320, overflowY: 'auto'}}>
                        {history.map((row) => (
                            <div
                                key={row.id}
                                className="px-3 py-2 text-xs border-b border-gray-gray100 dark:border-gray-gray600 last:border-b-0"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-gray-gray700 dark:text-gray-gray200 truncate flex-1">
                                        {row.filename}
                                    </span>
                                    <span className={`font-semibold whitespace-nowrap ${STATUS_COLORS[row.status] || ''}`}>
                                        {STATUS_LABELS[row.status] || row.status}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-1 text-gray-gray400">
                                    <span>{formatDateTime(row.uploaded_at)}</span>
                                    {row.status === 'imported' && row.rows_imported != null && (
                                        <span>{row.rows_imported.toLocaleString('fr-FR')} lignes</span>
                                    )}
                                    {row.status === 'failed' && row.error_message && (
                                        <span className="text-red-red truncate max-w-[60%]" title={row.error_message}>
                                            {row.error_message}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
