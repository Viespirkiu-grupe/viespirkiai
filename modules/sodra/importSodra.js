/*
Importuoja SODROS duomenis iš CSV failo į Postgress.
https://atvira.sodra.lt/imones/rinkiniai/index.html
*/
import fs from "fs";
import path from "path";
import { postgres } from "../../postgres/postgres.js";
import readline from "readline";
import { log } from "../../utils/log.js";
import { upsertSodraMonthly } from "./upsertSodraMonthly.js";

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
const BATCH_SIZE = 1_000;
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

    const parsedCode = toInt(code);
    if (parsedCode === null) {
        console.warn(`[Line ${eilute}] Missing draudėjo code — skipping`);
        skipped++;
        continue;
    }

    const row = {
        kodas: parsedCode,
        jarKodas: jarCode,
        pavadinimas: name,
        savivaldybe: municipality,
        ekonominesVeiklosKodas: ecoActCode,
        ekonominesVeiklosKodasEvrk: ecoActCodeStr, // ← new field, make sure column exists in DB
        ekonominesVeiklosPavadinimas: ecoActName,
        data: parsedMonth,
        vidutinisAtlyginimas: toFloat(avgWage),
        draustieji: toInt(numInsured) ?? 0,
        vidutinisAtlyginimas2: toFloat(avgWage2),
        draustieji2: toInt(numInsured2) ?? 0,
        imokuSuma: toFloat(tax),
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
 * Returns the first day of the month as YYYY-MM-01, or null if unrecognized.
 */
function parseMonth(val) {
    if (!val) return null;

    const match = String(val).match(/^(\d{4})-?(\d{2})$/);
    if (!match) return null;

    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;

    return `${match[1]}-${match[2]}-01`;
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

    try {
        await upsertSodraMonthly(rows, path.basename(filename));
        log(`Inserted ${rows.length} rows (total: ${eilute - skipped})`);
    } catch (err) {
        console.error("Insert failed:", err.message);
        console.error("First row of failed batch:", rows[0]);
        throw err;
    }
}
