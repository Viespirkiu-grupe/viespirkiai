import { performance } from "node:perf_hooks";
import { numArg, parseArgs } from "../../utils/cliArgs.js";
import {
    getBvpzSuVektoriais,
    getBvpzVektoriaiSqlitePath,
    getMeta,
    openBvpzVektoriaiSqlite,
} from "./bvpzVektoriaiSqlite.js";
import { createOllamaEmbedder, DEFAULT_EMBED_MODEL, DEFAULT_OLLAMA_URL } from "./ollamaEmbed.js";
import { cosine, norm, vecFromBlob } from "./vektoriai.js";

const argv = process.argv.slice(2);
const args = parseArgs(argv);
const positionals = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
        if (argv[i + 1] && !argv[i + 1].startsWith("--")) i++;
    } else positionals.push(argv[i]);
}
const UZKLAUSA = positionals.join(" ").trim();
const DB_PATH = typeof args.db === "string" ? args.db : getBvpzVektoriaiSqlitePath();
const URL = typeof args.url === "string" ? args.url : DEFAULT_OLLAMA_URL;
const MODEL = typeof args.model === "string" ? args.model : DEFAULT_EMBED_MODEL;
const TOP = numArg(args.top, 10);

function usage() {
    console.error(
        `Naudojimas: npm run vector:bvpz:paieska -- "<užklausa>" [--top 10]\n` +
            `            [--url ${DEFAULT_OLLAMA_URL}] [--model ${DEFAULT_EMBED_MODEL}] [--db <kelias>]`,
    );
    process.exitCode = 1;
}

async function main() {
    if (!UZKLAUSA) return usage();
    const db = openBvpzVektoriaiSqlite({ dbPath: DB_PATH, readonly: true });
    try {
        const storedModel = getMeta(db, "model");
        if (!storedModel) throw new Error("SQLite bazėje nėra modelio metaduomenų; pirmiausia paleisk vektorizavimą.");
        if (storedModel !== MODEL) throw new Error(`Bazė sukurta modeliu ${storedModel}, o paieškai nurodytas ${MODEL}.`);
        const started = performance.now();
        process.stdout.write(`[1/3] Skaitau BVPŽ vektorius iš SQLite… `);
        const readStarted = performance.now();
        const rows = getBvpzSuVektoriais(db);
        if (rows.length === 0) throw new Error("SQLite bazėje nėra vektorių.");
        console.log(`${rows.length} [${(performance.now() - readStarted).toFixed(0)} ms]`);

        const embedder = createOllamaEmbedder({ url: URL, model: MODEL });
        process.stdout.write(`[2/3] Vektorizuoju užklausą (${MODEL})… `);
        const embedStarted = performance.now();
        const query = Float32Array.from(await embedder.embedOne(UZKLAUSA));
        console.log(`${query.length} dim. [${(performance.now() - embedStarted).toFixed(0)} ms]`);
        const qn = norm(query);
        const scored = [];
        const progressEvery = 500;
        process.stdout.write(`[3/3] Lyginu kandidatus… 0/${rows.length} (0%)`);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const vector = vecFromBlob(row.vektorius);
            if (vector.length !== query.length) {
                throw new Error(`${row.mask}: bazėje dimensija ${vector.length}, užklausos ${query.length}`);
            }
            scored.push({ ...row, vektorius: undefined, cos: cosine(query, vector, qn, norm(vector)) });
            if ((i + 1) % progressEvery === 0 || i + 1 === rows.length) {
                const percent = (((i + 1) / rows.length) * 100).toFixed(1);
                process.stdout.write(`\r[3/3] Lyginu kandidatus… ${i + 1}/${rows.length} (${percent}%)`);
            }
        }
        console.log();
        const results = scored.sort((a, b) => b.cos - a.cos).slice(0, TOP);

        console.log(`\nUžklausa: ${UZKLAUSA}`);
        console.log(`Modelis: ${MODEL}; kandidatų: ${rows.length}; iš viso ${(performance.now() - started).toFixed(0)} ms\n`);
        for (const [index, row] of results.entries()) {
            console.log(`${String(index + 1).padStart(2)}  ${row.cos.toFixed(4)}  ${row.code}-${row.checksum}  ${row.pavadinimas}`);
        }
    } finally {
        db.close();
    }
}

main().catch((error) => {
    console.error("BVPŽ paieška nepavyko:", error.message);
    process.exitCode = 1;
});
