// csvParser.js (ESM)
import fs from "node:fs";
import readline from "node:readline";
import process from "node:process";

function detectDelimiter(line) {
    const candidates = [",", ";", "\t", "|"];
    let best = ",";
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

function parseCSVLine(line, delimiter) {
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const c = line[i];

        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
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

export async function* parseCSV(path, encoding = "utf8") {
    const stream = fs.createReadStream(path, { encoding });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let headers;
    let delimiter;
    let buffer = "";

    for await (const line of rl) {
        if (!headers) {
            delimiter = detectDelimiter(line);
            headers = parseCSVLine(line, delimiter).map((h) =>
                h.replace(/^\uFEFF/, "").trim(),
            );
            continue;
        }

        if (!line.trim()) continue;

        buffer += (buffer ? "\n" : "") + line;

        // Count quotes to see if the row is complete
        const quoteCount = (buffer.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            // Incomplete row, continue accumulating
            continue;
        }

        const values = parseCSVLine(buffer, delimiter);
        const row = {};

        for (let i = 0; i < headers.length; i++) {
            const val = values[i] ?? "";
            row[headers[i]] = val === "NULL" ? null : val;
        }

        yield row;
        buffer = "";
    }
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const file = process.argv[2];
    if (!file) {
        console.error("Usage: node csvParser.js <file.csv>");
        process.exit(1);
    }

    for await (const row of parseCSV(file)) {
        console.log(row);
    }
}
