import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { finished } from "node:stream/promises";
import { Agent } from "undici";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { limitArg, numArg, parseArgs } from "../../utils/cliArgs.js";
import { Logger } from "../../utils/log.js";
import { fmtDur, nf, SlidingEta } from "../../utils/progress.js";
import { setUvThreadpoolSize } from "../../utils/workerPool.js";
import { getBendriNustatymai, getMazgas, s3Raktas } from "./s3backupEnv.js";
import { createS3Client } from "./s3Client.js";
import {
    closeSqlite,
    createRezultatuWriter,
    getS3backupSqlitePath,
    getStats,
    imtiNeikeltus,
    openS3backupSqlite,
    valytiKlaidas,
} from "./s3backupSqlite.js";

/*
Parsiuntimas iš vidinio mazgo → įkėlimas į S3.

  npm run s3backup:upload -- --mazgas hetzner --concurrency 24
  npm run s3backup:upload -- --mazgas wasabi --limit 1000 --tikrinti-s3
  npm run s3backup:upload -- --mazgas hetzner --valyti-klaidas

Saugumo modelis (žr. ir s3backupSqlite.js):
  - eilėje nėra lock'ų, todėl po crash'o nieko atrakinti nereikia;
  - `ikelti` eilutė atsiranda tik po S3 patvirtinimo;
  - raktas = turinio md5, tad pakartotinis įkėlimas idempotentiškas.
Blogiausia, ką kainuoja crash'as — vienas pakartotinai keliamas failas.

Mažus failus (iki INLINE_MAX_BYTES) laikom RAM'e ir keliam vienu PutObject;
didesnius persiliejam į TEMP_DIR ir keliam multipart'u. md5 skaičiuojam srauto
metu — nesutapus, į S3 NEKELIAM.
*/

const args = parseArgs(process.argv.slice(2));
const N = getBendriNustatymai();

// Konfigūracijos klaida turi atrodyti kaip klaida, o ne kaip import'o stack trace.
let MAZGAS;
try {
    MAZGAS = getMazgas(typeof args.mazgas === "string" ? args.mazgas : undefined);
} catch (error) {
    console.error(`Konfigūracijos klaida: ${error.message}`);
    process.exit(1);
}
const CONCURRENCY = numArg(args.concurrency, N.concurrency);
const BATCH_SIZE = numArg(args.batch, N.batchSize);
const LIMIT = limitArg(args.limit);
const TIKRINTI_S3 = Boolean(args["tikrinti-s3"]);
const VALYTI_KLAIDAS = Boolean(args["valyti-klaidas"]);
const DB_PATH = typeof args.db === "string" ? args.db : getS3backupSqlitePath();

const FLUSH_EILUCIU = 200;
const FLUSH_MS = 1000;
const PROGRESO_MS = 2000;

setUvThreadpoolSize(CONCURRENCY);

const logger = new Logger(import.meta.url);

const dispatcher = new Agent({
    headersTimeout: N.downloadTimeoutMs,
    bodyTimeout: N.downloadTimeoutMs,
    connectTimeout: 60_000,
    connections: Math.max(CONCURRENCY, 16),
});

/* ------------------------------ būsena ------------------------------ */

let stopping = false;
let baigta = false;

const buferis = [];
const vykdomi = new Set(); // md5, kurie paimti bet dar neužfiksuoti SQLite'e
let poMd5 = null; // keyset kursorius eilėje
let ratoEilutes = 0; // kiek eilučių grąžinta šiame rate (wrap detekcijai)
let paimta = 0; // --limit skaičiavimui

const sekmesBuf = [];
const klaidosBuf = [];
let lastFlush = performance.now();

const stat = {
    ok: 0,
    klaidu: 0,
    baitai: 0,
    ram: 0,
    diskas: 0,
    vykdomaRam: 0,
    vykdomaDiskas: 0,
    praleista: 0, // rasta S3 su --tikrinti-s3
};

/* ------------------------------ eilė ------------------------------ */

/**
 * Papildo buferį iš SQLite. Sinchroniška → atomiška vienoje JS gijoje, todėl
 * darbininkams nereikia jokio užrakto.
 */
