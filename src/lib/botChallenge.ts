import type { SearchOgMeta } from './searchOgMeta.ts';

const protectedSearchPaths = new Set([
  '/',
  '/viesiejiPirkimai',
  '/dokumentai',
  '/juridiniai',
]);

/** Whether this is one of the DB/search-heavy HTML entry routes. */
export function isBotChallengePath(pathname: string): boolean {
  const normalizedPath = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  return protectedSearchPaths.has(normalizedPath);
}

/**
 * Google crawler user agents (Googlebot, AdsBot, Google-InspectionTool ir kt.).
 *
 * Tikrinama tik pagal User-Agent — tai lengvai suklastojama, todėl iššūkis
 * praleidžiamas nuosekliai su tuo, kad jis ir taip yra tik pigus filtras
 * prieš JS nevykdančius botus, o ne saugumo priemonė.
 */
const googleCrawlerUserAgent = /(?:^|[\s(;])(?:Googlebot(?:-\w+)?|AdsBot-Google(?:-\w+)?|APIs-Google|Mediapartners-Google|FeedFetcher-Google|Google-InspectionTool|GoogleOther|Storebot-Google|Google-Safety)(?:[/\s;)]|$)/i;

/** Whether the request comes from a Google crawler, which must see real HTML. */
export function isGoogleCrawler(userAgent: string | null | undefined): boolean {
  return !!userAgent && googleCrawlerUserAgent.test(userAgent);
}

/** HTML atributams — iššūkio dokumentas sudaromas rankomis. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * OG antraštės iššūkio puslapiui — sudarytos vien iš URL parametrų, be nė vienos DB
 * ar Quickwit užklausos (žr. `searchOgMeta.ts`).
 *
 * Jos gyvena būtent čia, o ne atskirame crawleriams skirtame atsakyme: peržiūros
 * crawleriai (Facebook, Slack, Signal…) JavaScript nevykdo, tad iššūkio niekada
 * neišspręs, o atpažinti juos pagal User-Agent reikštų laikyti sąrašą, kurio niekada
 * nepakaks. Vietoj to iššūkis lieka visiems (išskyrus Googlebot), o tą patį puslapį
 * gavęs crawleris `<head>` randa teisingą nuorodos peržiūrą.
 */
function ogTags(meta: SearchOgMeta | null | undefined): string {
  if (!meta) return '';

  const title = escapeHtml(meta.pageTitle);
  const description = escapeHtml(meta.pageDescription);
  const image = escapeHtml(meta.ogImageUrl);
  const url = escapeHtml(meta.canonicalUrl);

  return `
  <link rel="canonical" href="${url}">
  <meta name="description" content="${description}">
  <meta property="og:site_name" content="Viešpirkiai">
  <meta property="og:locale" content="lt_LT">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">`;
}

/**
 * A deliberately tiny JavaScript check for bots which do not execute JS.
 *
 * @param meta - paieškos užklausos OG duomenys; su jais puslapis lieka tinkama
 *   nuorodos peržiūra net ir tada, kai iššūkio niekas neišsprendžia.
 */
export function botChallengeResponse(meta?: SearchOgMeta | null): Response {
  return new Response(`<!doctype html>
<html lang="lt">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${meta ? `${escapeHtml(meta.pageTitle)} – Viešpirkiai` : 'Tikrinama naršyklė…'}</title>${ogTags(meta)}
  <style>
    :root { color-scheme: light dark; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      font: 1rem/1.5 system-ui, sans-serif;
    }
    main { display: grid; justify-items: center; gap: 1.25rem; padding: 2rem; text-align: center; }
    .spinner {
      width: 2.5rem;
      height: 2.5rem;
      border: .3rem solid color-mix(in srgb, currentColor 20%, transparent);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin .8s linear infinite;
    }
    .help { opacity: 0; animation: reveal 0s 5s forwards; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes reveal { to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }
  </style>
</head>
<body>
  <main>
    <div class="spinner" role="status" aria-label="Tikrinama naršyklė"></div>
    <div class="help">Įjunkite Javascript arba nustatykite Cookie <code>bot=no</code>, ačiū!</div>
  </main>
  <script>
    document.cookie = "bot=no; Path=/; SameSite=Lax";
    window.setTimeout(() => window.location.reload(), 100);
  </script>
</body>
</html>`, {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
