import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const BASE =
    "https://get.data.gov.lt/datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/Sutartys";
const LIMIT = 5000;
const BATCH_SIZE = 500;

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
        INSERT INTO "sabisSutartys" (
            "_type", "_id", "_revision", "sutartiesId", "sutartiesUid", "vpId",
            "tipas", "sutartiesNumeris", "pavadinimas", "cpvKodas", "cpvPav",
            "sutartiesPasirasymoData", "sutartiesGaliojimoData", "suma"
        )
        VALUES ${placeholders}
        ON CONFLICT ("_id") DO UPDATE SET
            "_revision" = EXCLUDED."_revision",
            "sutartiesId" = EXCLUDED."sutartiesId",
            "sutartiesUid" = EXCLUDED."sutartiesUid",
            "vpId" = EXCLUDED."vpId",
            "tipas" = EXCLUDED."tipas",
            "sutartiesNumeris" = EXCLUDED."sutartiesNumeris",
            "pavadinimas" = EXCLUDED."pavadinimas",
            "cpvKodas" = EXCLUDED."cpvKodas",
            "cpvPav" = EXCLUDED."cpvPav",
            "sutartiesPasirasymoData" = EXCLUDED."sutartiesPasirasymoData",
            "sutartiesGaliojimoData" = EXCLUDED."sutartiesGaliojimoData",
            "suma" = EXCLUDED."suma";
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
                r.sutarties_id ?? null,
                r.sutarties_uid ?? null,
                r.vp_id ?? null,
                r.tipas ?? null,
                r.sutarties_numeris ?? null,
                r.pavadinimas ?? null,
                r.cpv_kodas ?? null,
                r.cpv_pav ?? null,
                r.sutarties_pasirasymo_data ?? null,
                r.sutarties_galiojimo_data ?? null,
                r.suma ?? null,
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
