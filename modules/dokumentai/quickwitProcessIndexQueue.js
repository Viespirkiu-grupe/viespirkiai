import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { readDokumentasFs } from "./dokumentaiFs.js";

const BATCH_SIZE = 500;
const LENTELE = "dokumentai";

/**
 * Nusausina vieną `dokumentaiIndexQueue` porciją į Quickwit.
 *
 * Eilutės NEnaikinamos iš anksto — visas darbas vyksta tranzakcijoje: porcija
 * pasiimama su `SELECT ... FOR UPDATE SKIP LOCKED` (uždaromos gretimiems
 * darbininkams), atliekamos šalutinės operacijos ir tik po sėkmingo `indexDocs`
 * eilutės ištrinamos ir tranzakcija COMMIT'inama. Bet kokia klaida → ROLLBACK,
 * eilutės lieka eilėje ir bus pakartotinai apdorotos (jokio duomenų praradimo).
 *
 * @param {{ shard?: number, shardCount?: number }} [opts]
 *   Kai `shardCount > 1`, imamos tik tos eilutės, kurių `dokumentoId` patenka į
 *   `shard` hash'o skiltį — taip vienas dokumentas visada priklauso vienam
 *   darbininkui (išsaugoma dokumento operacijų eiliškumas, nėra lenktynių).
 * @returns {Promise<boolean>} `true`, jei buvo apdorota eilučių; `false`, jei
 *   (šio shard'o) eilė tuščia.
 */
export async function processDokumentaiIndexQueue({ shard, shardCount } = {}) {
    const sharded = shardCount > 1;
    const client = await postgres.connect();
    try {
        await client.query("BEGIN");

        // Pasiimam seniausią porciją, užrakindami eilutes (gretimi darbininkai
        // jas praleidžia). Eilutės lieka eilėje iki COMMIT — jei kas nepavyks,
        // ROLLBACK jas grąžins ir bus pakartota.
        const claim = sharded
            ? `SELECT id, "dokumentoId", keitimas
               FROM "dokumentaiIndexQueue"
               WHERE abs(hashtext("dokumentoId"::text)::bigint) % $2 = $3
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`
            : `SELECT id, "dokumentoId", keitimas
               FROM "dokumentaiIndexQueue"
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`;
        const claimParams = sharded
            ? [BATCH_SIZE, shardCount, shard]
            : [BATCH_SIZE];
        const { rows: queue } = await client.query(claim, claimParams);

        if (!queue.length) {
            await client.query("COMMIT");
            return false;
        }

        const claimedIds = queue.map((r) => r.id);

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
            await client.query(
                `DELETE FROM "quickwitEilutes"
                 WHERE "lentele" = $1 AND "eilutesId" = ANY($2::bigint[])`,
                [LENTELE, toDelete.map(String)],
            );
            logger.log(`deleted ${toDelete.length} from quickwit`);
        }

        // Inserts + patches — fetch DB row, merge with sidecar JSON, send to Quickwit.
        if (toIndex.length) {
            const { rows } = await client.query(
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

            // Dokumentai, kurie insert/patch metu jau nebeegzistuoja
            // public.dokumentai — traktuojam kaip delete. Kitaip jų
            // quickwitEilutes žemėlapis liktų kaip našlaitis (orphan): našlaičio
            // niekas nebeišvalytų, o gyvosEilutes skaitiklis rodytų jį gyvą.
            // Palyginam tekstais (eilutesId yra text, id/dokumentoId — bigint).
            const found = new Set(rows.map((row) => String(row.id)));
            const vanished = toIndex
                .map(String)
                .filter((id) => !found.has(id));

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
                // Ne tranzakcinis, bet idempotentiškas: insert/patch pagal doc id,
                // tad pakartotinis indeksavimas (po ROLLBACK/crash) yra saugus.
                await indexDocs(LENTELE, items, { commit: "force" });
                const elapsedMs = Date.now() - t0;
                const mbPerSec = (totalBytes / 1024 / 1024) / (elapsedMs / 1000);
                logger.log(
                    `indexed ${items.length} dokumentai | avg ${fmtBytes(avgBytes)} / doc | total ${fmtBytes(totalBytes)} in ${elapsedMs}ms = ${mbPerSec.toFixed(2)} MiB/s`,
                );
            }

            // NE po `if (rows.length)` — jei dingo visa porcija, vis tiek reikia
            // išvalyti žemėlapius. Toje pačioje tranzakcijoje → atominiai; jei
            // eilutė žemėlapio neturi, DELETE tiesiog nieko neranda (saugu).
            if (vanished.length) {
                await client.query(
                    `DELETE FROM "quickwitEilutes"
                     WHERE "lentele" = $1 AND "eilutesId" = ANY($2::bigint[])`,
                    [LENTELE, vanished],
                );
                logger.log(`deleted ${vanished.length} vanished from quickwit`);
            }
        }

        // Tik dabar, kai visos šalutinės operacijos pavyko, pašalinam porciją.
        await client.query(
            `DELETE FROM "dokumentaiIndexQueue" WHERE id = ANY($1)`,
            [claimedIds],
        );
        await client.query("COMMIT");
        return true;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
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

function parseConcurrency(argv) {
    // --concurrency=N | --concurrency N | -c N ; default 1.
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const m = a.match(/^--concurrency=(.+)$/);
        if (m) return m[1];
        if (a === "--concurrency" || a === "-c") return argv[i + 1];
    }
    return "1";
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const RETRY_MS = 60_000;

    const concurrency = parseInt(parseConcurrency(process.argv.slice(2)), 10);
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        logger.log(`Netinkamas --concurrency: turi būti sveikas skaičius >= 1`);
        process.exit(1);
    }

    // Švarus stabdymas: SIGINT/SIGTERM pažymi `stopping`; darbininkai baigia
    // dabartinę porciją (tranzakcija visada užsidaro COMMIT/ROLLBACK) ir išeina.
    let stopping = false;
    const wakeups = new Set(); // pertraukiam laukiančius retry `sleep`'us
    const requestStop = (sig) => {
        if (stopping) return;
        stopping = true;
        logger.log(`gauta ${sig}, baigiame dabartinį darbą ir išeisime...`);
        for (const resolve of wakeups) resolve();
    };
    process.on("SIGINT", () => requestStop("SIGINT"));
    process.on("SIGTERM", () => requestStop("SIGTERM"));

    // Interruptible sleep — pabunda anksčiau, jei paprašyta sustoti.
    const sleep = (ms) =>
        new Promise((resolve) => {
            const timer = setTimeout(done, ms);
            function done() {
                clearTimeout(timer);
                wakeups.delete(done);
                resolve();
            }
            wakeups.add(done);
        });

    // Vienas darbininkas: sausina savo shard'ą kol jis ištuštėja arba paprašoma
    // sustoti; klaidos atveju laukia RETRY_MS (pvz. Quickwit 503) ir kartoja.
    async function worker(shard) {
        const opts = concurrency > 1 ? { shard, shardCount: concurrency } : {};
        while (!stopping) {
            try {
                const didWork = await processDokumentaiIndexQueue(opts);
                if (!didWork) break;
            } catch (err) {
                logger.log(
                    `processDokumentaiIndexQueue[${shard}] klaida, kartosime po ${RETRY_MS / 1000}s: ${err.message}`,
                );
                await sleep(RETRY_MS);
            }
        }
    }

    await Promise.all(
        Array.from({ length: concurrency }, (_, i) => worker(i)),
    );
    await postgres.end();
    process.exit(0);
}
