import React, {useState, useMemo} from 'react';
import {
    initializeBlock,
    useBase,
    useRecords,
    useCustomProperties,
} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
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
            key: 'filterField',
            label: 'Champ filtre (dropdown UI)',
            type: 'field',
            table,
            shouldFieldBeAllowed: isTextField,
            defaultValue: table.fields.find((f) => f.name.toLowerCase().includes('campagne')) || textFields[0],
        },
        // Reach
        {
            key: 'coverageField',
            label: 'Couverture',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('couverture')) || numericFields[0],
        },
        {
            key: 'cpmField',
            label: 'CPM',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('cpm')) || numericFields[1],
        },
        // Traffic
        {
            key: 'pageViewsField',
            label: 'Vues page de destination',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('vue')) || numericFields[2],
        },
        {
            key: 'cpcField',
            label: 'CPC',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('cpc')) || numericFields[3],
        },
        // Engagement
        {
            key: 'impressionsField',
            label: 'Impressions',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('impression')) || numericFields[4],
        },
        {
            key: 'ctrField',
            label: 'CTR',
            type: 'field',
            table,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('ctr')) || numericFields[5],
        },
    ];
}

// --- Truncate long labels ---

function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
}

// --- Custom X-axis tick with truncation + tooltip on hover ---

function CustomXAxisTick({x, y, payload}) {
    const label = truncate(payload.value, 15);
    return (
        <g transform={`translate(${x},${y})`}>
            <title>{payload.value}</title>
            <text
                x={0}
                y={0}
                dy={8}
                textAnchor="end"
                fill="#666"
                fontSize={10}
                transform="rotate(-45)"
            >
                {label}
            </text>
        </g>
    );
}

// --- Dual Axis Chart Component ---

