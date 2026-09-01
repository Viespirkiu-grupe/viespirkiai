import { postgres } from "../../postgres/postgres.js";
import { findSingleJuridinis } from "../juridiniai/search.js";
import { Logger } from "../../utils/log.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";
const logger = new Logger();

const CONCURRENCY = 16;

async function nextSavininkuBatch(limit) {
    let res = await postgres.query(
        `SELECT DISTINCT sv.vardas AS savininkas
           FROM domenai.domenai d
           JOIN domenai.savininkai sv ON sv.id = d."savininkasId"
          WHERE sv.vardas IS NOT NULL AND d."kodasIeskotas" IS NOT TRUE
          LIMIT $1;`,
        [limit],
    );
    if (res.rowCount > 0) return res.rows.map((r) => r.savininkas);

    res = await postgres.query(
        `SELECT DISTINCT sv.vardas AS savininkas
           FROM domenai.scrapes s
           JOIN domenai.savininkai sv ON sv.id = s."savininkasId"
          WHERE sv.vardas IS NOT NULL AND s."kodasIeskotas" IS NOT TRUE
          LIMIT $1;`,
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

    const updated = await postgres.query(
        `UPDATE domenai.domenai d
            SET "savininkasId" = domenai.savininkas_id(sv.vardas, sv.adresas, $1),
                "kodasIeskotas" = true
           FROM domenai.savininkai sv
          WHERE sv.id = d."savininkasId" AND sv.vardas = $2;`,
        [jarKodas, savininkas],
    );
    if (updated.rowCount > 0) {
        signalWork(WORK_SIGNALS.DOMENAI_ADP_READY, {
            source: "rastiSavininkuKodus",
            count: updated.rowCount,
        });
    }
    await postgres.query(
        `UPDATE domenai.scrapes s
            SET "savininkasId" = domenai.savininkas_id(sv.vardas, sv.adresas, $1),
                "kodasIeskotas" = true
           FROM domenai.savininkai sv
          WHERE sv.id = s."savininkasId" AND sv.vardas = $2;`,
        [jarKodas, savininkas],
    );
}

while (true) {
    const batch = await nextSavininkuBatch(CONCURRENCY);
    if (batch.length === 0) break;
    await Promise.all(batch.map(processSavininkas));
}
