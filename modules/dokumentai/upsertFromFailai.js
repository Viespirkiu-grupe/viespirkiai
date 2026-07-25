import { postgres } from "../../postgres/postgres.js";
import { saveDokumentasFs } from "./dokumentaiFs.js";
import { readFailaiFs } from "../failai/failaiFs.js";

const SIDECAR_VERSION = "1";
const CLASS = "viesiejiPirkimai";
const TYPE = "failas";
const FS_CONCURRENCY = 32;

// NULL and 'sutartis' both mean the legacy CVP IS archive (sutartys) source.
export function normalizeSource(saltinis) {
    if (saltinis == null || saltinis === "sutartis") return "sutartys";
    return saltinis;
}

// `files` jau laiko šaltinio ID išskaidytą po stulpelius (žr. failuIrasymas.js
// SALTINIAI), tad čia nieko nebedalinam — tik suvienodinam vieną skirtumą:
// senoje cvpp formoje be `pid` dokumentai.saltinioId0 buvo NULL, o `files` toje
// pozicijoje laiko `-1`. Grąžinam NULL, kad indekso reikšmės nepasikeistų.
export function saltinioIdPozicijos(row) {
    const s0 = row.saltinis === "cvpp" && row.sourceId0 === "-1" ? null : row.sourceId0 ?? null;
    return [s0, row.sourceId1 ?? null, row.sourceId2 ?? null];
}

// Tas pats hash'as batch'e gali kartotis — promise įdedamas į Map sinchroniškai,
// todėl lygiagretūs workeriai dalinasi vienu FS skaitymu.
function readCached(map, hash, read) {
    let promise = map.get(hash);
    if (!promise) {
        promise = read(hash);
        map.set(hash, promise);
    }
    return promise;
}

async function buildPayload(row, caches) {
    const [s0, s1, s2] = saltinioIdPozicijos(row);
    const turinys = row.failasHash
        ? await readCached(caches.failai, row.failasHash, readFailaiFs)
        : null;
    const metadata = turinys?.metaduomenys ?? null;
    const text = turinys?.tekstas ?? null;
    const sidecar = {
        version: SIDECAR_VERSION,
        md5: row.md5,
        class: CLASS,
        type: TYPE,
        source: normalizeSource(row.saltinis),
        saltinioId0: s0,
        saltinioId1: s1,
        saltinioId2: s2,
        saltinioId3: null,
        author: row.autorius ?? null,
        title: row.pavadinimas ?? null,
        extension: row.extension ?? null,
        pageCount: row.puslapiuSkaicius ?? null,
        wordCount: row.zodziuSkaicius ?? null,
        characterCount: row.simboliuSkaicius ?? null,
        text,
        metadata,
    };
    return { row, s0, s1, s2, sidecar };
}

// Stulpeliai, kurių upsertBatch reikia iš `files`. Naudoja ir backfill (id > $1),
// ir eilės vartotojas (id = ANY).
//
// Šaltinio ID nebedalinamas užklausoje — `files` jau turi sourceId0..2.
//
// "istaigaJar" — perkančiosios / paskelbusios organizacijos JAR kodas, paimtas
// pagal šaltinį iš susijusios lentelės (žr. FILES_ISTAIGA_JOINS). cvpp neturi
// JAR kodo → NULL; archive (child) failai paveldi iš tėvo atskirame passe.
export const FAILAI_SELECT_COLUMNS = `
    f.id,
    m.md5,
    st.title AS saltinis,
    f."sourceId0", f."sourceId1", f."sourceId2",
    a.author AS autorius,
    fn.filename AS pavadinimas,
    e.extension,
    d."wordCount" AS "zodziuSkaicius",
    d."pageCount" AS "puslapiuSkaicius",
    d."characterCount" AS "simboliuSkaicius",
    i."fileHash" AS "failasHash",
    ST_AsEWKT(loc.location) AS location_ewkt,
    COALESCE(
        vp."jarKodas",
        s."perkanciosiosOrganizacijosKodas",
        (SELECT nd."jarKodas"
         FROM public."neskelbiamosDerybos" nd
         WHERE st.title = 'neskelbiamosDerybos'
           AND nd.link = 'https://eviesiejipirkimai.lt/' || f."sourceId0"
         LIMIT 1)
    ) AS "istaigaJar"
`;

