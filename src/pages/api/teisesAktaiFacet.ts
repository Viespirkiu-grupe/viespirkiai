import type { APIRoute } from 'astro';
import { teisesAktaiFacetOptions } from '../../lib/searchTeisesAktai.ts';

// Pilnas vieno /teisesAktai faceto reikšmių sąrašas pagal esamą užklausą ir
// filtrus. Aptarnauja šoninės juostos „Daugiau" modalą, tad grąžina kur kas
// daugiau reikšmių (iki ~1k) nei juostos peržiūra.
const ALLOWED = new Set(['aktoRusis', 'statusas', 'variantas', 'prieme', 'eurovoc', 'turinioBusena']);

export const GET: APIRoute = async ({ url }) => {
  const p = url.searchParams;
  const field = p.get('field')?.trim() || '';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (!ALLOWED.has(field)) return json({ options: [] }, 400);

  const size = Math.min(2000, Math.max(1, parseInt(p.get('size') || '1000', 10) || 1000));

  try {
    const options = await teisesAktaiFacetOptions(
      field,
      {
        q: p.get('search') ?? p.get('q') ?? '',
        rusis: p.getAll('rusis'),
        statusas: p.getAll('statusas'),
        variantas: p.getAll('variantas'),
        turinys: p.getAll('turinys'),
        prieme: p.getAll('prieme'),
        eurovoc: p.getAll('eurovoc'),
        nuo: p.get('nuo') ?? undefined,
        iki: p.get('iki') ?? undefined,
        mode: p.get('mode') ?? 'words',
      },
      size,
    );
    return json({ options });
  } catch (err) {
    return json({ options: [], error: String(err) }, 500);
  }
};
