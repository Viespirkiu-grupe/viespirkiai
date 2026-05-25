import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { log } from "../../utils/log.js";
import { uuidv7 } from "../../utils/uuid.js";

const BATCH_SIZE = 500;
const LENTELE = "failai";

export async function processFailaiIndexQueue() {
    // Fetch oldest unprocessed batch
    const { rows: queue } = await postgres.query(
        `DELETE FROM "failaiIndexQueue"
       WHERE id IN (
         SELECT id FROM "failaiIndexQueue"
         ORDER BY id
         LIMIT $1
       )
       RETURNING "failoId", keitimas`,
        [BATCH_SIZE]
    );

    if (!queue.length) {
        return false;
    }

    // Deduplicate — if a row appears multiple times keep the most significant change:
    // delete > patch > insert
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

    const toIndex = [...deduped.entries()]
        .filter(([, k]) => k === "insert" || k === "patch")
        .map(([id]) => id);

    // Handle deletes — mark dead in quickwitEilutes
    if (toDelete.length) {
        const ids = toDelete.map(String);
        const newIds = toDelete.map(() => uuidv7());
        await postgres.query(
            `UPDATE "quickwitEilutes" qe
         SET "quickwitId" = v."quickwitId"::uuid
         FROM (SELECT UNNEST($2::text[]) AS "eilutesId",
                      UNNEST($3::text[]) AS "quickwitId") v
         WHERE qe."lentele" = $1 AND qe."eilutesId" = v."eilutesId"`,
            [LENTELE, ids, newIds]
        );
        await postgres.query(
            `UPDATE "quickwitIndeksai" qi
         SET "mirusiosEilutes" = "mirusiosEilutes" + sub.cnt
         FROM (
           SELECT "indeksas", COUNT(*) AS cnt
           FROM "quickwitEilutes"
           WHERE "lentele" = $1 AND "eilutesId" = ANY($2)
           GROUP BY "indeksas"
         ) sub
         WHERE qi."indeksas" = sub."indeksas"`,
            [LENTELE, ids]
        );
        log(`deleted ${toDelete.length} from quickwit`);
    }

    // Handle inserts + patches — fetch from failaiTekstas and index
    if (toIndex.length) {
        const { rows } = await postgres.query(
        `SELECT
            f.id,
            f.pavadinimas,
            lower(f.extension) AS extension,
            f.saltinis,
            ft.tekstas,
            f."zodziuSkaicius",
            f."puslapiuSkaicius",
            f."simboliuSkaicius",
            f."autorius"
        FROM failai f
        LEFT JOIN "failaiTekstas" ft ON ft.id = f.id
        WHERE f.id = ANY($1)`,
        [toIndex]
        );

        if (rows.length) {
            const items = rows.map((row) => ({
                eilutesId: String(row.id),
                doc: {
                    ...row,
                    tekstas: row.tekstas ? foldLithuanian(row.tekstas) : null,
                },
            }));

            await indexDocs("failai", items);
            log(`indexed ${rows.length}`);
        }
    }
    return true;
}



function foldLithuanian(str) {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .normalize("NFC");
}


if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    while(await processIndexQueue()){}
}