function papildyti(db) {
    // Daugiausiai kelios apsukos: viena – iki eilės galo, tada wrap'as nuo
    // pradžios (eilė galėjo paaugti, kol dirbom), tada – pripažįstam pabaigą.
    for (let apsukos = 0; apsukos < 2; ) {
        const rows = imtiNeikeltus(db, {
            mazgas: MAZGAS.alias,
            maxBandymu: N.maxRetries,
            poMd5,
            limit: BATCH_SIZE,
        });

        if (rows.length) {
            poMd5 = rows[rows.length - 1].md5;
            ratoEilutes += rows.length;
            const nauji = rows.filter((row) => !vykdomi.has(row.md5));
            for (const row of nauji) vykdomi.add(row.md5);
            if (nauji.length) {
                buferis.push(...nauji);
                return;
            }
            // Visos eilutės jau vykdomos — nesustojam, bet ir nesukam amžinai:
            // grįžtam tuščiomis, darbininkas trumpam užmigs.
            return;
        }

        // Eilės galas. Jei per visą ratą nieko nebuvo ir niekas nevykdoma — baigta.
        if (ratoEilutes === 0 && vykdomi.size === 0) {
            baigta = true;
            return;
        }
        poMd5 = null;
        ratoEilutes = 0;
        apsukos++;
    }
}

/** @returns {{md5: string, dydis: number}|null} */
function paimtiKita(db) {
    if (paimta >= LIMIT) return null;
    if (buferis.length === 0 && !baigta) papildyti(db);
    if (buferis.length === 0) return null;
    paimta++;
    return buferis.shift();
}

/* --------------------------- parsiuntimas --------------------------- */

/**
 * Nuskaito atsakymo kūną skaičiuodamas md5. Iki `INLINE_MAX_BYTES` laikom RAM'e;
 * peraugus – persiliejam į temp failą. Todėl nežinomas dydis (0) nieko negadina.
 * @returns {Promise<{turinys: Buffer|null, kelias: string|null, dydis: number, md5: string}>}
 */
async function nuskaitytiTurini(res, md5) {
    const hash = createHash("md5");
    const gabalai = [];
    let dydis = 0;
    let ws = null;
    let kelias = null;

    const rasyti = async (buf) => {
        // `events.once` po įvykio pats nusiima IR „drain", IR „error" klausytojus.
        // Rankomis rašytas `new Promise` juos kaupdavo → MaxListenersExceededWarning
        // po ~10 backpressure ciklų viename dideliame faile.
        if (!ws.write(buf)) await once(ws, "drain");
    };

    try {
        for await (const gabalas of res.body) {
            const buf = Buffer.from(gabalas.buffer, gabalas.byteOffset, gabalas.byteLength);
            hash.update(buf);
            dydis += buf.length;

            if (ws) {
                await rasyti(buf);
                continue;
            }
            if (dydis > N.inlineMaxBytes) {
                kelias = path.join(N.tempDir, `${md5}.part`);
                ws = fs.createWriteStream(kelias);
                // Nuolatinis klausytojas: be jo „error", kilęs ne backpressure
                // laukimo metu, nukristų kaip uncaught exception. Tikrąją klaidą
                // vis tiek grąžina `finished(ws)` / `once(ws, "drain")`.
                ws.on("error", () => {});
                for (const ankstesnis of gabalai) await rasyti(ankstesnis);
                gabalai.length = 0;
                await rasyti(buf);
                continue;
            }
            gabalai.push(buf);
        }

        if (ws) {
            ws.end();
            await finished(ws);
        }
    } catch (error) {
        if (ws) ws.destroy();
        if (kelias) await fs.promises.rm(kelias, { force: true });
        throw error;
    }

    return {
        turinys: ws ? null : Buffer.concat(gabalai),
        kelias,
        dydis,
        md5: hash.digest("hex"),
    };
}

/* ------------------------------ S3 ------------------------------ */

const s3 = createS3Client(MAZGAS);

const storageClass = MAZGAS.storageClass ? { StorageClass: MAZGAS.storageClass } : {};

async function arYraS3(raktas) {
    try {
        await s3.send(new HeadObjectCommand({ Bucket: MAZGAS.bucket, Key: raktas }));
        return true;
    } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return false;
        throw error;
    }
}

async function ikeltiMazu(raktas, turinys, md5hex) {
    const out = await s3.send(
        new PutObjectCommand({
            Bucket: MAZGAS.bucket,
            Key: raktas,
            Body: turinys,
            ContentLength: turinys.length,
            // S3 pusė perskaičiuoja md5 ir atmeta sugadintą perdavimą.
            ContentMD5: Buffer.from(md5hex, "hex").toString("base64"),
            ...storageClass,
        }),
    );
    return out.ETag ?? null;
}

async function ikeltiDideli(raktas, kelias) {
    const upload = new Upload({
        client: s3,
        params: {
            Bucket: MAZGAS.bucket,
            Key: raktas,
            Body: fs.createReadStream(kelias),
            ...storageClass,
        },
        partSize: N.multipartPartSize,
        queueSize: N.multipartQueueSize,
        leavePartsOnError: false,
    });
    const out = await upload.done();
    return out.ETag ?? null;
}

/* --------------------------- apdorojimas --------------------------- */

