import type { APIRoute } from 'astro';
import { postgres } from '@/postgres/postgres.js';
import { openETarSidecar, readResponse } from '@/modules/eTar/eTarSidecar.js';

// Oficialaus teisės akto teksto HTML, skirtas įdėti į <iframe> akto puslapyje.
//
// Tai vidinis `/teisesAktas/[id]` iframe endpointas: dokumentą nusako kelias, o ne
// privalomas užklausos parametras. Vienintelis parametras `?scheme=dark|light`
// yra neprivalomas (be jo sprendžia `prefers-color-scheme`).
//
// Turinys ateina iš e-TAR sidecar'o (`official_text.html`) — tai svetimas HTML,
// tad atiduodam jį kuo sandaresniai:
//   • `md5` privalo egzistuoti "eTarLegalActDocument" lentelėje (ne bet kas iš sidecar'o);
//   • CSP uždraudžia skriptus, formas ir bet kokį išorinį krovimą;
//   • `sandbox` ant paties <iframe> (žr. puslapį) papildomai nuima JS ir same-origin.

let sidecarDb: any = null;
function getSidecar() {
  if (!sidecarDb) sidecarDb = openETarSidecar({ readonly: true });
  return sidecarDb;
}

/**
 * e-TAR aktai ateina iš Word'o ir kiekvienam elementui prirašo `color: black`
 * (viename įstatyme — 690 kartų). Tamsioje temoje toks tekstas taptų nematomas,
 * tad juodą spalvą nuimam, o VISAS kitas paliekam: suvestinėse redakcijose
 * spalva žymi pakeitimus, ir ta prasmė turi išlikti.
 *
 * Tuo pačiu nuimam ir Word'o `bgcolor`/`background` baltą foną bei `<font
 * color=...>` — jie temos nepaiso ir tamsoje išdegina baltus lopus.
 */
function stripForcedBlack(html: string): string {
  return html
    .replace(/(?<![-\w])color\s*:\s*(?:black|windowtext|#000(?:000)?)\s*;?/gi, '')
    .replace(/(?<![-\w])background(?:-color)?\s*:\s*(?:white|#fff(?:fff)?)\s*;?/gi, '')
    .replace(/\sbgcolor\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\scolor\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/**
 * Minimalus skaitymui pritaikytas apvalkalas.
 *
 * `scheme` ateina iš puslapio: `dark`/`light` — kai naudotojas pasirinko aiškiai,
 * o „auto" atveju parametro nėra ir sprendžia `prefers-color-scheme`. Taip rėmelis
 * nemirksi šviesiai prieš prisitaikydamas.
 */
function wrap(html: string, scheme: string): string {
  const attr = scheme === 'dark' || scheme === 'light' ? ` data-scheme="${scheme}"` : '';
  return `<!doctype html>
<html lang="lt"${attr}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #0c0a09; --line: #d6d3d1; --mark: #fff3a3;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16181d; --fg: #e7e9ee; --line: #343a44; --mark: #4a4320; }
  }
  :root[data-scheme="light"] {
    color-scheme: light;
    --bg: #ffffff; --fg: #0c0a09; --line: #d6d3d1; --mark: #fff3a3;
  }
  :root[data-scheme="dark"] {
    color-scheme: dark;
    --bg: #0c0a09; --fg: #fafaf9; --line: #292524; --mark: #4a4320;
  }
  html, body { background: var(--bg); }
  body {
    margin: 0;
    padding: 10px 24px 48px;
    font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--fg);
    overflow-wrap: break-word;
  }
  /* Word'o klasės neša savo spalvas — Word'o dokumentai jas rašo į „color",
     kurį jau nuėmėm, bet paveldėjimą užtikrinam ir čia. */
  p, span, div, td, th, li, h1, h2, h3, h4, h5, h6 { color: inherit; }
  /* Word'as kiekvienai akto daliai palieka tuščią pastraipą su inkaru — ekrane
     tai tik tuščia juosta, ryškiausiai teksto pradžioje. */
  p:empty { display: none; }
  img, table { max-width: 100%; }
  /* Akto paveikslėliai e-TAR'e guli reliatyviu keliu (content_files/...), kurio
     mes neaptarnaujam, o CSP jų vis tiek neįsileistų — geriau nieko, nei
     sulūžusio paveikslėlio ženkliukas vidury teksto. */
  img[src^="content_files"], img[src^="./content_files"] { display: none; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid var(--line); padding: 4px 8px; vertical-align: top; }
  a { color: inherit; }
  /* Atėjus iš turinio rodyklės dalies nedažom — vieta ir taip matoma, o geltonas
     lopas akto tekste atrodo kaip klaida. Lieka tik atsargus tarpas viršuje. */
  :target { scroll-margin-top: 16px; }
</style></head><body>${html}</body></html>`;
}

export const GET: APIRoute = async ({ params, url }) => {
  const md5 = (params.md5 || '').trim();
  if (!/^[0-9a-f]{32}$/.test(md5)) return new Response('Blogas md5', { status: 400 });

  const { rows } = await postgres.query(
    `SELECT 1 FROM "eTarLegalActDocument" WHERE "md5" = $1 LIMIT 1`,
    [md5],
  );
  if (!rows.length) return new Response('Nerasta', { status: 404 });

  let html: string | null = null;
  try {
    const payload: any = readResponse(getSidecar(), md5);
    const raw = payload?.official_text?.html;
    if (typeof raw === 'string' && raw.trim()) html = raw;
  } catch { /* sidecar'o nėra arba įrašas dingęs */ }

  if (!html) return new Response('Teksto nėra', { status: 404 });

  const scheme = url.searchParams.get('scheme') ?? '';
  return new Response(wrap(stripForcedBlack(html), scheme), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
};
