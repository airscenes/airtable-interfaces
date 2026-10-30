import {useMemo, useState} from 'react';
import {initializeBlock, useCustomProperties} from '@airtable/blocks/interface/ui';
import RoyaltiesUpload from './features/royalties.js';
import {makeUploadClient, missingSettings, royaltiesSourceKey} from './lib/uploadApi.js';
import './style.css';

// Registry of available document-upload features. Add new entries to expose
// new scripts in the dropdown — each entry maps to a React component that
// receives a {client} prop (see lib/uploadApi.js).
const FEATURES = [
    {
        key: 'royalties',
        label: 'Royalties (Believe, Bandcamp, Propagande)',
        description: 'Upload d\'un rapport de redevances vers Supabase. Import automatique dans royalty_reports.',
        Component: RoyaltiesUpload,
    },
];

function getCustomProperties() {
    return [
        // Token path: both filled in = the legacy settings below are ignored.
        {
            key: 'royaltiesApiUrl',
            label: 'URL de l\'API d\'upload des royalties (ex: https://…/api/airtable/royalty-upload)',
            type: 'string',
            defaultValue: '',
        },
        {
            key: 'royaltiesApiToken',
            label: 'Jeton de la base (le même que pour les ventes)',
            type: 'string',
            defaultValue: '',
        },
        // Legacy path (publishable key + client id + upload secret).
        {
            key: 'supabaseUrl',
            label: 'Supabase URL (ex: https://xyz.supabase.co)',
            type: 'string',
            defaultValue: '',
        },
        {
            key: 'supabaseApiKey',
            label: 'Supabase Publishable Key (sb_publishable_...)',
            type: 'string',
            defaultValue: '',
        },
        {
            key: 'clientId',
            label: 'Client UUID',
            type: 'string',
            defaultValue: '',
        },
        {
            key: 'uploadSecret',
            label: 'Upload Secret (fourni par Airscènes)',
            type: 'string',
            defaultValue: '',
        },
    ];
}

function DocumentUploadApp() {
    const {customPropertyValueByKey} = useCustomProperties(getCustomProperties);
    const cfg = {
        royaltiesApiUrl: customPropertyValueByKey.royaltiesApiUrl,
        royaltiesApiToken: customPropertyValueByKey.royaltiesApiToken,
        supabaseUrl: customPropertyValueByKey.supabaseUrl,
        apiKey: customPropertyValueByKey.supabaseApiKey,
        clientId: customPropertyValueByKey.clientId,
        uploadSecret: customPropertyValueByKey.uploadSecret,
    };
    const sourceKey = royaltiesSourceKey(cfg);
    // Rebuilt only when a setting changes, so the history effect does not refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const client = useMemo(() => makeUploadClient(cfg), [sourceKey]);

    const [selectedKey, setSelectedKey] = useState(FEATURES[0].key);
    const selected = FEATURES.find((f) => f.key === selectedKey);

    const missing = missingSettings(cfg);
    const configMissing = missing.length > 0;

    return (
        <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
            <div className="max-w-3xl mx-auto">
                <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray200 mb-1">
                    Import de documents
                </h1>
                {/* Feature picker: hidden while there is only one feature, so the
                    report type is the only choice on screen. */}
                {FEATURES.length > 1 && (
                <div className="mb-5">
                    <label className="block text-xs font-semibold text-gray-gray500 dark:text-gray-gray400 mb-1">
                        Type de document
                    </label>
                    <div className="relative">
                        <select
                            value={selectedKey}
                            onChange={(e) => setSelectedKey(e.target.value)}
                            disabled={FEATURES.length <= 1}
                            className="w-full appearance-none bg-white dark:bg-gray-gray700 border border-gray-gray200 dark:border-gray-gray600 rounded-md px-3 py-2 pr-8 text-sm text-gray-gray700 dark:text-gray-gray200 focus:outline-none focus:border-blue-blue disabled:opacity-70"
                        >
                            {FEATURES.map((f) => (
                                <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                        </select>
                        <svg
                            className="absolute right-2 top-2.5 w-4 h-4 text-gray-gray400 pointer-events-none"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M6 9l6 6 6-6" />
                        </svg>
                    </div>
                    {selected?.description && (
                        <p className="text-xs text-gray-gray400 mt-1">{selected.description}</p>
                    )}
                </div>
                )}
                {FEATURES.length <= 1 && selected?.description && (
                    <p className="text-sm text-gray-gray400 mb-5">{selected.description}</p>
                )}

                {/* Config gate */}
                {configMissing ? (
                    <div className="bg-yellow-yellowLight3 dark:bg-yellow-yellowDusty/20 border border-yellow-yellowLight2 rounded-lg p-4 text-sm text-yellow-yellowDark1 dark:text-yellow-yellowLight1">
                        Veuillez configurer les propriétés de l&apos;extension :
                        <ul className="list-disc list-inside mt-2">
                            {missing.map((label) => <li key={label}>{label}</li>)}
                        </ul>
                        <p className="mt-2 text-xs">
                            {'Avec l\'URL de l\'API et le jeton de la base, les autres réglages ne sont pas nécessaires.'}
                        </p>
                    </div>
                ) : (
                    selected && (
                        <selected.Component client={client} />
                    )
                )}
            </div>
        </div>
    );
}

initializeBlock({interface: () => <DocumentUploadApp />});
