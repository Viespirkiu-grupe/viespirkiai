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
 * Eilutės kaupiamos į ~1 MB gabalus: milijonams įrašų vienas `write()` per
 * eilutę yra pastebima dalis eksporto laiko.
 *
 * @param {string} outputPath - kelias iki .jsonl (aplankai sukuriami automatiškai)
 * @param {AsyncIterable<any>} records
 * @param {Object} [opts]
 * @param {(written: number) => void} [opts.onProgress] - kviečiama po kiekvieno įrašo
 * @param {(record: any) => string} [opts.serialize] - kaip įrašą paversti eilute;
 *   numatytai JSON.stringify. Kai duomenys iš PG ateina jau JSON tekstu,
 *   perduodam `String`, kad nereikėtų parsinti ir vėl stringify'inti.
 * @returns {Promise<number>} kiek eilučių įrašyta
 */
export async function writeJsonlFile(
    outputPath,
    records,
    { onProgress, serialize = JSON.stringify } = {},
) {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const out = fs.createWriteStream(outputPath, { encoding: "utf8" });

    const CHUNK_BYTES = 1 << 20;
    let buffer = "";
    let written = 0;

    const flush = async () => {
        if (!buffer) return;
        const chunk = buffer;
        buffer = "";
        if (!out.write(chunk)) {
            await new Promise((resolve) => out.once("drain", resolve));
        }
    };

    for await (const record of records) {
        buffer += serialize(record) + "\n";
        written++;
        onProgress?.(written);
        if (buffer.length >= CHUNK_BYTES) await flush();
    }
    await flush();

    await new Promise((resolve, reject) => {
        out.end((err) => (err ? reject(err) : resolve()));
    });
    return written;
}
