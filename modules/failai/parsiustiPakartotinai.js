/*
Avarinis įrankis: nepavykusius parsiuntimus grąžina į eilę nedelsiant.

Įprastai pakartojimą tvarko pati eilė — `files."downloadQueue"."nextAttempt"` atideda
bandymą pagal pakopas (3 val. / 12 val. / 1 d. / 3 d., žr. parsiuntimoEile.js).
Šitas scriptas tą atidėjimą nuima ir grąžina `files.files."downloadStatus"` į 0.
*/

import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

export async function parsiustiPakartotinai(kiekis = 100) {
    try {
        const res = await postgres.query(`
            WITH atrinkti AS (
                SELECT q.id
                FROM files."downloadQueue" q
                JOIN files.files f ON f.id = q.id
                WHERE f."downloadStatus" = -1
                  AND q."lockedBy" IS NULL
                LIMIT $1
            ),
            eile AS (
                UPDATE files."downloadQueue" q
                SET "nextAttempt" = NULL
                FROM atrinkti a
                WHERE q.id = a.id
                RETURNING q.id
            )
            UPDATE files.files f
            SET "downloadStatus" = 0
            FROM eile e
            WHERE f.id = e.id
        `, [kiekis]);

        logger.log(`Updated ${res.rowCount}`);
        return res.rowCount > 0;
    } catch (err) {
        console.error(err);
        return true;
    }
}

while (await parsiustiPakartotinai()) {}
await postgres.end();
