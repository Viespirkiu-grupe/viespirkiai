/**
 * Sutarčių eksportas standartine canonical schema (schemas/sutartis.schema.json)
 * forma. Naudoja tą pačią SQL logiką (docJsonbSql/DOC_JOINS_SQL), kuri
 * upsertVpmSutartis.js atstato canonical dokumentą iš normalizuotų vpm lentelių
 * (naudojama pakeitimų archyvavimui ir markVpmSutartisIstrinta), todėl dump'as
 * visada atitinka tą pačią schemą, kuria tikrinamas rašymas.
 *
 * Greičio sprendimai (pilnas dump'as – ~6 mln. eilučių):
 *  1. vietoj koreliuotų subužklausų (3 indekso paieškos KIEKVIENAI eilutei)
 *     vaikinės lentelės agreguojamos po kartą ir prijungiamos hash join'u;
 *  2. dokumentas grąžinamas jau kaip ::text – kitaip pg jsonb parsina į JS
 *     objektą, o mes iškart stringify'iname atgal;
 *  3. viena kursorinė (streamQuery) užklausa vietoj tūkstančių keyset batch'ų,
 *     tad agregatai skaičiuojami vieną kartą ir nėra round-trip'ų.
 *
 * Naudojama: modules/sutartys/eksportuotiCanonicalJsonl.js
 */
import { streamQuery } from "../../postgres/streamQuery.js";
import { DOC_JOINS_SQL, docJsonbSql } from "./upsertVpmSutartis.js";

const DOC_SQL = docJsonbSql({
    tiekejai: 'agg_tiekejai.arr',
    bvpzKodai: 'agg_bvpz.arr',
    dokumentai: 'agg_failai.arr',
});

// Iš anksto agreguotos vaikinės lentelės. Eilučių jose nedaug (papildomi
// tiekėjai ~11 tūkst., bvpz kodai ~200 tūkst., failai ~1,8 mln.), tad hash
// lentelės telpa į atmintį ir pakeičia ~18 mln. indekso paieškų.
const CANONICAL_EXPORT_SQL = `
SELECT ${DOC_SQL}::text AS doc
FROM "vpmSutartys"."sutartys" e
${DOC_JOINS_SQL}
LEFT JOIN (
    SELECT extra."unikalusId",
           jsonb_agg(
               jsonb_build_object(
                   'kodas', extra."tiekejoKodas",
                   'pavadinimas', extra_name.pavadinimas
               ) ORDER BY extra.id
           ) AS arr
    FROM "vpmSutartys"."papildomiTiekejai" extra
    LEFT JOIN "vpmSutartys"."salys" extra_name
      ON extra_name.id = extra."tiekejoPavadinimoId"
    GROUP BY extra."unikalusId"
) agg_tiekejai ON agg_tiekejai."unikalusId" = e."unikalusId"
LEFT JOIN (
    SELECT extra_bvpz."unikalusId",
           jsonb_agg(extra_bvpz."bvpzKodas" ORDER BY extra_bvpz.id) AS arr
    FROM "vpmSutartys"."papildomiBvpzKodai" extra_bvpz
    GROUP BY extra_bvpz."unikalusId"
) agg_bvpz ON agg_bvpz."unikalusId" = e."unikalusId"
LEFT JOIN (
    SELECT file."unikalusId",
           jsonb_agg(
               jsonb_build_object(
                   'pavadinimas', file.pavadinimas,
                   'fileId', file."fileId"
               ) ORDER BY file.id
           ) AS arr
    FROM "vpmSutartys"."failai" file
    GROUP BY file."unikalusId"
) agg_failai ON agg_failai."unikalusId" = e."unikalusId"
`;

export const DEFAULT_BATCH_SIZE = 5000;

/**
 * Srautas su visomis sutartimis; kiekviena eilutė – `{ doc }`, kur `doc` yra
 * canonical dokumentas JAU JSON tekstu (ne objektu).
 *
 * Eilučių eiliškumas nedeterministinis: ORDER BY "unikalusId" pilnam dump'ui
 * reikštų arba 6 mln. atsitiktinių heap skaitymų per indeksą, arba kelių GB
 * rūšiavimą – abu brangesni už patį eksportą, o JSONL vartotojams tvarka
 * nesvarbi.
 *
 * @param {{ batchSize?: number }} [options]
 * @returns {Promise<import("stream").Readable>}
 */
export function streamCanonicalDocs({ batchSize = DEFAULT_BATCH_SIZE } = {}) {
    return streamQuery(CANONICAL_EXPORT_SQL, [], { batchSize });
}

export { CANONICAL_EXPORT_SQL };
