import fs from "node:fs";
import { limitArg, parseArgs } from "../../utils/cliArgs.js";
import { nf } from "../../utils/progress.js";
import { fmtBytes } from "../../utils/units.js";
import { getMazgas } from "./s3backupEnv.js";
import { getKlaidas, getS3backupSqlitePath, openS3backupSqlite } from "./s3backupSqlite.js";

/*
Klaidų išrašas — po vieną md5, ne suvestinė (suvestinę rodo `s3backup:status`).

  npm run s3backup:klaidos
  npm run s3backup:klaidos -- --kaip "HTTP 404%"
  npm run s3backup:klaidos -- --limit 100
  npm run s3backup:klaidos -- --formatas md5 --failas /tmp/klaidos.txt
  npm run s3backup:klaidos -- --formatas jsonl --failas /tmp/klaidos.jsonl

`--formatas md5` duoda gryną md5 sąrašą — patogu paduoti kitiems įrankiams
(pvz. patikrinti, ar tie failai apskritai yra šaltinyje).
*/

const args = parseArgs(process.argv.slice(2));
const DB_PATH = typeof args.db === "string" ? args.db : getS3backupSqlitePath();
const KAIP = typeof args.kaip === "string" ? args.kaip : null;
const LIMIT = limitArg(args.limit);
const FORMATAS = typeof args.formatas === "string" ? args.formatas : "tekstas";
const FAILAS = typeof args.failas === "string" ? args.failas : null;

const FORMATAI = ["tekstas", "md5", "jsonl"];

function eilute(k, alias) {
    if (FORMATAS === "md5") return k.md5;
    if (FORMATAS === "jsonl") {
        return JSON.stringify({
            mazgas: alias,
            md5: k.md5,
            dydis: k.dydis,
            bandymai: k.bandymai,
            kada: new Date(k.kada).toISOString(),
            klaida: k.paskutine,
        });
    }
    const kada = new Date(k.kada).toLocaleString("lt-LT");
    return (
        `${k.md5}  ${String(k.bandymai).padStart(3)}×  ${fmtBytes(k.dydis).padStart(10)}  ` +
        `${kada}  ${k.paskutine ?? "(be teksto)"}`
    );
}

function main() {
    if (!FORMATAI.includes(FORMATAS)) {
        throw new Error(`Nežinomas --formatas „${FORMATAS}" — galimi: ${FORMATAI.join(", ")}`);
    }

    const db = openS3backupSqlite({ dbPath: DB_PATH, readonly: true });
    const alias = getMazgas(typeof args.mazgas === "string" ? args.mazgas : undefined).alias;
    const klaidos = getKlaidas(db, alias, { kaip: KAIP, limit: LIMIT });
    // Ne `closeSqlite` — jo `wal_checkpoint(TRUNCATE)` readonly jungtyje mestų klaidą.
    db.close();

    const tekstas = klaidos.map((k) => eilute(k, alias)).join("\n");

    if (FAILAS) {
        fs.writeFileSync(FAILAS, tekstas ? `${tekstas}\n` : "");
        console.error(`Mazgas „${alias}": ${nf(klaidos.length)} klaidų → ${FAILAS}`);
        return;
    }

    // Antraštė į stderr, kad `> failas` ar `| grep` gautų tik duomenis.
    console.error(
        `Mazgas „${alias}": ${nf(klaidos.length)} klaidų` + (KAIP ? ` (filtras: ${KAIP})` : ""),
    );
    if (tekstas) console.log(tekstas);
}

try {
    main();
} catch (error) {
    console.error(`s3backupKlaidos nulūžo: ${error.message}`);
    process.exitCode = 1;
}
