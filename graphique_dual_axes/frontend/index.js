import {useState, useMemo} from 'react';
import {
    initializeBlock,
    useRecords,
    useCustomProperties,
} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import {
    ComposedChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import './style.css';

// --- Custom Properties Definition ---

function getCustomProperties(base) {
    const table = base.tables[0];

    const isTextField = (field) =>
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.SINGLE_SELECT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.AUTO_NUMBER ||
        field.config.type === FieldType.NUMBER ||
        field.config.type === FieldType.MULTILINE_TEXT;

    const isNumericField = (field) =>
        field.config.type === FieldType.NUMBER ||
        field.config.type === FieldType.CURRENCY ||
        field.config.type === FieldType.PERCENT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP;

    const textFields = table.fields.filter(isTextField);
    const numericFields = table.fields.filter(isNumericField);

    return [
        {
            key: 'dataTable',
            label: 'Table',
            type: 'table',
            defaultValue: table,
        },
        {
            key: 'campaignField',
            label: 'Champ Campagne (axe X)',
            type: 'field',
            table,
            shouldFieldBeAllowed: isTextField,
            defaultValue: textFields[0],
        },
        {
            key: 'xAxisField',
            label: 'Identifiant pour graphique (axe X)',
            type: 'field',
            table,
            shouldFieldBeAllowed: isTextField,
            defaultValue: table.fields.find((f) => f.name.toLowerCase().includes('identifiant')) || textFields[0],
        },
        {
            key: 'filterField',
            label: 'Champ filtre (dropdown UI)',
            type: 'field',
            table,
            shouldFieldBeAllowed: isTextField,
            defaultValue: table.fields.find((f) => f.name.toLowerCase().includes('campagne')) || textFields[0],
        },
        {
            key: 'blocField',
            label: 'Champ Bloc (filtre multiselect)',
            type: 'field',
            table,
            shouldFieldBeAllowed: isTextField,
            defaultValue: table.fields.find((f) => f.name.toLowerCase().includes('bloc')) || textFields[1],
        },
        // Reach
        {
            key: 'coverageField',
            label: 'Portee - Couverture',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('couverture')) || numericFields[0],
        },
        {
            key: 'cpmField',
            label: 'Portee - CPM',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('cpm')) || numericFields[1],
        },
        // Traffic
        {
            key: 'pageViewsField',
            label: 'Traffic - Vues page de destination',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('vue')) || numericFields[2],
        },
        {
            key: 'cpcField',
            label: 'Traffic - CPC',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('cpc')) || numericFields[3],
        },
        // Engagement
        {
            key: 'impressionsField',
            label: 'Engagement - Impressions',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('impression')) || numericFields[4],
        },
        {
            key: 'ctrField',
            label: 'Engagement - CTR',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('ctr')) || numericFields[5],
        },
    ];
}

// --- Custom X-axis tick with horizontal word-wrap ---

function CustomXAxisTick({x, y, payload}) {
    const words = (payload.value || '').split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
        if (current.length + (current ? 1 : 0) + word.length > 12 && current) {
            lines.push(current);
            current = word;
        } else {
            current = current ? `${current} ${word}` : word;
        }
    }
    if (current) lines.push(current);

    return (
        <g transform={`translate(${x},${y})`}>
            <title>{payload.value}</title>
            <text x={0} y={0} dy={12} textAnchor="middle" fill="#666" fontSize={10}>
                {lines.map((line, i) => (
                    <tspan key={i} x={0} dy={i === 0 ? 0 : '1.2em'}>{line}</tspan>
                ))}
            </text>
        </g>
    );
}

// --- Dual Axis Chart Component ---

