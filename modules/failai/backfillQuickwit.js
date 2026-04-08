import { postgres } from "../../postgres/postgres.js";
import { indexDocs } from "../../quickwit/quickwit.js";
import { log } from "../../utils/log.js";

const BATCH_SIZE = 1000;
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
         ft.id,
         ft.pavadinimas,
         lower(ft.extension) AS extension,
         ft.saltinis,
         ft.tekstas,
         ft."zodziuSkaicius",
         ft."puslapiuSkaicius",
         ft."simboliuSkaicius"
       FROM "failaiTekstas" ft
       WHERE ft.id > $1
       ORDER BY ft.id
       LIMIT $2`,
            [fromId, BATCH_SIZE]
        );

        if (!rows.length) break;

        const items = rows.map((row) => ({
            eilutesId: String(row.id),
            doc: {
                ...row,
                tekstas: row.tekstas ? foldLithuanian(row.tekstas) : null,
            },
        }));

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