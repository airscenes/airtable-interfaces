// fr-FR thousands/decimals, with a leading "$" sign — matches the spec screenshot.
export const fmtCurrency = (v) => {
  const parsed = typeof v === "number" ? v : Number(v);
  const n = v == null || isNaN(parsed) ? 0 : parsed;
  const formatted = n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${formatted}`;
};
