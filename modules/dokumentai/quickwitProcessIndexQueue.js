import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
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

    // Deletes — drop the quickwitEilutes mapping. search's filterLive() then
    // stops matching the orphaned Quickwit doc (it lingers in the shard until
    // deleteDeadIndexes retires the whole shard). The quickwitEilutesGyvosDel
    // trigger decrements gyvosEilutes, which raises the generated
    // mirusiosEilutes — so counters need no manual touch here.
    if (toDelete.length) {
        await postgres.query(
            `DELETE FROM "quickwitEilutes"
             WHERE "lentele" = $1 AND "eilutesId" = ANY($2)`,
            [LENTELE, toDelete.map(String)],
        );
        logger.log(`deleted ${toDelete.length} from quickwit`);
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

            const totalBytes = items.reduce(
                (sum, it) => sum + Buffer.byteLength(JSON.stringify(it.doc), "utf8"),
                0,
            );
            const avgBytes = Math.round(totalBytes / items.length);
            const t0 = Date.now();
            await indexDocs(LENTELE, items, { commit: "force" });
            const elapsedMs = Date.now() - t0;
            const mbPerSec = (totalBytes / 1024 / 1024) / (elapsedMs / 1000);
            logger.log(
                `indexed ${items.length} dokumentai | avg ${fmtBytes(avgBytes)} / doc | total ${fmtBytes(totalBytes)} in ${elapsedMs}ms = ${mbPerSec.toFixed(2)} MiB/s`,
            );
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

function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / 1024 / 1024).toFixed(2)} MiB`;
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
            logger.log(`processDokumentaiIndexQueue klaida, kartosime po ${RETRY_MS / 1000}s: ${err.message}`);
            await new Promise((r) => setTimeout(r, RETRY_MS));
        }
    }
    await postgres.end();
    process.exit(0);
}
