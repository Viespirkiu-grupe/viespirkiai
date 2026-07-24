import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";

/**
 * Creates a Transform stream that serialises plain objects as JSONL (newline-delimited JSON).
 * Each object written produces one JSON line terminated with `\n`.
 * @returns {Transform} A Transform stream in object mode (input) / text mode (output).
 */
export function objectsToJsonlStream() {
    return new Transform({
        objectMode: true,
        transform(row, _enc, cb) {
            cb(null, JSON.stringify(row) + "\n");
        },
    });
}

/**
 * Išrašo async iteratorių į JSONL failą su backpressure (laukiam „drain", kai
 * buferis pilnas – kitaip didelis eksportas suvalgo visą RAM).
 *
 * @param {string} outputPath - kelias iki .jsonl (aplankai sukuriami automatiškai)
 * @param {AsyncIterable<object>} records
 * @param {Object} [opts]
 * @param {(written: number) => void} [opts.onProgress] - kviečiama po kiekvieno įrašo
 * @returns {Promise<number>} kiek eilučių įrašyta
 */
export async function writeJsonlFile(outputPath, records, { onProgress } = {}) {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const out = fs.createWriteStream(outputPath, { encoding: "utf8" });

    let written = 0;
    for await (const record of records) {
        if (!out.write(JSON.stringify(record) + "\n")) {
            await new Promise((resolve) => out.once("drain", resolve));
        }
        written++;
        onProgress?.(written);
    }

    await new Promise((resolve, reject) => {
        out.end((err) => (err ? reject(err) : resolve()));
    });
    return written;
}