async function apdoroti({ md5, dydis }) {
    const raktas = s3Raktas(MAZGAS.prefix, md5);
    let kelias = null;
    let didelis = false;

    try {
        if (TIKRINTI_S3 && (await arYraS3(raktas))) {
            stat.praleista++;
            sekmesBuf.push({ md5, bucket: MAZGAS.bucket, raktas, dydis, etag: null });
            return;
        }

        const res = await fetch(`${N.downloadBase}/${md5}`, { dispatcher });
        if (!res.ok) {
            // Kūną reikia sunaudoti, kitaip jungtis lieka kaboti pool'e.
            try {
                await res.body?.cancel();
            } catch {
                // nesvarbu
            }
            throw new Error(`HTTP ${res.status}`);
        }

        const gauta = await nuskaitytiTurini(res, md5);
        kelias = gauta.kelias;
        didelis = Boolean(kelias);

        if (gauta.md5 !== md5) {
            throw new Error(`md5 nesutampa (gauta ${gauta.md5}, ${gauta.dydis} B)`);
        }

        if (didelis) {
            stat.vykdomaDiskas++;
            try {
                const etag = await ikeltiDideli(raktas, kelias);
                sekmesBuf.push({
                    md5,
                    bucket: MAZGAS.bucket,
                    raktas,
                    dydis: gauta.dydis,
                    etag,
                });
            } finally {
                stat.vykdomaDiskas--;
            }
            stat.diskas++;
        } else {
            stat.vykdomaRam++;
            try {
                const etag = await ikeltiMazu(raktas, gauta.turinys, gauta.md5);
                sekmesBuf.push({
                    md5,
                    bucket: MAZGAS.bucket,
                    raktas,
                    dydis: gauta.dydis,
                    etag,
                });
            } finally {
                stat.vykdomaRam--;
            }
            stat.ram++;
        }

        stat.ok++;
        stat.baitai += gauta.dydis;
        slidingFailai.add(performance.now(), 1);
        slidingBaitai.add(performance.now(), gauta.dydis);
    } catch (error) {
        stat.klaidu++;
        klaidosBuf.push({ md5, klaida: error.message || String(error) });
    } finally {
        if (kelias) await fs.promises.rm(kelias, { force: true });
    }
}

/* ------------------------------ flush ------------------------------ */

function flush(writer, priverstinai = false) {
    const kiek = sekmesBuf.length + klaidosBuf.length;
    if (kiek === 0) return;
    if (!priverstinai && kiek < FLUSH_EILUCIU && performance.now() - lastFlush < FLUSH_MS) return;

    const sekmes = sekmesBuf.splice(0, sekmesBuf.length);
    const klaidos = klaidosBuf.splice(0, klaidosBuf.length);
    writer.flush(sekmes, klaidos);

    // Iš `vykdomi` išimam tik po užfiksavimo — kitaip wrap'as galėtų tą patį md5
    // paimti antrą kartą, kol rezultatas dar nepasiekęs bazės.
    for (const s of sekmes) vykdomi.delete(s.md5);
    for (const k of klaidos) vykdomi.delete(k.md5);
    lastFlush = performance.now();
}

/* ------------------------------ progresas ------------------------------ */

const t0 = performance.now();
const slidingFailai = new SlidingEta(t0);
const slidingBaitai = new SlidingEta(t0);

function gb(baitai) {
    return (baitai / 1024 ** 3).toFixed(1);
}

function progresas(pradzia) {
    const now = performance.now();
    const padaryta = pradzia.ikeltaCount + stat.ok;
    const proc = pradzia.eileCount ? ((padaryta / pradzia.eileCount) * 100).toFixed(1) : "0.0";
    const likoFailu = Math.max(0, pradzia.eileCount - padaryta);
    const likoBaitu = Math.max(0, pradzia.eileBytes - (pradzia.ikeltaBytes + stat.baitai));

    const langai = slidingFailai.windows
        .map((W) => {
            const f = slidingFailai.rate(now, W);
            const b = slidingBaitai.rate(now, W);
            const label = W < 60_000 ? `${W / 1000}s` : `${W / 60_000}min`;
            const left = b > 0 ? fmtDur(likoBaitu / b) : "?";
            return `${label} ${f.toFixed(0)}f/s ${(b / 1024 ** 2).toFixed(0)}MB/s→${left}`;
        })
        .join(" | ");

    logger.log(
        `${nf(padaryta)}/${nf(pradzia.eileCount)} (${proc}%) | ` +
            `${gb(pradzia.ikeltaBytes + stat.baitai)}/${gb(pradzia.eileBytes)} GB | ${langai} | ` +
            `RAM ${stat.vykdomaRam} / diskas ${stat.vykdomaDiskas} | ` +
            `likę ${nf(likoFailu)} | klaidų ${nf(stat.klaidu)}` +
            (stat.praleista ? ` | S3 jau turėjo ${nf(stat.praleista)}` : ""),
    );
}

