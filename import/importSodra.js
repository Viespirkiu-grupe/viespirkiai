/*
Importuoja SODROS duomenis iš CSV failo į MySQL duomenų bazę.
https://atvira.sodra.lt/imones/rinkiniai/index.html
*/
import fs from 'fs';
import path from 'path';
import { mysql } from "../mysql/mysql.js";
import readline from 'readline';

// Patikrina, ar nurodytas CSV failo pavadinimas
const filename = process.argv[2];
if (!filename) {
  console.error('Usage: node importSodra.js <file.csv>');
  process.exit(1);
}

// Nuskaito CSV failą liniją po linijos
const rl = readline.createInterface({
  input: fs.createReadStream(filename),
  crlfDelay: Infinity
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

  if (fields.length < 12) {
    console.warn(`Skipping malformed line: ${line}`);
    continue;
  }

  // Išvalome duomenys
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
    sanitize(code, 'int'),
    jarCode,
    name,
    municipality,
    ecoActCode,
    ecoActName,
    sanitize(month, 'int'),
    sanitize(avgWage, 'float'),
    sanitize(numInsured, 'int'),
    sanitize(avgWage2, 'float'),
    sanitize(numInsured2, 'int'),
    sanitize(tax, 'float'),
    path.basename(filename)
  ];

  batch.push(row);

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
    } else if (char === ';' && !inQuotes) {
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
 * Nustato teisingą reikšės tipą
 * @param {string} val - CSV lauko reikšmė.
 * @param {string} type - Lauko tipas ('text', 'int', 'float').
 * @returns {string|null} - Išvalyta reikšmė arba null, jei reikšmė yra tuščia.
 */
function sanitize(val, type = 'text'){
  if (val === '' || val === undefined) return null;
  if (type === 'int') return parseInt(val) || null;
  if (type === 'float') return parseFloat(val) || null;
  return clean(val);
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

let eilute = 0;
/**
 * Įterpia duomenų grupę į MySQL duomenų bazę.
 * @param {Array} rows - Duomenų grupė, kurią reikia įterpti.
 * @returns {Promise<void>}
 */
const insertBatch = async (rows) => {
  if (rows.length === 0) return;

  const sql = `
    INSERT INTO sodra (
      code, jarKodas, pavadinimas, savivaldybe, ekonominesVeiklosKodas,
      ekonominesVeiklosPavadinimas, data, vidutinisAtlyginimas, draustieji, vidutinisAtlyginimas2,
      draustieji2, imokuSuma, importFile
    ) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
  `;

  const values = rows.flat();

  try {
    await mysql.execute(sql, values);
    eilute += rows.length;
    if (eilute % 1000 === 0) {
			console.log(`Įterpta ${eilute} eilučių...`);
    }
  } catch (err) {
		console.error(`Įterpimas nepavyko po ${eilute} eilučių:`, err.message);
  }
};