/*
Importuoja SODROS duomenis iš CSV failo į Postgress.
https://atvira.sodra.lt/imones/rinkiniai/index.html
*/
import fs from "fs";
import path from "path";
import { postgres } from "../../postgres/postgres.js";
import readline from "readline";

// Check CSV filename
const filename = process.argv[2];
if (!filename) {
    console.error("Usage: node importSodra.js <file.csv>");
    process.exit(1);
}

// Read CSV line by line
const rl = readline.createInterface({
    input: fs.createReadStream(filename),
    crlfDelay: Infinity,
});

let arPirmaEilute = true;
const ITERPIMO_DYDIS = 100; // batch size
let batch = [];
let eilute = 0;

for await (const line of rl) {
    if (arPirmaEilute) {
        arPirmaEilute = false;
        continue;
    }

    const fields = parseCSVLine(line);
    if (fields.length < 12) {
        console.warn(`Skipping malformed line: ${line}`);
        continue;
    }

    const [
        code,
        jarCode,
        name,
        municipality,
        ecoActCode,
        ecoActName,
        month,
        avgWage,
        numInsured,
        avgWage2,
        numInsured2,
        tax,
    ] = fields.map(clean);

    const row = [
        sanitize(code, "int"),
        jarCode,
        name,
        municipality,
        ecoActCode,
        ecoActName,
        sanitize(month, "int"),
        sanitize(avgWage, "float"),
        sanitize(numInsured, "int"),
        sanitize(avgWage2, "float"),
        sanitize(numInsured2, "int"),
        sanitize(tax, "float"),
        path.basename(filename),
    ];

    batch.push(row);

    if (batch.length === ITERPIMO_DYDIS) {
        await insertBatch(batch);
        batch = [];
    }
}

if (batch.length > 0) {
    await insertBatch(batch);
}

console.log(`Inserted rows: ${eilute}`);
await postgres.end();

/* ----------------------- Helpers ----------------------- */

function parseCSVLine(line) {
    const result = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                field += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ";" && !inQuotes) {
            result.push(field);
            field = "";
        } else {
            field += char;
        }
    }
    result.push(field);
    return result;
}

function sanitize(val, type = "text") {
    if (val === "" || val === undefined) return null;
    if (type === "int") return parseInt(val) || null;
    if (type === "float") return parseFloat(val) || null;
    return clean(val);
}

function clean(val) {
    if (val === "" || val === undefined) return null;
    if (val.startsWith('"') && val.endsWith('"')) {
        return val.slice(1, -1).replace(/""/g, '"');
    }
    return val;
}

async function insertBatch(rows) {
    if (!rows.length) return;

    // PostgreSQL uses $1, $2, ... placeholders
    const placeholders = rows
        .map(
            (_, i) =>
                `(${Array.from({ length: 13 }, (_, j) => `$${i * 13 + j + 1}`).join(", ")})`,
        )
        .join(", ");

    const sql = `
      INSERT INTO sodra (
        kodas, "jarKodas", pavadinimas, savivaldybe, "ekonominesVeiklosKodas",
        "ekonominesVeiklosPavadinimas", data, "vidutinisAtlyginimas", draustieji,
        "vidutinisAtlyginimas2", draustieji2, "imokuSuma", "importFile"
      ) VALUES ${placeholders}
      ON CONFLICT ("kodas", "jarKodas", "data") DO UPDATE SET
        pavadinimas = EXCLUDED.pavadinimas,
        savivaldybe = EXCLUDED.savivaldybe,
        "ekonominesVeiklosKodas" = EXCLUDED."ekonominesVeiklosKodas",
        "ekonominesVeiklosPavadinimas" = EXCLUDED."ekonominesVeiklosPavadinimas",
        "vidutinisAtlyginimas" = EXCLUDED."vidutinisAtlyginimas",
        draustieji = EXCLUDED.draustieji,
        "vidutinisAtlyginimas2" = EXCLUDED."vidutinisAtlyginimas2",
        draustieji2 = EXCLUDED.draustieji2,
        "imokuSuma" = EXCLUDED."imokuSuma",
        "importFile" = EXCLUDED."importFile";
    `;

    const values = rows.flat();

    try {
        await postgres.query(sql, values);
        eilute += rows.length;
        if (eilute % 1000 === 0) {
            console.log(`Inserted ${eilute} rows...`);
        }
    } catch (err) {
        console.error(`Insert failed after ${eilute} rows:`, err.message);
    }
}
