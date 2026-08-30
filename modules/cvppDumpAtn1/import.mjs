#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { postgres } from '../../postgres/postgres.js';
import { schemaTables } from './scripts/generateSchema.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(moduleDir, 'data');
const NULL_MARKER = /^null$/i;
const DEFAULT_BATCH_SIZE = 250;
const MAX_POSTGRES_PARAMETERS = 65_535;

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

// Lentelės gyvena `cvppDump` schemoje (DDL — cvppDumpSchema.sql), kur schemos
// vardas iš lentelės vardo nukirptas: cvppDumpAtn1Contracts -> atn1Contracts.
const SCHEMA = 'cvppDump';
const lentelesVardas = (table) => {
    const name = table.tableName;
    if (!name.startsWith(SCHEMA)) return name;
    const rest = name.slice(SCHEMA.length);
    return rest[0].toLowerCase() + rest.slice(1);
};
const lentelesNuoroda = (table) => `${quote(SCHEMA)}.${quote(lentelesVardas(table))}`;

function usage() {
    console.log(`
Naudojimas:
  node modules/cvppDumpAtn1/import.mjs [parinktys]

Parinktys:
  --dry-run             Perskaityti ir patikrinti CSV, bet nesijungti prie DB.
  --replace             Prieš importą išvalyti visas 11 šio modulio lentelių.
  --only=LENTELĖ,...    Importuoti tik nurodytas šaltinio lenteles.
  --batch-size=N        Eilučių skaičius viename INSERT (numatyta: ${DEFAULT_BATCH_SIZE}).
  --help                Parodyti šią pagalbą.

Be --replace naudojamas UPSERT pagal kiekvienos lentelės pirminį raktą "id".
`.trim());
}

function parseArguments(argv) {
    const options = {
        batchSize: DEFAULT_BATCH_SIZE,
        dryRun: false,
        only: null,
        replace: false,
    };

    for (const argument of argv) {
        if (argument === '--dry-run') {
            options.dryRun = true;
        } else if (argument === '--replace') {
            options.replace = true;
        } else if (argument === '--help') {
            options.help = true;
        } else if (argument.startsWith('--batch-size=')) {
            options.batchSize = Number(argument.slice('--batch-size='.length));
        } else if (argument.startsWith('--only=')) {
            options.only = new Set(
                argument
                    .slice('--only='.length)
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
            );
        } else {
            throw new Error(`Nežinoma parinktis: ${argument}`);
        }
    }

    if (!Number.isInteger(options.batchSize) || options.batchSize < 1) {
        throw new Error('--batch-size turi būti teigiamas sveikasis skaičius.');
    }
    if (options.dryRun && options.replace) {
        throw new Error('--dry-run ir --replace negali būti naudojami kartu.');
    }
    if (options.only && options.replace) {
        throw new Error('--replace negalima naudoti kartu su --only.');
    }

    return options;
}

function updateQuoteState(line, initialState) {
    let inQuotes = initialState;

    for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== '"') {
            continue;
        }
        if (inQuotes && line[index + 1] === '"') {
            index += 1;
        } else {
            inQuotes = !inQuotes;
        }
    }

    return inQuotes;
}

