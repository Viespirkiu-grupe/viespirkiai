import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";

const BATCH_SIZE = 1000;

function fetchBatch(fromId) {
    return postgres.query(
        `SELECT
            id, pavadinimas, extension, saltinis, tekstas,
            "zodziuSkaicius", "puslapiuSkaicius", "simboliuSkaicius"
        FROM failai
        WHERE id > $1
        ORDER BY id ASC
        LIMIT $2`,
        [fromId, BATCH_SIZE],
    );
}

async function insertBatch(rows) {
    const values = rows
        .map((_, i) => {
            const base = i * 8;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
        })
        .join(", ");

    const params = rows.flatMap((r) => [
        r.id,
        r.tekstas,
        r.pavadinimas,
        r.extension,
        r.saltinis,
        r.zodziuSkaicius,
        r.puslapiuSkaicius,
        r.simboliuSkaicius,
    ]);

    await postgres.query(
        `INSERT INTO "failaiTekstas"
            (id, tekstas, pavadinimas, extension, saltinis, "zodziuSkaicius", "puslapiuSkaicius", "simboliuSkaicius")
         VALUES ${values}
         ON CONFLICT (id) DO NOTHING`,
        params,
    );
}

let lastId = parseInt(process.argv[2] ?? "0");
let total = 0;
let batch = 1;

log(`Starting from id: ${lastId}`);

let pgStart = Date.now();
let nextPromise = fetchBatch(lastId);

while (true) {
    log(`Batch ${batch}, last id: ${lastId}`);
    batch++;

    const { rows } = await nextPromise;
    log(
        `Postgres fetch took ${Date.now() - pgStart}ms, got ${rows.length} rows`,
    );

    if (rows.length === 0) break;

    const nextLastId = rows.at(-1).id;
    pgStart = Date.now();
    nextPromise = fetchBatch(nextLastId);

    // insert in chunks of 10 concurrently
    for (let i = 0; i < rows.length; i += 10) {
        const chunk = rows.slice(i, i + 10);
        await insertBatch(chunk);
    }

    lastId = nextLastId;
    total += rows.length;
    log(`Inserted ${total} rows (last id: ${lastId})`);

    if (rows.length < BATCH_SIZE) break;
}

log(`Done. Total inserted: ${total}`);
