/**
 * Statistics-page helpers for `/failai`.
 *
 * The "no query" view of /failai is a stats dashboard fed by SSE updates.
 * `buildStatistika` formats the raw `failaiCounts`-derived stat object into
 * the strings the dashboard renders; the same shape is later sent over SSE
 * so the client-side updater can swap text nodes in place.
 */

/** Returns the correct Lithuanian plural form for a number, with 4 forms. */
export function formatPluralOnly(number: number, forms: [string, string, string, string]): string {
  const n = Math.abs(Number(number));
  const stringValue = number.toString();
  const hasFraction = stringValue.includes('.') || stringValue.includes(',');

  if (hasFraction && n !== 0) return forms[3];
  if (n % 10 === 1 && !(n % 100 >= 11 && n % 100 <= 19)) return forms[0];
  if (n % 10 >= 2 && n % 10 <= 9 && !(n % 100 >= 11 && n % 100 <= 19)) return forms[1];
  return forms[2];
}

/** Format an ISO-ish timestamp into a Lithuanian-locale "YYYY-MM-DD HH:MM:SS" string. */
export function formatLtDateTime(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';

  const datePart = date.toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timePart = date.toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${datePart} ${timePart}`;
}

export interface StatistikaPayload {
  atnaujinta: string;
  totalWordsNumber: string;
  totalWordsLabel: string;
  dataSize: string;
  filesWithWordsNumber: string;
  filesWithWordsLabel: string;
}

/**
 * Convert the raw stat aggregate (from the `failaiCounts` view) into
 * pre-formatted strings ready to render in the dashboard.  The same shape is
 * pushed through SSE so the client can update spans without re-rendering.
 */
export function buildStatistika(stat: any): StatistikaPayload | null {
  if (!stat) return null;
  const totalWords = Number(stat.nuskaitymas.zodziai.total);
  const failaiSuZodziais = Number(stat.nuskaitymas.zodziai.failaiSuZodziais);
  const visiFailai = Number(stat.failai.kiekiai.visi);
  const visiDydziai = Number(stat.failai.dydziai.visi);
  const duomenuBaitai = visiDydziai * (visiFailai > 0 ? failaiSuZodziais / visiFailai : 0);

  return {
    atnaujinta: formatLtDateTime(stat.atnaujinta),
    totalWordsNumber: totalWords.toLocaleString('lt-LT'),
    totalWordsLabel: `${formatPluralOnly(totalWords, ['žodis', 'žodžiai', 'žodžių', 'žodžio'])} teksto`,
    dataSize: `${(duomenuBaitai / 1024 / 1024 / 1024).toFixed(2)} GB`,
    filesWithWordsNumber: failaiSuZodziais.toLocaleString('lt-LT'),
    filesWithWordsLabel: formatPluralOnly(failaiSuZodziais, ['failas', 'failai', 'failų', 'failo']),
  };
}