// LEFT JOIN'ai: žodynai, turinio hash'as, koordinatės ir šaltinių lentelės
// "istaigaJar" apskaičiavimui. Raktai remiasi tik į atrenkamus stulpelius, todėl
// tinka ir backfill'ui, ir eilės vartotojui.
// viesiejiPirkimai.pirkimoId UNIQUE, vpmSutartys.unikalusId PK — eilučių nedaugina.
// neskelbiamosDerybos link NEunikalus (PK = hash), todėl jis imamas skaliariniu
// subquery (LIMIT 1) FAILAI_SELECT_COLUMNS viduje, ne JOIN'u.
export const FAILAI_ISTAIGA_JOINS = `
    LEFT JOIN public."filesMd5"            m   ON m.id   = f."md5Id"
    LEFT JOIN public."filesFilenames"      fn  ON fn.id  = f."filenameId"
    LEFT JOIN public."filesExtensions"     e   ON e.id   = f."extensionId"
    LEFT JOIN public."filesAuthors"        a   ON a.id   = f."authorId"
    LEFT JOIN public."filesSourceTitles"   st  ON st.id  = f."sourceTitleId"
    LEFT JOIN public."filesDataExtraction" d   ON d.id   = f.id
    LEFT JOIN public."filesInfoFiles"      i   ON i.id   = f.id
    LEFT JOIN public."filesLocations"      loc ON loc.id = f.id
    LEFT JOIN public."viesiejiPirkimai" vp
        ON vp."pirkimoId" = CASE
            WHEN st.title = 'cvpIs' AND f."sourceId0" ~ '^[0-9]+$'
            THEN f."sourceId0"::integer
            ELSE NULL
        END
    LEFT JOIN public."vpmSutartys" s
        ON s."unikalusId" = CASE
            WHEN st.title = 'sutartys' AND f."sourceId0" ~ '^[0-9]+$'
            THEN f."sourceId0"::bigint
            ELSE NULL
        END
`;