function parseCsvRecord(record, location) {
    const fields = [];
    let field = '';
    let inQuotes = false;

    for (let index = 0; index < record.length; index += 1) {
        const character = record[index];

        if (inQuotes) {
            if (character === '"' && record[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (character === '"') {
                inQuotes = false;
            } else {
                field += character;
            }
        } else if (character === ',') {
            fields.push(field);
            field = '';
        } else if (character === '"' && field.length === 0) {
            inQuotes = true;
        } else {
            field += character;
        }
    }

    if (inQuotes) {
        throw new Error(`${location}: neuždarytos CSV kabutės.`);
    }

    fields.push(field);
    return fields;
}

async function* readCsv(filePath) {
    const input = fs.createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let logicalRecord = '';
    let recordStartLine = 1;
    let physicalLine = 0;
    let inQuotes = false;

    for await (const line of lines) {
        physicalLine += 1;
        if (logicalRecord === '') {
            recordStartLine = physicalLine;
        } else {
            logicalRecord += '\n';
        }
        logicalRecord += line;
        inQuotes = updateQuoteState(line, inQuotes);

        if (!inQuotes) {
            yield {
                fields: parseCsvRecord(
                    logicalRecord,
                    `${path.basename(filePath)}:${recordStartLine}`,
                ),
                line: recordStartLine,
            };
            logicalRecord = '';
        }
    }

    if (inQuotes) {
        throw new Error(
            `${path.basename(filePath)}:${recordStartLine}: neuždarytas CSV įrašas.`,
        );
    }
    if (logicalRecord !== '') {
        yield {
            fields: parseCsvRecord(
                logicalRecord,
                `${path.basename(filePath)}:${recordStartLine}`,
            ),
            line: recordStartLine,
        };
    }
}

function nullableValue(value) {
    const trimmed = value.trim();
    return trimmed === '' || NULL_MARKER.test(trimmed) ? null : value;
}

function parseInteger(value, location) {
    const nullable = nullableValue(value);
    if (nullable === null) {
        return null;
    }

    const trimmed = nullable.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
        throw new Error(`${location}: netinkamas integer: ${JSON.stringify(value)}`);
    }

    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < -2_147_483_648 || parsed > 2_147_483_647) {
        throw new Error(`${location}: integer nepatenka į PostgreSQL ribas: ${value}`);
    }
    return parsed;
}

function parseBigint(value, location) {
    const nullable = nullableValue(value);
    if (nullable === null) {
        return null;
    }

    const trimmed = nullable.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
        throw new Error(`${location}: netinkamas bigint: ${JSON.stringify(value)}`);
    }
    return BigInt(trimmed).toString();
}

function parseBoolean(value, location) {
    const nullable = nullableValue(value);
    if (nullable === null) {
        return null;
    }

    const normalized = nullable.trim().toLowerCase();
    if (normalized === 'true') {
        return true;
    }
    if (normalized === 'false') {
        return false;
    }
    throw new Error(`${location}: netinkamas boolean: ${JSON.stringify(value)}`);
}

function parseDate(value, location) {
    const nullable = nullableValue(value);
    if (nullable === null) {
        return null;
    }

    const trimmed = nullable.trim();
    let year;
    let month;
    let day;
    let match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);

    if (match) {
        [, year, month, day] = match;
    } else {
        match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/);
        if (!match) {
            throw new Error(`${location}: netinkama data: ${JSON.stringify(value)}`);
        }
        [, month, day, year] = match;
        month = month.padStart(2, '0');
        day = day.padStart(2, '0');
    }

    const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
        check.getUTCFullYear() !== Number(year)
        || check.getUTCMonth() + 1 !== Number(month)
        || check.getUTCDate() !== Number(day)
    ) {
        throw new Error(`${location}: neegzistuojanti data: ${JSON.stringify(value)}`);
    }

    return `${year}-${month}-${day}`;
}

function parseTimestamp(value, location) {
    const nullable = nullableValue(value);
    if (nullable === null) {
        return null;
    }

    const trimmed = nullable.trim();
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
        throw new Error(`${location}: netinkamas timestamp: ${JSON.stringify(value)}`);
    }
    return trimmed.replace('T', ' ');
}

function parseNumeric(value, location) {
    const nullable = nullableValue(value);
    if (nullable === null) {
        return null;
    }

    let normalized = nullable.trim().replace(/[\s\u00a0]/g, '');
    const comma = normalized.lastIndexOf(',');
    const dot = normalized.lastIndexOf('.');

    if (comma >= 0 && dot >= 0) {
        normalized = comma > dot
            ? normalized.replaceAll('.', '').replace(',', '.')
            : normalized.replaceAll(',', '');
    } else if (comma >= 0) {
        normalized = normalized.replace(',', '.');
    }

    if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
        throw new Error(`${location}: netinkamas numeric: ${JSON.stringify(value)}`);
    }
    return normalized;
}

