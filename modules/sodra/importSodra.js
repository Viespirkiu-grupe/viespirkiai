/*
Importuoja SODROS duomenis iš CSV failo į Postgres.
https://atvira.sodra.lt/imones/rinkiniai/index.html

Rankinis paleidimas:
    node modules/sodra/importSodra.js <file.csv> [--dry-run]

Automatinį parsiuntimą ir importą suka modules/sodra/atnaujintiSodra.js.
*/
import fs from "fs";
import path from "path";
import { postgres } from "../../postgres/postgres.js";
import readline from "readline";
import { log } from "../../utils/log.js";
import { upsertSodraMonthly } from "./upsertSodraMonthly.js";

const BATCH_SIZE = 1_000;

/**
 * Perskaito Sodros mėnesinį CSV ir sukelia jį į `sodraMonthly` lenteles.
 *
 * Failas skaitomas eilutė po eilutės ir keliamas 1000 eilučių paketais — metinis
 * CSV yra ~95 MB, tad į atmintį jo netraukiam.
 *
 * @param {string} kelias - Kelias iki CSV failo.
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Tik parsinti, į DB nerašyti.
 * @param {string} [options.importFile] - Vardas, kuriuo importas registruojamas
 *   `sodraMonthlyImportai` lentelėje (numatytai — failo vardas).
 * @returns {Promise<{eiluciuSkaicius: number, praleista: number, irasyta: number, naujausiasMenuo: string|null}>}
 */
export async function importuotiSodrosCsv(
    kelias,
    { dryRun = false, importFile } = {},
) {
    const importoVardas = importFile ?? path.basename(kelias);

    const rl = readline.createInterface({
        input: fs.createReadStream(kelias),
        crlfDelay: Infinity,
    });

    let isFirstLine = true;
    let batch = [];
    let eilute = 0;
    let skipped = 0;
    let irasyta = 0;
    let naujausiasMenuo = null;

    const insertBatch = async (rows) => {
        if (!rows.length) return;
        try {
            irasyta += await upsertSodraMonthly(rows, importoVardas);
            log(`Inserted ${rows.length} rows (total: ${eilute - skipped})`);
        } catch (err) {
            console.error("Insert failed:", err.message);
            console.error("First row of failed batch:", rows[0]);
            throw err;
        }
    };

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

        if (naujausiasMenuo === null || parsedMonth > naujausiasMenuo) {
            naujausiasMenuo = parsedMonth;
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

        if (dryRun) {
            log(`[Line ${eilute}] ${JSON.stringify(row, null, 2)}`);
            continue;
        }

        batch.push(row);

        if (batch.length === BATCH_SIZE) {
            await insertBatch(batch);
            batch = [];
        }
    }

    if (!dryRun && batch.length > 0) {
        await insertBatch(batch);
    }

    log(
        `Done ${importoVardas}. Processed: ${eilute}, skipped: ${skipped}, written: ${irasyta}`,
    );

    return {
        eiluciuSkaicius: eilute,
        praleista: skipped,
        irasyta,
        naujausiasMenuo,
    };
}

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

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const filename = process.argv[2];
    const dryRun = process.argv.includes("--dry-run");

    if (!filename) {
        console.error("Usage: node importSodra.js <file.csv> [--dry-run]");
        process.exit(1);
    }

    if (dryRun) log("🔍 DRY RUN — no data will be written");

    try {
        await importuotiSodrosCsv(filename, { dryRun });
    } catch (err) {
        console.error("Klaida importuojant Sodros duomenis:", err);
        process.exitCode = 1;
    } finally {
        await postgres.end();
    }
}
