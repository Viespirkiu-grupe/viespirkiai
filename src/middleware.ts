import { defineMiddleware } from 'astro:middleware';
import config from './lib/config.ts';
import { botChallengeResponse, isBotChallengePath, isGoogleCrawler } from './lib/botChallenge.ts';
import { describeSearchQuery } from './lib/searchOgMeta.ts';
import { isAtn1Path } from './lib/featureRoutes.ts';
import { hostFromHeaders, runWithRequestContext } from '@/utils/runtimeContext.js';

/**
 * Absoliutus adresas OG antraštėms. Už proxy tikrasis vardas lieka
 * `x-forwarded-host`/`x-forwarded-proto`, o `context.url` rodo vidinį adresą.
 */
function originFromRequest(headers: Headers, url: URL): string {
  const host = hostFromHeaders(headers, url);
  if (!host) return url.origin;
  const proto = headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim()
    || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/**
 * Onion-Location antraštė.
 *
 * Anksčiau ją siuntė Express serveris (senasis `index.js`), bet po porto į
 * Astro jis dingo. Jei sukonfigūruotas Tor onion adresas, kiekvienam atsakymui
 * pridedame `Onion-Location` antraštę, nukreipiančią į tą patį kelią onion
 * domene — Tor naršyklė pasiūlo vartotojui pereiti į onion versiją.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (!config.enableAtn1 && isAtn1Path(context.url.pathname)) {
    return new Response(null, { status: 404 });
  }

  if (
    config.enableBotChallenge
    && context.request.method === 'GET'
    && isBotChallengePath(context.url.pathname)
    && context.cookies.get('bot')?.value !== 'no'
    && !isGoogleCrawler(context.request.headers.get('user-agent'))
  ) {
    // Iššūkis lieka visiems (išskyrus Googlebot), bet pats jo puslapis nešasi
    // užklausą aprašančias OG antraštes — sudarytas vien iš URL parametrų, be nė
    // vienos DB užklausos. Taip nuorodų peržiūra veikia ir tiems crawleriams, kurie
    // JavaScript nevykdo, o atpažinti juos pagal User-Agent nereikia.
    return botChallengeResponse(describeSearchQuery(
      context.url.pathname,
      context.url.searchParams,
      originFromRequest(context.request.headers, context.url),
    ));
  }

  // Užklausos kontekstas (hostas) – kad SQL logo įrašus būtų galima priskirti
  // konkrečiam domenui. Apgaubiam visą `next()`, nes puslapių DB užklausos
  // vykdomos būtent jo viduje.
  const response = await runWithRequestContext(
    { host: hostFromHeaders(context.request.headers, context.url) },
    () => next(),
  );

  if (config.onionAddress) {
    const safeUrl = config.onionAddress + encodeURI(context.url.pathname + context.url.search);

    // `Response.redirect()` (naudojamas pvz. /kodas, /analitika) grąžina atsakymą
    // su nekeičiamomis (immutable) antraštėmis — `headers.set` tokiu atveju meta
    // `TypeError: immutable`. Tokiu atveju atkuriame atsakymą su keičiamomis
    // antraštėmis.
    try {
      response.headers.set('Onion-Location', safeUrl);
    } catch {
      const headers = new Headers(response.headers);
      headers.set('Onion-Location', safeUrl);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
  }

  return response;
});
