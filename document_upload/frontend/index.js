import {useState} from 'react';
import {initializeBlock, useCustomProperties} from '@airtable/blocks/interface/ui';
import RoyaltiesUpload from './features/royalties.js';
import './style.css';

// Registry of available document-upload features. Add new entries to expose
// new scripts in the dropdown — each entry maps to a React component that
// receives {supabaseUrl, anonKey, clientId} props.
const FEATURES = [
    {
        key: 'royalties',
        label: 'Royalties Believe (CSV mensuel)',
        description: 'Upload du rapport mensuel Believe vers Supabase. Import automatique dans royalty_reports.',
        Component: RoyaltiesUpload,
    },
];

function getCustomProperties() {
    return [
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
    ];
}

function DocumentUploadApp() {
    const {customPropertyValueByKey} = useCustomProperties(getCustomProperties);
    const supabaseUrl = customPropertyValueByKey.supabaseUrl;
    const apiKey = customPropertyValueByKey.supabaseApiKey;
    const clientId = customPropertyValueByKey.clientId;

    const [selectedKey, setSelectedKey] = useState(FEATURES[0].key);
    const selected = FEATURES.find((f) => f.key === selectedKey);

    const configMissing = !supabaseUrl || !apiKey || !clientId;

    return (
        <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
            <div className="max-w-3xl mx-auto">
                <h1 className="text-2xl font-display font-bold text-gray-gray700 dark:text-gray-gray200 mb-1">
                    Import de documents
                </h1>
                <p className="text-sm text-gray-gray400 mb-5">
                    Sélectionnez le type de document à importer.
                </p>

                {/* Feature picker */}
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

                {/* Config gate */}
                {configMissing ? (
                    <div className="bg-yellow-yellowLight3 dark:bg-yellow-yellowDusty/20 border border-yellow-yellowLight2 rounded-lg p-4 text-sm text-yellow-yellowDark1 dark:text-yellow-yellowLight1">
                        Veuillez configurer les propriétés de l'extension :
                        <ul className="list-disc list-inside mt-2">
                            {!supabaseUrl && <li>Supabase URL</li>}
                            {!apiKey && <li>Supabase Publishable Key</li>}
                            {!clientId && <li>Client UUID</li>}
                        </ul>
                    </div>
                ) : (
                    selected && (
                        <selected.Component
                            supabaseUrl={supabaseUrl}
                            apiKey={apiKey}
                            clientId={clientId}
                        />
                    )
                )}
            </div>
        </div>
    );
}

initializeBlock({interface: () => <DocumentUploadApp />});
