import React, {useState, useMemo, useEffect, useRef} from 'react';
import {
    initializeBlock,
    useBase,
    useRecords,
    useCustomProperties,
    expandRecord,
} from '@airtable/blocks/interface/ui';
import {FieldType} from '@airtable/blocks/interface/models';
import {
    ComposedChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';
import './style.css';

// --- Helper: format ISO timestamp to "15 fev" ---

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'avr', 'mai', 'jun', 'jul', 'aou', 'sep', 'oct', 'nov', 'dec'];

function formatDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    if (isNaN(d)) return isoDate;
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

// --- Custom Properties Definition ---

function getCustomProperties(base) {
    const tables = base.tables;
    const spectaclesTable = tables.find((t) => t.name.toLowerCase().includes('spectacle')) || tables[0];
    const repsTable = tables.find((t) => t.name.toLowerCase().includes('repr')) || tables[1] || tables[0];

    const isLinkField = (field) =>
        field.config.type === FieldType.MULTIPLE_RECORD_LINKS;

    const isAttachmentField = (field) =>
        field.config.type === FieldType.MULTIPLE_ATTACHMENTS;

    const isNumericField = (field) =>
        field.config.type === FieldType.NUMBER ||
        field.config.type === FieldType.CURRENCY ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.COUNT ||
        field.config.type === FieldType.PERCENT ||
        field.config.type === FieldType.MULTIPLE_LOOKUP_VALUES;

    const isTextField = (field) =>
        field.config.type === FieldType.SINGLE_LINE_TEXT ||
        field.config.type === FieldType.SINGLE_SELECT ||
        field.config.type === FieldType.FORMULA ||
        field.config.type === FieldType.MULTIPLE_RECORD_LINKS ||
        field.config.type === FieldType.ROLLUP ||
        field.config.type === FieldType.AUTO_NUMBER ||
        field.config.type === FieldType.DATE ||
        field.config.type === FieldType.DATE_TIME;

    const isAnyField = () => true;

    const linkFields = repsTable.fields.filter(isLinkField);
    const attachmentFields = spectaclesTable.fields.filter(isAttachmentField);
    const numericFields = repsTable.fields.filter(isNumericField);
    const textFields = repsTable.fields.filter(isTextField);

    // Numeric fields from Spectacles table for KPIs
    const specNumericFields = spectaclesTable.fields.filter(isNumericField);

    // Smart defaults for table columns
    const findRepField = (keyword) =>
        repsTable.fields.find((f) => f.name.toLowerCase().includes(keyword));

    return [
        {
            key: 'spectaclesTable',
            label: 'Table des spectacles',
            type: 'table',
            defaultValue: spectaclesTable,
        },
        {
            key: 'imageField',
            label: 'Champ image (dans Spectacles)',
            type: 'field',
            table: spectaclesTable,
            shouldFieldBeAllowed: isAttachmentField,
            defaultValue: attachmentFields[0],
        },
        {
            key: 'representationsTable',
            label: 'Table des representations',
            type: 'table',
            defaultValue: repsTable,
        },
        {
            key: 'spectacleLinkField',
            label: 'Champ lien Spectacle (dans Representations)',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isLinkField,
            defaultValue: linkFields.find((f) => f.name.toLowerCase().includes('spectacle')) || linkFields[0],
        },
        {
            key: 'repNameField',
            label: 'Champ nom/date de la representation',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isTextField,
            defaultValue: textFields[0],
        },
        {
            key: 'capacityField',
            label: 'Champ Capacite totale (dans Representations)',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('capacit')) || numericFields[0],
        },
        {
            key: 'revenuePotentialField',
            label: 'Champ Potentiel en salle (dans Representations)',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: numericFields.find((f) => f.name.toLowerCase().includes('potentiel')) || numericFields.find((f) => f.name.toLowerCase().includes('revenu')),
        },
        // --- Table columns (Representations) ---
        {
            key: 'colJoursRestants',
            label: 'Colonne: Jours restants',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isAnyField,
            defaultValue: findRepField('jour') || findRepField('restant'),
        },
        {
            key: 'colDateRep',
            label: 'Colonne: Date representation',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isAnyField,
            defaultValue: findRepField('date'),
        },
        {
            key: 'colSalle',
            label: 'Colonne: Salle',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isAnyField,
            defaultValue: findRepField('salle'),
        },
        {
            key: 'colVille',
            label: 'Colonne: Ville',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isAnyField,
            defaultValue: findRepField('ville'),
        },
        {
            key: 'colPlacesBloques',
            label: 'Colonne: Places bloquees',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isAnyField,
            defaultValue: findRepField('bloqu'),
        },
        {
            key: 'colBilletsDispo',
            label: 'Colonne: Billets disponibles',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isAnyField,
            defaultValue: findRepField('disponib') || findRepField('billet'),
        },
        // --- KPIs (Spectacles) ---
        {
            key: 'kpiField1',
            label: 'KPI 1 (dans Spectacles)',
            type: 'field',
            table: spectaclesTable,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: specNumericFields[0],
        },
        {
            key: 'kpiField2',
            label: 'KPI 2 (dans Spectacles)',
            type: 'field',
            table: spectaclesTable,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: specNumericFields[1],
        },
        {
            key: 'kpiField3',
            label: 'KPI 3 (dans Spectacles)',
            type: 'field',
            table: spectaclesTable,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: specNumericFields[2],
        },
        {
            key: 'kpiField4',
            label: 'KPI 4 (dans Spectacles)',
            type: 'field',
            table: spectaclesTable,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: specNumericFields[3],
        },
        {
            key: 'kpiField5',
            label: 'KPI 5 (dans Spectacles)',
            type: 'field',
            table: spectaclesTable,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: specNumericFields[4],
        },
        {
            key: 'kpiField6',
            label: 'KPI 6 (dans Spectacles)',
            type: 'field',
            table: spectaclesTable,
            shouldFieldBeAllowed: isNumericField,
            defaultValue: specNumericFields[5],
        },
        // --- Filter ---
        {
            key: 'filterStatusField',
            label: 'Filtre: Champ Statut (dans Representations)',
            type: 'field',
            table: repsTable,
            shouldFieldBeAllowed: isAnyField,
            defaultValue: findRepField('statut') || findRepField('status'),
        },
        // --- Supabase ---
        {
            key: 'supabaseUrl',
            label: 'Supabase URL (ex: https://xyz.supabase.co)',
            type: 'string',
            defaultValue: '',
        },
        {
            key: 'supabaseAnonKey',
            label: 'Supabase Anon Key',
            type: 'string',
            defaultValue: '',
        },
    ];
}

