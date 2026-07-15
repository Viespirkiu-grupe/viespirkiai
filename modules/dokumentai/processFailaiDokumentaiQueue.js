import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import {
    fetchFailaiByIds,
    upsertBatch,
    deleteDokumentaiByFailasIds,
} from "./upsertFromFailai.js";

const BATCH_SIZE = 500;

export async function processFailaiDokumentaiQueue() {
    const client = await postgres.connect();
    try {
        await client.query("BEGIN");

        // Keep rows locked, but present, until all downstream work succeeds.
        // An error rolls the claim back instead of losing the entire batch.
        const { rows: queue } = await client.query(
            `SELECT id, "failoId", keitimas
             FROM "failaiDokumentaiQueue"
             ORDER BY id
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [BATCH_SIZE],
        );

        if (!queue.length) {
            await client.query("COMMIT");
            return false;
        }

        // Dedup per failoId: delete > patch > insert.
        const priority = { delete: 0, patch: 1, insert: 2 };
        const deduped = new Map();
        for (const row of queue) {
            const existing = deduped.get(row.failoId);
            if (!existing || priority[row.keitimas] < priority[existing]) {
                deduped.set(row.failoId, row.keitimas);
            }
        }

        const toDelete = [...deduped.entries()]
            .filter(([, k]) => k === "delete")
            .map(([id]) => id);

        const toUpsert = [...deduped.entries()]
            .filter(([, k]) => k === "insert" || k === "patch")
            .map(([id]) => id);

        let deleted = 0;
        let inserted = 0;
        let skipped = 0;

        if (toDelete.length) {
            const removed = await deleteDokumentaiByFailasIds(toDelete, client);
            deleted = removed.length;
            // NOTE: sidecar JSON files keyed by md5 are NOT removed — same md5 may
            // be shared by other dokumentai. A separate GC job can sweep orphans.
        }

        if (toUpsert.length) {
            const rows = await fetchFailaiByIds(toUpsert, client);
            // Some toUpsert ids may have been deleted from failai between
            // enqueue and now — they just won't come back from the SELECT.
            const r = await upsertBatch(rows, client);
            inserted = r.inserted;
            skipped = r.skipped;
        }

        await client.query(
            `DELETE FROM "failaiDokumentaiQueue" WHERE id = ANY($1::bigint[])`,
            [queue.map((row) => row.id)],
        );
        await client.query("COMMIT");

        logger.log(
            `failaiDokumentaiQueue: claimed ${queue.length} (deduped ${deduped.size}) | upserted ${inserted} | skipped ${skipped} | deleted ${deleted}`,
        );
        return true;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    while (await processFailaiDokumentaiQueue()) {}
    await postgres.end();
    process.exit(0);
}