function DualAxisChart({
    title, data, xKey,
    leftKey, leftLabel, leftColor,
    rightKey, rightLabel, rightColor,
}) {
    // Strict exclusion: both metrics must be > 0
    const filteredData = (data || []).filter((d) => d[leftKey] > 0 && d[rightKey] > 0);

    if (!filteredData || filteredData.length === 0) {
        return (
            <div className="mb-4 bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h3 className="text-sm font-semibold text-gray-gray700 dark:text-gray-gray200">
                        {title}
                    </h3>
                </div>
                <p className="text-sm text-gray-gray500">Aucune campagne avec des données pour ces métriques.</p>
            </div>
        );
    }

    const barSize = Math.max(8, Math.min(20, 500 / filteredData.length));

    return (
        <div className="mb-4 bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                <h3 className="text-sm font-semibold text-gray-gray700 dark:text-gray-gray200">
                    {title}
                </h3>
            </div>
            <div style={{display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, marginBottom: 4, color: '#374151'}}>
                <span style={{display: 'flex', alignItems: 'center', gap: 4}}>
                    <span style={{display: 'inline-block', width: 12, height: 12, backgroundColor: leftColor, borderRadius: 2}} />
                    {leftLabel}
                </span>
                <span style={{display: 'flex', alignItems: 'center', gap: 4}}>
                    <span style={{display: 'inline-block', width: 12, height: 12, backgroundColor: rightColor, borderRadius: 2}} />
                    {rightLabel}
                </span>
            </div>
            <div style={{width: '100%', height: 340}}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={filteredData} margin={{top: 5, right: 40, bottom: 10, left: 40}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" vertical={false} />
                        <XAxis
                            dataKey={xKey}
                            tick={<CustomXAxisTick />}
                            interval={0}
                            height={80}
                        />
                        <YAxis
                            yAxisId="left"
                            orientation="left"
                            stroke={leftColor}
                            tick={{fontSize: 10}}
                            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
                            domain={[0, 'auto']}
                            padding={{top: 10, bottom: 5}}
                            label={{
                                value: leftLabel,
                                angle: -90,
                                position: 'insideLeft',
                                offset: -25,
                                style: {fontSize: 11, fill: leftColor, fontWeight: 600},
                            }}
                        />
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            stroke={rightColor}
                            tick={{fontSize: 10}}
                            domain={[0, 'auto']}
                            padding={{top: 10, bottom: 5}}
                            label={{
                                value: rightLabel,
                                angle: 90,
                                position: 'insideRight',
                                offset: -25,
                                style: {fontSize: 11, fill: rightColor, fontWeight: 600},
                            }}
                        />
                        <Tooltip
                            content={({ active, payload, label }) => {
                                if (!active || !payload || payload.length === 0) return null;
                                const left = payload.find((p) => p.dataKey === leftKey);
                                const right = payload.find((p) => p.dataKey === rightKey);
                                const fmt = (v) => typeof v === 'number'
                                    ? v.toLocaleString('fr-FR', {maximumFractionDigits: 2}) : v ?? '';
                                return (
                                    <div style={{background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)'}}>
                                        <p style={{fontWeight: 600, marginBottom: 6, color: '#374151'}}>{label}</p>
                                        {left && <p style={{color: leftColor, margin: '2px 0'}}>{leftLabel} : {fmt(left.value)}</p>}
                                        {right && <p style={{color: rightColor, margin: '2px 0'}}>{rightLabel} : {fmt(right.value)}</p>}
                                    </div>
                                );
                            }}
                        />
                        <Bar
                            yAxisId="left"
                            dataKey={leftKey}
                            name={leftLabel}
                            fill={leftColor}
                            opacity={0.85}
                            radius={[3, 3, 0, 0]}
                            barSize={barSize}
                        />
                        <Bar
                            yAxisId="right"
                            dataKey={rightKey}
                            name={rightLabel}
                            fill={rightColor}
                            opacity={0.85}
                            radius={[3, 3, 0, 0]}
                            barSize={barSize}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// --- Main App ---

function MultiAxisChartsApp() {
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const table = customPropertyValueByKey.dataTable;
    const records = useRecords(table);

    const campaignField = customPropertyValueByKey.campaignField;
    const xAxisField = customPropertyValueByKey.xAxisField;
    const filterField = customPropertyValueByKey.filterField;
    const blocField = customPropertyValueByKey.blocField;
    const coverageField = customPropertyValueByKey.coverageField;
    const cpmField = customPropertyValueByKey.cpmField;
    const pageViewsField = customPropertyValueByKey.pageViewsField;
    const cpcField = customPropertyValueByKey.cpcField;
    const impressionsField = customPropertyValueByKey.impressionsField;
    const ctrField = customPropertyValueByKey.ctrField;

    const [selectedFilters, setSelectedFilters] = useState([]);
    const [campaignDropdownOpen, setCampaignDropdownOpen] = useState(false);
    const [selectedBlocs, setSelectedBlocs] = useState([]);
    const [blocDropdownOpen, setBlocDropdownOpen] = useState(false);

    // Extract unique values from the filter field (supports linked records, single select, and other types)
    // Only includes campaigns that have at least one non-empty value for cpm, ctr, or cpc
    const filterOptions = useMemo(() => {
        if (!filterField || !records) return [];
        const hasMetricData = (record) =>
            [cpmField, ctrField, cpcField].some((f) => {
                if (!f) return false;
                const val = record.getCellValue(f);
                return val !== null && val !== undefined && val !== 0 && val !== '';
            });
        const seen = new Set();
        const options = [];
        for (const record of records) {
            if (!hasMetricData(record)) continue;
            const cellValue = record.getCellValue(filterField);
            if (Array.isArray(cellValue)) {
                // Linked records return an array of {id, name}
                for (const link of cellValue) {
                    if (link.name && !seen.has(link.name)) {
                        seen.add(link.name);
                        options.push(link.name);
                    }
                }
            } else if (cellValue && typeof cellValue === 'object' && cellValue.name) {
                // Single select returns {id, name, color}
                if (!seen.has(cellValue.name)) {
                    seen.add(cellValue.name);
                    options.push(cellValue.name);
                }
            } else {
                const str = record.getCellValueAsString(filterField);
                if (str && !seen.has(str)) {
                    seen.add(str);
                    options.push(str);
                }
            }
        }
        return options.sort();
    }, [filterField, records, cpmField, ctrField, cpcField]);

    // Extract unique values from the bloc field
    const blocOptions = useMemo(() => {
        if (!blocField || !records) return [];
        const seen = new Set();
        const options = [];
        for (const record of records) {
            const cellValue = record.getCellValue(blocField);
            if (Array.isArray(cellValue)) {
                for (const link of cellValue) {
                    if (link.name && !seen.has(link.name)) {
                        seen.add(link.name);
                        options.push(link.name);
                    }
                }
            } else if (cellValue && typeof cellValue === 'object' && cellValue.name) {
                if (!seen.has(cellValue.name)) {
                    seen.add(cellValue.name);
                    options.push(cellValue.name);
                }
            } else {
                const str = record.getCellValueAsString(blocField);
                if (str && !seen.has(str)) {
                    seen.add(str);
                    options.push(str);
                }
            }
        }
        return options.sort();
    }, [blocField, records]);

    // Filter records based on selected dropdown value + bloc multiselect
    const filteredRecords = useMemo(() => {
        if (!records) return [];
        let result = records;

        // Global campaign multiselect filter
        if (selectedFilters.length > 0 && filterField) {
            result = result.filter((record) => {
                const cellValue = record.getCellValue(filterField);
                if (Array.isArray(cellValue)) {
                    return cellValue.some((link) => selectedFilters.includes(link.name));
                }
                if (cellValue && typeof cellValue === 'object' && cellValue.name) {
                    return selectedFilters.includes(cellValue.name);
                }
                return selectedFilters.includes(record.getCellValueAsString(filterField));
            });
        }

        // Bloc multiselect filter
        if (selectedBlocs.length > 0 && blocField) {
            result = result.filter((record) => {
                const cellValue = record.getCellValue(blocField);
                if (Array.isArray(cellValue)) {
                    return cellValue.some((link) => selectedBlocs.includes(link.name));
                }
                if (cellValue && typeof cellValue === 'object' && cellValue.name) {
                    return selectedBlocs.includes(cellValue.name);
                }
                return selectedBlocs.includes(record.getCellValueAsString(blocField));
            });
        }

        return result;
    }, [records, selectedFilters, filterField, selectedBlocs, blocField]);

    if (errorState) {
        return (
            <div className="p-6 text-center text-red-red dark:text-red-redLight1">
                Erreur de configuration : {errorState.message || 'Erreur inconnue'}
            </div>
        );
    }

    const allConfigured = campaignField && xAxisField && coverageField && cpmField &&
        pageViewsField && cpcField && impressionsField && ctrField;

    if (!allConfigured) {
        return (
            <div className="flex items-center justify-center min-h-screen p-6">
                <div className="text-center">
                    <p className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray200 mb-2">
                        Configuration requise
                    </p>
                    <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
                        Ouvrez le panneau des proprietes pour configurer les champs
                        (Campagne, Couverture, CPM, Vues, CPC, Impressions, CTR).
                    </p>
                </div>
            </div>
        );
    }

    const isPercentField = (field) => {
        if (field.config.type === FieldType.PERCENT) return true;
        // FORMULA and ROLLUP fields store the result type in options.result
        const resultType = field.config.options?.result?.type;
        return resultType === FieldType.PERCENT || resultType === 'percent';
    };

    const getValue = (record, field) => {
        if (!field) return 0;
        const val = record.getCellValue(field);
        const num = typeof val === 'number' ? val : parseFloat(String(val)) || 0;
        if (isPercentField(field)) return num * 100;
        return num;
    };

    const chartData = filteredRecords.map((record) => ({
        _raw: record,
        campaign: campaignField ? record.getCellValueAsString(campaignField) : '',
        xLabel: xAxisField ? record.getCellValueAsString(xAxisField) : '',
        coverage: getValue(record, coverageField),
        cpm: getValue(record, cpmField),
        pageViews: getValue(record, pageViewsField),
        cpc: getValue(record, cpcField),
        impressions: getValue(record, impressionsField),
        ctr: getValue(record, ctrField),
    }));

    return (
        <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <h2 className="text-xl font-display font-bold text-gray-gray700 dark:text-gray-gray200">
                    Performance des campagnes
                </h2>

                <div className="flex items-center gap-4 flex-wrap">
                    {filterField && filterOptions.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-gray600 dark:text-gray-gray300">
                                {filterField.name} :
                            </span>
                            <div style={{position: 'relative', display: 'inline-block'}}>
                                <button
                                    onClick={() => setCampaignDropdownOpen((v) => !v)}
                                    style={{
                                        fontSize: 13,
                                        padding: '6px 32px 6px 12px',
                                        borderRadius: 6,
                                        border: '2px solid #d0d5dd',
                                        backgroundColor: '#fff',
                                        color: '#333',
                                        cursor: 'pointer',
                                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M3 5l3 3 3-3\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'/%3E%3C/svg%3E")',
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 10px center',
                                        minWidth: 180,
                                        textAlign: 'left',
                                    }}
                                >
                                    {selectedFilters.length === 0
                                        ? `Tous (${filterOptions.length})`
                                        : `${selectedFilters.length} sélectionné${selectedFilters.length > 1 ? 's' : ''}`}
                                </button>
                                {campaignDropdownOpen && (
                                    <div style={{position: 'absolute', top: '100%', right: 0, marginTop: 4, backgroundColor: '#fff', border: '1px solid #d0d5dd', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 50, minWidth: 200, maxHeight: 250, overflowY: 'auto'}}>
                                        <label
                                            style={{display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #eee', fontWeight: 600, color: '#333'}}
                                        >
                                            <input type="checkbox" checked={selectedFilters.length === 0} onChange={() => setSelectedFilters([])} style={{accentColor: '#3B82F6'}} />
                                            Tous
                                        </label>
                                        {filterOptions.map((name) => (
                                            <label
                                                key={name}
                                                style={{display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#444'}}
                                            >
                                                <input type="checkbox" checked={selectedFilters.includes(name)} onChange={() => {
                                                    if (selectedFilters.includes(name)) {
                                                        setSelectedFilters(selectedFilters.filter((v) => v !== name));
                                                    } else {
                                                        setSelectedFilters([...selectedFilters, name]);
                                                    }
                                                }} style={{accentColor: '#3B82F6'}} />
                                                {name}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {blocField && blocOptions.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-gray600 dark:text-gray-gray300">
                                {blocField.name} :
                            </span>
                            <div style={{position: 'relative', display: 'inline-block'}}>
                                <button
                                    onClick={() => setBlocDropdownOpen((v) => !v)}
                                    style={{
                                        fontSize: 13,
                                        padding: '6px 32px 6px 12px',
                                        borderRadius: 6,
                                        border: '2px solid #d0d5dd',
                                        backgroundColor: '#fff',
                                        color: '#333',
                                        cursor: 'pointer',
                                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M3 5l3 3 3-3\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'/%3E%3C/svg%3E")',
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 10px center',
                                        minWidth: 180,
                                        textAlign: 'left',
                                    }}
                                >
                                    {selectedBlocs.length === 0
                                        ? `Tous (${blocOptions.length})`
                                        : `${selectedBlocs.length} selectionne${selectedBlocs.length > 1 ? 's' : ''}`}
                                </button>
                                {blocDropdownOpen && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: '100%',
                                            right: 0,
                                            marginTop: 4,
                                            backgroundColor: '#fff',
                                            border: '1px solid #d0d5dd',
                                            borderRadius: 6,
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                            zIndex: 50,
                                            minWidth: 200,
                                            maxHeight: 250,
                                            overflowY: 'auto',
                                        }}
                                    >
                                        <label
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                padding: '6px 12px',
                                                fontSize: 12,
                                                cursor: 'pointer',
                                                borderBottom: '1px solid #eee',
                                                fontWeight: 600,
                                                color: '#333',
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedBlocs.length === 0}
                                                onChange={() => setSelectedBlocs([])}
                                                style={{accentColor: '#3B82F6'}}
                                            />
                                            Tous
                                        </label>
                                        {blocOptions.map((name) => (
                                            <label
                                                key={name}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 8,
                                                    padding: '5px 12px',
                                                    fontSize: 12,
                                                    cursor: 'pointer',
                                                    color: '#444',
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedBlocs.includes(name)}
                                                    onChange={() => {
                                                        if (selectedBlocs.includes(name)) {
                                                            setSelectedBlocs(selectedBlocs.filter((v) => v !== name));
                                                        } else {
                                                            setSelectedBlocs([...selectedBlocs, name]);
                                                        }
                                                    }}
                                                    style={{accentColor: '#3B82F6'}}
                                                />
                                                {name}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <DualAxisChart
                title="Objectif de portée : Couverture / CPM"
                data={chartData}
                xKey="xLabel"
                leftKey="coverage"
                leftLabel="Couverture"
                leftColor="#93C5FD"
                rightKey="cpm"
                rightLabel="CPM ($)"
                rightColor="#1E40AF"
            />

            <DualAxisChart
                title="Objectif de traffic : Vues de page de destination / CPC"
                data={chartData}
                xKey="xLabel"
                leftKey="pageViews"
                leftLabel="Vues de page de destination"
                leftColor="#93C5FD"
                rightKey="cpc"
                rightLabel="CPC ($)"
                rightColor="#1E40AF"
            />

            <DualAxisChart
                title="Objectif d'engagement : Impressions / CTR"
                data={chartData}
                xKey="xLabel"
                leftKey="impressions"
                leftLabel="Impressions"
                leftColor="#93C5FD"
                rightKey="ctr"
                rightLabel="CTR (%)"
                rightColor="#1E40AF"
            />
        </div>
    );
}

initializeBlock({interface: () => <MultiAxisChartsApp />});
