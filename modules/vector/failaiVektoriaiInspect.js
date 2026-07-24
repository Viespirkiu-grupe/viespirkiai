import { numArg, parseArgs } from "../../utils/cliArgs.js";
import { nf } from "../../utils/progress.js";
import {
    getApdorotuCount,
    getFailaiVektoriaiSqlitePath,
    getGabaloSaltiniai,
    getGabaluCount,
    getSaltiniuCount,
    getSuVektoriumCount,
    openFailaiVektoriaiSqlite,
} from "./failaiVektoriaiSqlite.js";

// failaiVektoriai queue peržiūra: suvestinė + keli atsitiktiniai gabalai su šaltiniais.
// Read-only, Postgres nereikia.
//
//   npm run vector:inspect                     # suvestinė + 5 atsitiktiniai
//   npm run vector:inspect -- --n 10           # 10 atsitiktinių
//   npm run vector:inspect -- --full           # visas gabalo tekstas (ne preview)
//   npm run vector:inspect -- --hash <md5>     # konkretus gabalas
//   npm run vector:inspect -- --db tmp/testVektoriai.sqlite

const args = parseArgs(process.argv.slice(2));
const DB_PATH = typeof args.db === "string" ? args.db : getFailaiVektoriaiSqlitePath();
const N = numArg(args.n, 5);
const FULL = Boolean(args.full);
const PREVIEW_CHARS = numArg(args.chars, 400);

function cvpIsLink(s) {
    // saltinioId triple → viešas CVP IS dokumento linkas (kaip aptarnavimas.js).
    if (s.pirkimoFailoId == null || s.pirkimoFailoVersijosId == null) return null;
    return `https://viesiejipirkimai.lt/epps/cft/downloadDocumentVersion.do?versionId=${s.pirkimoFailoVersijosId}&documentId=${s.pirkimoFailoId}`;
}

function rodytiGabala(db, g) {
    const saltiniai = getGabaloSaltiniai(db, g.hash);

    const turiVektoriu = g.vektorius != null;
    console.log("─".repeat(100));
    console.log(
        `hash=${g.hash}  tokenai=${g.tokenai}  vektorius=${turiVektoriu ? `${g.vektorius.byteLength}B` : "NULL"}  ` +
            `šaltinių=${saltiniai.length}`,
    );
    const t = FULL ? g.tekstas : g.tekstas.slice(0, PREVIEW_CHARS);
    console.log(
        `tekstas${FULL ? "" : ` (pirmi ${PREVIEW_CHARS} simb.)`}:\n` +
            `${t}${!FULL && g.tekstas.length > PREVIEW_CHARS ? " …" : ""}`,
    );

    console.log(`šaltiniai (iki 10):`);
    for (const s of saltiniai.slice(0, 10)) {
        console.log(
            `  failaiId=${s.failaiId} eile=${s.eile} | pirkimoId=${s.pirkimoId} ` +
                `pirkimoFailoId=${s.pirkimoFailoId} pirkimoFailoVersijosId=${s.pirkimoFailoVersijosId}` +
                (cvpIsLink(s) ? `\n     ${cvpIsLink(s)}` : ""),
        );
    }
    if (saltiniai.length > 10) console.log(`  … dar ${saltiniai.length - 10}`);
}

function main() {
    const db = openFailaiVektoriaiSqlite({ dbPath: DB_PATH, readonly: true });

    const gabalu = getGabaluCount(db);
    const saltiniu = getSaltiniuCount(db);
    const apdoroti = getApdorotuCount(db);
    const suVektorium = getSuVektoriumCount(db);
    const tok = db.prepare(`SELECT MIN("tokenai") mn, MAX("tokenai") mx, AVG("tokenai") av FROM "gabalai"`).get();
    const topKart = db
        .prepare(`SELECT "hash", COUNT(*) c FROM "saltiniai" GROUP BY "hash" ORDER BY c DESC LIMIT 5`)
        .all();

    console.log(`═══ ${DB_PATH} ═══`);
    console.log(`apdoroti failai:      ${nf(apdoroti)}`);
    console.log(`gabalai (unikalūs):   ${nf(gabalu)}`);
    console.log(`šaltiniai (viso):     ${nf(saltiniu)}`);
    console.log(`dedup:                ${gabalu ? (saltiniu / gabalu).toFixed(2) : "-"} šaltinių/gabalą`);
    console.log(`su vektorium:         ${nf(suVektorium)} (turi būti 0 kol nevektorizuota)`);
    console.log(`tokenai:              min ${tok.mn}, max ${tok.mx} (turi būti ≤1536), vid ${Number(tok.av).toFixed(0)}`);
    console.log(`labiausiai kartojasi (hash → šaltinių):`);
    for (const r of topKart) console.log(`  ${r.hash} → ${nf(r.c)}`);

    if (gabalu === 0) {
        db.close();
        return;
    }

    console.log(`\n═══ ${args.hash ? "Nurodytas gabalas" : `${N} atsitiktiniai gabalai`} ═══`);
    const gabalai = args.hash
        ? [db.prepare(`SELECT * FROM "gabalai" WHERE "hash" = ?`).get(args.hash)].filter(Boolean)
        : db.prepare(`SELECT * FROM "gabalai" ORDER BY RANDOM() LIMIT ?`).all(N);

    if (gabalai.length === 0) console.log("Nerasta.");
    for (const g of gabalai) rodytiGabala(db, g);

    db.close();
}

main();
