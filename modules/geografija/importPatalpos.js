import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("geografija", { operation: "importPatalpos" });
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { getArDataSources } from "./adresuRegistrasDataSources.js";
import { createInterface } from "readline";
import { Readable } from "stream";

const BATCH_SIZE = 1000;

async function updatePatalposAdresai() {
    await postgres.query(`TRUNCATE "arPatalposAdresai"`);

    const sources = await getArDataSources();
    const entry = sources.premiseAddresses.find(
        (r) =>
            r.name ===
            "Gyvenamosioms ir negyvenamosioms patalpoms suteikti adresai visoje LR teritorijoje",
    );

    const res = await scrapeFetch(entry.csv);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

    const rl = createInterface({
        input: Readable.fromWeb(res.body),
        crlfDelay: Infinity,
    });

    let headers = null;
    const delimiter = "|";
    let batch = [];
    let total = 0;

    const flushBatch = async () => {
        if (!batch.length) return;
        const values = [];
        const params = [];
        let p = 1;
        for (const row of batch) {
            values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
            params.push(
                row.SAV_KODAS || null,
                row.PAT_KODAS,
                row.AOB_KODAS || null,
                row.PATALPOS_NR || null,
                row.PAT_NUO || null,
            );
        }
        await postgres.query(
            `INSERT INTO "arPatalposAdresai" ("savKodas", "patKodas", "aobKodas", "patalpaNr", "patNuo")
       VALUES ${values.join(", ")}`,
            params,
        );
        total += batch.length;
        logger.log(`Įkelta ${total}`);
        batch = [];
    };

    const rows = [];

    for await (const line of rl) {
        if (!line.trim()) continue;
        if (!headers) {
            headers = line.split(delimiter);
            continue;
        }
        const vals = line.split(delimiter);
        const row = {};
        for (let i = 0; i < headers.length; i++) {
            row[headers[i]] = vals[i] || null;
        }
        rows.push(row);
    }

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        batch = rows.slice(i, i + BATCH_SIZE);
        await flushBatch();
    }

    logger.log("Atnaujinti patalpų adresai");
    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    await updatePatalposAdresai();
    await postgres.end();
}