function DualAxisChart({title, data, xKey, leftKey, leftLabel, leftColor, rightKey, rightLabel, rightColor}) {
    if (!data || data.length === 0) {
        return (
            <div className="mb-10">
                <h3 className="text-base font-semibold mb-3 text-gray-gray700 dark:text-gray-gray200">
                    {title}
                </h3>
                <p className="text-sm text-gray-gray500">Aucune donnee pour ce graphique.</p>
            </div>
        );
    }

    // Filter data: only keep rows where at least one of the two metrics has a value > 0
    const filteredData = data.filter((d) => d[leftKey] > 0 || d[rightKey] > 0);

    if (filteredData.length === 0) {
        return (
            <div className="mb-10">
                <h3 className="text-base font-semibold mb-3 text-gray-gray700 dark:text-gray-gray200">
                    {title}
                </h3>
                <p className="text-sm text-gray-gray500">Aucune campagne avec des donnees pour ces metriques.</p>
            </div>
        );
    }

    return (
        <div className="mb-10 bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm">
            <h3 className="text-sm font-semibold mb-4 text-gray-gray700 dark:text-gray-gray200">
                {title}
            </h3>
            <div style={{width: '100%', height: 350}}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={filteredData} margin={{top: 10, right: 40, bottom: 80, left: 40}}>
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
                            domain={['auto', 'auto']}
                            padding={{top: 20, bottom: 10}}
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
                            domain={['auto', 'auto']}
                            padding={{top: 20, bottom: 10}}
                            label={{
                                value: rightLabel,
                                angle: 90,
                                position: 'insideRight',
                                offset: -25,
                                style: {fontSize: 11, fill: rightColor, fontWeight: 600},
                            }}
                        />
                        <Tooltip
                            contentStyle={{
                                fontSize: 12,
                                borderRadius: 8,
                                border: '1px solid #e0e0e0',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            }}
                            formatter={(value, name) => {
                                if (typeof value === 'number') {
                                    return [value.toLocaleString('fr-FR', {maximumFractionDigits: 2}), name];
                                }
                                return [value, name];
                            }}
                        />
                        <Legend
                            wrapperStyle={{fontSize: 11, paddingTop: 8}}
                        />
                        <Bar
                            yAxisId="left"
                            dataKey={leftKey}
                            name={leftLabel}
                            fill={leftColor}
                            opacity={0.85}
                            radius={[3, 3, 0, 0]}
                            barSize={Math.max(12, Math.min(40, 600 / filteredData.length))}
                        />
                        <Line
                            yAxisId="right"
                            dataKey={rightKey}
                            name={rightLabel}
                            stroke={rightColor}
                            strokeWidth={2.5}
                            dot={{r: 4, fill: rightColor, strokeWidth: 2, stroke: '#fff'}}
                            activeDot={{r: 6}}
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
    const filterField = customPropertyValueByKey.filterField;
    const coverageField = customPropertyValueByKey.coverageField;
    const cpmField = customPropertyValueByKey.cpmField;
    const pageViewsField = customPropertyValueByKey.pageViewsField;
    const cpcField = customPropertyValueByKey.cpcField;
    const impressionsField = customPropertyValueByKey.impressionsField;
    const ctrField = customPropertyValueByKey.ctrField;

    const [selectedFilter, setSelectedFilter] = useState('__all__');

    // Extract unique values from the filter field (supports linked records, single select, and other types)
    const filterOptions = useMemo(() => {
        if (!filterField || !records) return [];
        const seen = new Set();
        const options = [];
        for (const record of records) {
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
    }, [filterField, records]);

    // Filter records based on selected dropdown value
    const filteredRecords = useMemo(() => {
        if (!records) return [];
        if (selectedFilter === '__all__' || !filterField) return records;
        return records.filter((record) => {
            const cellValue = record.getCellValue(filterField);
            if (Array.isArray(cellValue)) {
                return cellValue.some((link) => link.name === selectedFilter);
            }
            if (cellValue && typeof cellValue === 'object' && cellValue.name) {
                return cellValue.name === selectedFilter;
            }
            return record.getCellValueAsString(filterField) === selectedFilter;
        });
    }, [records, selectedFilter, filterField]);

    if (errorState) {
        return (
            <div className="p-6 text-center text-red-red dark:text-red-redLight1">
                Erreur de configuration : {errorState.message || 'Erreur inconnue'}
            </div>
        );
    }

    const allConfigured = campaignField && coverageField && cpmField &&
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

    const getValue = (record, field) => {
        if (!field) return 0;
        const val = record.getCellValue(field);
        return typeof val === 'number' ? val : parseFloat(String(val)) || 0;
    };

    const chartData = filteredRecords.map((record) => ({
        campaign: campaignField ? record.getCellValueAsString(campaignField) : '',
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

                {filterField && filterOptions.length > 0 && (
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-gray600 dark:text-gray-gray300">
                            {filterField.name} :
                        </span>
                        <select
                            value={selectedFilter}
                            onChange={(e) => setSelectedFilter(e.target.value)}
                            style={{
                                fontSize: 13,
                                padding: '6px 32px 6px 12px',
                                borderRadius: 6,
                                border: '2px solid #d0d5dd',
                                backgroundColor: '#fff',
                                color: '#333',
                                cursor: 'pointer',
                                appearance: 'none',
                                backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M3 5l3 3 3-3\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'/%3E%3C/svg%3E")',
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'right 10px center',
                                minWidth: 180,
                            }}
                        >
                            <option value="__all__">Tous ({filterOptions.length})</option>
                            {filterOptions.map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            <DualAxisChart
                title="Objectif de portee : Couverture / CPM"
                data={chartData}
                xKey="campaign"
                leftKey="coverage"
                leftLabel="Couverture"
                leftColor="#4a90d9"
                rightKey="cpm"
                rightLabel="CPM"
                rightColor="#e06666"
            />

            <DualAxisChart
                title="Objectif de traffic : Vues page destination / CPC"
                data={chartData}
                xKey="campaign"
                leftKey="pageViews"
                leftLabel="Vues page destination"
                leftColor="#6aa84f"
                rightKey="cpc"
                rightLabel="CPC"
                rightColor="#f6b26b"
            />

            <DualAxisChart
                title="Objectif d'engagement : Impressions / CTR"
                data={chartData}
                xKey="campaign"
                leftKey="impressions"
                leftLabel="Impressions"
                leftColor="#8e7cc3"
                rightKey="ctr"
                rightLabel="CTR"
                rightColor="#c27ba0"
            />
        </div>
    );
}

initializeBlock({interface: () => <MultiAxisChartsApp />});
