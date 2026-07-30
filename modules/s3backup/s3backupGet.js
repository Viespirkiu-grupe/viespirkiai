import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { parseArgs } from "../../utils/cliArgs.js";
import { fmtDur } from "../../utils/progress.js";
import { fmtBytes } from "../../utils/units.js";
import { getMazgas, s3Raktas } from "./s3backupEnv.js";
import { createS3Client } from "./s3Client.js";
import { getS3backupSqlitePath, openS3backupSqlite } from "./s3backupSqlite.js";

/*
Vieno failo parsiuntimas iš S3 backup'o — atkūrimui ir patikrinimui.

  npm run s3backup:get -- 000082b3f1da7489e07e43ae5819d15c
  npm run s3backup:get -- viespat/failai/00/00/82/000082b3f1da7489e07e43ae5819d15c
  npm run s3backup:get -- <md5> --i /tmp/failas.pdf
  npm run s3backup:get -- <md5> --i -            # į stdout (pvz. | md5sum)
  npm run s3backup:get -- <md5> --mazgas wasabi

Argumentas gali būti:
  - md5 (32 hex) — bucket'as ir raktas paimami iš `ikelti` lentelės, o jos
    nesant sudaromi iš mazgo konfigūracijos (`<prefix>ab/cd/ef/<md5>`);
  - `bucket/raktas` arba tiesiog `raktas` — naudojamas kaip yra.

Parsisiuntus md5 visada perskaičiuojamas ir palyginamas su rakto md5. Nesutapus
– failas ištrinamas ir exit 1, nes toks backup'as bevertis.
*/

const argv = process.argv.slice(2);
const args = parseArgs(argv);

// Vėliavėlės su reikšme — jų reikšmė nėra pozicinis argumentas.
const SU_REIKSME = new Set(["--i", "--mazgas", "--db"]);

/** Pirmas tikras pozicinis argumentas (md5 arba raktas). */
function pirmasPozicinis() {
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith("--")) {
            if (SU_REIKSME.has(argv[i])) i++;
            continue;
        }
        return argv[i];
    }
    return null;
}

const MD5_REGEX = /^[a-f0-9]{32}$/i;

function usage(zinute) {
    console.error(`${zinute}
Naudojimas: npm run s3backup:get -- <md5|bucket/raktas> [--i <kelias|->] [--mazgas <alias>]`);
    process.exit(1);
}

const taikinys = pirmasPozicinis();
if (!taikinys) usage("Nenurodytas md5 arba raktas.");

let MAZGAS;
try {
    MAZGAS = getMazgas(typeof args.mazgas === "string" ? args.mazgas : undefined);
} catch (error) {
    console.error(`Konfigūracijos klaida: ${error.message}`);
    process.exit(1);
}

/**
 * Iš argumento nustato bucket'ą, raktą ir laukiamą md5.
 * @returns {{bucket: string, raktas: string, md5: string|null, saltinis: string}}
 */
function isspresti() {
    if (!MD5_REGEX.test(taikinys)) {
        // `bucket/prefix/…/md5` arba `prefix/…/md5`. Bucket'u laikom pirmą segmentą
        // tik tada, kai jis sutampa su sukonfigūruotu — kitaip tai prefikso dalis.
        const dalys = taikinys.split("/");
        const turiBucket = dalys.length > 1 && dalys[0] === MAZGAS.bucket;
        const raktas = turiBucket ? dalys.slice(1).join("/") : taikinys;
        const bazė = path.basename(raktas);
        return {
            bucket: MAZGAS.bucket,
            raktas,
            md5: MD5_REGEX.test(bazė) ? bazė.toLowerCase() : null,
            saltinis: "argumentas",
        };
    }

    const md5 = taikinys.toLowerCase();

    // Pirmiausia žiūrim į savo apskaitą — ten tikrasis bucket'as ir raktas.
    try {
        const db = openS3backupSqlite({
            dbPath: typeof args.db === "string" ? args.db : getS3backupSqlitePath(),
            readonly: true,
        });
        const row = db
            .prepare(`SELECT "bucket", "raktas" FROM "ikelti" WHERE "md5" = ? AND "mazgas" = ?`)
            .get(md5, MAZGAS.alias);
        db.close();
        if (row) {
            return { bucket: row.bucket, raktas: row.raktas, md5, saltinis: "ikelti lentelė" };
        }
    } catch {
        // Bazės nėra arba neprieinama — nieko tokio, raktą sudarysim patys.
    }

    return {
        bucket: MAZGAS.bucket,
        raktas: s3Raktas(MAZGAS.prefix, md5),
        md5,
        saltinis: "sudarytas iš konfigūracijos",
    };
}

async function main() {
    const { bucket, raktas, md5, saltinis } = isspresti();

    const iStdout = args.i === "-";
    const iseitis =
        typeof args.i === "string" && !iStdout ? args.i : path.resolve(md5 ?? path.basename(raktas));

    if (!iStdout) {
        console.error(`Mazgas „${MAZGAS.alias}": ${MAZGAS.endpoint}`);
        console.error(`Objektas: ${bucket}/${raktas}  (${saltinis})`);
    }

    const s3 = createS3Client(MAZGAS);
    const t0 = performance.now();

    let out;
    try {
        out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: raktas }));
    } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey") {
            console.error(`Nerasta: ${bucket}/${raktas}`);
            s3.destroy();
            process.exit(1);
        }
        throw error;
    }

    const hash = createHash("md5");
    let dydis = 0;
    const skaiciuoti = async function* (srautas) {
        for await (const gabalas of srautas) {
            hash.update(gabalas);
            dydis += gabalas.length;
            yield gabalas;
        }
    };

    const rasytojas = iStdout ? process.stdout : fs.createWriteStream(iseitis);
    try {
        await pipeline(out.Body, skaiciuoti, rasytojas);
    } catch (error) {
        if (!iStdout) await fs.promises.rm(iseitis, { force: true });
        s3.destroy();
        throw error;
    }
    s3.destroy();

    const gautasMd5 = hash.digest("hex");
    const trukmeS = (performance.now() - t0) / 1000;

    if (md5 && gautasMd5 !== md5) {
        if (!iStdout) await fs.promises.rm(iseitis, { force: true });
        console.error(
            `MD5 NESUTAMPA: laukta ${md5}, gauta ${gautasMd5} (${fmtBytes(dydis)}). ` +
                `Failas ${iStdout ? "neišsaugotas" : "ištrintas"}.`,
        );
        process.exit(1);
    }

    const eilute =
        `${fmtBytes(dydis)} per ${fmtDur(trukmeS)} ` +
        `(${(dydis / 1024 ** 2 / Math.max(trukmeS, 0.001)).toFixed(1)} MiB/s)` +
        (md5 ? `, md5 ${gautasMd5} ✓` : `, md5 ${gautasMd5} (nebuvo su kuo lyginti)`);

    console.error(iStdout ? eilute : `${eilute}\nIšsaugota: ${iseitis}`);
}

main().catch((error) => {
    console.error(`s3backupGet nulūžo: ${error.stack || error.message}`);
    process.exitCode = 1;
});
