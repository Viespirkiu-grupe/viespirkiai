import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { writeJsonlFile } from "../../utils/jsonl.js";
import { buildExportRecord, iterateBatches } from "./eksportas.js";

// Visos sutartys → exports/sutartys.jsonl (viena eilutė per sutartį).
//   npm run export:sutartys

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(HERE, "../../exports/sutartys.jsonl");

/** Batch'ų iteratorių išlyginam į atskirus įrašus, kad tiktų writeJsonlFile. */
async function* records(onBatch) {
    for await (const { rows, md5Lookup, afterId } of iterateBatches()) {
        for (const row of rows) {
            yield buildExportRecord(row, md5Lookup);
        }
        onBatch(rows.length, afterId);
    }
}

async function main() {
    const t0 = Date.now();
    let written = 0;

    const total = await writeJsonlFile(
        OUTPUT_PATH,
        records((batchSize, afterId) => {
            if (written % 10000 < batchSize) {
                const dt = ((Date.now() - t0) / 1000).toFixed(1);
                console.log(`${written} sutarčių (${dt}s, last id ${afterId})`);
            }
        }),
        { onProgress: (n) => { written = n; } },
    );

    console.log(`Exported ${total} sutarčių to ${OUTPUT_PATH}`);
}

main()
    .catch((error) => {
        console.error("Failed to export sutartys:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await postgres.end();
    });
