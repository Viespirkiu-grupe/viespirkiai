import type { LentelesRaktas } from './tipai.ts';

/**
 * `/duomenys/lenteles` adresai.
 *
 * Grupė yra schema, tad grupavimo logikos nebėra: kiekviena lentelė priklauso
 * lygiai tai schemai, kurioje guli, ir adresas surenkamas be jokio žemėlapio.
 */

/** Numatytoji tvarka schemoms, kurių `dba."schemos"` neaprašo. */
export const NUMATYTOJI_TVARKA = 500;

export function schemosUrl(schema: string): string {
  return `/duomenys/lenteles/${encodeURIComponent(schema)}`;
}

export function lentelesUrl(schema: string, vardas: string): string {
  return `${schemosUrl(schema)}/${encodeURIComponent(vardas)}`;
}

/**
 * `schema.lentele` → adresas. Patogu FK nuorodoms, kur turim tik raktą.
 * Skeliam ties pirmuoju tašku: schemų varduose taškų nėra, lentelių – gali būti.
 */
export function lentelesUrlIsRakto(raktas: LentelesRaktas): string {
  const riba = raktas.indexOf('.');
  if (riba < 0) return '/duomenys/lenteles';
  return lentelesUrl(raktas.slice(0, riba), raktas.slice(riba + 1));
}
