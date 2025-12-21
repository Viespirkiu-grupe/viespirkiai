#!/usr/bin/env node
/*
Importuoja Užimtumo tarnybos darbo vietas tiesiai iš API į PostgreSQL
https://data.gov.lt/datasets/2894/
*/
import { postgres } from "../../postgres/postgres.js";

const BASE = "https://get.data.gov.lt/datasets/gov/uzt/ldv/Vieta";
const LIMIT = 100_000;
const BATCH_SIZE = 1000;

let totalProcessed = 0;
let pageNr = 1;

async function fetchPage(pageToken = null) {
    const params = [`limit(${LIMIT})`];
    if (pageToken) params.push(`page("${pageToken}")`);

    const url = `${BASE}?${params.join("&")}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return res.json();
}

async function main() {
    let nextPage = null;

    while (true) {
        const data = await fetchPage(nextPage);

        if (!data._data || data._data.length === 0) {
            console.log("Baigta. Daugiau duomenų nėra.");
            break;
        }

        console.log(`→ Page ${pageNr}: ${data._data.length} įrašų`);

        let batch = [];

        for (const obj of data._data) {
            batch.push([
                obj._type,
                obj._id,
                obj._revision,
                obj.darbo_vietos_id,
                obj.ikelimo_data,
                obj.profesijos_pareigybes_kodas,
                obj.profesijos_pareigybes_pav,
                obj.darbo_aprasymas_lt,
                obj.galioja_nuo,
                obj.galioja_iki,
                obj.ar_aktuali_siandien,
                obj.ar_uzpildyta,
                obj.pageidaujama_darbo_pradzia,
                obj.darbo_vietu_skaicius,
                obj.darbo_vietos_adresas,
                obj.darbo_vietos_sav_pav,
                obj.registravimo_pagrindo_kodas,
                obj.registravimo_pagrindo_pav,
                obj.registravimo_budo_kodas,
                obj.registravimo_budo_pav,
                obj.pageidavimo_pateikimo_kodas,
                obj.pageidavimo_pateikimo_pav,
                obj.ar_papildomai_remia,
                obj.ar_darbina_po_mokymu,
                obj.ar_apmoka_keliones,
                obj.ar_apgyvendina,
                obj.ar_maitina,
                obj.rizikos_lt,
                obj.jar_kodas,
                obj.darbdavys,
                obj.teisinio_statuso_kodas,
                obj.teisinio_statuso_pav,
                obj.teisines_formos_kodas,
                obj.teisines_formos_pav,
                obj.imones_iregistravimas,
                obj.darbdavio_bustine,
                obj.reik_darbo_patirtis,
                obj.reik_kompetencijos_lt,
                obj.reik_gebejimai,
                obj.reik_issilavinimo_kodas,
                obj.reik_issilavinimo_pav,
                obj.reik_mok_progr_kodas,
                obj.reik_mok_progr_pav,
            ]);

            if (batch.length === BATCH_SIZE) {
                await insertBatch(batch);
                batch = [];
            }
        }

        if (batch.length > 0) {
            await insertBatch(batch);
        }

        nextPage = data._page?.next;
        if (!nextPage) break;

        pageNr++;
    }

    console.log("DONE. Iš viso apdorota:", totalProcessed);
}

async function insertBatch(rows) {
    if (rows.length === 0) return;

    const numColumns = rows[0].length;
    const placeholders = rows
        .map(
            (_, i) =>
                `(${Array.from(
                    { length: numColumns },
                    (_, j) => `$${i * numColumns + j + 1}`,
                ).join(", ")})`,
        )
        .join(", ");

    const sql = `
        INSERT INTO "darboVietos" (
            "_type", "_id", "_revision", "darboVietosId", "ikelimoData",
            "profesijosPareigybesKodas", "profesijosPareigybesPav", "darboAprasymasLt",
            "galiojaNuo", "galiojaIki", "arAktualiSiandien", "arUzpildyta",
            "pageidaujamaDarboPradzia", "darboVietuSkaicius", "darboVietosAdresas",
            "darboVietosSavPav", "registravimoPagrindoKodas", "registravimoPagrindoPav",
            "registravimoBudoKodas", "registravimoBudoPav", "pageidavimoPateikimoKodas",
            "pageidavimoPateikimoPav", "arPapildomaiRemia", "arDarbinaPoMokymu",
            "arApmokaKeliones", "arApgyvendina", "arMaitina", "rizikosLt", "jarKodas",
            darbdavys, "teisinioStatusoKodas", "teisinioStatusoPav", "teisinesFormosKodas",
            "teisinesFormosPav", "imonesIregistravimas", "darbdavioBustine",
            "reikDarboPatirtis", "reikKompetencijosLt", "reikGebejimai",
            "reikIssilavinimoKodas", "reikIssilavinimoPav", "reikMokProgrKodas",
            "reikMokProgrPav"
        ) VALUES ${placeholders}
        ON CONFLICT ("_id") DO NOTHING
    `;

    try {
        await postgres.query(sql, rows.flat());
        totalProcessed += rows.length;
        if (totalProcessed % 1000 === 0) {
            console.log(`✓ Apdorota ${totalProcessed} įrašų`);
        }
    } catch (err) {
        console.error(
            `Įterpimas nepavyko po ${totalProcessed} įrašų:`,
            err.message,
        );
        throw err;
    }
}

await main();
await postgres.end();