function convertValue(value, column, location) {
    if (column.type === 'integer') {
        return parseInteger(value, location);
    }
    if (column.type === 'bigint') {
        return parseBigint(value, location);
    }
    if (column.type === 'boolean') {
        return parseBoolean(value, location);
    }
    if (column.type === 'date') {
        return parseDate(value, location);
    }
    if (column.type === 'timestamp without time zone') {
        return parseTimestamp(value, location);
    }
    if (column.type.startsWith('numeric')) {
        return parseNumeric(value, location);
    }
    if (column.type === 'text') {
        return nullableValue(value);
    }
    throw new Error(`${location}: nepalaikomas tipas ${column.type}.`);
}

function insertSql(table, rowCount) {
    const columnCount = table.columns.length;
    const placeholders = Array.from({ length: rowCount }, (_, rowIndex) => {
        const start = rowIndex * columnCount + 1;
        return `(${Array.from(
            { length: columnCount },
            (_, columnIndex) => `$${start + columnIndex}`,
        ).join(', ')})`;
    }).join(',\n');
    const columns = table.columns.map((column) => quote(column.name)).join(', ');
    const updates = table.columns
        .filter((column) => column.name !== 'id')
        .map((column) => `${quote(column.name)} = EXCLUDED.${quote(column.name)}`)
        .join(',\n    ');

    return `
INSERT INTO ${lentelesNuoroda(table)} (${columns})
VALUES ${placeholders}
ON CONFLICT (id) DO UPDATE SET
    ${updates}
`.trim();
}

