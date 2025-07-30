/*
Importuoja mokėtų mokesčių duomenis iš CSV failo į MySQL duomenų bazę.
https://data.gov.lt/datasets/673/
*/
import fs from 'fs';
import { mysql } from "../mysql/mysql.js";
import readline from 'readline';

// Patikrina, ar nurodytas CSV failo pavadinimas
const filename = process.argv[2];
if (!filename) {
  console.error('Naudojimas: node importMoketiMokesciai.js <file.csv>');
  process.exit(1);
}

// Nuskaito CSV failą liniją po linijos
const rl = readline.createInterface({
  input: fs.createReadStream(filename),
  crlfDelay: Infinity
});



let isFirstLine = true;
const batchSize = 100;
let batch = [];
for await (const line of rl) {
  if (isFirstLine) {
    isFirstLine = false;
    continue;
  }

  // Nuskaitome eilutės laukus
  const fields = parseCSVLine(line);

  // Patikriname, ar yra pakankamai laukų
  if (fields.length < 12) {
    console.warn(`Skipping malformed line: ${line}`);
    continue;
  }

  // Išvalome duomenys
  const [
    _id, id, mm_kodas_id, jarCode, pavadinimas,
      tipas, apskritis, savivaldybe, metai, menuo,
      suma, atnaujinta
  ] = fields.map(clean);

  const row = [
    _id,
    id,
    mm_kodas_id,
    jarCode,
    pavadinimas,
    tipas,
    apskritis,
    savivaldybe,
    metai,
    menuo,
    suma,
    atnaujinta
  ];

  batch.push(row);

  // Kai susikaupia pakankamai eilučių, įterpiame jas į duomenų bazę
  if (batch.length === batchSize) {
    await insertBatch(batch);
    batch = [];
  }
}

// Įterpiame likusias eilutes, jei tokių yra
if (batch.length > 0) {
  await insertBatch(batch);
}

console.log(`Įterptos eilutės: ${eilute}`);
await mysql.end();

/**
 * Nuskaito CSV eilutę.
 * @param {string} line - CSV eilutė.
 * @returns {Array} - Išanalizuoti laukai.
 */
function parseCSVLine(line){
  const result = [];
  let field = '';
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
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(field);
      field = '';
    } else {
      field += char;
    }
  }

  result.push(field); // last field
  return result;
};

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

let eilute = 0;
/**
 * Įterpia duomenų grupę į MySQL duomenų bazę.
 * @param {Array} rows - Duomenų grupė, kurią reikia įterpti.
 * @returns {Promise<void>}
 */
const insertBatch = async (rows) => {
  if (rows.length === 0) return;

  const sql = `
    INSERT INTO mokesciai (
      _id, id, mm_kodas_id, jarKodas, pavadinimas,
      formosPavadinimas, apskritis, savivaldybe, metai, menuo,
      suma, duomenuData
    ) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
  `;

  const values = rows.flat();

  try {
    await mysql.execute(sql, values);
    eilute += rows.length;
    if (eilute % 1000 === 0) {
      console.log(`${eilute} rows inserted...`);
    }
  } catch (err) {
    console.error(`Batch insert failed after ${eilute} rows:`, err.message);
  }
};