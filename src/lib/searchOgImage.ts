/**
 * Užklausą aprašantys OG paveikslėliai keturiems paieškos maršrutams
 * (`/sutartys.png`, `/viesiejiPirkimai.png`, `/dokumentai.png`, `/juridiniai.png`).
 *
 * Tekstas imamas iš `describeSearchQuery` — tų pačių duomenų, kaip ir puslapio OG
 * antraštės, be nė vienos DB užklausos. Piešiama esamu `getOpenGraphImage`
 * (satori + resvg, be naršyklės).
 *
 * Vienas renderas – apie 60 ms sinchroninio CPU, tad brangus jis tampa tik masiškai
 * ir tik su unikaliomis užklausomis. Todėl du saugikliai:
 *   1. TTL kešas (jis pat sulipina vienalaikes tas pačias užklausas);
 *   2. naujų renderų greičio biudžetas — jį pramušus užklausa nukreipiama į tą patį
 *      maršrutą be užklausos (statinį, beveik visada kešuotą variantą).
 *
 * Skaičiuojamas būtent greitis, o ne vienalaikių renderų kiekis: darbas sinchroninis,
 * tad vienu metu vykdomų renderų praktiškai niekada nebūna daugiau nei vienas — tokia
 * riba tiesiog niekada nesuveiktų.
 */
import { getOpenGraphImage } from '@/utils/openGraphImage.js';
import { createTtlPromiseCache } from '@/utils/ttlPromiseCache.js';
import RPSCounter from '@/utils/rpsCounter.js';
import { describeSearchQuery, type SearchOgMeta } from './searchOgMeta.ts';

const CACHE_TTL_MS = 60 * 60 * 1000;
/** Kiek naujų (nekešuotų) paveikslėlių per sekundę leidžiam nupiešti. */
const MAX_RENDERS_PER_SECOND = 10;
/** Kiek filtrų sutalpina 1200×630 kortelė, kol nepradeda lipti per kraštą. */
const MAX_IMAGE_FILTERS = 4;

const cachedImage = createTtlPromiseCache(CACHE_TTL_MS);
const renderRate = new RPSCounter(3000);

/** `describeSearchQuery` išvestis → satori kortelės tekstai. */
function imageParts(meta: SearchOgMeta, pathname: string) {
  const filters = meta.filters.slice(0, MAX_IMAGE_FILTERS)
    .map(({ label, value }) => `${label}: ${value}`);
  const hidden = meta.filters.length - MAX_IMAGE_FILTERS;
  if (hidden > 0) filters.push(`ir dar ${hidden} filtrai`);

  return {
    tipas: meta.baseTitle,
    // Be užklausos kortelė lieka tokia, kokia buvo iki šiol: maršruto pavadinimas
    // viršuje, „Viešpirkiai" antraštėje (žr. ankstesnį viesiejiPirkimai.png.ts).
    pavadinimas: meta.queryText || 'Viešpirkiai',
    aprasymas: filters.join('<br>'),
    id: `viespirkiai.org${pathname === '/' ? '' : pathname}`,
  };
}

/**
 * Atsakymas su OG paveikslėliu paieškos maršrutui.
 *
 * @param url - `.png` maršruto URL (jo užklausa aprašo paiešką).
 * @param pathname - paieškos puslapio kelias, pvz. `/` arba `/dokumentai`.
 * @param pngPath - šio `.png` maršruto kelias (statiniam atsarginiam variantui).
 */
export async function searchOgImageResponse(url: URL, pathname: string, pngPath: string): Promise<Response> {
  const meta = describeSearchQuery(pathname, url.searchParams);
  if (!meta) return new Response(null, { status: 404 });

  // Kešo raktas — sunormintas OG paveikslėlio URL: tie patys parametrai bet kokia
  // eilės tvarka duoda tą patį raktą, o nežinomi parametrai į jį nepatenka.
  const key = meta.ogImageUrl;

  // Be užklausos visiems tenka tas pats vienas paveikslėlis — jo neribojam, nes po
  // pirmo renderio jis vis tiek kešuotas.
  if (meta.hasQuery && renderRate.getRPS() >= MAX_RENDERS_PER_SECOND) {
    return new Response(null, { status: 302, headers: { Location: pngPath } });
  }

  const parts = imageParts(meta, pathname);
  const buffer: Buffer = await cachedImage(key, () => {
    renderRate.record();
    return getOpenGraphImage(parts.tipas, parts.pavadinimas, parts.aprasymas, parts.id);
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
