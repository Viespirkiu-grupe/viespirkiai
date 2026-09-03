/**
 * Shared formatting helpers used across components and pages.
 *
 * Centralised to avoid the previous pattern of redefining the same
 * locale-formatting lambda inside every component.
 */

/**
 * Format a numeric value as a Lithuanian-locale decimal with 2 fraction digits.
 *
 * Components typically append ` €` themselves (the spacing/markup varies),
 * so this returns just the number portion (e.g. "1 234,56").
 */
export const fmtEur = (v: number | string): string =>
  Number(v).toLocaleString('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Null-safe currency formatter.
 *
 * Returns a Lithuanian-locale string with the euro sign appended, or `null`
 * when the value is missing, non-numeric, or non-positive.  Used where the
 * component conditionally renders an amount only when a meaningful value
 * exists (e.g. PirkimasVerte).
 */
export const fmtEurOrNull = (v: unknown): string | null => {
  const n = Number(v);
  return v != null && v !== '' && !Number.isNaN(n) && n > 0
    ? n.toLocaleString('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00a0€'
    : null;
};

/**
 * Plain locale-formatted integer/number (no fraction-digit padding).
 */
export const fmtNumber = (v: number | string): string =>
  Number(v).toLocaleString('lt-LT');

/**
 * Truncate an ISO-like date/timestamp string to its YYYY-MM-DD prefix.
 *
 * Used by export rows and some result cards where only the date is shown.
 */
export const fmtDateOnly = (v: unknown): string =>
  v ? String(v).slice(0, 10) : '';
