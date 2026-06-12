import { defineMiddleware } from 'astro:middleware';
import config from './lib/config.ts';

/**
 * Onion-Location antraštė.
 *
 * Anksčiau ją siuntė Express serveris (senasis `index.js`), bet po porto į
 * Astro jis dingo. Jei sukonfigūruotas Tor onion adresas, kiekvienam atsakymui
 * pridedame `Onion-Location` antraštę, nukreipiančią į tą patį kelią onion
 * domene — Tor naršyklė pasiūlo vartotojui pereiti į onion versiją.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();

  if (config.onionAddress) {
    const safeUrl = config.onionAddress + encodeURI(context.url.pathname + context.url.search);
    response.headers.set('Onion-Location', safeUrl);
  }

  return response;
});
