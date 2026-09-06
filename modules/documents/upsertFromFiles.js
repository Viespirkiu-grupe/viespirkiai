import { postgres } from "../../postgres/postgres.js";
import { saveDocumentFs } from "./documentsFs.js";
import { readFailaiFs } from "../failai/failaiFs.js";

const SIDECAR_VERSION = "1";
const CLASS = "viesiejiPirkimai";
const TYPE = "failas";
const PROTOCOL = "https";
const HOST = "viespirkiai.org";
const FS_CONCURRENCY = 32;

// NULL and 'sutartis' both mean the legacy CVP IS archive (sutartys) source.
export function normalizeSource(saltinis) {
    if (saltinis == null || saltinis === "sutartis") return "sutartys";
    return saltinis;
}

// `files` jau laiko šaltinio ID išskaidytą po stulpelius (žr. failuIrasymas.js
// SALTINIAI), tad čia nieko nebedalinam — tik suvienodinam vieną skirtumą:
// senoje cvpp formoje be `pid` saltinioId0 buvo NULL, o `files` toje pozicijoje
// laiko `-1`. Grąžinam NULL, kad sidecar reikšmės nepasikeistų.
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
// Dauguma jų keliauja tik į sidecar: pati documents.documents eilutė turinio
// metaduomenų nedubliuoja – md5, pavadinimą, autorių, plėtinį, šaltinio ID ir
// apimtis ji paveldi iš files.files per "fileId" (žr. documents."documentsFull").
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
    COALESCE(
        vp."jarKodas",
        s."perkanciosiosOrganizacijosKodas",
        (SELECT nd."jarKodas"
         FROM "neskelbiamosDerybos"."sutikimai" nd
         WHERE st.title = 'neskelbiamosDerybos'
           AND nd."failoKelias" = f."sourceId0"
         LIMIT 1)
    ) AS "istaigaJar"
`;

// LEFT JOIN'ai: žodynai, turinio hash'as ir šaltinių lentelės "istaigaJar"
// apskaičiavimui. Raktai remiasi tik į atrenkamus stulpelius, todėl tinka ir
// backfill'ui, ir eilės vartotojui.
// viesiejiPirkimai.pirkimoId UNIQUE, vpmSutartys."sutartys"."unikalusId" PK — eilučių nedaugina.
// neskelbiamosDerybos "failoKelias" NEunikalus (PK = hash; vienas dokumentas
// dengia kelis sutikimus), todėl jis imamas skaliariniu subquery (LIMIT 1)
// FAILAI_SELECT_COLUMNS viduje, ne JOIN'u. Anksčiau čia buvo lyginama su
// 'https://eviesiejipirkimai.lt/' || sourceId0, o šaltinis duoda santykinį
// kelią — sąlyga nesutapdavo niekada ir "istaigaJar" likdavo tuščias.
//
// files."locations" čia nebejungiamas: koordinates dokumentas paveldi iš failo.
export const FAILAI_ISTAIGA_JOINS = `
    LEFT JOIN files."md5"            m   ON m.id   = f."md5Id"
    LEFT JOIN files."filenames"      fn  ON fn.id  = f."filenameId"
    LEFT JOIN files."extensions"     e   ON e.id   = f."extensionId"
    LEFT JOIN files."authors"        a   ON a.id   = f."authorId"
    LEFT JOIN files."sourceTitles"   st  ON st.id  = f."sourceTitleId"
    LEFT JOIN files."dataExtraction" d   ON d.id   = f.id
    LEFT JOIN files."infoFiles"      i   ON i.id   = f.id
    LEFT JOIN "eppsViesiejiPirkimai"."pirkimai" vp
        ON vp."pirkimoId" = CASE
            WHEN st.title = 'cvpIs' AND f."sourceId0" ~ '^[0-9]+$'
            THEN f."sourceId0"::integer
            ELSE NULL
        END
    LEFT JOIN "vpmSutartys"."sutartys" s
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
            await saveDocumentFs(row.md5, b.sidecar);
            built.push(b);
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(FS_CONCURRENCY, ready.length) }, worker),
    );
    const fsMs = Date.now() - fsStart;

    if (built.length === 0) return { inserted: 0, skipped, fsMs, insertMs: 0 };

    const fileIds = built.map((b) => b.row.id);
    const sources = built.map((b) => normalizeSource(b.row.saltinis));
    const istaigaJars = built.map((b) => b.row.istaigaJar);

    // Failais paremta eilutė laiko tik tai, ko `files` neturi: tapatybę,
    // adresą, klasifikaciją ir įstaigos kodą. Žodynų raktus išsprendžia DB.
    const insertStart = Date.now();
    await db.query(
        `INSERT INTO documents.documents (
            "fileId", "typeId", "sourceId", "protocolId", "hostId",
            path, "institutionJarCode"
         )
         SELECT
            t."fileId",
            documents.type_id($4, $5),
            documents.source_id(t.source),
            documents.protocol_id($6),
            documents.host_id($7),
            '/failas/' || t."fileId"::text,
            CASE WHEN t."istaigaJar" ~ '^[0-9]{9}$' THEN t."istaigaJar"::integer END
         FROM unnest($1::int[], $2::text[], $3::text[])
              AS t("fileId", source, "istaigaJar")
         ON CONFLICT ("fileId") WHERE "fileId" IS NOT NULL DO UPDATE SET
            "typeId"             = EXCLUDED."typeId",
            "sourceId"           = EXCLUDED."sourceId",
            "protocolId"         = EXCLUDED."protocolId",
            "hostId"             = EXCLUDED."hostId",
            path                 = EXCLUDED.path,
            "institutionJarCode" = EXCLUDED."institutionJarCode"`,
        [fileIds, sources, istaigaJars, CLASS, TYPE, PROTOCOL, HOST],
    );
    const insertMs = Date.now() - insertStart;

    return { inserted: built.length, skipped, fsMs, insertMs };
}

// Fetch a slice of failai by id range (for backfill).
export async function fetchFailaiSlice(afterId, limit) {
    const { rows } = await postgres.query(
        `SELECT ${FAILAI_SELECT_COLUMNS}
         FROM files.files f
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
         FROM files.files f
         ${FAILAI_ISTAIGA_JOINS}
         WHERE f.id = ANY($1)`,
        [ids],
    );
    return rows;
}

// Remove documents rows whose files source was deleted. Returns the md5s that
// were removed (caller may want to GC sidecar files, though those may be shared
// across multiple documents with the same md5 — leave them alone by default).
//
// md5 pačioje eilutėje nebesaugomas, tad jis imamas iš failo prieš trynimą.
export async function deleteDocumentsByFileIds(fileIds, db = postgres) {
    if (!fileIds.length) return [];
    const { rows } = await db.query(
        `WITH doomed AS (
            SELECT d.id, m.md5
            FROM documents.documents d
            JOIN files.files f    ON f.id = d."fileId"
            LEFT JOIN files."md5" m ON m.id = f."md5Id"
            WHERE d."fileId" = ANY($1)
         ), removed AS (
            DELETE FROM documents.documents
            WHERE id IN (SELECT id FROM doomed)
         )
         SELECT md5 FROM doomed`,
        [fileIds],
    );
    return rows.map((r) => r.md5).filter(Boolean);
}
