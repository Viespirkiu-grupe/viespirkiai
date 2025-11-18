/*
Importuoja JADIS dayvlių duomenis iš JSONL failo į PostgreSQL jadis lentelę.
https://data.gov.lt/datasets/1732/
*/
import fs from "fs";
import readline from "readline";
import { postgres } from "../../postgres/postgres.js";

const filename = process.argv[2];
if (!filename) {
    console.error("Naudojimas: node importJadis.js <file.jsonl>");
    process.exit(1);
}

const BATCH_SIZE = 100; // kiek eilučių įterpti vienu metu
let batch = [];
let inserted = 0;

// Read JSONL line by line
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
        obj.juridinis_asmuo?._id ?? null, // jarId
        obj.form_kodas?._id ?? null, // formaId
        obj.stat_statusas?._id ?? null, // statusasId
        obj.lr_fiziniai ?? null, // lrFiziniai
        obj.lr_juridiniai ?? null, // lrJuridiniai
        obj.uzsienio_fiziniai ?? null, // uzsienioFiziniai
        obj.uzsienio_juridiniai ?? null, // uzsienioJuridiniai
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
      INSERT INTO "jadis" (
          "jarId", "formaId", "statusasId", "lrFiziniai", "lrJuridiniai",
          "uzsienioFiziniai", "uzsienioJuridiniai"
      ) VALUES ${placeholders}
      ON CONFLICT ("jarId") DO UPDATE SET
          "formaId" = EXCLUDED."formaId",
          "statusasId" = EXCLUDED."statusasId",
          "lrFiziniai" = EXCLUDED."lrFiziniai",
          "lrJuridiniai" = EXCLUDED."lrJuridiniai",
          "uzsienioFiziniai" = EXCLUDED."uzsienioFiziniai",
          "uzsienioJuridiniai" = EXCLUDED."uzsienioJuridiniai";
    `;

    try {
        await postgres.query(sql, flatValues);
        inserted += rows.length;
        console.log(`Įterpta ${inserted} eilučių...`);
    } catch (err) {
        console.error("Įterpimas nepavyko:", err.message);
    }
}
