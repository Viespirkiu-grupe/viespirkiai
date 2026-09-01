/*
Importuoja Viesojo sektoriaus sąskaitas iš API į PostgreSQL.
https://get.data.gov.lt/datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/Saskaitos
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("sabis", { operation: "importSaskaitos" });
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import config from "../../utils/config.js";

const BASE = `${config.dataGovUrl}/datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/Saskaitos`;
const LIMIT = 5000;
const BATCH_SIZE = 500;

let totalInserted = 0;

async function fetchPage(pageToken = null) {
    const params = [`limit(${LIMIT})`];
    if (pageToken) params.push(`page("${pageToken}")`);

    const url = `${BASE}?${params.join("&")}`;
    const res = await scrapeFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
}

async function insertBatch(rows) {
    if (!rows.length) return;

    const placeholders = rows
        .map(
            (_, i) =>
                `(${Array.from({ length: 20 }, (_, j) => `$${i * 20 + j + 1}`).join(", ")})`,
        )
        .join(", ");

    const sql = `
    INSERT INTO sabis."saskaitos" (
      "_id", "_revision", "id", "sfId", "israsymoData", "sfPozymis",
      "sfTipas", "sfNumeris", "sutartiesUid", "sutartiesNumeris", "cpvKodas",
      "cpvPav", "sfApmokejimoTerminas", "pvm", "sumaBePvm", "sumaPvm",
      "bendraSfSuma", "valiuta", "sfBusena", "sfBusenoData"
    ) VALUES ${placeholders}
    ON CONFLICT ("_id") DO UPDATE SET
      "_revision" = EXCLUDED."_revision",
      "id" = EXCLUDED."id",
      "sfId" = EXCLUDED."sfId",
      "israsymoData" = EXCLUDED."israsymoData",
      "sfPozymis" = EXCLUDED."sfPozymis",
      "sfTipas" = EXCLUDED."sfTipas",
      "sfNumeris" = EXCLUDED."sfNumeris",
      "sutartiesUid" = EXCLUDED."sutartiesUid",
      "sutartiesNumeris" = EXCLUDED."sutartiesNumeris",
      "cpvKodas" = EXCLUDED."cpvKodas",
      "cpvPav" = EXCLUDED."cpvPav",
      "sfApmokejimoTerminas" = EXCLUDED."sfApmokejimoTerminas",
      "pvm" = EXCLUDED."pvm",
      "sumaBePvm" = EXCLUDED."sumaBePvm",
      "sumaPvm" = EXCLUDED."sumaPvm",
      "bendraSfSuma" = EXCLUDED."bendraSfSuma",
      "valiuta" = EXCLUDED."valiuta",
      "sfBusena" = EXCLUDED."sfBusena",
      "sfBusenoData" = EXCLUDED."sfBusenoData";
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
                r._id ?? null,
                r._revision ?? null,
                r.id ?? null,
                r.sf_id ?? null,
                r.israsymo_data ?? null,
                r.sf_pozymis ?? null,
                r.sf_tipas ?? null,
                r.sf_numeris ?? null,
                r.sutarties_uid ?? null,
                r.sutarties_numeris ?? null,
                r.cpv_kodas ?? null,
                r.cpv_pav ?? null,
                r.sf_apmokejimo_terminas ?? null,
                r.pvm ?? null,
                r.suma_be_pvm ?? null,
                r.suma_pvm ?? null,
                r.bendra_sf_suma ?? null,
                r.valiuta ?? null,
                r.sf_busena ?? null,
                r.sf_buseno_data ?? null,
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
