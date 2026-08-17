import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";
import { buildJuridiniaiUpsertSql } from "./backfill.js";
import { JURIDINIAI_SOURCE_REFRESH_LOCK } from "./locks.js";

const DEFAULT_BATCH_SIZE = 1_000;

export const REFRESH_BATCH_SQL = buildJuridiniaiUpsertSql(
    `SELECT jar_person.*
     FROM public."jarAsmenys" jar_person
     WHERE jar_person."jarKodas" = ANY($1::integer[])`,
    `SELECT
        (SELECT count(*)::integer FROM batch) AS "found",
        (SELECT count(*)::integer FROM upserted) AS "changed"`,
);

function parseBatchSize(argv) {
    const inline = argv.find((arg) => arg.startsWith("--batch-size="));
    const separateAt = argv.indexOf("--batch-size");
    const raw = inline?.slice("--batch-size=".length) ??
        (separateAt >= 0 ? argv[separateAt + 1] : DEFAULT_BATCH_SIZE);
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 10_000) {
        throw new Error("--batch-size turi būti sveikasis skaičius nuo 1 iki 10000");
    }
    return value;
}

export async function processJuridiniaiRefreshQueue(
    { batchSize = DEFAULT_BATCH_SIZE, onProgress } = {},
    db = postgres,
) {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        const lock = await client.query(
            `SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS locked`,
            [JURIDINIAI_SOURCE_REFRESH_LOCK],
        );
        if (!lock.rows[0]?.locked) {
            await client.query("COMMIT");
            return false;
        }
        const claimed = await client.query(
            `SELECT "jarKodas"
             FROM public."juridiniaiRefreshQueue"
             ORDER BY "sukurta", "jarKodas"
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [batchSize],
        );
        const codes = claimed.rows.map((row) => Number(row.jarKodas));
        if (!codes.length) {
            await client.query("COMMIT");
            return false;
        }

        onProgress?.({ stage: "claimed", count: codes.length });

        const projected = await client.query(REFRESH_BATCH_SQL, [codes]);
        const removed = await client.query(
            `DELETE FROM public."juridiniai" j
             WHERE j."jarKodas" = ANY($1::text[])
               AND NOT EXISTS (
                   SELECT 1 FROM public."jarAsmenys" source
                   WHERE source."jarKodas"::text = j."jarKodas"
               )`,
            [codes.map(String)],
        );
        await client.query(
            `DELETE FROM public."juridiniaiRefreshQueue"
             WHERE "jarKodas" = ANY($1::integer[])`,
            [codes],
        );
        await client.query("COMMIT");

        const changed = Number(projected.rows[0]?.changed ?? 0) + removed.rowCount;
        onProgress?.({
            stage: "completed",
            count: codes.length,
            changed,
        });
        if (changed > 0) {
            signalWork(WORK_SIGNALS.JURIDINIAI_INDEX_READY, {
                source: "juridiniai-refresh",
                count: changed,
            });
        }
        return true;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const batchSize = parseBatchSize(process.argv.slice(2));
    let batches = 0;
    let processed = 0;
    let changed = 0;
    try {
        const pending = await postgres.query(
            `SELECT count(*)::integer AS count
             FROM public."juridiniaiRefreshQueue"`,
        );
        console.log(
            `Juridinių atnaujinimo eilėje laukia ` +
            `${Number(pending.rows[0]?.count ?? 0)} kodų; paketas ${batchSize}`,
        );

        while (true) {
            const batchNumber = batches + 1;
            const worked = await processJuridiniaiRefreshQueue({
                batchSize,
                onProgress: (progress) => {
                    if (progress.stage === "claimed") {
                        console.log(
                            `Paketas ${batchNumber}: perskaičiuojama ` +
                            `${progress.count} kodų...`,
                        );
                    } else {
                        processed += progress.count;
                        changed += progress.changed;
                        console.log(
                            `Paketas ${batchNumber}: baigtas; iš viso ` +
                            `peržiūrėta ${processed}, pakeista ${changed}`,
                        );
                    }
                },
            });
            if (!worked) break;
            batches++;
        }
        console.log(
            `Juridinių atnaujinimo eilė ištuštinta: paketų ${batches}, ` +
            `peržiūrėta ${processed}, pakeista ${changed}`,
        );
    } finally {
        await postgres.end();
    }
}
