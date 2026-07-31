/**
 * Ar poraštėje rodyti įspėjimą apie automatiškai surinktus duomenis.
 *
 * Tekstas prasmingas tik ten, kur rodomi surinkti (scrapinti) duomenys —
 * sutartys, pirkimai, juridiniai asmenys, dokumentai ir pan. Statiniuose
 * projekto puslapiuose (apie, kontaktai, privatumas, MCP...) jis tik triukšmas,
 * tad jie išvardyti čia. Naujiems duomenų puslapiams nieko daryti nereikia —
 * numatyta rodyti.
 */

/** Keliai (ir jų sub-keliai), kuriuose įspėjimas NErodomas. */
const STATIC_PATHS = [
  '/apie',
  '/kontaktai',
  '/privatumas',
  '/duomenys',
  '/mcp',
  '/kodas',
  '/analitika',
  '/vieslaiskiai',
  '/status',
];

export function showFooterDisclaimer(pathname: string): boolean {
  // Be trailing slash, kad „/apie/" atitiktų „/apie".
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return !STATIC_PATHS.some((base) => path === base || path.startsWith(`${base}/`));
}

export default showFooterDisclaimer;
