import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { writeJsonlFile } from "../../utils/jsonl.js";
import { iterateCanonicalBatches } from "./eksportasCanonical.js";

// Kanoninis sutarčių JSON → exports/sutartysCanonical.jsonl.
//   npm run export:sutartys-canonical

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(HERE, "../../exports/sutartysCanonical.jsonl");

async function* records(onBatch) {
    for await (const { rows, afterId } of iterateCanonicalBatches()) {
        for (const row of rows) yield row.doc;
        onBatch(afterId);
    }
}

async function main() {
    const t0 = Date.now();
    let written = 0;

    const total = await writeJsonlFile(
        OUTPUT_PATH,
        records((afterId) => {
            const dt = ((Date.now() - t0) / 1000).toFixed(1);
            console.log(`${written} sutarčių (${dt}s, last id ${afterId})`);
        }),
        { onProgress: (n) => { written = n; } },
    );

    console.log(`Exported ${total} sutarčių to ${OUTPUT_PATH}`);
}

main()
    .catch((error) => {
        console.error("Failed to export sutartys (canonical):", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await postgres.end();
    });