// --- Custom X-axis tick with rotation ---

function CustomXAxisTick({x, y, payload}) {
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
                {payload.value}
            </text>
        </g>
    );
}

// --- Sales Chart Component ---

function SalesChart({data, capacity, revenueCapacity, height = 500}) {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-48">
                <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
                    Aucune donnee de ventes pour cette representation.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm">
            <div style={{width: '100%', height}}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{top: 10, right: 40, bottom: 5, left: 40}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" vertical={false} />
                        <XAxis
                            dataKey="dateLabel"
                            tick={<CustomXAxisTick />}
                            interval="preserveStartEnd"
                            height={50}
                        />
                        <YAxis
                            yAxisId="left"
                            orientation="left"
                            stroke="#4a90d9"
                            tick={{fontSize: 10}}
                            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
                            domain={[0, capacity || 'auto']}
                            padding={{top: 20, bottom: 10}}
                            label={{
                                value: 'Billets',
                                angle: -90,
                                position: 'insideLeft',
                                offset: -25,
                                style: {fontSize: 11, fill: '#4a90d9', fontWeight: 600},
                            }}
                        />
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            stroke="#6aa84f"
                            tick={{fontSize: 10}}
                            tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} $`}
                            domain={[0, revenueCapacity || 'auto']}
                            padding={{top: 20, bottom: 10}}
                            label={{
                                value: 'Revenus ($)',
                                angle: 90,
                                position: 'insideRight',
                                offset: -25,
                                style: {fontSize: 11, fill: '#6aa84f', fontWeight: 600},
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
                                if (name === 'Revenus ($)') {
                                    return [`${value.toLocaleString('fr-FR', {maximumFractionDigits: 2})} $`, name];
                                }
                                return [value.toLocaleString('fr-FR'), name];
                            }}
                        />
                        <Legend wrapperStyle={{fontSize: 11, paddingTop: 8}} />
                        <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="ventes"
                            name="Ventes"
                            stroke="#4a90d9"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{r: 4}}
                        />
                        <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="gratuits"
                            name="Gratuits"
                            stroke="#e06666"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{r: 4}}
                            strokeDasharray="5 5"
                        />
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="total_dollars"
                            name="Revenus ($)"
                            stroke="#6aa84f"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{r: 4}}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// --- Gallery Card ---

function SpectacleCard({name, imageUrl, onClick}) {
    return (
        <div
            onClick={onClick}
            className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm overflow-hidden cursor-pointer
                       hover:shadow-md transition-shadow duration-200 border border-gray-gray100 dark:border-gray-gray600"
        >
            <div
                className="w-full bg-gray-gray75 dark:bg-gray-gray800"
                style={{height: 160, overflow: 'hidden'}}
            >
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={name}
                        style={{width: '100%', height: '100%', objectFit: 'cover'}}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-gray300 dark:text-gray-gray500">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="M21 15l-5-5L5 21" />
                        </svg>
                    </div>
                )}
            </div>
            <div className="p-3">
                <p className="text-sm font-semibold text-gray-gray700 dark:text-gray-gray200 truncate">
                    {name}
                </p>
            </div>
        </div>
    );
}

// --- Detail Page ---

function DetailPage({spectacle, representations, spectacleKPIs, supabaseUrl, supabaseAnonKey, baseId, onBack, repRecords}) {
    const [selectedRepId, setSelectedRepId] = useState(null);
    const [salesData, setSalesData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showAll, setShowAll] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const cacheRef = useRef(new Map());

    // Stable string of all rep IDs for cache key + useEffect dependency
    const allRepIds = useMemo(() =>
        representations.map((r) => r.id).join(','),
        [representations]
    );

    // Default filters: future dates only + exclude cancelled
    const filteredReps = useMemo(() => {
        if (showAll) return representations;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return representations.filter((rep) => {
            if (rep.rawDate && rep.rawDate < today) return false;
            if (rep.rawStatus && rep.rawStatus.toLowerCase().includes('annul')) return false;
            return true;
        });
    }, [representations, showAll]);

    // Fetch sales data from Supabase (total or individual)
    useEffect(() => {
        if (!supabaseUrl || !supabaseAnonKey) {
            setSalesData([]);
            setLoading(false);
            setError(null);
            return;
        }

        const isAllMode = !selectedRepId;
        if (isAllMode && !allRepIds) {
            setSalesData([]);
            return;
        }

        const cacheKey = isAllMode ? `all_${allRepIds}` : selectedRepId;
        let didCancel = false;

        const fetchSales = async () => {
            if (cacheRef.current.has(cacheKey)) {
                if (!didCancel) {
                    setSalesData(cacheRef.current.get(cacheKey));
                    setLoading(false);
                }
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const filter = isAllMode
                    ? `record_id=in.(${allRepIds})`
                    : `record_id=eq.${selectedRepId}`;

                const baseUrl = `${supabaseUrl}/rest/v1/sales_report`
                    + `?base_id=eq.${baseId}`
                    + `&${filter}`
                    + `&order=date.asc`
                    + `&select=record_id,date,sold,free,total`;

                // Paginate to fetch all rows (Supabase caps at 1000 per request)
                let data = [];
                let offset = 0;
                const pageSize = 1000;
                while (true) {
                    const response = await fetch(baseUrl + `&limit=${pageSize}&offset=${offset}`, {
                        headers: {
                            'apikey': supabaseAnonKey,
                            'Authorization': `Bearer ${supabaseAnonKey}`,
                            'Content-Type': 'application/json',
                        },
                    });

                    if (!response.ok) {
                        throw new Error(`Erreur Supabase: ${response.status} ${response.statusText}`);
                    }

                    const page = await response.json();
                    data = data.concat(page);
                    if (page.length < pageSize) break;
                    offset += pageSize;
                    if (didCancel) return;
                }

                if (!didCancel) {
                    let formatted;
                    if (isAllMode) {
                        // Group rows by record_id, keyed by date
                        const byRecord = {};
                        const allDatesSet = new Set();
                        data.forEach((row) => {
                            const rid = row.record_id;
                            const day = row.date ? row.date.split('T')[0] : row.date;
                            allDatesSet.add(day);
                            if (!byRecord[rid]) byRecord[rid] = {};
                            byRecord[rid][day] = {
                                sold: row.sold || 0,
                                free: row.free || 0,
                                total: parseFloat(row.total) || 0,
                            };
                        });

                        const sortedDates = [...allDatesSet].sort();
                        const recordIds = Object.keys(byRecord);

                        // Fill every calendar day; carry-forward per record
                        // Cumulative data: values never decrease (use Math.max)
                        const start = new Date(sortedDates[0]);
                        const end = new Date(sortedDates[sortedDates.length - 1]);
                        const lastKnown = {};
                        formatted = [];
                        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                            const day = d.toISOString().split('T')[0];
                            let sumSold = 0, sumFree = 0, sumTotal = 0;
                            for (const rid of recordIds) {
                                if (byRecord[rid] && byRecord[rid][day]) {
                                    const entry = byRecord[rid][day];
                                    if (!lastKnown[rid]) lastKnown[rid] = {sold: 0, free: 0, total: 0};
                                    lastKnown[rid].sold = Math.max(lastKnown[rid].sold, entry.sold);
                                    lastKnown[rid].free = Math.max(lastKnown[rid].free, entry.free);
                                    lastKnown[rid].total = Math.max(lastKnown[rid].total, entry.total);
                                }
                                if (lastKnown[rid]) {
                                    sumSold += lastKnown[rid].sold;
                                    sumFree += lastKnown[rid].free;
                                    sumTotal += lastKnown[rid].total;
                                }
                            }
                            formatted.push({
                                date: day,
                                dateLabel: formatDate(day),
                                ventes: sumSold,
                                gratuits: sumFree,
                                total_dollars: sumTotal,
                            });
                        }
                    } else {
                        // Index raw data by date
                        const byDay = {};
                        data.forEach((row) => {
                            const day = row.date ? row.date.split('T')[0] : row.date;
                            byDay[day] = {
                                sold: row.sold || 0,
                                free: row.free || 0,
                                total: parseFloat(row.total) || 0,
                            };
                        });
                        const days = Object.keys(byDay).sort();
                        if (days.length > 0) {
                            // Fill every calendar day; cumulative: never decrease
                            const start = new Date(days[0]);
                            const end = new Date(days[days.length - 1]);
                            let last = {sold: 0, free: 0, total: 0};
                            formatted = [];
                            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                                const key = d.toISOString().split('T')[0];
                                if (byDay[key]) {
                                    last.sold = Math.max(last.sold, byDay[key].sold);
                                    last.free = Math.max(last.free, byDay[key].free);
                                    last.total = Math.max(last.total, byDay[key].total);
                                }
                                formatted.push({
                                    date: key,
                                    dateLabel: formatDate(key),
                                    ventes: last.sold,
                                    gratuits: last.free,
                                    total_dollars: last.total,
                                });
                            }
                        } else {
                            formatted = [];
                        }
                    }

                    cacheRef.current.set(cacheKey, formatted);
                    setSalesData(formatted);
                    setLoading(false);
                }
            } catch (err) {
                if (!didCancel) {
                    setError(err.message);
                    setLoading(false);
                }
            }
        };

        fetchSales();

        return () => {
            didCancel = true;
        };
    }, [selectedRepId, supabaseUrl, supabaseAnonKey, baseId, allRepIds]);

    // Filter salesData by date range
    const filteredSalesData = useMemo(() => {
        if (!salesData.length) return salesData;
        let data = salesData;
        if (dateFrom) data = data.filter((d) => d.date >= dateFrom);
        if (dateTo) data = data.filter((d) => d.date <= dateTo);
        return data;
    }, [salesData, dateFrom, dateTo]);

    // Period stats: delta between first and last point in filtered range
    const periodStats = useMemo(() => {
        if (filteredSalesData.length < 1) return null;
        const first = filteredSalesData[0];
        const last = filteredSalesData[filteredSalesData.length - 1];
        const baseIndex = salesData.indexOf(first);
        const base = baseIndex > 0 ? salesData[baseIndex - 1] : {ventes: 0, gratuits: 0, total_dollars: 0};
        return {
            ventesInPeriod: last.ventes - base.ventes,
            revenusInPeriod: last.total_dollars - base.total_dollars,
        };
    }, [filteredSalesData, salesData]);

    // Fixed KPIs: Ventes and Revenus (always shown, context-dependent values)
    const hasFilter = !!(dateFrom || dateTo);
    const fixedKPIs = useMemo(() => {
        if (salesData.length === 0) return [{value: '\u2014', label: 'Billets vendus'}, {value: '\u2014', label: 'Revenus'}];
        const last = filteredSalesData.length > 0 ? filteredSalesData[filteredSalesData.length - 1] : salesData[salesData.length - 1];
        if (hasFilter && periodStats) {
            return [
                {
                    value: `+${periodStats.ventesInPeriod.toLocaleString('fr-FR')}`,
                    label: 'Billets vendus (période)',
                },
                {
                    value: `+${periodStats.revenusInPeriod.toLocaleString('fr-FR', {maximumFractionDigits: 0})} $`,
                    label: 'Revenus (période)',
                },
            ];
        }
        return [
            {
                value: last.ventes.toLocaleString('fr-FR'),
                label: 'Billets vendus',
            },
            {
                value: `${last.total_dollars.toLocaleString('fr-FR', {maximumFractionDigits: 0})} $`,
                label: 'Revenus',
            },
        ];
    }, [salesData, filteredSalesData, hasFilter, periodStats]);

    // Preset helper
    const setPreset = (preset) => {
        const now = new Date();
        if (preset === 'all') {
            setDateFrom('');
            setDateTo('');
        } else if (preset === 'ytd') {
            setDateFrom(`${now.getFullYear()}-01-01`);
            setDateTo('');
        } else {
            const from = new Date(now);
            from.setMonth(from.getMonth() - preset);
            setDateFrom(from.toISOString().split('T')[0]);
            setDateTo('');
        }
    };

    const activePreset = useMemo(() => {
        if (!dateFrom && !dateTo) return 'all';
        const now = new Date();
        const ytdStart = `${now.getFullYear()}-01-01`;
        if (dateFrom === ytdStart && !dateTo) return 'ytd';
        for (const m of [3, 6, 12]) {
            const from = new Date(now);
            from.setMonth(from.getMonth() - m);
            if (dateFrom === from.toISOString().split('T')[0] && !dateTo) return m;
        }
        return null;
    }, [dateFrom, dateTo]);

    // Build chart content based on current state
    const chartContent = (() => {
        const placeholderClass = 'bg-white dark:bg-gray-gray700 rounded-lg p-4 shadow-sm flex items-center justify-center h-full';

        if (loading) {
            return (
                <div className={placeholderClass}>
                    <div className="flex items-center space-x-3 text-gray-gray500">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-blue"></div>
                        <span className="text-sm">Chargement...</span>
                    </div>
                </div>
            );
        }
        if (error) {
            return (
                <div className={placeholderClass}>
                    <p className="text-sm text-red-red dark:text-red-redLight1">{error}</p>
                </div>
            );
        }
        if (salesData.length === 0) {
            return (
                <div className={placeholderClass}>
                    <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
                        Aucune donnee de ventes.
                    </p>
                </div>
            );
        }

        const isAllMode = !selectedRepId;
        const selectedRep = isAllMode ? null : filteredReps.find((r) => r.id === selectedRepId);
        const presets = [
            {key: 3, label: '3m'},
            {key: 6, label: '6m'},
            {key: 12, label: '1an'},
            {key: 'ytd', label: 'YTD'},
            {key: 'all', label: 'Tout'},
        ];
        const btnBase = 'px-2 py-0.5 rounded text-xs font-medium transition-colors';
        const btnActive = 'bg-blue-blue text-white';
        const btnInactive = 'bg-gray-gray100 dark:bg-gray-gray600 text-gray-gray600 dark:text-gray-gray300 hover:bg-gray-gray200 dark:hover:bg-gray-gray500';
        const inputStyle = {
            fontSize: 11,
            padding: '2px 6px',
            borderRadius: 4,
            border: '1px solid #d0d5dd',
            backgroundColor: '#fff',
            color: '#333',
            width: 120,
        };

        return (
            <div>
                {/* Date filter bar */}
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-1">
                        {presets.map((p) => (
                            <button
                                key={p.key}
                                onClick={() => setPreset(p.key)}
                                className={`${btnBase} ${activePreset === p.key ? btnActive : btnInactive}`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            style={inputStyle}
                        />
                        <span className="text-xs text-gray-gray400">—</span>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            style={inputStyle}
                        />
                    </div>
                </div>

                {/* Mode label / back to total */}
                {isAllMode ? (
                    <p className="text-xs text-gray-gray500 dark:text-gray-gray400 mb-1 text-center font-medium">
                        Total — toutes representations
                    </p>
                ) : (
                    <button
                        onClick={() => setSelectedRepId(null)}
                        className="flex items-center gap-1 text-xs font-medium text-blue-blue hover:text-blue-blueDark1
                                   dark:text-blue-blueLight1 dark:hover:text-blue-blueLight2 transition-colors mb-1 mx-auto"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                        Voir le total du spectacle
                    </button>
                )}
                <SalesChart data={filteredSalesData} capacity={selectedRep ? selectedRep.capacity : null} revenueCapacity={selectedRep ? selectedRep.revenuePotential : null} height={isAllMode ? 320 : 330} />
            </div>
        );
    })();

    return (
        <div className="p-4 sm:p-6 min-h-screen bg-gray-gray50 dark:bg-gray-gray800 overflow-auto">
            {/* Back button + title */}
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
                    {spectacle.name}
                </h2>
            </div>

            {/* Top section: Chart (60%) + KPIs (40%) */}
            <div className="flex gap-5 mb-6" style={{minHeight: 400}}>
                {/* Chart - left 60% */}
                <div style={{width: '60%'}}>
                    {chartContent}
                </div>

                {/* KPIs - right 40% */}
                <div style={{width: '40%'}}>
                    <div
                        className="grid grid-cols-2 gap-3 h-full"
                        style={{gridTemplateRows: 'repeat(4, 1fr)'}}
                    >
                        {/* Fixed KPIs: Ventes + Revenus */}
                        {fixedKPIs.map((kpi, i) => (
                            <div
                                key={`fixed-${i}`}
                                className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100
                                           dark:border-gray-gray600 flex flex-col justify-center items-center p-4"
                                style={hasFilter ? {borderColor: i === 0 ? '#3b82f6' : '#4a7a33', borderWidth: 2} : {}}
                            >
                                <p
                                    className={`font-bold font-display ${!hasFilter ? 'text-gray-gray800 dark:text-gray-gray100' : ''}`}
                                    style={{
                                        fontSize: '1.75rem',
                                        lineHeight: 1.1,
                                        color: hasFilter ? (i === 0 ? '#2563eb' : '#4a7a33') : undefined,
                                    }}
                                >
                                    {kpi.value}
                                </p>
                                <p className="text-xs text-gray-gray500 dark:text-gray-gray400 mt-3 text-center leading-tight font-medium uppercase tracking-wide" style={{fontSize: '0.6rem'}}>
                                    {kpi.label}
                                </p>
                            </div>
                        ))}
                        {/* Configurable KPIs */}
                        {spectacleKPIs.map((kpi, i) => (
                            <div
                                key={i}
                                className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100
                                           dark:border-gray-gray600 flex flex-col justify-center items-center p-4"
                            >
                                <p className="font-bold text-gray-gray800 dark:text-gray-gray100 font-display" style={{fontSize: '1.75rem', lineHeight: 1.1}}>
                                    {kpi.value || '\u2014'}
                                </p>
                                <p className="text-xs text-gray-gray500 dark:text-gray-gray400 mt-3 text-center leading-tight font-medium uppercase tracking-wide" style={{fontSize: '0.6rem'}}>
                                    {kpi.label}
                                </p>
                            </div>
                        ))}
                        {/* Fill empty slots if fewer than 6 configurable KPIs */}
                        {Array.from({length: Math.max(0, 6 - spectacleKPIs.length)}).map((_, i) => (
                            <div
                                key={`empty-${i}`}
                                className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm border border-gray-gray100
                                           dark:border-gray-gray600 flex flex-col justify-center items-center p-4 opacity-30"
                            >
                                <p className="text-2xl font-bold text-gray-gray300">{'\u2014'}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Representations table */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-gray600 dark:text-gray-gray300">
                        Representations ({filteredReps.length}{filteredReps.length !== representations.length ? ` / ${representations.length}` : ''})
                    </h3>
                    <label className="flex items-center gap-2 text-xs text-gray-gray500 dark:text-gray-gray400 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={showAll}
                            onChange={(e) => setShowAll(e.target.checked)}
                            className="rounded"
                        />
                        Afficher tout
                    </label>
                </div>
                <div className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm overflow-hidden border border-gray-gray100 dark:border-gray-gray600">
                    <div style={{overflowX: 'auto'}}>
                        <table className="w-full text-sm" style={{minWidth: 700}}>
                            <thead>
                                <tr className="bg-gray-gray75 dark:bg-gray-gray800 text-gray-gray600 dark:text-gray-gray300 text-left text-xs">
                                    <th className="px-3 py-2 font-semibold">J. restants</th>
                                    <th className="px-3 py-2 font-semibold">Date</th>
                                    <th className="px-3 py-2 font-semibold">Salle</th>
                                    <th className="px-3 py-2 font-semibold">Ville</th>
                                    <th className="px-3 py-2 font-semibold text-right">Capacite</th>
                                    <th className="px-3 py-2 font-semibold text-right">Places bloq.</th>
                                    <th className="px-3 py-2 font-semibold text-right">Billets dispo</th>
                                    <th className="px-3 py-2 w-8"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredReps.map((rep) => (
                                    <tr
                                        key={rep.id}
                                        onClick={() => setSelectedRepId(rep.id)}
                                        className={`cursor-pointer border-t border-gray-gray100 dark:border-gray-gray600 transition-colors
                                            ${rep.id === selectedRepId
                                                ? 'bg-blue-blueLight3 dark:bg-blue-blueDark1 font-medium'
                                                : 'hover:bg-gray-gray25 dark:hover:bg-gray-gray600'
                                            }`}
                                    >
                                        <td className="px-3 py-2">{rep.colJoursRestants}</td>
                                        <td className="px-3 py-2">{rep.colDateRep}</td>
                                        <td className="px-3 py-2">{rep.colSalle}</td>
                                        <td className="px-3 py-2">{rep.colVille}</td>
                                        <td className="px-3 py-2 text-right">{rep.colCapacite}</td>
                                        <td className="px-3 py-2 text-right">{rep.colPlacesBloques}</td>
                                        <td className="px-3 py-2 text-right">{rep.colBilletsDispo}</td>
                                        <td className="px-3 py-2 text-center">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const record = repRecords && repRecords.find((r) => r.id === rep.id);
                                                    if (record) expandRecord(record);
                                                }}
                                                className="text-gray-gray400 hover:text-blue-blue dark:hover:text-blue-blueLight1 transition-colors"
                                                title="Ouvrir le detail"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                                    <polyline points="15 3 21 3 21 9" />
                                                    <line x1="10" y1="14" x2="21" y2="3" />
                                                </svg>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {filteredReps.length === 0 && (
                        <div className="flex items-center justify-center py-8">
                            <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
                                Aucune representation trouvee.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// --- Main App ---

function SalesChartApp() {
    const base = useBase();
    const {customPropertyValueByKey, errorState} = useCustomProperties(getCustomProperties);

    const spectaclesTable = customPropertyValueByKey.spectaclesTable;
    const imageField = customPropertyValueByKey.imageField;
    const repsTable = customPropertyValueByKey.representationsTable;
    const spectacleLinkField = customPropertyValueByKey.spectacleLinkField;
    const repNameField = customPropertyValueByKey.repNameField;
    const capacityField = customPropertyValueByKey.capacityField;
    const revenuePotentialField = customPropertyValueByKey.revenuePotentialField;
    const colJoursRestants = customPropertyValueByKey.colJoursRestants;
    const colDateRep = customPropertyValueByKey.colDateRep;
    const colSalle = customPropertyValueByKey.colSalle;
    const colVille = customPropertyValueByKey.colVille;
    const colPlacesBloques = customPropertyValueByKey.colPlacesBloques;
    const colBilletsDispo = customPropertyValueByKey.colBilletsDispo;
    const kpiField1 = customPropertyValueByKey.kpiField1;
    const kpiField2 = customPropertyValueByKey.kpiField2;
    const kpiField3 = customPropertyValueByKey.kpiField3;
    const kpiField4 = customPropertyValueByKey.kpiField4;
    const kpiField5 = customPropertyValueByKey.kpiField5;
    const kpiField6 = customPropertyValueByKey.kpiField6;
    const filterStatusField = customPropertyValueByKey.filterStatusField;
    const supabaseUrl = customPropertyValueByKey.supabaseUrl;
    const supabaseAnonKey = customPropertyValueByKey.supabaseAnonKey;

    const spectacleRecords = useRecords(spectaclesTable);
    const repRecords = useRecords(repsTable);

    const [selectedSpectacleId, setSelectedSpectacleId] = useState(null);
    const [search, setSearch] = useState('');

    // Get KPI data for selected spectacle from configured fields
    const kpiFields = useMemo(() =>
        [kpiField1, kpiField2, kpiField3, kpiField4, kpiField5, kpiField6].filter(Boolean),
        [kpiField1, kpiField2, kpiField3, kpiField4, kpiField5, kpiField6]
    );

    const spectacleKPIs = useMemo(() => {
        if (!selectedSpectacleId || !spectacleRecords || kpiFields.length === 0) return [];
        const record = spectacleRecords.find((r) => r.id === selectedSpectacleId);
        if (!record) return [];
        return kpiFields.map((field) => ({
            label: field.name,
            value: record.getCellValueAsString(field),
        }));
    }, [selectedSpectacleId, spectacleRecords, kpiFields]);

    // Build spectacle data with images
    const spectacles = useMemo(() => {
        if (!spectacleRecords) return [];
        return spectacleRecords
            .map((record) => {
                let imageUrl = null;
                if (imageField) {
                    const attachments = record.getCellValue(imageField);
                    if (Array.isArray(attachments) && attachments.length > 0) {
                        const thumb = attachments[0].thumbnails;
                        imageUrl = (thumb && thumb.large && thumb.large.url) || attachments[0].url;
                    }
                }
                return {
                    id: record.id,
                    name: record.name || '',
                    imageUrl,
                };
            })
            .filter((s) => s.name)
            .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }, [spectacleRecords, imageField]);

    // Filter spectacles by search
    const filteredSpectacles = useMemo(() => {
        if (!search) return spectacles;
        const lower = search.toLowerCase();
        return spectacles.filter((s) => s.name.toLowerCase().includes(lower));
    }, [spectacles, search]);

    // Get representations for selected spectacle (with table column values)
    const representations = useMemo(() => {
        if (!repRecords || !selectedSpectacleId || !spectacleLinkField) return [];

        const getCol = (record, field) => field ? record.getCellValueAsString(field) : '';

        return repRecords
            .filter((record) => {
                const linkValue = record.getCellValue(spectacleLinkField);
                if (!Array.isArray(linkValue)) return false;
                return linkValue.some((link) => link.id === selectedSpectacleId);
            })
            .map((record) => {
                let cap = null;
                if (capacityField) {
                    const val = record.getCellValue(capacityField);
                    cap = typeof val === 'number' ? val : parseFloat(String(val)) || null;
                }
                let revPotential = null;
                if (revenuePotentialField) {
                    const val = record.getCellValue(revenuePotentialField);
                    revPotential = typeof val === 'number' ? val : parseFloat(String(val)) || null;
                }
                // Raw values for filtering/sorting
                let rawDate = null;
                if (colDateRep) {
                    const dv = record.getCellValue(colDateRep);
                    if (dv) rawDate = new Date(dv);
                }
                const rawStatus = filterStatusField ? record.getCellValueAsString(filterStatusField) : '';

                return {
                    id: record.id,
                    name: repNameField ? record.getCellValueAsString(repNameField) : record.name,
                    capacity: cap,
                    revenuePotential: revPotential,
                    rawDate,
                    rawStatus,
                    colJoursRestants: getCol(record, colJoursRestants),
                    colDateRep: getCol(record, colDateRep),
                    colSalle: getCol(record, colSalle),
                    colVille: getCol(record, colVille),
                    colCapacite: getCol(record, capacityField),
                    colPlacesBloques: getCol(record, colPlacesBloques),
                    colBilletsDispo: getCol(record, colBilletsDispo),
                };
            })
            .filter((r) => r.name)
            .sort((a, b) => {
                if (a.rawDate && b.rawDate) return a.rawDate - b.rawDate;
                if (a.rawDate) return -1;
                if (b.rawDate) return 1;
                return a.name.localeCompare(b.name, 'fr');
            });
    }, [repRecords, selectedSpectacleId, spectacleLinkField, repNameField, capacityField, revenuePotentialField,
        colJoursRestants, colDateRep, colSalle, colVille, colPlacesBloques, colBilletsDispo,
        filterStatusField]);

    // Get selected spectacle data
    const selectedSpectacle = useMemo(() => {
        return spectacles.find((s) => s.id === selectedSpectacleId) || null;
    }, [spectacles, selectedSpectacleId]);

    if (errorState) {
        return (
            <div className="p-6 text-center text-red-red dark:text-red-redLight1">
                Erreur de configuration : {errorState.message || 'Erreur inconnue'}
            </div>
        );
    }

    const isConfigured = spectaclesTable && repsTable && spectacleLinkField && repNameField && supabaseUrl && supabaseAnonKey;
    if (!isConfigured) {
        return (
            <div className="flex items-center justify-center min-h-screen p-6">
                <div className="text-center">
                    <p className="text-lg font-semibold text-gray-gray700 dark:text-gray-gray200 mb-2">
                        Configuration requise
                    </p>
                    <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
                        Ouvrez le panneau des proprietes pour configurer les tables,
                        les champs, l&apos;URL Supabase et la cle API.
                    </p>
                </div>
            </div>
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
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher un spectacle..."
                    style={{
                        fontSize: 13,
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '2px solid #d0d5dd',
                        backgroundColor: '#fff',
                        color: '#333',
                        width: 260,
                        outline: 'none',
                    }}
                />
            </div>

            {filteredSpectacles.length === 0 && (
                <div className="flex items-center justify-center h-64">
                    <p className="text-sm text-gray-gray500 dark:text-gray-gray400">
                        {search ? 'Aucun spectacle trouve.' : 'Aucun spectacle disponible.'}
                    </p>
                </div>
            )}

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 16,
                }}
            >
                {filteredSpectacles.map((spectacle) => (
                    <SpectacleCard
                        key={spectacle.id}
                        name={spectacle.name}
                        imageUrl={spectacle.imageUrl}
                        onClick={() => setSelectedSpectacleId(spectacle.id)}
                    />
                ))}
            </div>
        </div>
    );
}

initializeBlock({interface: () => <SalesChartApp />});