async function verifyTargetSchema(client, tables) {
    for (const table of tables) {
        const result = await client.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2`,
            [SCHEMA, lentelesVardas(table)],
        );
        const existing = new Set(result.rows.map((row) => row.column_name));

        if (existing.size === 0) {
            throw new Error(
                `DB lentelė ${SCHEMA}.${lentelesVardas(table)} nerasta. Pirmiausia pritaikykite schema.sql.`,
            );
        }

        const missing = table.columns
            .map((column) => column.name)
            .filter((column) => !existing.has(column));
        if (missing.length > 0) {
            throw new Error(
                `DB lentelėje ${SCHEMA}.${lentelesVardas(table)} trūksta stulpelių: ${missing.join(', ')}`,
            );
        }
    }
}

async function truncateTables(client, tables) {
    const targets = tables
        .map((table) => lentelesNuoroda(table))
        .join(', ');
    await client.query(`TRUNCATE TABLE ${targets}`);
}

async function importTable(client, table, options, knownIds) {
    const filePath = path.join(dataDir, `${table.sourceTable}.csv`);
    const records = readCsv(filePath);
    const headerResult = await records.next();

    if (headerResult.done) {
        throw new Error(`${path.basename(filePath)} yra tuščias.`);
    }

    const header = headerResult.value.fields;
    header[0] = header[0].replace(/^\uFEFF/, '');
    const expectedHeader = table.columns.map((column) => column.sourceName);

    if (
        header.length !== expectedHeader.length
        || header.some((column, index) => column !== expectedHeader[index])
    ) {
        throw new Error(
            `${path.basename(filePath)} antraštė neatitinka schemos.\n`
            + `Gauta: ${header.join(',')}\nTikėtasi: ${expectedHeader.join(',')}`,
        );
    }

    const idIndex = table.columns.findIndex((column) => column.name === 'id');
    const atn1IdIndex = table.columns.findIndex((column) => column.name === 'atn1Id');
    const contractIdIndex = table.columns.findIndex(
        (column) => column.name === 'atn1ContractListId',
    );
    const tableIds = new Set();
    let batch = [];
    let count = 0;

    for await (const record of records) {
        count += 1;
        if (record.fields.length !== table.columns.length) {
            throw new Error(
                `${path.basename(filePath)}:${record.line}: gauta ${record.fields.length} `
                + `laukų, tikėtasi ${table.columns.length}.`,
            );
        }

        const values = record.fields.map((value, index) => convertValue(
            value,
            table.columns[index],
            `${path.basename(filePath)}:${record.line} (${table.columns[index].sourceName})`,
        ));
        const id = values[idIndex];
        if (id === null) {
            throw new Error(`${path.basename(filePath)}:${record.line}: ID negali būti NULL.`);
        }
        if (tableIds.has(id)) {
            throw new Error(`${path.basename(filePath)}:${record.line}: pasikartojantis ID ${id}.`);
        }
        tableIds.add(id);

        if (atn1IdIndex >= 0 && knownIds.has('ATN1')) {
            const parentId = values[atn1IdIndex];
            if (!knownIds.get('ATN1').has(parentId)) {
                throw new Error(
                    `${path.basename(filePath)}:${record.line}: ATN1_ID ${parentId} nerastas.`,
                );
            }
        }
        if (contractIdIndex >= 0 && knownIds.has('ATN1_CONTRACT_LIST')) {
            const parentId = values[contractIdIndex];
            if (!knownIds.get('ATN1_CONTRACT_LIST').has(parentId)) {
                throw new Error(
                    `${path.basename(filePath)}:${record.line}: `
                    + `ATN1_CONTRACT_LIST_ID ${parentId} nerastas.`,
                );
            }
        }

        if (!options.dryRun) {
            batch.push(values);
            if (batch.length >= options.batchSize) {
                await client.query(insertSql(table, batch.length), batch.flat());
                batch = [];
            }
        }
    }

    if (!options.dryRun && batch.length > 0) {
        await client.query(insertSql(table, batch.length), batch.flat());
    }

    knownIds.set(table.sourceTable, tableIds);
    console.log(`${table.sourceTable}: ${count.toLocaleString('lt-LT')} eilučių`);
    return count;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
        usage();
        return;
    }

    const knownNames = new Set(schemaTables.map((table) => table.sourceTable));
    if (options.only) {
        const unknown = [...options.only].filter((name) => !knownNames.has(name));
        if (unknown.length > 0) {
            throw new Error(`Nežinomos --only lentelės: ${unknown.join(', ')}`);
        }
    }

    const tables = options.only
        ? schemaTables.filter((table) => options.only.has(table.sourceTable))
        : schemaTables;
    for (const table of tables) {
        if (table.columns.length * options.batchSize > MAX_POSTGRES_PARAMETERS) {
            throw new Error(
                `${table.sourceTable}: batch-size ${options.batchSize} viršytų `
                + `PostgreSQL ${MAX_POSTGRES_PARAMETERS} parametrų limitą.`,
            );
        }
    }

    const mode = options.dryRun
        ? 'DRY RUN'
        : options.replace ? 'REPLACE' : 'UPSERT';
    console.log(`CVPP ATN-1 importas: ${mode}, batch=${options.batchSize}`);

    const knownIds = new Map();
    let total = 0;

    if (options.dryRun) {
        for (const table of tables) {
            total += await importTable(null, table, options, knownIds);
        }
        console.log(`Patikra baigta: ${total.toLocaleString('lt-LT')} eilučių.`);
        return;
    }

    const client = await postgres.connect();
    try {
        await client.query('BEGIN');
        await verifyTargetSchema(client, tables);
        if (options.replace) {
            await truncateTables(client, tables);
        }
        for (const table of tables) {
            total += await importTable(client, table, options, knownIds);
        }
        await client.query('COMMIT');
        console.log(`Importas baigtas: ${total.toLocaleString('lt-LT')} eilučių.`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

try {
    await main();
} catch (error) {
    console.error(`Klaida: ${error.message}`);
    process.exitCode = 1;
} finally {
    await postgres.end();
}
