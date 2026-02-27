/*
Failus nuskaitytus su klaidomis (-1) nustato kaip nenučítytus (0)
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

async function nuskaitytiPakartotinai(kiekis = 10, workerId) {
    const query = `
        WITH to_update AS (
            SELECT id
            FROM failai
            WHERE nuskaitytas = -1 OR nuskaitytas = -4
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE failai f
        SET nuskaitytas = 0
        FROM to_update t
        WHERE f.id = t.id;
    `;

    try {
        const res = await postgres.query(query, [kiekis]);
        if (res.rowCount > 0) {
            log(`Worker ${workerId} updated ${res.rowCount}`);
        }
        return res.rowCount; // number of rows updated
    } catch (err) {
        console.error(`Worker ${workerId} error:`, err);
        return 1;
    }
}

async function worker(workerId) {
    while ((await nuskaitytiPakartotinai(10, workerId)) > 0) {
        // keep processing until no rows left
    }
}

const CONCURRENCY = 5;

// start 5 concurrent workers with IDs 1..5
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

await postgres.end();
