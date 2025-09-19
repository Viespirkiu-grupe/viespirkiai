/*
Importuoja įstatinį kapitalą iš JSONL failo į PostgreSQL.
https://data.gov.lt/datasets/1570/
*/
import fs from "fs";
import readline from "readline";
import { postgres } from "../../postgres/postgres.js";

const filename = process.argv[2];
if (!filename) {
    console.error("Naudojimas: node importIstatinisKapitalas.js <file.jsonl>");
    process.exit(1);
}

const BATCH_SIZE = 100;
let batch = [];
let inserted = 0;

const rl = readline.createInterface({
    input: fs.createReadStream(filename),
    crlfDelay: Infinity,
});

for await (const line of rl) {
    if (!line.trim()) continue;

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
        obj["juridinis_asmuo"]?._id ?? null, // jarId
        obj["forma"]?._id ?? null, // formaId
        obj["data_nuo"] ?? null, // data
        obj["reiksme"] ?? null, // reiksme
        obj["valiuta"] ?? null, // valiuta
    ];

    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
        await insertBatch(batch);
        batch = [];
    }
}

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
        INSERT INTO "istatinisKapitalas" (
            "jarId", "formaId", "data", "reiksme", "valiuta"
        ) VALUES ${placeholders}
        ON CONFLICT ("jarId", "data", "reiksme") DO NOTHING
    `;

    try {
        await postgres.query(sql, flatValues);
        inserted += rows.length;
        console.log(`Įterpta ${inserted} eilučių...`);
    } catch (err) {
        console.error("Įterpimas nepavyko:", err.message);
    }
}
