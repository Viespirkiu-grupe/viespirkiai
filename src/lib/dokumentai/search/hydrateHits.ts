import { readDocumentFs } from '@/modules/documents/documentsFs.js';
import { postgres } from '@/postgres/postgres.js';
import { makeSnippet, normalizeDocText } from '../snippet.ts';
import type { DokumentasHit, Timing } from './types.ts';

export interface HydratedHits {
  rows: DokumentasHit[];
  timings: Timing[];
}

/** Hydrate Quickwit ids from Postgres and their document sidecars. */
export async function hydrateHits(
  ids: number[],
  textQuery: string,
  phrase: boolean,
  mark: () => number,
): Promise<HydratedHits> {
  if (!ids.length) return { rows: [], timings: [] };

  const timings: Timing[] = [];
  const postgresStart = mark();
  const { rows: postgresRows } = await postgres.query(
    // savivaldybe / apskritis buvo 100 % NULL ir iš schemos pašalinti; kol
    // sąsaja jų tikisi, grąžinam tuščius.
    `SELECT
       d.id, d.md5, d."class", d.type, d.url, d.host, d.domain, d.source,
       d.title AS pavadinimas, d.author AS autorius,
       d.extension, d.language, d."pageCount", d."wordCount", d."characterCount",
       NULL::text AS savivaldybe, NULL::text AS apskritis,
       d."institutionJarCode"::text AS "istaigaJar",
       j.pavadinimas AS "istaigaPavadinimas",
       d."happenedAt", d."createdAt", d."updatedAt", d."discoveredAt",
       d."fileId" AS "failasId",
       d."sourceId0" AS "saltinioId0", d."sourceId1" AS "saltinioId1",
       d."sourceId2" AS "saltinioId2", d."sourceId3" AS "saltinioId3"
     FROM documents."documentsFull" d
     LEFT JOIN public.jar j ON j."jarKodas" = d."institutionJarCode"::text
     WHERE d.id = ANY($1)
       AND NOT EXISTS (
         SELECT 1 FROM public."filesHidden" n WHERE n.id = d."fileId"
       )`,
    [ids],
  );
  timings.push({
    label: 'Duomenys',
    phase: 'pg',
    start: postgresStart,
    duration: mark() - postgresStart,
  });

  const byId = new Map<number, any>(
    postgresRows.map((row: any) => [Number(row.id), row]),
  );
  const rows = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row: any) => ({
      ...row,
      title: row.pavadinimas ?? null,
      snippet: null,
    } as DokumentasHit));

  const snippetQuery = textQuery && textQuery !== '*' ? textQuery : '';
  const snippetsStart = mark();
  await Promise.all(rows.map(async (row) => {
    if (!row.md5) return;
    try {
      const sidecar: any = await readDocumentFs(row.md5);
      const text = normalizeDocText(sidecar?.text);
      row.editionType = sidecar?.metadata?.editionType ?? null;
      row.galiojimas = sidecar?.metadata?.galiojimas ?? null;
      row.prieme = sidecar?.metadata?.prieme ?? null;
      row.turinioBusena = sidecar?.metadata?.turinioBusena ?? null;
      row.istaigosNr = sidecar?.metadata?.istaigosNr ?? null;
      row.registracijosNr = sidecar?.metadata?.registracijosNr ?? null;
      if (text.length) {
        row.snippet = makeSnippet(text, snippetQuery, phrase ? 'phrase' : 'words');
      }
    } catch {
      // A missing sidecar should not remove an otherwise valid result.
    }
  }));
  timings.push({
    label: 'Ištraukos',
    phase: 'count',
    start: snippetsStart,
    duration: mark() - snippetsStart,
  });

  return { rows, timings };
}
