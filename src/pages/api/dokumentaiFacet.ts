import type { APIRoute } from 'astro';
import { dokumentaiFacetOptions } from '../../lib/searchDokumentai';
import { searchJar } from '../../../modules/juridiniai/search.js';
import { postgres } from '../../../postgres/postgres.js';

// Full option list for a single document-search facet under the current
// query/filters. Backs the "show all" modal in the filter sidebar, so it can
// return far more values (up to ~1k) than the sidebar previews inline.
const ALLOWED = new Set([
  'extension', 'host', 'jarKodai', 'istaigaJar', 'language', 'savivaldybe', 'apskritis', 'source', 'author',
  'metadata.creator', 'metadata.producer',
  'class', 'metadata.teismas', 'metadata.bylosRusis', 'metadata.kategorijos', 'metadata.teisejai',
  'metadata.rusis', 'metadata.galiojimas', 'metadata.editionType', 'metadata.busena', 'metadata.eurovocTerminai',
]);

export const GET: APIRoute = async ({ url }) => {
  const p = url.searchParams;
  const field = p.get('field')?.trim() || '';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (!ALLOWED.has(field)) return json({ options: [] }, 400);

  const size = Math.min(2000, Math.max(1, parseInt(p.get('size') || '1000', 10) || 1000));

  try {
    const options = await dokumentaiFacetOptions(
      field,
      {
        q: p.get('search') ?? p.get('q') ?? '',
        klase: p.getAll('klase'),
        type: p.getAll('type'),
        host: p.getAll('host'),
        jar: p.getAll('jar'),
        istaiga: p.getAll('istaiga'),
        ext: p.getAll('ext'),
        author: p.getAll('author'),
        creator: p.getAll('creator'),
        producer: p.getAll('producer'),
        lang: p.getAll('lang'),
        sav: p.getAll('sav'),
        apskritis: p.getAll('apskritis'),
        source: p.getAll('source'),
        metai: p.getAll('metai'),
        teismas: p.getAll('teismas'),
        bylosRusis: p.getAll('bylosRusis'),
        kategorija: p.getAll('kategorija'),
        teisejas: p.getAll('teisejas'),
        aktoRusis: p.getAll('aktoRusis'),
        galiojimas: p.getAll('galiojimas'),
        redakcija: p.getAll('redakcija'),
        projektoBusena: p.getAll('projektoBusena'),
        eurovoc: p.getAll('eurovoc'),
        minLat: p.get('minLat') ?? undefined,
        maxLat: p.get('maxLat') ?? undefined,
        minLon: p.get('minLon') ?? undefined,
        maxLon: p.get('maxLon') ?? undefined,
        mode: p.get('mode') ?? 'phrase',
      },
      size,
    );
    const optionSearch = p.get('optionSearch')?.trim() || '';
    if (field === 'jarKodai' && optionSearch) {
      const counts = new Map(options.map((option) => [option.value, option.count]));
      const registryResults = /^\d+$/.test(optionSearch)
        ? (await postgres.query(
            `SELECT "jarKodas", pavadinimas FROM public.jar WHERE "jarKodas" LIKE $1 ORDER BY "jarKodas" LIMIT 50`,
            [`${optionSearch}%`],
          )).rows
        : (await searchJar({ search: optionSearch }, { page: 1, limit: 50 })).results;
      const registryOptions = (registryResults as Array<{ jarKodas?: string | number; pavadinimas?: string }>)
        .filter((item) => item.jarKodas)
        .map((item) => ({
          value: String(item.jarKodas),
          label: item.pavadinimas ? String(item.pavadinimas) : undefined,
          count: counts.get(String(item.jarKodas)) ?? null,
        }));
      return json({ options: registryOptions });
    }
    return json({ options });
  } catch (err) {
    return json({ options: [], error: String(err) }, 500);
  }
};
