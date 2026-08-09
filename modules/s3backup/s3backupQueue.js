import { performance } from "node:perf_hooks";
import { postgres } from "../../postgres/postgres.js";
import { limitArg, numArg, parseArgs } from "../../utils/cliArgs.js";
import { keysetPages } from "../../utils/keysetPaginate.js";
import { eta, nf, secs } from "../../utils/progress.js";
import { Logger } from "../../utils/log.js";
import {
    closeSqlite,
    createEileWriter,
    getQueueCursor,
    getS3backupSqlitePath,
    openS3backupSqlite,
    setQueueCursor,
} from "./s3backupSqlite.js";

/*
Eilės sudarymas: Postgres → SQLite `eile`.

Vyksta atskirai nuo įkėlimo, tad scriptą galima leisti nuolat, net kol
`s3backup:upload` jau sukasi (WAL: du procesai, trumpos transakcijos,
busy_timeout suderina).

Numatytai einam per VISUS md5 nuo pradžių. Kursorius (`bukle.queueCursor`) tinka
tik atsistatymui po nutrūkimo, bet ne kasdieniam paleidimui: tinkamumo sąlyga
priklauso nuo `filesMd5Boxes` / `files."downloadStatus"`, o šie atsiranda vėliau
nei pats `filesMd5` įrašas. Praleidus mažesnius id, seni md5, tapę tinkami po
praėjusio rato, į eilę nebepatektų niekada. Pilnas ratas pigus — `INSERT … ON
CONFLICT DO NOTHING`, tad kartotiniai md5 nieko nekainuoja.

  npm run s3backup:queue
  npm run s3backup:queue -- --testi            # tęsti nuo kursoriaus (po nutrūkimo)
  npm run s3backup:queue -- --page 50000 --limit 200000

Šaltinis: md5, kuriems realiai yra baitų — t. y. yra `filesMd5Boxes` įrašas
(dėžė turi blob'ą) ARBA yra `files."downloadStatus" = 1` eilutė. Praktiškai tai
tas pats rinkinys (3 432 700 vs 3 432 700), bet ne visiškai: patikra rado 1 md5,
esantį dėžėje be nė vienos `downloadStatus = 1` eilutės. Backup'ui geriau
paimti per daug nei pamesti failą, todėl imam sąjungą.

Dydis imamas iš `filesMd5Boxes.filesize` — jo reikia ir maršrutizavimui
(RAM vs diskas), ir baitiniam progresui; jei nežinomas, lieka 0 ir įkėlimas
susitvarko srauto metu.
*/

const args = parseArgs(process.argv.slice(2));

const PAGE_SIZE = numArg(args.page, 50_000);
const LIMIT = limitArg(args.limit);
// `--nuo-pradziu` paliktas kaip senas vardas — dabar tai numatytasis elgesys.
const TESTI = Boolean(args.testi) && !args["nuo-pradziu"];
const DB_PATH = typeof args.db === "string" ? args.db : getS3backupSqlitePath();

const logger = new Logger(import.meta.url);

/** Vienas keyset puslapis md5 didėjančia `filesMd5.id` tvarka. */
async function fetchPage(cursor, pageSize) {
    const { rows } = await postgres.query(
        `SELECT m.id AS "md5Id",
                m.md5 AS "md5",
                COALESCE((SELECT MAX(b.filesize)
                          FROM public."filesMd5Boxes" b
                          WHERE b."md5Id" = m.id), 0)::bigint AS "dydis"
         FROM public."filesMd5" m
         WHERE ($1::int IS NULL OR m.id > $1)
           AND (EXISTS (SELECT 1 FROM public."filesMd5Boxes" b WHERE b."md5Id" = m.id)
                OR EXISTS (SELECT 1 FROM public.files f
                           WHERE f."md5Id" = m.id AND f."downloadStatus" = 1))
         ORDER BY m.id
         LIMIT $2`,
        [cursor, pageSize],
    );
    return rows;
}

async function main() {
    const db = openS3backupSqlite({ dbPath: DB_PATH });
    const writer = createEileWriter(db);

    const startAfter = TESTI ? getQueueCursor(db) : null;
    logger.log(
        `SQLite: ${DB_PATH}` +
            (startAfter
                ? `, tęsiam nuo filesMd5.id > ${nf(startAfter)}`
                : ", pilnas ratas nuo pradžių"),
    );

    const { rows: countRows } = await postgres.query(
        `SELECT COUNT(*) AS c FROM public."filesMd5" m
         WHERE EXISTS (SELECT 1 FROM public."filesMd5Boxes" b WHERE b."md5Id" = m.id)
            OR EXISTS (SELECT 1 FROM public.files f
                       WHERE f."md5Id" = m.id AND f."downloadStatus" = 1)`,
    );
    const isViso = Number(countRows[0].c);
    logger.log(`Postgres: ${nf(isViso)} tinkamų md5; page=${nf(PAGE_SIZE)}`);

    let perziureta = 0;
    let prideta = 0;
    let baitai = 0;
    const t0 = performance.now();

    const pages = keysetPages(fetchPage, {
        pageSize: PAGE_SIZE,
        startAfter,
        getCursor: (row) => row.md5Id,
        prefetch: true,
    });

    for await (const { rows, cursor } of pages) {
        const porcija = rows.slice(0, LIMIT - perziureta);
        if (porcija.length === 0) break;

        const eilutes = porcija.map((row) => ({
            md5: row.md5,
            md5Id: Number(row.md5Id),
            dydis: Number(row.dydis),
        }));

        prideta += writer.insertMany(eilutes);
        perziureta += eilutes.length;
        for (const e of eilutes) baitai += e.dydis;

        // Kursorių fiksuojam TIK po sėkmingo įrašymo — nutrūkus pakartosim porciją.
        setQueueCursor(db, eilutes[eilutes.length - 1].md5Id);

        const elapsed = performance.now() - t0;
        logger.log(
            `${nf(perziureta)}/${nf(isViso)} peržiūrėta | +${nf(prideta)} naujų | ` +
                `${(baitai / 1024 ** 3).toFixed(1)} GB | id iki ${nf(cursor)} | ` +
                `ETA ${eta(perziureta, isViso, elapsed)}`,
        );

        if (perziureta >= LIMIT) break;
    }

    const elapsed = performance.now() - t0;
    logger.log(
        `Baigta per ${secs(elapsed)}s: peržiūrėta ${nf(perziureta)}, ` +
            `pridėta ${nf(prideta)} naujų (${(baitai / 1024 ** 3).toFixed(1)} GB peržiūrėtuose)`,
    );

    closeSqlite(db);
    await postgres.end();
}

main().catch((error) => {
    logger.log(`s3backupQueue nulūžo: ${error.stack || error.message}`);
    process.exitCode = 1;
});
