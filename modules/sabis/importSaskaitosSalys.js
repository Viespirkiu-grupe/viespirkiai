import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const BASE =
    "https://get.data.gov.lt/datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/SaskaituSalys";
const LIMIT = 100000;
const BATCH_SIZE = 1000;

let totalInserted = 0;

async function fetchPage(pageToken = null) {
    const params = [`limit(${LIMIT})`];
    if (pageToken) params.push(`page("${pageToken}")`);

    const url = `${BASE}?${params.join("&")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
}

async function insertBatch(rows) {
    if (!rows.length) return;

    const placeholders = rows
        .map(
            (_, i) =>
                `(${Array.from({ length: 14 }, (_, j) => `$${i * 14 + j + 1}`).join(", ")})`,
        )
        .join(", ");

    const sql = `
        INSERT INTO "sabisSaskaituSalys" (
            "_type", "_id", "_revision", "id", "sfId", "tipas",
            "validusAsmensKodas", "validusJarKodas", "kitasKodas", "kitasKodasPaaiskinimas",
            "pavadinimas", "nePvmMoketojas", "veiklosVieta", "data"
        )
        VALUES ${placeholders}
        ON CONFLICT ("_id") DO UPDATE SET
            "_revision" = EXCLUDED."_revision",
            "id" = EXCLUDED."id",
            "sfId" = EXCLUDED."sfId",
            "tipas" = EXCLUDED."tipas",
            "validusAsmensKodas" = EXCLUDED."validusAsmensKodas",
            "validusJarKodas" = EXCLUDED."validusJarKodas",
            "kitasKodas" = EXCLUDED."kitasKodas",
            "kitasKodasPaaiskinimas" = EXCLUDED."kitasKodasPaaiskinimas",
            "pavadinimas" = EXCLUDED."pavadinimas",
            "nePvmMoketojas" = EXCLUDED."nePvmMoketojas",
            "veiklosVieta" = EXCLUDED."veiklosVieta",
            "data" = EXCLUDED."data";
    `;

    await postgres.query(sql, rows.flat());
    totalInserted += rows.length;
    log(`Inserted ${totalInserted}`);
}

async function main() {
    let nextPage = null;
    let pageNr = 1;

    while (true) {
        const data = await fetchPage(nextPage);
        if (!data._data || !data._data.length) break;

        log(`Page ${pageNr}: ${data._data.length} įrašų`);
        let batch = [];

        for (const r of data._data) {
            batch.push([
                r._type ?? null,
                r._id ?? null,
                r._revision ?? null,
                r.id ?? null,
                r.sf_id ?? null,
                r.tipas ?? null,
                r.validus_asmens_kodas ?? null,
                r.validus_jar_kodas ?? null,
                r.kitas_kodas ?? null,
                r.kitas_kodas_paaiskinimas ?? null,
                r.pavadinimas ?? null,
                r.ne_pvm_moketojas ?? null,
                r.veiklos_vieta ?? null,
                r.data ?? null,
            ]);

            if (batch.length === BATCH_SIZE) {
                await insertBatch(batch);
                batch = [];
            }
        }

        if (batch.length) await insertBatch(batch);

        nextPage = data._page?.next;
        if (!nextPage) break;
        pageNr++;
    }

    log(`DONE. Iš viso įterpta: ${totalInserted}`);
    await postgres.end();
}

await main();
