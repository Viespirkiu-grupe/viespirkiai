import { performance } from "node:perf_hooks";
import { numArg } from "../../utils/cliArgs.js";
import { nf, secs, SlidingEta } from "../../utils/progress.js";
import { runStream } from "../../utils/workerPool.js";
import {
    createVektoriuWriter,
    getFailaiVektoriaiSqlitePath,
    openFailaiVektoriaiSqlite,
} from "./failaiVektoriaiSqlite.js";
import {
    createOllamaEmbedder,
    DEFAULT_EMBED_MODEL,
    DEFAULT_OLLAMA_URL,
    newEmbedStats,
} from "./ollamaEmbed.js";
import { BGE_M3_DIM, cosine, norm, vecFromBlob, vecToBlob } from "./vektoriai.js";

// Testinė vektorinė paieška VIENO pirkimo viduje: paimam visus to pirkimo bge-m3
// gabalus, ko trūksta — suembeddinam vietoje (per Ollamą, su progresu), užklausą
// embeddinam tuo pačiu modeliu ir surikiuojam pagal kosinuso panašumą.
//
// Brute force per vieno pirkimo gabalus (mediana ~14, p99 ~180) — indekso nereikia.
//
//   npm run vector:paieska -- 726543 "statybos darbų garantinis terminas"
//   npm run vector:paieska -- 726543 "laužo išvežimas" --top 20
//   npm run vector:paieska -- 726543 "…" --url http://192.168.255.99:80 --concurrency 8
//   npm run vector:paieska -- 726543 "…" --irasyti     # suskaičiuotus vektorius palikti bazėj

/** parseArgs pozicinių neatiduoda, o mums jų reikia dviejų — tad savas skaitytuvas. */
function parseArgvWithPositionals(argv) {
    const opts = {};
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) {
            positional.push(arg);
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            opts[key] = next;
            i++;
        } else {
            opts[key] = true;
        }
    }
    return { opts, positional };
}

const { opts: args, positional } = parseArgvWithPositionals(process.argv.slice(2));
const [PIRKIMO_NR, UZKLAUSA] = positional;

const DB_PATH = typeof args.db === "string" ? args.db : getFailaiVektoriaiSqlitePath();
const URL = typeof args.url === "string" ? args.url : DEFAULT_OLLAMA_URL;
const MODEL = typeof args.model === "string" ? args.model : DEFAULT_EMBED_MODEL;
const CONCURRENCY = numArg(args.concurrency, 4);
const BATCH = numArg(args.batch, 25);
const TOP = numArg(args.top, 10);
// Bazė atidaroma rašymui tik su --irasyti: kitaip trukdytume `vector:embed` rašytojui.
const IRASYTI = Boolean(args.irasyti);

function usage(message) {
    console.error(
        `${message}\n\n` +
            `Naudojimas: npm run vector:paieska -- <pirkimoNr> "<užklausa>" [--top 10]\n` +
            `            [--url ${DEFAULT_OLLAMA_URL}] [--model ${DEFAULT_EMBED_MODEL}]\n` +
            `            [--concurrency 4] [--batch 25] [--irasyti] [--db <kelias>]`,
    );
    process.exitCode = 1;
}

function cvpIsLink(row) {
    if (row.pirkimoFailoId == null || row.pirkimoFailoVersijosId == null) return null;
    return `https://viesiejipirkimai.lt/epps/cft/downloadDocumentVersion.do?versionId=${row.pirkimoFailoVersijosId}&documentId=${row.pirkimoFailoId}`;
}

/** Vieno pirkimo gabalai su šaltinių metaduomenimis (hash gali kartotis keliuose failuose). */
function fetchPirkimoGabalai(db, pirkimoId) {
    return db
        .prepare(
            `SELECT s."failaiId", s."eile", s."hash", s."pirkimoFailoId", s."pirkimoFailoVersijosId",
                    g."tekstas", g."tokenai", g."vektorius"
             FROM "saltiniai" s
             JOIN "gabalai" g ON g."hash" = s."hash"
             WHERE s."pirkimoId" = ?
             ORDER BY s."failaiId", s."eile"`,
        )
        .all(pirkimoId);
}

