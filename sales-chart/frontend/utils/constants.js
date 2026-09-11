// Date range presets: `days` or `months` = offset back from now.
// Day-based presets also pin dateTo to "now" so short ranges render a line.
export const PRESETS = [
  { key: "24h", label: "24h", days: 1 },
  { key: "72h", label: "72h", days: 3 },
  { key: "7d", label: "7j", days: 7 },
  { key: "1m", label: "1m", months: 1 },
  { key: "3m", label: "3m", months: 3 },
  { key: "all", label: "Tout" },
];
