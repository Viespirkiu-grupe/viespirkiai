import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { Logger } from "../../utils/log.js";
import { pathToFileURL } from "node:url";

const logger = new Logger();

const BATCH_SIZE = 2500;
const LENTELE = "viesiejiPirkimai";

/**
 * Drain one viesiejiPirkimaiIndexQueue batch into Quickwit.
 *
 * @param {{ shard?: number, shardCount?: number }} [opts]
 * @returns {Promise<boolean>} true when work was done.
 */
export async function processViesiejiPirkimaiIndexQueue({ shard, shardCount } = {}) {
    const sharded = shardCount > 1;
    const client = await postgres.connect();
    try {
        await client.query("BEGIN");

        const claim = sharded
            ? `SELECT id, "pirkimoId", keitimas
               FROM "viesiejiPirkimaiIndexQueue"
               WHERE abs(hashtext("pirkimoId")::bigint) % $2 = $3
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`
            : `SELECT id, "pirkimoId", keitimas
               FROM "viesiejiPirkimaiIndexQueue"
               ORDER BY id
               LIMIT $1
               FOR UPDATE SKIP LOCKED`;
        const claimParams = sharded
            ? [BATCH_SIZE, shardCount, shard]
            : [BATCH_SIZE];
        const { rows: queue } = await client.query(claim, claimParams);

        if (!queue.length) {
            await client.query("COMMIT");
            logger.log(`viesiejiPirkimaiIndexQueue${sharded ? `[${shard}/${shardCount}]` : ""}: empty`);
            return false;
        }

        logger.log(`viesiejiPirkimaiIndexQueue${sharded ? `[${shard}/${shardCount}]` : ""}: claimed ${queue.length} rows`);

        const claimedIds = queue.map((row) => row.id);
        const priority = { delete: 0, patch: 1, insert: 2 };
        const deduped = new Map();

        for (const row of queue) {
            const key = String(row.pirkimoId);
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
                 WHERE "lentele" = $1 AND "eilutesId" = ANY($2::bigint[])`,
                [LENTELE, toDelete.map(toEilutesId)],
            );
            logger.log(`deleted ${toDelete.length} viesiejiPirkimai from quickwit`);
        }

        if (toIndex.length) {
            const { rows } = await client.query(
                `SELECT
                    "pirkimoId", pavadinimas, "pirkimoVykdytojas", informacija,
                    "paskelbimoData", "pasiulymuPateikimoTerminas",
                    "pirkimoBudas", statusas, "numatomaBendraPirkimoVerte",
                    zingsnis, type, "numatomaVerteEUR", "bvpzKodai",
                    "pirkimoObjektoTipas", "esFinansavimas",
                    "pirkimoVykdytojasId", "jarKodas"
                 FROM public."viesiejiPirkimai"
                 WHERE "pirkimoId" = ANY($1::text[])`,
                [toIndex],
            );

            const found = new Set(rows.map((row) => String(row.pirkimoId)));
            const vanished = toIndex.filter((id) => !found.has(id));

            if (rows.length) {
                const items = rows.map((row) => ({
                    eilutesId: toEilutesId(row.pirkimoId),
                    doc: buildDoc(row),
                }));
                const totalBytes = items.reduce(
                    (sum, item) => sum + Buffer.byteLength(JSON.stringify(item.doc), "utf8"),
                    0,
                );
                const avgBytes = Math.round(totalBytes / items.length);
                const t0 = Date.now();

                logger.log(`indexing ${items.length} viesiejiPirkimai into Quickwit...`);
                await indexDocs(LENTELE, items, { commit: "auto" });

                const elapsedMs = Date.now() - t0;
                const mbPerSec = (totalBytes / 1024 / 1024) / (elapsedMs / 1000);
                logger.log(
                    `indexed ${items.length} viesiejiPirkimai | avg ${fmtBytes(avgBytes)} / doc | total ${fmtBytes(totalBytes)} in ${elapsedMs}ms = ${mbPerSec.toFixed(2)} MiB/s`,
                );
            }

            if (vanished.length) {
                await client.query(
                    `DELETE FROM "quickwitEilutes"
                     WHERE "lentele" = $1 AND "eilutesId" = ANY($2::bigint[])`,
                    [LENTELE, vanished.map(toEilutesId)],
                );
                logger.log(`deleted ${vanished.length} vanished viesiejiPirkimai from quickwit`);
            }
        }

        await client.query(
            `DELETE FROM "viesiejiPirkimaiIndexQueue" WHERE id = ANY($1::bigint[])`,
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

export function buildDoc(row) {
    const bvpzKodai = compact(row.bvpzKodai ?? []);
    const tekstas = foldLithuanian(compact([
        row.pavadinimas,
        row.pirkimoId,
        row.pirkimoVykdytojas,
        row.informacija,
        row.jarKodas,
        row.pirkimoVykdytojasId,
        row.pirkimoBudas,
        row.statusas,
        row.zingsnis,
        row.type,
        row.pirkimoObjektoTipas,
        ...bvpzKodai,
    ]).join(" "));

    return {
        pirkimoId: String(row.pirkimoId),
        tekstas,
        pavadinimas: row.pavadinimas,
        pirkimoVykdytojas: row.pirkimoVykdytojas,
        informacija: row.informacija,
        jarKodas: row.jarKodas,
        pirkimoVykdytojasId: row.pirkimoVykdytojasId,
        pirkimoBudas: row.pirkimoBudas,
        statusas: row.statusas,
        zingsnis: row.zingsnis,
        type: row.type,
        pirkimoObjektoTipas: row.pirkimoObjektoTipas,
        bvpzKodai,
        esFinansavimas: row.esFinansavimas,
        numatomaBendraPirkimoVerte: toNumber(row.numatomaBendraPirkimoVerte),
        numatomaVerteEUR: toNumber(row.numatomaVerteEUR),
        paskelbimoData: toRfc3339(row.paskelbimoData) ?? new Date().toISOString(),
        pasiulymuPateikimoTerminas: toRfc3339(row.pasiulymuPateikimoTerminas),
    };
}

function toEilutesId(pirkimoId) {
    if (!/^\d+$/.test(String(pirkimoId))) {
        throw new Error(`viesiejiPirkimai.pirkimoId is not numeric: ${pirkimoId}`);
    }
    return String(pirkimoId);
}

function compact(values) {
    return values.filter((value) => value != null && value !== "");
}

function foldLithuanian(str) {
    return str.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
}

function toNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toRfc3339(value) {
    if (value == null) return null;
    if (typeof value === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) {
            return `${value.replace(" ", "T")}Z`;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    drainViesiejiPirkimaiIndexQueue()
        .catch((error) => {
            console.error(`Nepavyko apdoroti viesiejiPirkimaiIndexQueue: ${error.message}`);
            process.exitCode = 1;
        })
        .finally(async () => postgres.end());
}

async function drainViesiejiPirkimaiIndexQueue() {
    let batches = 0;
    while (await processViesiejiPirkimaiIndexQueue()) {
        batches++;
    }
    logger.log(`viesiejiPirkimaiIndexQueue: drained ${batches} batch(es)`);
}
