import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { Logger } from "../../utils/log.js";
import { pathToFileURL } from "node:url";
import { DateTime } from "luxon";

const logger = new Logger();

const BATCH_SIZE = 2500;
const LENTELE = "sutartys";

/**
 * Drain one sutartysIndexQueue batch into Quickwit.
 *
 * Queue rows stay locked inside the transaction until the Quickwit ingest and
 * quickwitEilutes cleanup have succeeded. Any error rolls the batch back.
 *
 * @param {{ shard?: number, shardCount?: number }} [opts]
 * @returns {Promise<boolean>} true when work was done.
 */
export async function processSutartysIndexQueue({ shard, shardCount } = {}) {
    const sharded = shardCount > 1;
    const client = await postgres.connect();
    try {
        await client.query("BEGIN");

        const claim = sharded
            ? `SELECT id, "sutartiesUnikalusId", keitimas
               FROM "sutartysIndexQueue"
               WHERE abs(hashtext("sutartiesUnikalusId"::text)::bigint) % $2 = $3
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`
            : `SELECT id, "sutartiesUnikalusId", keitimas
               FROM "sutartysIndexQueue"
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`;
        const claimParams = sharded
            ? [BATCH_SIZE, shardCount, shard]
            : [BATCH_SIZE];
        const { rows: queue } = await client.query(claim, claimParams);

        if (!queue.length) {
            await client.query("COMMIT");
            logger.log(`sutartysIndexQueue${sharded ? `[${shard}/${shardCount}]` : ""}: empty`);
            return false;
        }

        logger.log(`sutartysIndexQueue${sharded ? `[${shard}/${shardCount}]` : ""}: claimed ${queue.length} rows`);

        const claimedIds = queue.map((row) => row.id);
        const priority = { delete: 0, patch: 1, insert: 2 };
        const deduped = new Map();

        for (const row of queue) {
            const key = row.sutartiesUnikalusId;
            const existing = deduped.get(key);
            if (!existing || priority[row.keitimas] < priority[existing]) {
                deduped.set(key, row.keitimas);
            }
        }

        const toDelete = [...deduped.entries()]
            .filter(([, change]) => change === "delete")
            .map(([id]) => id);
        const toIndex = [...deduped.entries()]
            .filter(([, change]) => change === "insert" || change === "patch")
            .map(([id]) => id);

        if (toDelete.length) {
            await client.query(
                `DELETE FROM "quickwitEilutes"
                 WHERE "lentelesId" = (SELECT id FROM "quickwitLenteles" WHERE "lentele" = $1)
                   AND "eilutesId" = ANY($2::bigint[])`,
                [LENTELE, toDelete.map(String)],
            );
            logger.log(`deleted ${toDelete.length} sutartys from quickwit`);
        }

        if (toIndex.length) {
            const { rows } = await client.query(
                `SELECT
                    "sutartiesUnikalusId", pavadinimas, "sutartiesNumeris",
                    "pirkimoNumeris", tipas, kategorija,
                    "perkanciojiOrganizacija", "perkanciosiosOrganizacijosKodas",
                    tiekejas, "tiekejoKodas", "papildomiTiekejai",
                    "papildomiTiekejaiKodai", "bvpzKodas", "papildomiBvpzKodai",
                    "bvpzPavadinimas", "papildomiBvpzPavadinimai",
                    verte, suma, "faktineIvykdimoVerte", "dokumentuKiekis",
                    "sudarymoData", "paskelbimoData", "galiojimoData",
                    "faktineIvykdimoData", "paskutinioRedagavimoData",
                    "paskutinioAtnaujinimoData"
                 FROM public.sutartys
                 WHERE "sutartiesUnikalusId" = ANY($1::bigint[])
                   AND NOT COALESCE(istrinta, false)`,
                [toIndex],
            );

            const found = new Set(rows.map((row) => String(row.sutartiesUnikalusId)));
            const vanished = toIndex
                .map(String)
                .filter((id) => !found.has(id));

            if (rows.length) {
                const items = rows.map((row) => ({
                    eilutesId: String(row.sutartiesUnikalusId),
                    doc: buildDoc(row),
                }));
                const totalBytes = items.reduce(
                    (sum, item) => sum + Buffer.byteLength(JSON.stringify(item.doc), "utf8"),
                    0,
                );
                const avgBytes = Math.round(totalBytes / items.length);
                const t0 = Date.now();

                logger.log(`indexing ${items.length} sutartys into Quickwit...`);
                await indexDocs(LENTELE, items, { commit: "auto" });

                const elapsedMs = Date.now() - t0;
                const mbPerSec = (totalBytes / 1024 / 1024) / (elapsedMs / 1000);
                logger.log(
                    `indexed ${items.length} sutartys | avg ${fmtBytes(avgBytes)} / doc | total ${fmtBytes(totalBytes)} in ${elapsedMs}ms = ${mbPerSec.toFixed(2)} MiB/s`,
                );
            }

            if (vanished.length) {
                await client.query(
                    `DELETE FROM "quickwitEilutes"
                     WHERE "lentelesId" = (SELECT id FROM "quickwitLenteles" WHERE "lentele" = $1)
                       AND "eilutesId" = ANY($2::bigint[])`,
                    [LENTELE, vanished],
                );
                logger.log(`deleted ${vanished.length} vanished sutartys from quickwit`);
            }
        }

        await client.query(
            `DELETE FROM "sutartysIndexQueue" WHERE id = ANY($1::bigint[])`,
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

function buildDoc(row) {
    const tiekejai = compact([row.tiekejas, ...(row.papildomiTiekejai ?? [])]);
    const tiekejaiKodai = compact([row.tiekejoKodas, ...(row.papildomiTiekejaiKodai ?? [])]);
    const bvpzKodai = compact([row.bvpzKodas, ...(row.papildomiBvpzKodai ?? [])]);
    const bvpzPavadinimai = compact([row.bvpzPavadinimas, ...(row.papildomiBvpzPavadinimai ?? [])]);
    const tekstas = foldLithuanian(compact([
        row.pavadinimas,
        row.sutartiesNumeris,
        row.pirkimoNumeris,
        row.perkanciojiOrganizacija,
        row.perkanciosiosOrganizacijosKodas,
        ...tiekejai,
        ...tiekejaiKodai,
        ...bvpzPavadinimai,
        row.kategorija,
    ]).join(" "));

    return {
        sutartiesUnikalusId: toNumber(row.sutartiesUnikalusId),
        tekstas,
        pavadinimas: row.pavadinimas,
        perkanciojiOrganizacija: row.perkanciojiOrganizacija,
        tiekejai,
        bvpzPavadinimai,
        sutartiesNumeris: row.sutartiesNumeris,
        pirkimoNumeris: row.pirkimoNumeris,
        tipas: row.tipas,
        kategorija: row.kategorija,
        perkanciosiosOrganizacijosKodas: row.perkanciosiosOrganizacijosKodas,
        tiekejaiKodai,
        bvpzKodai,
        verte: toNumber(row.verte),
        suma: toNumber(row.suma),
        faktineIvykdimoVerte: toNumber(row.faktineIvykdimoVerte),
        dokumentuKiekis: toNumber(row.dokumentuKiekis),
        sudarymoData: toRfc3339(row.sudarymoData),
        paskelbimoData: toRfc3339(row.paskelbimoData),
        galiojimoData: toRfc3339(row.galiojimoData),
        faktineIvykdimoData: toRfc3339(row.faktineIvykdimoData),
        paskutinioRedagavimoData: toRfc3339(row.paskutinioRedagavimoData) ?? new Date().toISOString(),
        paskutinioAtnaujinimoData: toRfc3339(row.paskutinioAtnaujinimoData),
    };
}

function compact(values) {
    return values.filter((value) => value != null && value !== "");
}

function toNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function toRfc3339(value) {
    if (value == null) return null;
    if (typeof value === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) {
            const dt = DateTime.fromSQL(value, { zone: "Europe/Vilnius" });
            return dt.isValid ? dt.toUTC().toISO({ suppressMilliseconds: true }) : value;
        }
        return value;
    }
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

function foldLithuanian(str) {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .normalize("NFC");
}

function parseConcurrency(argv) {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const match = arg.match(/^--concurrency=(.+)$/);
        if (match) return match[1];
        if (arg === "--concurrency" || arg === "-c") return argv[i + 1];
    }
    return "1";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const RETRY_MS = 60_000;

    const concurrency = parseInt(parseConcurrency(process.argv.slice(2)), 10);
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        logger.log("Invalid --concurrency: expected an integer >= 1");
        process.exit(1);
    }

    logger.log(`starting sutartys Quickwit queue drain with concurrency=${concurrency}`);

    let stopping = false;
    const wakeups = new Set();
    const requestStop = (signal) => {
        if (stopping) {
            logger.log(`received ${signal} again, exiting now`);
            process.exit(130);
        }
        stopping = true;
        logger.log(`received ${signal}, finishing current work before exit...`);
        for (const resolve of wakeups) resolve();
    };
    process.on("SIGINT", () => requestStop("SIGINT"));
    process.on("SIGTERM", () => requestStop("SIGTERM"));

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

    async function worker(shard) {
        const opts = concurrency > 1 ? { shard, shardCount: concurrency } : {};
        while (!stopping) {
            try {
                const didWork = await processSutartysIndexQueue(opts);
                if (!didWork) break;
            } catch (err) {
                logger.log(
                    `processSutartysIndexQueue[${shard}] failed, retrying after ${RETRY_MS / 1000}s: ${err.message}`,
                );
                await sleep(RETRY_MS);
            }
        }
    }

    await Promise.all(
        Array.from({ length: concurrency }, (_, i) => worker(i)),
    );
    logger.log("sutartys Quickwit queue drain finished");
    await postgres.end();
    process.exit(0);
}
