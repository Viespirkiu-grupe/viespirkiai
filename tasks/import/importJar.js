/*
Importuoja Jar duomenis iš JSONL failo į PostgreSQL.
https://get.data.gov.lt/datasets/gov/rc/jar/iregistruoti/JuridinisAsmuo
*/
import fs from "fs";
import readline from "readline";
import { postgres } from "../../postgres/postgres.js";

const filename = process.argv[2];
if (!filename) {
    console.error("Naudojimas: node importJar.js <file.jsonl>");
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
        obj._id ?? null, // id
        obj.ja_kodas ?? null, // jarKodas
        obj.ja_pavadinimas ?? null, // pavadinimas
        obj.pilnas_adresas ?? null, // adresas
        obj.adresas?._id ?? null, // adresasId
        obj.reg_data ?? null, // registravimoData
        obj.isreg_data ?? null, // isregistravimoData
        obj.forma?._id ?? null, // formaId
        obj.statusas?._id ?? null, // statusasId
        obj.stat_data ?? null, // statusasData
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
        INSERT INTO "jar" (
            "id", "jarKodas", "pavadinimas", "adresas", "adresasId",
            "registravimoData", "isregistravimoData", "formaId", "statusasId", "statusasData"
        ) VALUES ${placeholders}
        ON CONFLICT ("jarKodas") DO NOTHING
    `;

    try {
        await postgres.query(sql, flatValues);
        inserted += rows.length;
        console.log(`Įterpta ${inserted} eilučių...`);
    } catch (err) {
        console.error("Įterpimas nepavyko:", err.message);
    }
}
