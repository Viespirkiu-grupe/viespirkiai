import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

export async function parsiustiPakartotinai(kiekis = 100) {
    try {
        const res = await postgres.query(`
            UPDATE public."failaiParsiuntimoQueue"
            SET state = 0
            WHERE id IN (
                SELECT id FROM public."failaiParsiuntimoQueue"
                WHERE state = -1
                  AND "lockedBy" IS NULL
                LIMIT $1
            )
        `, [kiekis]);

        log(`Updated ${res.rowCount}`);
        return res.rowCount > 0;
    } catch (err) {
        console.error(err);
        return true;
    }
}

while (await parsiustiPakartotinai()) {}
await postgres.end();