/** Šaltinių eilutės → unikalūs gabalai (hash → {tekstas, tokenai, vektorius, saltiniai[]}). */
function sugrupuotiPagalHash(rows) {
    const byHash = new Map();
    for (const row of rows) {
        let g = byHash.get(row.hash);
        if (!g) {
            g = {
                hash: row.hash,
                tekstas: row.tekstas,
                tokenai: Number(row.tokenai),
                vektorius: row.vektorius,
                saltiniai: [],
            };
            byHash.set(row.hash, g);
        }
        g.saltiniai.push({
            failaiId: Number(row.failaiId),
            eile: Number(row.eile),
            pirkimoFailoId: row.pirkimoFailoId,
            pirkimoFailoVersijosId: row.pirkimoFailoVersijosId,
        });
    }
    return [...byHash.values()];
}

/** Trūkstamus vektorius suskaičiuojam vietoje; progresas kas batch'ą. */
async function embedTrukstamus(embedder, trukstami, stats) {
    const target = trukstami.length;
    const targetStr = nf(target);
    let done = 0;
    let batchNr = 0;
    const t0 = performance.now();
    const slid = new SlidingEta(t0);

    let cursor = 0;
    const nextBatch = () => (cursor >= target ? null : trukstami.slice(cursor, (cursor += BATCH)));

    await runStream(
        nextBatch,
        async (batch) => {
            const wt0 = performance.now();
            const embeddings = await embedder.embedBatch(
                batch.map((g) => g.tekstas),
                stats,
            );
            const batchMs = performance.now() - wt0;

            for (let j = 0; j < batch.length; j++) {
                const vec = embeddings[j];
                if (vec.length !== BGE_M3_DIM) stats.dimMismatch++;
                batch[j].vec = Float32Array.from(vec);
            }

            done += batch.length;
            batchNr++;
            const now = performance.now();
            slid.add(now, batch.length);
            console.log(
                `  batch #${batchNr} (${batch.length}) ${secs(batchMs)}s ` +
                    `${(batch.length / (batchMs / 1000)).toFixed(0)} vec/s | ${nf(done)}/${targetStr}` +
                    (target - done > 0 ? ` | ETA ${slid.format(now, target - done)}` : "") +
                    (stats.retries ? ` | retries ${stats.retries}` : ""),
            );
        },
        CONCURRENCY,
    );

    return performance.now() - t0;
}

