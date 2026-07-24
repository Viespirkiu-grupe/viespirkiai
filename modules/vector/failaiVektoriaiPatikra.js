import { numArg, parseArgs } from "../../utils/cliArgs.js";
import { nf } from "../../utils/progress.js";
import {
    getFailaiVektoriaiSqlitePath,
    getGabaluCount,
    getSuVektoriumCount,
    openFailaiVektoriaiSqlite,
} from "./failaiVektoriaiSqlite.js";
import { hasNaN, minMax, norm, topKByCosine, vecFromBlob } from "./vektoriai.js";

// Vektorių patikra: dekoduoja float32 BLOB'us ir parodo dimensiją, normą, kelias
// reikšmes + teksto preview. Su --knn <hash> suranda artimiausius pagal cosine
// (brute force per atsitiktinį sample), kad matytųsi ar panašūs tekstai klusterizuojasi.
// Read-only.
//
//   npm run vector:patikra                            # stats + 5 atsitiktinių
//   npm run vector:patikra -- --n 10 --values 16      # daugiau reikšmių
//   npm run vector:patikra -- --knn <md5> --sample 5000
//   npm run vector:patikra -- --db tmp/testVektoriai.sqlite

const args = parseArgs(process.argv.slice(2));
const DB_PATH = typeof args.db === "string" ? args.db : getFailaiVektoriaiSqlitePath();
const N = numArg(args.n, 5);
const VALUES = numArg(args.values, 8);
const SAMPLE = numArg(args.sample, 5000);
const TOPK = numArg(args.topk, 8);
const PREVIEW = numArg(args.chars, 160);

const preview = (t) => t.replace(/\s+/g, " ").slice(0, PREVIEW);

function main() {
    const db = openFailaiVektoriaiSqlite({ dbPath: DB_PATH, readonly: true });

    const total = getGabaluCount(db);
    const suVek = getSuVektoriumCount(db);
    const blobDydziai = db
        .prepare(
            `SELECT LENGTH("vektorius") b, COUNT(*) c FROM "gabalai"
             WHERE "vektorius" IS NOT NULL GROUP BY b ORDER BY c DESC`,
        )
        .all();

    console.log(`═══ ${DB_PATH} ═══`);
    console.log(`gabalų: ${nf(total)}, su vektorium: ${nf(suVek)} (${total ? ((suVek / total) * 100).toFixed(1) : 0}%)`);
    console.log(`blob dydžiai (baitai → kiek): ${blobDydziai.map((r) => `${r.b}B×${nf(r.c)}`).join(", ") || "-"}`);
    if (blobDydziai.length > 1) console.log(`  ⚠ nevienodi blob dydžiai — dimensija nepastovi!`);

    if (suVek === 0) {
        console.log("Vektorių dar nėra (paleisk npm run vector:embed).");
        db.close();
        return;
    }

    // --knn: artimiausi pagal cosine per atsitiktinį sample.
    if (args.knn) {
        const target = db.prepare(`SELECT "hash", "tekstas", "vektorius" FROM "gabalai" WHERE "hash" = ?`).get(args.knn);
        if (!target || target.vektorius == null) {
            console.log(`Gabalas ${args.knn} nerastas arba be vektoriaus.`);
            db.close();
            return;
        }
        console.log(`\n═══ KNN pagal cosine (sample ${nf(SAMPLE)}) ═══`);
        console.log(`taikinys ${target.hash}: „${preview(target.tekstas)}…"`);

        const sample = db
            .prepare(
                `SELECT "hash", "tekstas", "vektorius" FROM "gabalai"
                 WHERE "vektorius" IS NOT NULL AND "hash" <> ? ORDER BY RANDOM() LIMIT ?`,
            )
            .all(args.knn, SAMPLE);
        const artimiausi = topKByCosine(vecFromBlob(target.vektorius), sample, (r) => vecFromBlob(r.vektorius), TOPK);
        for (const r of artimiausi) {
            console.log(`  ${r.cos.toFixed(4)}  ${r.hash}  „${preview(r.tekstas)}…"`);
        }
        db.close();
        return;
    }

    // Atsitiktiniai vektoriai su reikšmėmis.
    console.log(`\n═══ ${N} atsitiktiniai vektoriai ═══`);
    const rows = db
        .prepare(
            `SELECT "hash", "tekstas", "tokenai", "vektorius" FROM "gabalai"
             WHERE "vektorius" IS NOT NULL ORDER BY RANDOM() LIMIT ?`,
        )
        .all(N);
    for (const r of rows) {
        const v = vecFromBlob(r.vektorius);
        const { min, max } = minMax(v);
        console.log("─".repeat(100));
        console.log(
            `hash=${r.hash} tokenai=${r.tokenai} | dim=${v.length} norma=${norm(v).toFixed(4)} ` +
                `min=${min.toFixed(4)} max=${max.toFixed(4)}${hasNaN(v) ? " ⚠NaN/Inf!" : ""}`,
        );
        console.log(`  [${Array.from(v.slice(0, VALUES)).map((x) => x.toFixed(4)).join(", ")}, …]`);
        console.log(`  tekstas: „${preview(r.tekstas)}…"`);
    }

    db.close();
}

main();
