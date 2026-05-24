import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { log } from "../../utils/log.js";
import { uuidv7 } from "../../utils/uuid.js";
import { readDokumentasFs } from "./dokumentaiFs.js";

const BATCH_SIZE = 500;
const LENTELE = "dokumentai";

export async function processDokumentaiIndexQueue() {
    // Claim oldest batch — DELETE ... RETURNING is atomic, multiple workers
    // can run concurrently without seeing the same rows.
    const { rows: queue } = await postgres.query(
        `DELETE FROM "dokumentaiIndexQueue"
         WHERE id IN (
           SELECT id FROM "dokumentaiIndexQueue"
           ORDER BY id
           LIMIT $1
         )
         RETURNING "dokumentoId", keitimas`,
        [BATCH_SIZE],
    );

    if (!queue.length) return false;

    // Dedup per dokumentoId. Priority: delete > patch > insert.
    const priority = { delete: 0, patch: 1, insert: 2 };
    const deduped = new Map();
    for (const row of queue) {
        const existing = deduped.get(row.dokumentoId);
        if (!existing || priority[row.keitimas] < priority[existing]) {
            deduped.set(row.dokumentoId, row.keitimas);
        }
    }

    const toDelete = [...deduped.entries()]
        .filter(([, k]) => k === "delete")
        .map(([id]) => id);

    const toIndex = [...deduped.entries()]
        .filter(([, k]) => k === "insert" || k === "patch")
        .map(([id]) => id);

    // Deletes — rotate quickwit IDs so search filters out the dead rows.
    // Use UUIDv7 (generated in node) so the new tombstone rows hit hot pages
    // in the quickwitId btree instead of random pages.
    if (toDelete.length) {
        const ids = toDelete.map(String);
        const newIds = toDelete.map(() => uuidv7());
        await postgres.query(
            `UPDATE "quickwitEilutes" qe
             SET "quickwitId" = v."quickwitId"::uuid
             FROM (SELECT UNNEST($2::text[]) AS "eilutesId",
                          UNNEST($3::text[]) AS "quickwitId") v
             WHERE qe."lentele" = $1 AND qe."eilutesId" = v."eilutesId"`,
            [LENTELE, ids, newIds],
        );
        await postgres.query(
            `UPDATE "quickwitIndeksai" qi
             SET "mirusiosEilutes" = "mirusiosEilutes" + sub.cnt
             FROM (
               SELECT "indeksas", COUNT(*) AS cnt
               FROM "quickwitEilutes"
               WHERE "lentele" = $1 AND "eilutesId" = ANY($2)
               GROUP BY "indeksas"
             ) sub
             WHERE qi."indeksas" = sub."indeksas"`,
            [LENTELE, toDelete.map(String)],
        );
        log(`deleted ${toDelete.length} from quickwit`);
    }

    // Inserts + patches — fetch DB row, merge with sidecar JSON, send to Quickwit.
    if (toIndex.length) {
        const { rows } = await postgres.query(
            `SELECT
                id, md5, class, type, parent,
                host, domain, url, source, "istaigaJar",
                "saltinioId0", "saltinioId1", "saltinioId2", "saltinioId3",
                autorius AS author, pavadinimas AS title,
                extension, "mimeType", language,
                "pageCount", "wordCount", "characterCount",
                savivaldybe, apskritis,
                CASE WHEN location IS NULL THEN NULL ELSE ST_Y(location::geometry) END AS lat,
                CASE WHEN location IS NULL THEN NULL ELSE ST_X(location::geometry) END AS lon,
                "discoveredAt", "createdAt", "updatedAt", "happenedAt"
             FROM public.dokumentai
             WHERE id = ANY($1)`,
            [toIndex],
        );

        if (rows.length) {
            const items = await Promise.all(
                rows.map(async (row) => {
                    const sidecar = row.md5 ? await readDokumentasFs(row.md5) : null;
                    const doc = buildDoc(row, sidecar);
                    return { eilutesId: String(row.id), doc };
                }),
            );

            await indexDocs(LENTELE, items);
            log(`indexed ${items.length} dokumentai`);
        }
    }

    return true;
}

function buildDoc(row, sidecar) {
    // DB row holds the queryable fields; sidecar holds the bulky / array /
    // free-form ones. Sidecar wins when both have a value (it's the source
    // of truth), DB row fills in when the sidecar is missing or partial.
    const s = sidecar || {};
    return {
        id: row.id,
        version: s.version ?? null,
        md5: row.md5,
        class: row.class,
        type: row.type,
        parent: row.parent,

        host: row.host,
        domain: row.domain,
        url: row.url,
        source: row.source,
        istaigaJar: row.istaigaJar,

        saltinioId0: row.saltinioId0,
        saltinioId1: row.saltinioId1,
        saltinioId2: row.saltinioId2,
        saltinioId3: row.saltinioId3,

        jarKodai: s.jarKodai ?? [],
        phones: s.phones ?? [],
        emails: s.emails ?? [],
        iban: s.iban ?? [],
        domains: s.domains ?? [],

        author: s.author ?? row.author ?? null,
        title: s.title ?? row.title ?? null,

        extension: row.extension,
        mimeType: row.mimeType,
        metadata: s.metadata ?? null,
        language: row.language,
        pageCount: row.pageCount,
        wordCount: row.wordCount,
        characterCount: row.characterCount,

        text: s.text ? foldLithuanian(s.text) : null,

        savivaldybe: row.savivaldybe,
        apskritis: row.apskritis,
        lat: row.lat,
        lon: row.lon,

        discoveredAt: toRfc3339(row.discoveredAt),
        createdAt: toRfc3339(row.createdAt),
        // Quickwit requires the timestamp_field (updatedAt) to be non-null.
        // Fall back to "now" when unknown — indexing time is a reasonable proxy.
        updatedAt: toRfc3339(row.updatedAt) ?? new Date().toISOString(),
        happenedAt: toRfc3339(row.happenedAt),
    };
}

function toRfc3339(v) {
    if (v == null) return null;
    if (typeof v === "string") return v;
    if (v instanceof Date) return v.toISOString();
    return String(v);
}

function foldLithuanian(str) {
    return str
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .normalize("NFC");
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const RETRY_MS = 60_000;
    // Daemon loop: drain the queue, retry after 60s on any error (e.g. Quickwit
    // 503). Exits cleanly only when the queue is empty.
    while (true) {
        try {
            const didWork = await processDokumentaiIndexQueue();
            if (!didWork) break;
        } catch (err) {
            log(`processDokumentaiIndexQueue klaida, kartosime po ${RETRY_MS / 1000}s: ${err.message}`);
            await new Promise((r) => setTimeout(r, RETRY_MS));
        }
    }
    await postgres.end();
    process.exit(0);
}
