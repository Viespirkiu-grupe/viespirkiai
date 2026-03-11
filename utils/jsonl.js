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
