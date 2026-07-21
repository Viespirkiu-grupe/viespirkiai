import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { postgres } from "../postgres/postgres.js";
import { iterateCanonicalBatches } from "../modules/sutartys/eksportasCanonical.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.resolve(__dirname, "../exports/sutartysCanonical.jsonl");

async function main() {
    await fs.promises.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    const out = fs.createWriteStream(OUTPUT_PATH, { encoding: "utf8" });

    let written = 0;
    const t0 = Date.now();

    for await (const { rows, afterId } of iterateCanonicalBatches()) {
        for (const row of rows) {
            if (!out.write(JSON.stringify(row.doc) + "\n")) {
                await new Promise((resolve) => out.once("drain", resolve));
            }
            written++;
        }
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`${written} sutarčių (${dt}s, last id ${afterId})`);
    }

    await new Promise((resolve, reject) => {
        out.end((err) => (err ? reject(err) : resolve()));
    });

    console.log(`Exported ${written} sutarčių to ${OUTPUT_PATH}`);
}

main()
    .catch((error) => {
        console.error("Failed to export sutartys (canonical):", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await postgres.end();
    });