/* ------------------------------ temp ------------------------------ */

/** Po crash'o TEMP_DIR lieka `.part` failų — jie niekam nebereikalingi. */
async function isvalytiTemp() {
    await fs.promises.mkdir(N.tempDir, { recursive: true });
    const failai = await fs.promises.readdir(N.tempDir);
    let istrinta = 0;
    for (const failas of failai) {
        if (!failas.endsWith(".part")) continue;
        await fs.promises.rm(path.join(N.tempDir, failas), { force: true });
        istrinta++;
    }
    if (istrinta) logger.log(`TEMP_DIR išvalytas: ${nf(istrinta)} likusių .part failų`);
}

/* ------------------------------ main ------------------------------ */

async function main() {
    const db = openS3backupSqlite({ dbPath: DB_PATH });
    const writer = createRezultatuWriter(db, MAZGAS.alias);

    if (VALYTI_KLAIDAS) {
        logger.log(`Klaidų žymių ištrinta: ${nf(valytiKlaidas(db, MAZGAS.alias))}`);
    }

    await isvalytiTemp();

    const pradzia = getStats(db, MAZGAS.alias);
    const pikas = CONCURRENCY * N.inlineMaxBytes + CONCURRENCY * N.multipartPartSize * N.multipartQueueSize;

    logger.log(
        `Mazgas „${MAZGAS.alias}": ${MAZGAS.endpoint} bucket=${MAZGAS.bucket} ` +
            `prefix="${MAZGAS.prefix}"` + (MAZGAS.storageClass ? ` class=${MAZGAS.storageClass}` : ""),
    );
    logger.log(
        `Eilėje ${nf(pradzia.eileCount)} md5 (${gb(pradzia.eileBytes)} GB), ` +
            `jau įkelta ${nf(pradzia.ikeltaCount)} (${gb(pradzia.ikeltaBytes)} GB), ` +
            `liko ${nf(pradzia.likoCount)} (${gb(pradzia.likoBytes)} GB)`,
    );
    logger.log(
        `concurrency=${CONCURRENCY} batch=${nf(BATCH_SIZE)} ` +
            `RAM riba ${(N.inlineMaxBytes / 1024 ** 2).toFixed(0)}MB, temp=${N.tempDir}, ` +
            `piko atmintis ~${(pikas / 1024 ** 2).toFixed(0)}MB`,
    );

    const requestStop = (signal) => {
        if (stopping) {
            logger.log(`gauta ${signal} dar kartą, išeiname iš karto`);
            process.exit(130);
        }
        stopping = true;
        logger.log(`gauta ${signal}, baigiame pradėtus failus ir išeisime…`);
    };
    process.on("SIGINT", () => requestStop("SIGINT"));
    process.on("SIGTERM", () => requestStop("SIGTERM"));

    const progresoTimer = setInterval(() => progresas(pradzia), PROGRESO_MS);
    progresoTimer.unref();

    const miegoti = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function darbininkas() {
        while (!stopping) {
            const item = paimtiKita(db);
            if (item === null) {
                if (baigta || paimta >= LIMIT) return;
                // Buferis tuščias, bet kažkas dar vykdoma — palaukiam ir bandom vėl.
                await miegoti(250);
                continue;
            }
            await apdoroti(item);
            flush(writer);
        }
    }

    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, darbininkas));

    clearInterval(progresoTimer);
    flush(writer, true);

    const elapsed = performance.now() - t0;
    const pabaiga = getStats(db, MAZGAS.alias);
    logger.log(
        `Baigta per ${fmtDur(elapsed / 1000)}: įkelta ${nf(stat.ok)} ` +
            `(${gb(stat.baitai)} GB; RAM ${nf(stat.ram)}, diskas ${nf(stat.diskas)}), ` +
            `klaidų ${nf(stat.klaidu)}` +
            (stat.praleista ? `, S3 jau turėjo ${nf(stat.praleista)}` : ""),
    );
    logger.log(
        `Iš viso mazge „${MAZGAS.alias}": ${nf(pabaiga.ikeltaCount)}/${nf(pabaiga.eileCount)} ` +
            `(${gb(pabaiga.ikeltaBytes)}/${gb(pabaiga.eileBytes)} GB), liko ${nf(pabaiga.likoCount)}`,
    );

    closeSqlite(db);
    s3.destroy();
    await dispatcher.close();
}

main().catch((error) => {
    logger.log(`s3backupUpload nulūžo: ${error.stack || error.message}`);
    process.exitCode = 1;
});
