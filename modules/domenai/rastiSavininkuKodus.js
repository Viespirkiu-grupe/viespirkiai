import { postgres } from "../../postgres/postgres.js";
import { findSingleJuridinis } from "../juridiniai/search.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

const CONCURRENCY = 16;

async function nextSavininkuBatch(limit) {
    let res = await postgres.query(
        `SELECT DISTINCT savininkas FROM domenai WHERE savininkas IS NOT NULL AND ("savininkoKodasStatus" IS NULL OR ("savininkoKodasStatus" >= 0 AND "savininkoKodasStatus" < 2)) LIMIT $1;`,
        [limit],
    );
    if (res.rowCount > 0) return res.rows.map((r) => r.savininkas);

    res = await postgres.query(
        `SELECT DISTINCT savininkas FROM "domenaiScrapes" WHERE savininkas IS NOT NULL AND ("savininkoKodasStatus" IS NULL OR ("savininkoKodasStatus" >= 0 AND "savininkoKodasStatus" < 2)) LIMIT $1;`,
        [limit],
    );
    return res.rows.map((r) => r.savininkas);
}

async function processSavininkas(savininkas) {
    let juridinisRes = await findSingleJuridinis(savininkas);
    let jarKodas = juridinisRes?.jarKodas ?? null;

    if (jarKodas === null) {
        logger.log(`Savininko kodas nerastas: ${savininkas}`);
    } else {
        logger.log(
            `Savininko kodas rastas: ${savininkas} -> ${jarKodas} (${juridinisRes.pavadinimas})`,
        );
    }

    await postgres.query(
        `UPDATE domenai SET "savininkoKodas" = $1, "savininkoKodasStatus" = 2 WHERE savininkas = $2;`,
        [jarKodas, savininkas],
    );
    await postgres.query(
        `UPDATE "domenaiScrapes" SET "savininkoKodas" = $1, "savininkoKodasStatus" = 2 WHERE savininkas = $2;`,
        [jarKodas, savininkas],
    );
}

while (true) {
    const batch = await nextSavininkuBatch(CONCURRENCY);
    if (batch.length === 0) break;
    await Promise.all(batch.map(processSavininkas));
}
