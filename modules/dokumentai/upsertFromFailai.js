import { postgres } from "../../postgres/postgres.js";
import { saveDokumentasFs } from "./dokumentaiFs.js";
import { readMetaduomenysFs } from "../failai/metaduomenysFs.js";

const SIDECAR_VERSION = "1";
const CLASS = "viesiejiPirkimai";
const TYPE = "failas";
const FS_CONCURRENCY = 32;

// NULL and 'sutartis' both mean the legacy CVP IS archive (sutartys) source.
export function normalizeSource(saltinis) {
    if (saltinis == null || saltinis === "sutartis") return "sutartys";
    return saltinis;
}

// See docs/dokumentai-migracija.md → "saltinioId layout per source".
export function splitSaltinioId(saltinis, saltinioId, dokId, fileId) {
    if (saltinis == null || saltinis === "sutartys" || saltinis === "sutartis") {
        return [
            dokId == null ? null : String(dokId),
            fileId == null ? null : String(fileId),
            null,
        ];
    }
    if (saltinioId == null) return [null, null, null];
    if (saltinis === "cvpp") {
        const parts = saltinioId.split("/");
        if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
        if (parts.length === 2) return [null, parts[0], parts[1]];
        return [saltinioId, null, null];
    }
    if (saltinis === "cvpIs") {
        const parts = saltinioId.split("/");
        return [parts[0] ?? null, parts[1] ?? null, parts[2] ?? null];
    }
    return [saltinioId, null, null];
}

async function buildPayload(row) {
    const [s0, s1, s2] = splitSaltinioId(row.saltinis, row.saltinioId, row.dokId, row.fileId);
    const metadata = row.metaduomenysHash ? await readMetaduomenysFs(row.metaduomenysHash) : null;
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
        text: row.tekstas ?? null,
        metadata,
    };
    return { row, s0, s1, s2, sidecar };
}

// Columns the failai SELECT must return for upsertBatch. Used by both the
// backfill (id-range CTE) and the queue consumer (id = ANY).
export const FAILAI_SELECT_COLUMNS = `
    f.id, f.md5, f.saltinis, f."saltinioId",
    f."dokId", f."fileId",
    f.autorius, f.pavadinimas, f.extension,
    f."zodziuSkaicius", f."puslapiuSkaicius", f."simboliuSkaicius",
    f."metaduomenysHash",
    ST_AsEWKT(f.location) AS location_ewkt
`;

// Take an array of failai rows (with t.tekstas joined), write sidecars in
// parallel, then bulk-upsert dokumentai. Returns timings + counts.
export async function upsertBatch(rows) {
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
    let cursor = 0;
    async function worker() {
        while (cursor < ready.length) {
            const row = ready[cursor++];
            const b = await buildPayload(row);
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

    const insertStart = Date.now();
    await postgres.query(
        `INSERT INTO public.dokumentai (
            "failasId", md5, class, type, source,
            "saltinioId0", "saltinioId1", "saltinioId2",
            autorius, pavadinimas, extension,
            "wordCount", "pageCount", "characterCount",
            location
         )
         SELECT
            t."failasId", t.md5, $13::text, $14::text, t.source,
            t.s0, t.s1, t.s2,
            t.autorius, t.pavadinimas, t.extension,
            t."wordCount", t."pageCount", t."charCount",
            CASE WHEN t.loc IS NULL THEN NULL ELSE ST_GeogFromText(t.loc) END
         FROM unnest(
            $1::bigint[], $2::text[], $3::text[],
            $4::text[], $5::text[], $6::text[],
            $7::text[], $8::text[], $9::text[],
            $10::int[], $11::int[], $12::int[],
            $15::text[]
         ) AS t("failasId", md5, source, s0, s1, s2,
                autorius, pavadinimas, extension,
                "wordCount", "pageCount", "charCount", loc)
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
            location        = EXCLUDED.location`,
        [
            failasIds, md5s, sources,
            s0s, s1s, s2s,
            autoriai, pavadinimai, extensions,
            wordCounts, pageCounts, charCounts,
            CLASS, TYPE,
            locEwkts,
        ],
    );
    const insertMs = Date.now() - insertStart;

    return { inserted: built.length, skipped, fsMs, insertMs };
}

// Fetch a slice of failai by id range (for backfill).
export async function fetchFailaiSlice(afterId, limit) {
    const { rows } = await postgres.query(
        `WITH base AS (
            SELECT ${FAILAI_SELECT_COLUMNS}
            FROM public.failai f
            WHERE f.id > $1
            ORDER BY f.id
            LIMIT $2
        )
        SELECT b.*, t.tekstas
        FROM base b
        LEFT JOIN public."failaiTekstas" t ON t.id = b.id
        ORDER BY b.id`,
        [afterId, limit],
    );
    return rows;
}

// Fetch specific failai by id list (for queue consumer).
export async function fetchFailaiByIds(ids) {
    if (!ids.length) return [];
    const { rows } = await postgres.query(
        `SELECT ${FAILAI_SELECT_COLUMNS}, t.tekstas
         FROM public.failai f
         LEFT JOIN public."failaiTekstas" t ON t.id = f.id
         WHERE f.id = ANY($1)`,
        [ids],
    );
    return rows;
}

// Remove dokumentai rows whose failai source was deleted. Returns the md5s
// that were removed (caller may want to GC sidecar files, though those may
// be shared across multiple dokumentai with the same md5 — leave them alone
// by default).
export async function deleteDokumentaiByFailasIds(failasIds) {
    if (!failasIds.length) return [];
    const { rows } = await postgres.query(
        `DELETE FROM public.dokumentai
         WHERE "failasId" = ANY($1)
         RETURNING md5`,
        [failasIds],
    );
    return rows.map((r) => r.md5).filter(Boolean);
}
