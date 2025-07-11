// https://data.gov.lt/datasets/673/#info

import fs from 'fs';
import { mysql } from "../mysql/mysql.js";
import readline from 'readline';

const filename = process.argv[2];
if (!filename) {
  console.error('Usage: node import-csv.mjs <file.csv>');
  process.exit(1);
}


const clean = (val) => {
  if (val === '' || val === undefined) return null;

  const hasWrappingQuotes = val.startsWith('"') && val.endsWith('"');
  if (hasWrappingQuotes) {
    // Remove the outer quotes and unescape inner quotes
    return val.slice(1, -1).replace(/""/g, '"');
  }

  return val;
};


const sanitize = (val, type = 'text') => {
  if (val === '' || val === undefined) return null;
  if (type === 'int') return parseInt(val) || null;
  if (type === 'float') return parseFloat(val) || null;
  return clean(val);
};

let count = 0;
let isFirstLine = true;
const batchSize = 100;
let batch = [];

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
    count += rows.length;
    if (count % 1000 === 0) {
      console.log(`${count} rows inserted...`);
    }
  } catch (err) {
    console.error(`Batch insert failed after ${count} rows:`, err.message);
  }
};

const rl = readline.createInterface({
  input: fs.createReadStream(filename),
  crlfDelay: Infinity
});

const parseCSVLine = (line) => {
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


for await (const line of rl) {
  if (isFirstLine) {
    isFirstLine = false;
    continue;
  }

  const fields = parseCSVLine(line);

  if (fields.length < 12) {
    console.warn(`Skipping malformed line: ${line}`);
    continue;
  }

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

  if (batch.length === batchSize) {
    await insertBatch(batch);
    batch = [];
  }
}

// Insert any remaining rows
if (batch.length > 0) {
  await insertBatch(batch);
}

console.log(`Done. Total rows inserted: ${count}`);
await mysql.end();
