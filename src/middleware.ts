import { defineMiddleware } from 'astro:middleware';
import config from './lib/config.ts';
import { isAtn1Path } from './lib/featureRoutes.ts';
import { hostFromHeaders, runWithRequestContext } from '@/utils/runtimeContext.js';

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
