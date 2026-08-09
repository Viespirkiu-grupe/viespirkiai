import { parseArgs } from "../../utils/cliArgs.js";
import { nf } from "../../utils/progress.js";
import { getMazgas, getMazguAliasai } from "./s3backupEnv.js";
import {
    closeSqlite,
    getKlaiduSuvestine,
    getS3backupSqlitePath,
    getStats,
    openS3backupSqlite,
    valytiKlaidas,
} from "./s3backupSqlite.js";

/*
Klaidų grąžinimas į eilę.

Įkėlimas praleidžia md5, kurių `klaidos.bandymai` pasiekė MAX_RETRIES — dėl to po
kelių ratų `s3backup:upload` baigia darbą per kelias sekundes, nors dalis failų
liko neįkelta. Ši komanda ištrina klaidų žymes, ir kitas paleidimas bando iš naujo.

Kartojam ir „nuolatines" klaidas (HTTP 404, md5 nesutapimus): failas galėjo būti
parsiųstas jau po nesėkmingo bandymo, tad prielaida „404 visada liks 404" neteisinga.

  npm run s3backup:requeue
  npm run s3backup:requeue -- --mazgas wasabi
  npm run s3backup:requeue -- --visi
  npm run s3backup:requeue -- --rodyti     # tik parodo, nieko netrina
*/

const args = parseArgs(process.argv.slice(2));
const DB_PATH = typeof args.db === "string" ? args.db : getS3backupSqlitePath();
const VISI = Boolean(args.visi);
const RODYTI = Boolean(args.rodyti);

function requeue(db, alias) {
    const pries = getStats(db, alias);

    console.log(`\n=== ${alias} ===`);
    console.log(
        `Klaidų žymių: ${nf(pries.klaiduCount)} md5 (${nf(pries.klaiduBandymai)} bandymų), ` +
            `neįkelta iš viso: ${nf(pries.likoCount)}`,
    );

    const suvestine = getKlaiduSuvestine(db, alias, 20);
    if (suvestine.length) {
        console.log("Dažniausios klaidos:");
        for (const k of suvestine) {
            console.log(`  ${String(k.kiek).padStart(8)}×  ${k.klaida ?? "(be teksto)"}`);
        }
    }

    if (pries.klaiduCount === 0) {
        console.log("Nėra ko grąžinti į eilę.");
        return;
    }
    if (RODYTI) {
        console.log(`(--rodyti) Būtų ištrinta ${nf(pries.klaiduCount)} klaidų žymių.`);
        return;
    }

    const istrinta = valytiKlaidas(db, alias);
    const po = getStats(db, alias);
    console.log(
        `Ištrinta ${nf(istrinta)} klaidų žymių — ${nf(po.likoCount)} md5 vėl keliami ` +
            `(paleiskite: npm run s3backup:upload${alias ? ` -- --mazgas ${alias}` : ""}).`,
    );
}

function main() {
    // `--rodyti` užtenka readonly jungties; trynimui reikia rašymo teisių.
    const db = openS3backupSqlite({ dbPath: DB_PATH, readonly: RODYTI });
    console.log(`SQLite: ${DB_PATH}`);

    const aliasai = VISI
        ? getMazguAliasai()
        : [getMazgas(typeof args.mazgas === "string" ? args.mazgas : undefined).alias];

    for (const alias of aliasai) requeue(db, alias);

    // Readonly jungtyje `closeSqlite` daro wal_checkpoint(TRUNCATE) → klaida.
    if (RODYTI) db.close();
    else closeSqlite(db);
}

try {
    main();
} catch (error) {
    console.error(`s3backupRequeue nulūžo: ${error.message}`);
    process.exitCode = 1;
}
