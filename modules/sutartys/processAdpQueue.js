import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import {
    createSutartysSpintaClient,
    isSutartysSpintaConfigured,
    syncSutartysToSpinta,
} from "./spintaSync.js";

export async function processSutartysAdpQueue() {
    if (!isSutartysSpintaConfigured()) return false;

    // Eilutė laikoma užrakinta transakcijoje ir ištrinama tik po sėkmingo
    // sync'o — procesui nulūžus bet kuriuo momentu (net SIGKILL/OOM),
    // rollback'as / atsijungimas grąžina ją į eilę.
    const client = await postgres.connect();
    try {
        await client.query("BEGIN");
        const { rows } = await client.query(
            `SELECT "unikalusId"
             FROM public."vpmSutartysAdpQueue"
             ORDER BY "queuedAt"
             FOR UPDATE SKIP LOCKED
             LIMIT 1`,
        );
        if (rows.length === 0) {
            await client.query("COMMIT");
            return false;
        }

        const id = Number(rows[0].unikalusId);
        const stats = await syncSutartysToSpinta({
            ids: [id],
            spinta: createSutartysSpintaClient(),
        });
        log(
            `vpmSutartysAdpQueue id=${id} | insert=${stats.insert} patch=${stats.patch} delete=${stats.delete} unchanged=${stats.unchanged}`,
        );

        await client.query(
            `DELETE FROM public."vpmSutartysAdpQueue"
             WHERE "unikalusId" = $1`,
            [id],
        );
        await client.query("COMMIT");
        return true;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    try {
        while (await processSutartysAdpQueue()) {}
    } catch (error) {
        console.error("Klaida apdorojant vpmSutartysAdpQueue:", error);
        process.exitCode = 1;
    } finally {
        await postgres.end();
    }
}
