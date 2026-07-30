import { numArg, parseArgs } from "../../utils/cliArgs.js";
import { fmtDur, nf } from "../../utils/progress.js";
import { fmtBytes } from "../../utils/units.js";
import { getMazgas, getMazguAliasai } from "./s3backupEnv.js";
import {
    getKlaiduSuvestine,
    getPaskutinius,
    getS3backupSqlitePath,
    getStats,
    getTempas,
    openS3backupSqlite,
} from "./s3backupSqlite.js";

/*
Backup būsenos ataskaita.

  npm run s3backup:status
  npm run s3backup:status -- --mazgas wasabi
  npm run s3backup:status -- --visi
  npm run s3backup:status -- --paskutiniai 20
*/

const args = parseArgs(process.argv.slice(2));
const DB_PATH = typeof args.db === "string" ? args.db : getS3backupSqlitePath();
const VISI = Boolean(args.visi);
const PASKUTINIU = numArg(args.paskutiniai, 5);

function gb(baitai) {
    return (baitai / 1024 ** 3).toFixed(1);
}

function rodyti(db, alias) {
    const s = getStats(db, alias);
    const tempas = getTempas(db, alias, 24);
    const proc = s.eileCount ? ((s.ikeltaCount / s.eileCount) * 100).toFixed(1) : "0.0";

    console.log(`\n=== ${alias} ===`);
    console.log(`Eilėje    ${nf(s.eileCount).padStart(12)} md5   ${gb(s.eileBytes).padStart(10)} GB`);
    console.log(`Įkelta    ${nf(s.ikeltaCount).padStart(12)} md5   ${gb(s.ikeltaBytes).padStart(10)} GB   (${proc}%)`);
    console.log(`Liko      ${nf(s.likoCount).padStart(12)} md5   ${gb(s.likoBytes).padStart(10)} GB`);
    console.log(`Klaidų    ${nf(s.klaiduCount).padStart(12)} md5   ${nf(s.klaiduBandymai).padStart(10)} bandymų`);

    if (tempas.count) {
        const etaS = tempas.baitaiPerS > 0 ? s.likoBytes / tempas.baitaiPerS : Infinity;
        console.log(
            `\nPer 24 h: ${nf(tempas.count)} failų (${gb(tempas.bytes)} GB) → ` +
                `${tempas.failaiPerS.toFixed(1)} f/s, ${(tempas.baitaiPerS / 1024 ** 2).toFixed(0)} MB/s` +
                ` → liko ~${fmtDur(etaS)}`,
        );
    } else {
        console.log("\nPer 24 h: nieko neįkelta");
    }

    const paskutiniai = getPaskutinius(db, alias, PASKUTINIU);
    if (paskutiniai.length) {
        console.log(`\nPaskutiniai ${paskutiniai.length} įkelti:`);
        for (const p of paskutiniai) {
            const kada = new Date(p.ikeltas).toLocaleString("lt-LT");
            const pries = fmtDur((Date.now() - p.ikeltas) / 1000);
            console.log(
                `  ${kada} (prieš ${pries})  ${fmtBytes(p.dydis).padStart(10)}  ` +
                    `${p.bucket}/${p.raktas}`,
            );
        }
    }

    const klaidos = getKlaiduSuvestine(db, alias, 20);
    if (klaidos.length) {
        console.log("\nDažniausios klaidos:");
        for (const k of klaidos) {
            console.log(`  ${String(k.kiek).padStart(8)}×  ${k.klaida ?? "(be teksto)"}`);
        }
    }
}

function main() {
    const db = openS3backupSqlite({ dbPath: DB_PATH, readonly: true });
    console.log(`SQLite: ${DB_PATH}`);

    const aliasai = VISI
        ? getMazguAliasai()
        : [getMazgas(typeof args.mazgas === "string" ? args.mazgas : undefined).alias];

    for (const alias of aliasai) rodyti(db, alias);

    // Ne `closeSqlite` — jo `wal_checkpoint(TRUNCATE)` readonly jungtyje mestų klaidą.
    db.close();
}

try {
    main();
} catch (error) {
    console.error(`s3backupStatus nulūžo: ${error.message}`);
    process.exitCode = 1;
}
