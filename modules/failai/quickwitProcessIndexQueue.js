import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { log } from "../../utils/log.js";
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

    // Handle deletes — drop the quickwitEilutes mapping so search's filterLive()
    // stops matching the orphaned Quickwit doc (it lingers in the shard until
    // deleteDeadIndexes retires the whole shard). The quickwitEilutesGyvosDel
    // trigger decrements gyvosEilutes, which raises the generated mirusiosEilutes
    // — so counters need no manual touch here.
    if (toDelete.length) {
        await postgres.query(
            `DELETE FROM "quickwitEilutes"
         WHERE "lentele" = $1 AND "eilutesId" = ANY($2)`,
            [LENTELE, toDelete.map(String)]
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
            // Tas pats tekstasHash batch'e gali kartotis — promise dedamas į Map
            // sinchroniškai, tad lygiagretūs workeriai dalinasi vienu FS skaitymu.
            const tekstaiByHash = new Map();
            await Promise.all(
                Array.from({ length: Math.min(FS_CONCURRENCY, rows.length) }, async () => {
                    while (cursor < rows.length) {
                        const i = cursor++;
                        const hash = rows[i].tekstasHash;
                        if (!hash) {
                            texts[i] = null;
                            continue;
                        }
                        let promise = tekstaiByHash.get(hash);
                        if (!promise) {
                            promise = readTekstasFs(hash);
                            tekstaiByHash.set(hash, promise);
                        }
                        texts[i] = await promise;
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
