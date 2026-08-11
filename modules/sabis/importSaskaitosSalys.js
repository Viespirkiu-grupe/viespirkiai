import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("sabis", { operation: "importSaskaitosSalys" });
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import config from "../../utils/config.js";

const BASE = `${config.dataGovUrl}/datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/SaskaituSalys`;
const LIMIT = 100000;
const BATCH_SIZE = 1000;

let totalInserted = 0;

// Normalizuoti string stulpeliai -> lookup lentelių ID (ADP ID neduoda,
// juos generuojam patys). Kiekvienam – atskira lentelė ir cache.
const tipaiCache = new Map();
const veiklosVietaCache = new Map();

// Generinis lookup: užtikrina, kad visos reikšmės turėtų ID, ir sudeda į cache.
async function resolveIds(values, { table, column, cache }) {
    const unknown = [...new Set(values.filter((v) => v != null && !cache.has(v)))];
    if (!unknown.length) return;

    const placeholders = unknown.map((_, i) => `($${i + 1})`).join(", ");
    await postgres.query(
        `INSERT INTO "${table}" ("${column}")
         VALUES ${placeholders}
         ON CONFLICT ("${column}") DO NOTHING`,
        unknown,
    );

    const { rows } = await postgres.query(
        `SELECT id, "${column}" AS val FROM "${table}" WHERE "${column}" = ANY($1)`,
        [unknown],
    );
    for (const row of rows) cache.set(row.val, row.id);
}

// "12345" -> 12345; tuščias / ne skaitmenys -> null
function toInt(v) {
    if (v == null || v === "") return null;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
}

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

    // tipas (idx 4) -> tipasId
    await resolveIds(rows.map((r) => r[4]), {
        table: "sabisSaskaituSalysTipai",
        column: "tipas",
        cache: tipaiCache,
    });
    for (const r of rows) r[4] = r[4] == null ? null : tipaiCache.get(r[4]);

    // veiklosVieta (idx 11) -> veiklosVietaId
    await resolveIds(rows.map((r) => r[11]), {
        table: "sabisSaskaituSalysVeiklosVieta",
        column: "veiklosVieta",
        cache: veiklosVietaCache,
    });
    for (const r of rows) r[11] = r[11] == null ? null : veiklosVietaCache.get(r[11]);

    // validusJarKodas (idx 6) text -> int
    for (const r of rows) r[6] = toInt(r[6]);

    const placeholders = rows
        .map(
            (_, i) =>
                `(${Array.from({ length: 13 }, (_, j) => `$${i * 13 + j + 1}`).join(", ")})`,
        )
        .join(", ");

    const sql = `
        INSERT INTO "sabisSaskaituSalys" (
            "_id", "_revision", "id", "sfId", "tipasId",
            "validusAsmensKodas", "validusJarKodas", "kitasKodas", "kitasKodasPaaiskinimas",
            "pavadinimas", "nePvmMoketojas", "veiklosVietaId", "data"
        )
        VALUES ${placeholders}
        ON CONFLICT ("_id") DO UPDATE SET
            "_revision" = EXCLUDED."_revision",
            "id" = EXCLUDED."id",
            "sfId" = EXCLUDED."sfId",
            "tipasId" = EXCLUDED."tipasId",
            "validusAsmensKodas" = EXCLUDED."validusAsmensKodas",
            "validusJarKodas" = EXCLUDED."validusJarKodas",
            "kitasKodas" = EXCLUDED."kitasKodas",
            "kitasKodasPaaiskinimas" = EXCLUDED."kitasKodasPaaiskinimas",
            "pavadinimas" = EXCLUDED."pavadinimas",
            "nePvmMoketojas" = EXCLUDED."nePvmMoketojas",
            "veiklosVietaId" = EXCLUDED."veiklosVietaId",
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
