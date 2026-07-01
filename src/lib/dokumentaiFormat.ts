// Shared number/date formatting for the /dokumentai page and its components.
// Kept in one place so the page, the result cards, the home overview and the
// stats panel all format identically.

/** Lietuviškas sveikojo skaičiaus formatas (1 234). Tuščia, jei reikšmės nėra. */
export function fmt(n: number | null | undefined): string {
  return n != null ? Number(n).toLocaleString('lt-LT') : '';
}

/** Kompaktiškas skaičius dideliems dažniams (6,9 mln. / 77 tūkst.). */
export function fmtCompact(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace('.', ',') + ' mlrd.';
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' mln.';
  if (v >= 1e4) return Math.round(v / 1e3).toLocaleString('lt-LT') + ' tūkst.';
  return v.toLocaleString('lt-LT');
}

/** Data lietuvišku formatu (2024-01-31 → 2024-01-31 lokalė). null, jei nėra. */
export function fmtDate(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toLocaleDateString('lt-LT') : null;
}

/** ISO diena (YYYY-MM-DD) datų palyginimui (ar dvi datos ta pati diena). */
export function dateKey(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}
