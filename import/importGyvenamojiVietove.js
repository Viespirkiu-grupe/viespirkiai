/*
Importuoja gyvenamųjų vietovių pavadinimus iš CSV failo į MySQL duomenų bazę.
https://data.gov.lt/datasets/1287/
*/
import fs from "fs";
import readline from "readline";
import { postgres } from "../postgres/postgres.js";

// Patikrina, ar nurodytas CSV failo pavadinimas
const filename = process.argv[2];
if (!filename) {
    console.error("Naudojimas: node importGyvenamojiVietove.js <file.csv>");
    process.exit(1);
}

// Nuskaito CSV failą liniją po linijos
const rl = readline.createInterface({
    input: fs.createReadStream(filename),
    crlfDelay: Infinity,
});

let arPirmaEilute = true;
const ITERPIMO_DYDIS = 100; // Po tiek eilučių įterpiama į duomenų bazę vienu metu
let batch = [];

for await (const line of rl) {
    // Praleidžiame pirmą eilutę, kuri yra antraštė
    if (arPirmaEilute) {
        arPirmaEilute = false;
        continue;
    }

    // Nuskaitome eilutės laukus
    const fields = parseCSVLine(line);

    if (fields.length < 10) {
        console.warn(`Praleidžiama neteisingo formato eilutę: ${line}`);
        continue;
    }

    // Išvalome duomenys
    const row = fields.map(clean);

    batch.push([
        row[4], // gyvKodas
        row[5], // tipas
        row[6], // tipoSantrumpa
        row[7], // pavadinimasK
        row[8], // pavadinimas
        row[9], // seniunija
        row[10], // savivaldybe
        row[11], // gyvNuo
        row[12], // gyvIki
    ]);

    // Kai susikaupia pakankamai eilučių, įterpiame jas į duomenų bazę
    if (batch.length === ITERPIMO_DYDIS) {
        await insertBatch(batch);
        batch = [];
    }
}

// Įterpiame likusias eilutes, jei tokių yra
if (batch.length > 0) {
    await insertBatch(batch);
}

/**
 * Nuskaito ir išanalizuoja CSV eilutę, atskirdama laukus pagal kabutes ir kablelius.
 * @param {string} line - CSV eilutė.
 * @returns {Array} - Išanalizuoti laukai kaip masyvas.
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
        } else if (char === "," && !inQuotes) {
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

var eilutė = 0;
/**
 * Inserts a batch of rows into PostgreSQL "gyvenamosVietoves" table.
 * @param {Array} rows - Array of rows to insert.
 * @returns {Promise<void>}
 */
async function insertBatch(rows) {
    if (rows.length === 0) return;

    // Construct placeholders for PostgreSQL ($1, $2, …)
    const placeholders = rows
        .map(
            (_, rowIndex) =>
                `(${[1, 2, 3, 4, 5, 6, 7, 8, 9]
                    .map((i, colIndex) => `$${rowIndex * 9 + colIndex + 1}`)
                    .join(", ")})`,
        )
        .join(", ");

    const sql = `
        INSERT INTO public."gyvenamosVietoves" (
            "gyvKodas", tipas, "tipoSantrumpa", "pavadinimasK", pavadinimas,
            seniunija, savivaldybe, "gyvNuo", "gyvIki"
        ) VALUES ${placeholders}
        ON CONFLICT ("gyvKodas") DO NOTHING
    `;

    const values = rows.flat();

    try {
        await postgres.query(sql, values);
        eilutė += rows.length;
        if (eilutė % 1000 === 0) {
            console.log(`Inserted ${eilutė} rows...`);
        }
    } catch (err) {
        console.error(`Insert failed after ${eilutė} rows:`, err.message);
    }
}
