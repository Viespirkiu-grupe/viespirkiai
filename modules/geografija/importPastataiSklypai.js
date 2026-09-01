import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("geografija", { operation: "importPastataiSklypai" });
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { getArDataSources } from "./adresuRegistrasDataSources.js";
import { createInterface } from "readline";
import { Readable } from "stream";

const BATCH_SIZE = 1000;

export async function updatePastataiSklypaiAdresai() {
    await postgres.query(`TRUNCATE "adresuRegistras"."pastataiSklypaiAdresai"`);

    const sources = await getArDataSources();
    const entry = sources.buildingAddresses.find(
        (r) =>
            r.name ===
            "Žemės sklypams ir / ar pastatams suteikti adresai visoje LR teritorijoje",
    );

    const res = await scrapeFetch(entry.csv);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

    const rl = createInterface({
        input: Readable.fromWeb(res.body),
        crlfDelay: Infinity,
    });

    let headers = null;
    let delimiter = "|";
    let batch = [];
    let total = 0;

    const flushBatch = async () => {
        if (!batch.length) return;
        const values = [];
        const params = [];
        let p = 1;
        for (const row of batch) {
            values.push(
                `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
            );
            params.push(
                row.SAV_KODAS || null,
                row.AOB_KODAS,
                row.GYV_KODAS || null,
                row.GAT_KODAS || null,
                row.NR || null,
                row.KORPUSO_NR || null,
                row.PASTO_KODAS || null,
                row.AOB_NUO || null,
            );
        }
        await postgres.query(
            `INSERT INTO "adresuRegistras"."pastataiSklypaiAdresai" ("savKodas", "kodas", "gyvKodas", "gatKodas", "nr", "korpusoNr", "pastoKodas", "aobNuo")
       VALUES ${values.join(", ")}`,
            params,
        );
        total += batch.length;
        logger.log(`Įkelta ${total}`);
        batch = [];
    };

    for await (const line of rl) {
        if (!line.trim()) continue;
        if (!headers) {
            headers = line.split(delimiter);
            continue;
        }
        const values = line.split(delimiter);
        const row = {};
        for (let i = 0; i < headers.length; i++) {
            row[headers[i]] = values[i] || null;
        }
        batch.push(row);
        if (batch.length >= BATCH_SIZE) await flushBatch();
    }

    await flushBatch();

    logger.log("Atnaujinti pastatų ir sklypų adresai");
    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    await updatePastataiSklypaiAdresai();
    await postgres.end();
}
