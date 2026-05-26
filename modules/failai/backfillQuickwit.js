import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { log } from "../../utils/log.js";
import { readTekstasFs } from "./tekstasFs.js";

const BATCH_SIZE = 1000;
const FS_CONCURRENCY = 32;
const lastId = process.argv[2] ? parseInt(process.argv[2]) : 0;

function foldLithuanian(str) {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .normalize("NFC");
}

async function backfill() {
    let fromId = lastId;
    let total = 0;

    while (true) {
        const { rows } = await postgres.query(
            `SELECT
         f.id,
         f.pavadinimas,
         lower(f.extension) AS extension,
         f.saltinis,
         f."tekstasHash",
         f."zodziuSkaicius",
         f."puslapiuSkaicius",
         f."simboliuSkaicius"
       FROM failai f
       WHERE f.id > $1
       ORDER BY f.id
       LIMIT $2`,
            [fromId, BATCH_SIZE]
        );

        if (!rows.length) break;

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

        fromId = rows[rows.length - 1].id;
        total += rows.length;
        log(`indexed ${total} — last id: ${fromId}`);
    }

    log(`done. total indexed: ${total}`);
    await postgres.end();
}

backfill().catch((err) => {
    console.error(err);
    process.exit(1);
});