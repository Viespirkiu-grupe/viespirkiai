#!/usr/bin/env node
/*
Importuoja JAR isregistruotu juridiniu asmenu duomenis is CSV i PostgreSQL.

https://www.registrucentras.lt/aduomenys/?byla=JAR_ISREGISTRUOTI.csv

CSV stulpeliai:
ja_kodas|ja_pavadinimas|adresas|ja_reg_data|form_kodas|form_pavadinimas|isreg_data|formavimo_data
*/
import fs from "fs";
import readline from "readline";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const BATCH_SIZE = 200;

const filename = process.argv[2];
if (!filename) {
	console.error("Naudojimas: node importJarIsregistruoti.js <file.csv> [skipRows]");
	process.exit(1);
}

const skipRows = Number(process.argv[3] ?? 1);
if (Number.isNaN(skipRows) || skipRows < 0) {
	console.error("skipRows turi buti teigiamas arba nulis.");
	process.exit(1);
}

let skipped = 0;
let scannedRows = 0;
let affectedRows = 0;

const rl = readline.createInterface({
	input: fs.createReadStream(filename),
	crlfDelay: Infinity,
});

let batch = [];

for await (const line of rl) {
	if (skipped < skipRows) {
		skipped++;
		continue;
	}

	scannedRows++;
	const fields = parseCSVLine(line);

	if (fields.length < 8) {
		console.warn(`Skipping malformed line: ${line}`);
		continue;
	}

	const row = fields.map(clean);

	batch.push([
		row[0], // jarKodas
		row[1], // pavadinimas
		row[2], // adresas
		row[3], // registravimoData
		toInteger(row[4]), // formosKodas
		row[5], // formosPavadinimas
		row[6], // isregistravimoData
		row[7], // duomenuData
	]);

	if (batch.length === BATCH_SIZE) {
		await insertBatch(batch);
		affectedRows += batch.length;
		log(`Upsertinta ${affectedRows} eiluciu...`);
		batch = [];
	}
}

if (batch.length > 0) {
	await insertBatch(batch);
	affectedRows += batch.length;
}

log(`DONE. Nuskaityta: ${scannedRows}, upsertinta: ${affectedRows}`);
await postgres.end();

/**
 * Upsertina batch i lentele "jarCsvIsregistruoti".
 * @param {Array<Array<unknown>>} rows
 */
export async function insertBatch(rows) {
	if (rows.length === 0) return;

	const numColumns = 8;
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

	const sql = `
		INSERT INTO "jarCsvIsregistruoti" (
			"jarKodas", "pavadinimas", "adresas",
			"registravimoData", "formosKodas", "formosPavadinimas",
			"isregistravimoData", "duomenuData"
		) VALUES ${placeholders}
		ON CONFLICT ("jarKodas") DO UPDATE SET
			"pavadinimas" = EXCLUDED."pavadinimas",
			"adresas" = EXCLUDED."adresas",
			"registravimoData" = EXCLUDED."registravimoData",
			"formosKodas" = EXCLUDED."formosKodas",
			"formosPavadinimas" = EXCLUDED."formosPavadinimas",
			"isregistravimoData" = EXCLUDED."isregistravimoData",
			"duomenuData" = EXCLUDED."duomenuData"
	`;

	await postgres.query(sql, rows.flat());
}

/**
 * Isparsina viena CSV eilute su | skirtuku ir kabuciu palaikymu.
 * @param {string} line
 * @returns {string[]}
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
				field += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === "|" && !inQuotes) {
			result.push(field);
			field = "";
		} else {
			field += char;
		}
	}

	result.push(field);
	return result;
}

/**
 * Isvalo CSV lauko reiksme.
 * @param {string | undefined} value
 * @returns {string | null}
 */
function clean(value) {
	if (value === "" || value === undefined) return null;

	const hasWrappingQuotes = value.startsWith('"') && value.endsWith('"');
	if (hasWrappingQuotes) {
		return value.slice(1, -1).replace(/""/g, '"');
	}

	return value;
}

/**
 * Konvertuoja i integer, jei nepavyksta - null.
 * @param {string | null} value
 * @returns {number | null}
 */
function toInteger(value) {
	if (value === null || value === "") return null;
	const n = Number(value);
	return Number.isNaN(n) ? null : n;
}
