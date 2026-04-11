import { postgres } from "../../postgres/postgres.js";

const BATCH = 1000;
const lastId = parseInt(process.argv[2] ?? "0", 10);

let cursor = lastId;
let total = 0;

async function queryWithRetry(sql, params, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await postgres.query(sql, params);
        } catch (err) {
            if (err.code === "40P01" && i < retries - 1) {
                // Deadlock — wait briefly and retry
                await new Promise((res) => setTimeout(res, 100 * (i + 1)));
                continue;
            }
            throw err;
        }
    }
}

while (true) {
    const { rows } = await postgres.query(
        `SELECT id, metaduomenys
     FROM failai
     WHERE id > $1
     ORDER BY id
     LIMIT $2`,
        [cursor, BATCH]
    );

    if (!rows.length) break;

    const updates = rows
        .map((r) => {
            const metadata = r.metaduomenys;
            const autorius = metadata?.Author ?? metadata?.author ?? null;
            return { id: r.id, autorius };
        })
        .filter((r) => r.autorius !== null);

    if (updates.length) {
        const vals = updates.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::text)`).join(", ");
        const params = updates.flatMap((u) => [u.id, u.autorius]);

        await queryWithRetry(
            `UPDATE failai f
   SET autorius = v.autorius
   FROM (VALUES ${vals}) AS v(id, autorius)
   WHERE f.id = v.id`,
            params
        );
        await queryWithRetry(
            `UPDATE "failaiTekstas" ft
   SET autorius = v.autorius
   FROM (VALUES ${vals}) AS v(id, autorius)
   WHERE ft.id = v.id`,
            params
        );
    }

    cursor = rows[rows.length - 1].id;
    total += updates.length;
    console.log(`processed up to id ${cursor}, updated ${total} so far`);
}


console.log(`done. total updated: ${total}`);
await postgres.end();