import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import {
    createSutartysSpintaClient,
    isSutartysSpintaConfigured,
    syncSutartysToSpinta,
} from "./spintaSync.js";

async function claimOne() {
    const { rows } = await postgres.query(
        `DELETE FROM public."sutartysAdpQueue"
         WHERE "sutartiesUnikalusId" = (
             SELECT "sutartiesUnikalusId"
             FROM public."sutartysAdpQueue"
             ORDER BY "queuedAt"
             FOR UPDATE SKIP LOCKED
             LIMIT 1
         )
         RETURNING "sutartiesUnikalusId"`,
    );
    return rows[0] ?? null;
}

export async function processSutartysAdpQueue() {
    if (!isSutartysSpintaConfigured()) return false;
    const claimed = await claimOne();
    if (!claimed) return false;

    const id = Number(claimed.sutartiesUnikalusId);
    try {
        const stats = await syncSutartysToSpinta({
            ids: [id],
            spinta: createSutartysSpintaClient(),
        });
        log(
            `sutartysAdpQueue id=${id} | insert=${stats.insert} patch=${stats.patch} delete=${stats.delete} unchanged=${stats.unchanged}`,
        );
        return true;
    } catch (error) {
        await postgres.query(
            `INSERT INTO public."sutartysAdpQueue" ("sutartiesUnikalusId")
             VALUES ($1)
             ON CONFLICT ("sutartiesUnikalusId") DO NOTHING`,
            [id],
        );
        throw error;
    }
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    try {
        while (await processSutartysAdpQueue()) {}
    } catch (error) {
        console.error("Klaida apdorojant sutartysAdpQueue:", error);
        process.exitCode = 1;
    } finally {
        await postgres.end();
    }
}