export async function upsertBatch(rows, db = postgres) {
    const fsStart = Date.now();
    let skipped = 0;
    const ready = [];
    for (const r of rows) {
        if (r.md5 == null) {
            skipped++;
            continue;
        }
        ready.push(r);
    }

    const built = [];
    const caches = { tekstai: new Map(), metaduomenys: new Map(), failai: new Map() };
    let cursor = 0;
    async function worker() {
        while (cursor < ready.length) {
            const row = ready[cursor++];
            const b = await buildPayload(row, caches);
            await saveDokumentasFs(row.md5, b.sidecar);
            built.push(b);
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(FS_CONCURRENCY, ready.length) }, worker),
    );
    const fsMs = Date.now() - fsStart;

    if (built.length === 0) return { inserted: 0, skipped, fsMs, insertMs: 0 };

    const failasIds = built.map((b) => b.row.id);
    const md5s = built.map((b) => b.row.md5);
    const sources = built.map((b) => normalizeSource(b.row.saltinis));
    const s0s = built.map((b) => b.s0);
    const s1s = built.map((b) => b.s1);
    const s2s = built.map((b) => b.s2);
    const autoriai = built.map((b) => b.row.autorius);
    const pavadinimai = built.map((b) => b.row.pavadinimas);
    const extensions = built.map((b) => b.row.extension);
    const wordCounts = built.map((b) => b.row.zodziuSkaicius);
    const pageCounts = built.map((b) => b.row.puslapiuSkaicius);
    const charCounts = built.map((b) => b.row.simboliuSkaicius);
    const locEwkts = built.map((b) => b.row.location_ewkt);
    const istaigaJars = built.map((b) => b.row.istaigaJar);

    const insertStart = Date.now();
    await db.query(
        `INSERT INTO public.dokumentai (
            "failasId", md5, class, type, source,
            "saltinioId0", "saltinioId1", "saltinioId2",
            autorius, pavadinimas, extension,
            "wordCount", "pageCount", "characterCount",
            location, host, domain, url, "istaigaJar"
         )
         SELECT
            t."failasId", t.md5, $13::text, $14::text, t.source,
            t.s0, t.s1, t.s2,
            t.autorius, t.pavadinimas, t.extension,
            t."wordCount", t."pageCount", t."charCount",
            CASE WHEN t.loc IS NULL THEN NULL ELSE ST_GeogFromText(t.loc) END,
            'viespirkiai.org', 'viespirkiai.org',
            'https://viespirkiai.org/failas/' || t."failasId"::text,
            t."istaigaJar"
         FROM unnest(
            $1::bigint[], $2::text[], $3::text[],
            $4::text[], $5::text[], $6::text[],
            $7::text[], $8::text[], $9::text[],
            $10::int[], $11::int[], $12::int[],
            $15::text[], $16::text[]
         ) AS t("failasId", md5, source, s0, s1, s2,
                autorius, pavadinimas, extension,
                "wordCount", "pageCount", "charCount", loc, "istaigaJar")
         ON CONFLICT ("failasId") WHERE "failasId" IS NOT NULL DO UPDATE SET
            md5             = EXCLUDED.md5,
            class           = EXCLUDED.class,
            type            = EXCLUDED.type,
            source          = EXCLUDED.source,
            "saltinioId0"   = EXCLUDED."saltinioId0",
            "saltinioId1"   = EXCLUDED."saltinioId1",
            "saltinioId2"   = EXCLUDED."saltinioId2",
            autorius        = EXCLUDED.autorius,
            pavadinimas     = EXCLUDED.pavadinimas,
            extension       = EXCLUDED.extension,
            "wordCount"     = EXCLUDED."wordCount",
            "pageCount"     = EXCLUDED."pageCount",
            "characterCount" = EXCLUDED."characterCount",
            location        = EXCLUDED.location,
            host            = EXCLUDED.host,
            domain          = EXCLUDED.domain,
            url             = EXCLUDED.url,
            "istaigaJar"    = EXCLUDED."istaigaJar"`,
        [
            failasIds, md5s, sources,
            s0s, s1s, s2s,
            autoriai, pavadinimai, extensions,
            wordCounts, pageCounts, charCounts,
            CLASS, TYPE,
            locEwkts, istaigaJars,
        ],
    );
    const insertMs = Date.now() - insertStart;

    return { inserted: built.length, skipped, fsMs, insertMs };
}

// Fetch a slice of failai by id range (for backfill).
export async function fetchFailaiSlice(afterId, limit) {
    const { rows } = await postgres.query(
        `SELECT ${FAILAI_SELECT_COLUMNS}
         FROM public.files f
         ${FAILAI_ISTAIGA_JOINS}
         WHERE f.id > $1
         ORDER BY f.id
         LIMIT $2`,
        [afterId, limit],
    );
    return rows;
}

// Fetch specific failai by id list (for queue consumer).
export async function fetchFailaiByIds(ids, db = postgres) {
    if (!ids.length) return [];
    const { rows } = await db.query(
        `SELECT ${FAILAI_SELECT_COLUMNS}
         FROM public.files f
         ${FAILAI_ISTAIGA_JOINS}
         WHERE f.id = ANY($1)`,
        [ids],
    );
    return rows;
}

// Remove dokumentai rows whose failai source was deleted. Returns the md5s
// that were removed (caller may want to GC sidecar files, though those may
// be shared across multiple dokumentai with the same md5 — leave them alone
// by default).
export async function deleteDokumentaiByFailasIds(failasIds, db = postgres) {
    if (!failasIds.length) return [];
    const { rows } = await db.query(
        `DELETE FROM public.dokumentai
         WHERE "failasId" = ANY($1)
         RETURNING md5`,
        [failasIds],
    );
    return rows.map((r) => r.md5).filter(Boolean);
}
