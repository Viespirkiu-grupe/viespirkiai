import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { writeJsonlFile } from "../../utils/jsonl.js";
import { streamCanonicalDocs } from "./eksportasCanonical.js";

// Kanoninis sutarčių JSON → exports/sutartysCanonical.jsonl.
//   npm run export:sutartys-canonical

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(HERE, "../../exports/sutartysCanonical.jsonl");

const PROGRESS_MS = 2000;

/**
 * PG jau grąžina dokumentą JSON tekstu – tik ištraukiam stulpelį.
 * Progresas spausdinamas pagal laiką, ne pagal eilučių skaičių: prieš pirmą
 * eilutę užklausa dar sudeda vaikinių lentelių hash'us, tad fiksuotas „kas N
 * eilučių" žingsnis tą laiką paliktų be jokio išvedimo.
 */
async function* docs(stream, onProgress) {
    let n = 0;
    let nextAt = Date.now() + PROGRESS_MS;
    for await (const row of stream) {
        n++;
        if (Date.now() >= nextAt) {
            nextAt = Date.now() + PROGRESS_MS;
            onProgress(n);
        }
        yield row.doc;
    }
}

async function main() {
    const t0 = Date.now();
    const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`Renkam sutartis į ${OUTPUT_PATH}…`);
    const stream = await streamCanonicalDocs();

    const total = await writeJsonlFile(
        OUTPUT_PATH,
        docs(stream, (n) => console.log(`${n} sutarčių (${elapsed()}s)`)),
        { serialize: String },
    );

    console.log(`Exported ${total} sutarčių to ${OUTPUT_PATH} (${elapsed()}s)`);
}

main()
    .catch((error) => {
        console.error("Failed to export sutartys (canonical):", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await postgres.end();
    });
