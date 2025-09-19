/*
Importuoja užimtumo tarnybos duomenis iš JSONL failo į PostgreSQL.
https://data.gov.lt/datasets/2894/
*/
import fs from "fs";
import readline from "readline";
import { postgres } from "../../postgres/postgres.js";

const filename = process.argv[2];
if (!filename) {
    console.error("Naudojimas: node importUZT.js <file.jsonl>");
    process.exit(1);
}

const BATCH_SIZE = 100; // kiek eilučių įterpti vienu metu
let batch = [];
let inserted = 0;

const rl = readline.createInterface({
    input: fs.createReadStream(filename),
    crlfDelay: Infinity,
});

for await (const line of rl) {
    if (!line.trim()) continue; // skip empty lines

    let obj;
    try {
        obj = JSON.parse(line);
    } catch (err) {
        console.warn(
            "Skipping malformed line:",
            line.slice(0, 100),
            err.message,
        );
        continue;
    }

    // Map JSON fields to table columns
    const row = [
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
    ];

    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
        await insertBatch(batch);
        batch = [];
    }
}

// Insert any remaining rows
if (batch.length > 0) {
    await insertBatch(batch);
}

console.log(`Viso įterpta eilučių: ${inserted}`);
await postgres.end();

// --- Functions ---

async function insertBatch(rows) {
    if (rows.length === 0) return;

    const numColumns = rows[0].length;

    const placeholders = rows
        .map((_, rowIndex) => {
            const start = rowIndex * numColumns + 1;
            const rowPlaceholders = Array.from(
                { length: numColumns },
                (_, colIndex) => `$${start + colIndex}`,
            );
            return `(${rowPlaceholders.join(", ")})`;
        })
        .join(", ");

    const flatValues = rows.flat();

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
        await postgres.query(sql, flatValues);
        inserted += rows.length;
        console.log(`Įterpta ${inserted} eilučių...`);
    } catch (err) {
        console.error("Įterpimas nepavyko:", err.message);
    }
}
