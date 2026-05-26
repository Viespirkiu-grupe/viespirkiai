import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { log } from "../../utils/log.js";
import { uuidv7 } from "../../utils/uuid.js";
import { readTekstasFs } from "./tekstasFs.js";

const BATCH_SIZE = 500;
const FS_CONCURRENCY = 32;
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

    // Handle inserts + patches — fetch metadata from failai, text from FS, index
    if (toIndex.length) {
        const { rows } = await postgres.query(
        `SELECT
            f.id,
            f.pavadinimas,
            lower(f.extension) AS extension,
            f.saltinis,
            f."tekstasHash",
            f."zodziuSkaicius",
            f."puslapiuSkaicius",
            f."simboliuSkaicius",
            f."autorius"
        FROM failai f
        WHERE f.id = ANY($1)`,
        [toIndex]
        );

        if (rows.length) {
            let cursor = 0;
            const texts = new Array(rows.length);
            await Promise.all(
                Array.from({ length: Math.min(FS_CONCURRENCY, rows.length) }, async () => {
                    while (cursor < rows.length) {
                        const i = cursor++;
                        texts[i] = rows[i].tekstasHash
                            ? await readTekstasFs(rows[i].tekstasHash)
                            : null;
                    }
                }),
            );

            const items = rows.map((row, i) => {
                const { tekstasHash, ...rest } = row;
                return {
                    eilutesId: String(row.id),
                    doc: {
                        ...rest,
                        tekstas: texts[i] ? foldLithuanian(texts[i]) : null,
                    },
                };
            });

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
