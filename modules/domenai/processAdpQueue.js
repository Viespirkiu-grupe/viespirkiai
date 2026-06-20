import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import {
    createDomenaiSpintaClient,
    isDomenaiSpintaConfigured,
    syncDomenasToSpinta,
} from "./spintaSync.js";

async function claimOne() {
    const { rows } = await postgres.query(
        `DELETE FROM public."domenaiAdpQueue"
         WHERE domain = (
             SELECT domain
             FROM public."domenaiAdpQueue"
             ORDER BY "queuedAt"
             FOR UPDATE SKIP LOCKED
             LIMIT 1
         )
         RETURNING domain`,
    );
    return rows[0]?.domain ?? null;
}

export async function processDomenaiAdpQueue() {
    if (!isDomenaiSpintaConfigured()) return false;
    const domain = await claimOne();
    if (!domain) return false;
    try {
        const stats = await syncDomenasToSpinta({
            domain,
            spinta: createDomenaiSpintaClient(),
        });
        logger.log(
            `domenaiAdpQueue domain=${domain} | insert=${stats.insert} patch=${stats.patch} delete=${stats.delete} unchanged=${stats.unchanged}`,
        );
        return true;
    } catch (error) {
        await postgres.query(
            `INSERT INTO public."domenaiAdpQueue" (domain)
             VALUES ($1)
             ON CONFLICT (domain) DO NOTHING`,
            [domain],
        );
        throw error;
    }
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    try {
        while (await processDomenaiAdpQueue()) {}
    } catch (error) {
        console.error("Klaida apdorojant domenaiAdpQueue:", error);
        process.exitCode = 1;
    } finally {
        await postgres.end();
    }
}