async function main() {
    if (!PIRKIMO_NR || !/^\d+$/.test(PIRKIMO_NR)) return usage("Trūksta pirkimo numerio (sveikas skaičius).");
    if (!UZKLAUSA) return usage("Trūksta paieškos užklausos.");
    const pirkimoId = Number(PIRKIMO_NR);

    const db = openFailaiVektoriaiSqlite({ dbPath: DB_PATH, readonly: !IRASYTI });
    const embedder = createOllamaEmbedder({ url: URL, model: MODEL });

    console.log(`═══ ${DB_PATH} ═══`);
    console.log(`pirkimas: ${pirkimoId}`);
    console.log(`užklausa: "${UZKLAUSA}"`);
    console.log(`backend:  ${embedder.url} model=${embedder.model} concurrency=${CONCURRENCY} batch=${BATCH}`);

    // `saltiniai` neturi indekso pagal pirkimoId → pilnas skenavimas (~1,5 mln. eil.).
    process.stdout.write(`\n[1/4] Ieškom pirkimo gabalų (pilnas „saltiniai" skenavimas)… `);
    const ts = performance.now();
    const rows = fetchPirkimoGabalai(db, pirkimoId);
    const gabalai = sugrupuotiPagalHash(rows);
    console.log(
        `${nf(rows.length)} šaltinių → ${nf(gabalai.length)} unikalių gabalų ` +
            `[${secs(performance.now() - ts)}s]`,
    );

    if (gabalai.length === 0) {
        console.log(`Pirkimas ${pirkimoId} queue'je nerastas (arba jo failai dar neapdoroti).`);
        db.close();
        return;
    }

    const failai = new Set(rows.map((r) => Number(r.failaiId)));
    console.log(`      failų: ${nf(failai.size)}, tokenų Σ ${nf(gabalai.reduce((s, g) => s + g.tokenai, 0))}`);

    // Turimus vektorius pasiimam iš bazės, trūkstamus embeddinsim.
    let isBazes = 0;
    for (const g of gabalai) {
        if (g.vektorius != null) {
            g.vec = vecFromBlob(g.vektorius);
            isBazes++;
        }
        g.vektorius = null; // BLOB'o nebelaikom atmintyje
    }
    const trukstami = gabalai.filter((g) => g.vec == null);

    const stats = { ...newEmbedStats(), dimMismatch: 0 };

    console.log(`\n[2/4] Užklausos embeddingas…`);
    const tq = performance.now();
    const uzklausosVec = Float32Array.from(await embedder.embedOne(UZKLAUSA, stats));
    console.log(`      dim=${uzklausosVec.length} [${secs(performance.now() - tq)}s]`);

    console.log(
        `\n[3/4] Gabalų vektoriai: ${nf(isBazes)} iš bazės, ${nf(trukstami.length)} reikia suskaičiuoti`,
    );
    let embedMs = 0;
    if (trukstami.length > 0) {
        embedMs = await embedTrukstamus(embedder, trukstami, stats);
        console.log(
            `      suembeddinta ${nf(trukstami.length)} per ${secs(embedMs)}s ` +
                `(${(trukstami.length / (embedMs / 1000)).toFixed(1)} vec/s)` +
                (stats.dimMismatch ? ` | dim≠${BGE_M3_DIM}: ${stats.dimMismatch}` : ""),
        );
        if (IRASYTI) {
            const tw = performance.now();
            createVektoriuWriter(db).updateMany(
                trukstami.map((g) => ({ hash: g.hash, blob: vecToBlob(g.vec) })),
            );
            console.log(`      įrašyta į bazę [${secs(performance.now() - tw)}s]`);
        } else {
            console.log(`      (neįrašyta — pridėk --irasyti, kad liktų bazėj)`);
        }
    }

    console.log(`\n[4/4] Kosinuso panašumas per ${nf(gabalai.length)} gabalų…`);
    const tr = performance.now();
    const qn = norm(uzklausosVec);
    const scored = gabalai
        .map((g) => ({ ...g, cos: cosine(uzklausosVec, g.vec, qn, norm(g.vec)) }))
        .sort((a, b) => b.cos - a.cos)
        .slice(0, TOP);
    console.log(`      [${secs(performance.now() - tr)}s]`);

    console.log(`\n═══ TOP ${Math.min(TOP, scored.length)} (iš ${nf(gabalai.length)}) ═══`);
    scored.forEach((g, i) => {
        console.log("─".repeat(100));
        const s = g.saltiniai[0];
        console.log(
            `#${String(i + 1).padStart(2)}  cos=${g.cos.toFixed(4)}  tokenai=${g.tokenai}  ` +
                `hash=${g.hash}  failaiId=${s.failaiId} eile=${s.eile}` +
                (g.saltiniai.length > 1 ? `  (dar ${g.saltiniai.length - 1} šaltinis (-iai) pirkime)` : ""),
        );
        const link = cvpIsLink(s);
        if (link) console.log(`     ${link}`);
        console.log(g.tekstas);
    });
    console.log("─".repeat(100));
    console.log(
        `Viso: ${nf(gabalai.length)} gabalų, embed ${secs(embedMs)}s, ` +
            `http Σ ${secs(stats.httpMs)}s, retries ${stats.retries}`,
    );

    if (IRASYTI) {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
    db.close();
}

main().catch((error) => {
    console.error("failaiVektoriaiPaieska nulūžo:", error);
    process.exitCode = 1;
});
