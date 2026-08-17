import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import process from "node:process";

/**
 * Guesses the delimiter of a CSV line by counting occurrences of common candidates.
 *
 * @param {string} line - The first (header) line of a CSV file.
 * @returns {"," | ";" | "\t" | "|"} The most likely delimiter character.
 */
function detectDelimiter(line) {
    const candidates = /** @type {const} */ ([",", ";", "\t", "|"]);
    let best = /** @type {"," | ";" | "\t" | "|"} */ (",");
    let max = 0;
    for (const d of candidates) {
        const count = line.split(d).length;
        if (count > max) {
            max = count;
            best = d;
        }
    }
    return best;
}

/**
 * Parses a single CSV line into an array of string values, respecting
 * double-quote escaping and `NULL` → `null` coercion.
 *
 * @param {string} line - A raw CSV line (may contain quoted fields).
 * @param {string} delimiter - The field separator character.
 * @returns {(string | null)[]} Array of parsed field values.
 */
function parseLine(line, delimiter) {
    const out = /** @type {(string | null)[]} */ ([]);
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"'; // escaped quote
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === delimiter && !inQuotes) {
            out.push(cur === "NULL" ? null : cur);
            cur = "";
        } else {
            cur += c;
        }
    }

    out.push(cur === "NULL" ? null : cur);
    return out;
}

/**
 * Async generator that streams rows from a CSV file as plain objects,
 * keyed by the header row. Handles:
 * - BOM stripping
 * - Auto-delimiter detection
 * - Multi-line quoted fields
 * - `NULL` string → `null` coercion
 *
 * @param {string} path - Absolute or relative path to the CSV file.
 * @param {BufferEncoding} [encoding="utf8"] - File encoding.
 * @yields {Record<string, string | null>} One object per data row.
 *
 * @example
 * for await (const row of parseCSV("data.csv")) {
 *   console.log(row);
 * }
 */
export async function* parseCSV(path, encoding = "utf8") {
    const stream = fs.createReadStream(path, { encoding });

    let headers = undefined;
    let delimiter = ",";
    let buffer = "";

    try {
        // `readline` async iteratorius gali užsidaryti ties EOF, kol lėtas
        // vartotojas laukia DB batch'o, o po to mesti ERR_USE_AFTER_CLOSE per
        // kitą `next()`. Tiesioginis failo chunk'ų skaidymas išlaiko likusias
        // eilutes mūsų buferyje ir natūraliai taiko stream backpressure.
        for await (const line of streamLines(stream)) {
            if (!headers) {
                delimiter = detectDelimiter(line);
                headers = parseLine(line, delimiter).map((h) =>
                    (h ?? "").replace(/^\uFEFF/, "").trim(),
                );
                continue;
            }

            if (!line.trim() && !buffer) continue;

            buffer += (buffer ? "\n" : "") + line;

            const quoteCount = (buffer.match(/"/g) ?? []).length;
            if (quoteCount % 2 !== 0) continue;

            const values = parseLine(buffer, delimiter);
            const row = {};
            for (let i = 0; i < headers.length; i++) {
                const val = values[i] ?? "";
                row[headers[i]] = val === "NULL" ? null : val;
            }

            yield row;
            buffer = "";
        }
        if (buffer) throw new Error("CSV baigėsi neuždarytomis kabutėmis");
    } finally {
        stream.destroy();
    }
}

/**
 * @param {import("node:fs").ReadStream} stream
 * @yields {string}
 */
async function* streamLines(stream) {
    let pending = "";
    for await (const chunk of stream) {
        pending += chunk;
        let newline;
        while ((newline = pending.indexOf("\n")) !== -1) {
            let line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            yield line;
        }
    }
    if (pending) {
        yield pending.endsWith("\r") ? pending.slice(0, -1) : pending;
    }
}

/**
 * Escapes a single field value for safe inclusion in a CSV cell.
 * Wraps in double-quotes if the value contains the delimiter, a quote,
 * a newline, or a carriage return.
 *
 * @param {unknown} value - The raw field value.
 * @param {string} delimiter - The field separator character.
 * @returns {string} The properly escaped CSV field.
 */
function escapeField(value, delimiter) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    const needsQuoting =
        str.includes(delimiter) ||
        str.includes('"') ||
        str.includes("\n") ||
        str.includes("\r");
    if (!needsQuoting) return str;
    return `"${str.replaceAll('"', '""')}"`;
}

/**
 * Creates a Transform stream that converts plain objects into CSV lines.
 * The first object written determines the column order (header row).
 * Subsequent objects are serialized in that same column order.
 *
 * Pipe an object-mode Readable into this transform, then pipe its output
 * wherever you need (file, HTTP response, stdout, …).
 *
 * @param {object} [options]
 * @param {string} [options.delimiter=","] - Field separator character.
 * @returns {Transform} A Transform stream in object mode (input) / text mode (output).
 *
 * @example
 * // Stream an array of objects to a file
 * import { Readable } from "node:stream";
 * import { pipeline } from "node:stream/promises";
 *
 * const rows = [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }];
 * await pipeline(
 *   Readable.from(rows),
 *   objectsToCsvStream(),
 *   fs.createWriteStream("out.csv"),
 * );
 */
export function objectsToCsvStream({ delimiter = "," } = {}) {
    let headers = /** @type {string[] | null} */ (null);

    return new Transform({
        objectMode: true, // accepts objects
        /**
         * @param {Record<string, unknown>} row
         * @param {BufferEncoding} _enc
         * @param {(err?: Error | null, data?: string) => void} cb
         */
        transform(row, _enc, cb) {
            if (!headers) {
                headers = Object.keys(row);
                const headerLine =
                    headers
                        .map((h) => escapeField(h, delimiter))
                        .join(delimiter) + "\n";
                this.push(headerLine);
            }
            const line =
                headers
                    .map((h) => escapeField(row[h] ?? "", delimiter))
                    .join(delimiter) + "\n";
            cb(null, line);
        },
    });
}

/**
 * Convenience wrapper: converts an iterable (array, generator, async generator)
 * of objects into a CSV stream.
 *
 * @param {Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>>} source
 * @param {object} [options]
 * @param {string} [options.delimiter=","] - Field separator character.
 * @returns {import("node:stream").Readable} A readable stream of CSV text chunks.
 *
 * @example
 * // Pipe to stdout
 * objectsToCSV(rows).pipe(process.stdout);
 *
 * // Pipe to file
 * objectsToCSV(rows).pipe(fs.createWriteStream("out.csv"));
 */
export function objectsToCSV(source, { delimiter = "," } = {}) {
    const readable = Readable.from(source, { objectMode: true });
    const transform = objectsToCsvStream({ delimiter });
    return readable.pipe(transform);
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const file = process.argv[2];
    if (!file) {
        console.error("Usage: node csv.js <file.csv>");
        process.exit(1);
    }

    const rows = [];
    for await (const row of parseCSV(file)) {
        rows.push(row);
    }

    console.log(JSON.stringify(rows, null, 2));
}
