/*
Importuoja JAR duomenis iš CSV failo į MySQL duomenų bazę.
https://data.gov.lt/datasets/1484/ (CSV pirmas, tiesioginis)
*/
import fs from "fs";
import readline from "readline";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import {
    addDocumentsToJarSearch,
    ensureJarCollection,
} from "../../typesense/typesense.js";

// Jei importuojame į Typesense, schemą privalome patikrinti net kai bendras
// `typesenseUp` jungiklis išjungtas: dokumentų siuntimas žemiau vis tiek vyksta.
await ensureJarCollection({ ignoreTypesenseUp: true });
let eilute = 0;

// Patikrina, ar nurodytas CSV failo pavadinimas
const filename = process.argv[2];
if (!filename) {
    console.error("Naudojimas: node importJarCsv.js <file.csv> [skipRows]");
    process.exit(1);
}

// Papildomas argumentas – kiek eilučių praleisti
const skipRows = Number(process.argv[3] ?? 1); // default 1 = praleidžia pirmą antraštės eilutę
if (isNaN(skipRows) || skipRows < 0) {
    console.error("skipRows turi būti teigiamas arba nulis.");
    process.exit(1);
}

let skipped = 0;

// Nuskaito CSV failą liniją po linijos
const rl = readline.createInterface({
    input: fs.createReadStream(filename),
    crlfDelay: Infinity,
});

const ITERPIMO_DYDIS = 100; // Po tiek eilučių įterpiama į duomenų bazę vienu metu
let batch = [];
let typesenseBatch = [];

for await (const line of rl) {
    // Praleidžiame tiek eilučių, kiek nurodyta
    if (skipped < skipRows) {
        skipped++;
        eilute++;
        continue;
    }

    const fields = parseCSVLine(line);

    if (fields.length < 10) {
        console.warn(`Skipping malformed line: ${line}`);
        continue;
    }

    // Išvalome duomenys
    const row = fields.map(clean);
    row.push(toBaseCompanyName(row[1])); // pridedame bazinį pavadinimą

    batch.push(row);
    typesenseBatch.push({
        jarKodas: row[0],
        pavadinimas: row[1],
        pavadinimasBase: row[10],
        adresas: row[2],
        registravimoData: row[3],
        formosKodas: Number(row[4]),
        formosPavadinimas: row[5],
        statusoKodas: Number(row[6]),
        statusoPavadinimas: row[7],
        statusasNuo: row[8],
        duomenuData: row[9],
    });

    // Kai susikaupia pakankamai eilučių, įterpiame jas į duomenų bazę
    if (batch.length === ITERPIMO_DYDIS) {
        await insertBatch(batch);
        await addDocumentsToJarSearch(typesenseBatch);

        batch = [];
        typesenseBatch = [];
    }
}

// Įterpiame likusias eilutes, jei tokių yra
if (batch.length > 0) {
    await insertBatch(batch);
    await addDocumentsToJarSearch(typesenseBatch);
}

log(`Įterptos eilutės: ${eilute}`);

function toBaseCompanyName(name) {
    const companyTypes = [
        "UAB",
        "AB",
        "MB",
        "IĮ",
        "VšĮ",
        "ŽŪB",
        "KŪB",
        "Uždaroji akcinė bendrovė",
        "Akcinė bendrovė",
        "Mažoji bendrija",
        "Individuali įmonė",
        "Viešoji įstaiga",
        "Žemės ūkio bendrovė",
        "Kooperatinė ūkinė bendrovė",
    ];

    if (!name) return "";

    let cleaned = name
        .replace(/["“”„]/g, "")
        .replace(/,/g, "")
        .trim();

    // Pašalina visus prefiksus, nepriklausomai nuo case
    companyTypes.forEach((type) => {
        const pattern = type.replace(/\s+/g, "\\s+"); // tarpai gali būti vienas ar keli
        const regex = new RegExp(pattern, "gi");
        cleaned = cleaned.replace(regex, "");
    });

    // Normalizuoja tarpus
    return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * Nuskaito CSV eilutę.
 * @param {string} line - CSV eilutė.
 * @returns {Array} - Išanalizuoti laukai.
 */
function parseCSVLine(line) {
    const result = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped double quote ("")
                field += '"';
                i++; // Skip the next quote
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === "|" && !inQuotes) {
            // End of field
            result.push(field);
            field = "";
        } else {
            field += char;
        }
    }

    result.push(field); // last field
    return result;
}

/**
 * Išvalo CSV lauką, pašalindamas tuščias reikšmes ir apdorodamas kabutes.
 * @param {string} val - CSV lauko reikšmė.
 * @returns {string|null} - Išvalyta reikšmė arba null, jei reikšmė yra tuščia.
 */
function clean(val) {
    if (val === "" || val === undefined) return null;

    const hasWrappingQuotes = val.startsWith('"') && val.endsWith('"');
    if (hasWrappingQuotes) {
        return val.slice(1, -1).replace(/""/g, '"');
    }

    return val;
}

/**
 * Insert a batch of rows into PostgreSQL.
 * @param {Array} rows - Array of row arrays
 */
export async function insertBatch(rows) {
    if (rows.length === 0) return;

    const placeholders = rows
        .map((_, i) => {
            const start = i * 11 + 1; // 11 vietoj 10, nes pridėjome vieną
            const rowPlaceholders = Array.from(
                { length: 11 },
                (_, j) => `$${start + j}`,
            );
            return `(${rowPlaceholders.join(", ")})`;
        })
        .join(", ");

    const sql = `
        INSERT INTO "jarCsv" (
            "jarKodas", "pavadinimas", "adresas", "registravimoData", "formosKodas",
            "formosPavadinimas", "statusoKodas", "statusoPavadinimas", "statusasNuo", "duomenuData", "pavadinimasBase"
        ) VALUES ${placeholders}
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas",
            "adresas" = EXCLUDED."adresas",
            "registravimoData" = EXCLUDED."registravimoData",
            "formosKodas" = EXCLUDED."formosKodas",
            "formosPavadinimas" = EXCLUDED."formosPavadinimas",
            "statusoKodas" = EXCLUDED."statusoKodas",
            "statusoPavadinimas" = EXCLUDED."statusoPavadinimas",
            "statusasNuo" = EXCLUDED."statusasNuo",
            "duomenuData" = EXCLUDED."duomenuData",
            "pavadinimasBase" = EXCLUDED."pavadinimasBase"
    `;

    const values = rows.flat();

    await postgres.query(sql, values);
    eilute = eilute + rows.length;
    log(`Įterpta ${eilute} eilučių...`);
}
