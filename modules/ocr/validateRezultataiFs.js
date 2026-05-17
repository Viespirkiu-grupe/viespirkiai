import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { getRezultatasPath } from "./rezultataiFs.js";
import fs from "fs";

const BATCH_SIZE = 5_000;
const LOG_EVERY = 50_000;

async function run() {
    let lastId = 0;
    let totalChecked = 0;
    let totalMissing = 0;
    let totalNoMd5 = 0;
    const startTime = Date.now();

    while (true) {
        const { rows } = await postgres.query(
            `SELECT id, md5
             FROM public."failaiOcrRezultatai"
             WHERE id > $1
             ORDER BY id ASC
             LIMIT $2`,
            [lastId, BATCH_SIZE],
        );

        if (rows.length === 0) break;

        for (const row of rows) {
            if (!row.md5) {
                totalNoMd5++;
            } else if (!fs.existsSync(getRezultatasPath(row.md5))) {
                totalMissing++;
                log(`Trūksta: id=${row.id} md5=${row.md5}`);
            }
            totalChecked++;
        }

        lastId = rows[rows.length - 1].id;

        if (totalChecked % LOG_EVERY < BATCH_SIZE) {
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = Math.round(totalChecked / elapsed);
            log(`Patikrinta: ${totalChecked.toLocaleString()} | trūksta: ${totalMissing.toLocaleString()} | be md5: ${totalNoMd5.toLocaleString()} | greitis: ${speed.toLocaleString()} eil/s | paskutinis id: ${lastId}`);
        }

        if (rows.length < BATCH_SIZE) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Baigta. Patikrinta: ${totalChecked.toLocaleString()} | trūksta failų: ${totalMissing.toLocaleString()} | be md5: ${totalNoMd5.toLocaleString()} | per ${elapsed}s`);
    if (totalMissing > 0 || totalNoMd5 > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run()
        .then(async () => {
            await postgres.end();
            process.exit(0);
        })
        .catch(async (err) => {
            console.error("Klaida:", err);
            await postgres.end();
            process.exit(1);
        });
}
