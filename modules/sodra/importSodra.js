/*
Importuoja SODROS duomenis iš CSV failo į Postgress.
https://atvira.sodra.lt/imones/rinkiniai/index.html
*/
import fs from "fs";
import path from "path";
import { postgres } from "../../postgres/postgres.js";
import readline from "readline";
import { log } from "../../utils/log.js";

const filename = process.argv[2];
const DRY_RUN = process.argv.includes("--dry-run");

if (!filename) {
    console.error("Usage: node importSodra.js <file.csv> [--dry-run]");
    process.exit(1);
}

if (DRY_RUN) log("🔍 DRY RUN — no data will be written");

const rl = readline.createInterface({
    input: fs.createReadStream(filename),
    crlfDelay: Infinity,
});

let isFirstLine = true;
const BATCH_SIZE = 100;
let batch = [];
let eilute = 0;
let skipped = 0;

for await (const line of rl) {
    if (isFirstLine) {
        isFirstLine = false;
        continue;
    }

    eilute++;

    const fields = parseCSVLine(line);
    let code,
        jarCode,
        name,
        municipality,
        ecoActCode,
        ecoActCodeStr,
        ecoActName,
        month,
        avgWage,
        numInsured,
        avgWage2,
        numInsured2,
        tax;

    // Detect format by column count
    if (fields.length >= 13) {
        // New format: has ecoActCodeStr at position 5
        [
            code,
            jarCode,
            name,
            municipality,
            ecoActCode,
            ecoActCodeStr,
            ecoActName,
            month,
            avgWage,
            numInsured,
            avgWage2,
            numInsured2,
            tax,
        ] = fields.map(clean);
    } else if (fields.length >= 12) {
        // Old format: no ecoActCodeStr
        [
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
        ecoActCodeStr = null;
    } else {
        console.warn(
            `[Line ${eilute}] Skipping malformed line (${fields.length} fields): ${line}`,
        );
        skipped++;
        continue;
    }

    const parsedMonth = parseMonth(month);
    if (!parsedMonth) {
        console.warn(
            `[Line ${eilute}] Unrecognized month format: "${month}" — skipping`,
        );
        skipped++;
        continue;
    }

    const row = {
        kodas: toInt(code),
        jarKodas: jarCode,
        pavadinimas: name,
        savivaldybe: municipality,
        ekonominesVeiklosKodas: ecoActCode,
        ekonominesVeiklosKodasEvrk: ecoActCodeStr, // ← new field, make sure column exists in DB
        ekonominesVeiklosPavadinimas: ecoActName,
        data: parsedMonth,
        vidutinisAtlyginimas: toFloat(avgWage),
        draustieji: toInt(numInsured),
        vidutinisAtlyginimas2: toFloat(avgWage2),
        draustieji2: toInt(numInsured2),
        imokuSuma: toFloat(tax),
        importFile: path.basename(filename),
    };

    if (DRY_RUN) {
        log(`[Line ${eilute}] ${JSON.stringify(row, null, 2)}`);
        continue;
    }

    batch.push(row);

    if (batch.length === BATCH_SIZE) {
        await insertBatch(batch);
        batch = [];
    }
}

if (!DRY_RUN && batch.length > 0) {
    await insertBatch(batch);
}

log(
    `Done. Processed: ${eilute}, skipped: ${skipped}, inserted: ${eilute - skipped}`,
);
if (!DRY_RUN) await postgres.end();

/* ----------------------- Helpers ----------------------- */

/**
 * Parses month field — handles both integer (200012) and string (2000-12) formats.
 * Returns an integer like 200012, or null if unrecognized.
 */
function parseMonth(val) {
    if (!val) return null;

    // Already a plain integer: 200012
    if (/^\d{6}$/.test(val)) return parseInt(val);

    // YYYY-MM format: 2000-12
    const match = val.match(/^(\d{4})-(\d{2})$/);
    if (match) return parseInt(match[1]) * 100 + parseInt(match[2]);

    // Fallback: try plain parseInt
    const n = parseInt(val);
    return isNaN(n) ? null : n;
}

function toInt(val) {
    if (val === null || val === undefined || val === "") return null;
    const n = parseInt(val);
    return isNaN(n) ? null : n;
}

function toFloat(val) {
    if (val === null || val === undefined || val === "") return null;
    // Handle European decimal comma
    const n = parseFloat(String(val).replace(",", "."));
    return isNaN(n) ? null : n;
}

function clean(val) {
    if (val === "" || val === undefined || val === null) return null;
    if (val.startsWith('"') && val.endsWith('"')) {
        return val.slice(1, -1).replace(/""/g, '"');
    }
    return val;
}

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

async function insertBatch(rows) {
    if (!rows.length) return;

    const columns = Object.keys(rows[0]);
    const placeholders = rows
        .map(
            (_, i) =>
                `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(", ")})`,
        )
        .join(", ");

    const sql = `
        INSERT INTO sodra (${columns.map((c) => `"${c}"`).join(", ")})
        VALUES ${placeholders}
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
            "importFile" = EXCLUDED."importFile"
    `;

    const values = rows.flatMap((r) => columns.map((c) => r[c]));

    try {
        await postgres.query(sql, values);
        log(`Inserted ${rows.length} rows (total: ${eilute - skipped})`);
    } catch (err) {
        console.error("Insert failed:", err.message);
        console.error("First row of failed batch:", rows[0]);
        throw err;
    }
}
