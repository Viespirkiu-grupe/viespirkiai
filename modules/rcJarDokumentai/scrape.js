import config from "../../utils/config.js";
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { createScraperFetch } from "../../utils/scrapeFetch.js";
import { FifoRateLimiter } from "../openrouter/fifoRateLimiter.js";
import { parseArgs, numArg } from "../../utils/cliArgs.js";
import { nf, fmtDur } from "../../utils/progress.js";
import { parseDokPuslapi } from "./parse.js";
import { irasytiPateiktusDokumentus } from "./irasymas.js";
import pLimit from "p-limit";

const scrapeFetch = createScraperFetch("rcJarDokumentai", { operation: "scrape" });

const PUSLAPIS = "https://www.registrucentras.lt/jar/p/dok.php";
const UZKLAUSOS_TIMEOUT_MS = 30_000;

// Paimtas kodas iškart nustumiamas valandai į priekį – tai nuoma, kuri
// neleidžia kitam workeriui griebti to paties kodo, kol jis apdorojamas.
// Sėkmė ar klaida "nextAttempt" perrašo tikrąja reikšme.
const PAIMTI_SQL = `
WITH imami AS (
    SELECT "jarKodas"
    FROM "rcJar"."dokumentuEile"
    WHERE "nextAttempt" <= now()
    ORDER BY "nextAttempt"
    LIMIT $1
    FOR UPDATE SKIP LOCKED
)
UPDATE "rcJar"."dokumentuEile" e
SET "nextAttempt" = now() + interval '1 hour'
FROM imami
WHERE e."jarKodas" = imami."jarKodas"
RETURNING e."jarKodas"
`;

const SEKME_SQL = `
UPDATE "rcJar"."dokumentuEile"
SET "nextAttempt" = now() + make_interval(days => $2) * (0.9 + random() * 0.2),
    "nuskaityta" = now(),
    "bandymai" = 0,
    "klaida" = NULL,
    "eiluciuRasta" = $3
WHERE "jarKodas" = $1
`;

// Eksponentinis atidėjimas nuo valandos iki paros.
const LIKUTIS_SQL = `
SELECT count(*)::integer AS laukia
FROM "rcJar"."dokumentuEile"
WHERE "nextAttempt" <= now()
`;

const KLAIDA_SQL = `
UPDATE "rcJar"."dokumentuEile"
SET "nextAttempt" = now()
        + LEAST(interval '24 hours', interval '1 hour' * power(2, LEAST("bandymai", 5))),
    "bandymai" = LEAST("bandymai" + 1, 32767),
    "klaida" = $2
WHERE "jarKodas" = $1
`;

/**
 * Parsiunčia ir išskaido vieno juridinio asmens dok.php puslapį.
 *
 * @param {number} jarKodas
 * @returns {Promise<import("./parse.js").DokPuslapis>}
 */
export async function nuskaitytiPuslapi(jarKodas) {
    const atsakymas = await scrapeFetch(`${PUSLAPIS}?kod=${jarKodas}`, {
        signal: AbortSignal.timeout(UZKLAUSOS_TIMEOUT_MS),
    });
    if (!atsakymas.ok) throw new Error(`HTTP ${atsakymas.status}`);

    const puslapis = parseDokPuslapi(await atsakymas.text());
    if (puslapis.jarKodas != null && puslapis.jarKodas !== jarKodas) {
        throw new Error(
            `puslapis grąžino kitą kodą (${puslapis.jarKodas} vietoje ${jarKodas})`,
        );
    }
    return puslapis;
}

/**
 * Nuskaito vieną JAR kodą ir įrašo rezultatą kartu su eilės būsena.
 *
 * @param {number} jarKodas
 * @param {number} intervalDienomis
 * @param {import("pg").Pool|import("pg").PoolClient} db
 * @returns {Promise<{jarKodas: number, eiluciuRasta?: number, klaida?: string}>}
 */
async function apdorotiKoda(jarKodas, intervalDienomis, db) {
    try {
        const puslapis = await nuskaitytiPuslapi(jarKodas);
        await irasytiPateiktusDokumentus(jarKodas, puslapis.eilutes, db);
        await db.query(SEKME_SQL, [jarKodas, intervalDienomis, puslapis.eilutes.length]);
        return { jarKodas, eiluciuRasta: puslapis.eilutes.length };
    } catch (klaida) {
        const tekstas = String(klaida?.message ?? klaida).slice(0, 500);
        await db.query(KLAIDA_SQL, [jarKodas, tekstas]);
        return { jarKodas, klaida: tekstas };
    }
}

/**
 * Viena porcija: paima kodus iš eilės, nuskaito juos lygiagrečiai (bet ne
 * greičiau nei leidžia RPS riba) ir grąžina `false`, kai eilėje nieko nebėra
 * – tokia TaskRunner `mode: "asap"` sutartis.
 *
 * @param {object} [nustatymai]
 * @param {number} [nustatymai.batch] kiek kodų paimti į vieną porciją
 * @param {number} [nustatymai.concurrency] kiek užklausų vienu metu
 * @param {number} [nustatymai.rps] bendra užklausų per sekundę riba
 * @param {number} [nustatymai.intervalDienomis] po kiek dienų kodas skaitomas vėl
 * @param {number[]} [nustatymai.kodai] konkretūs kodai vietoje eilės (CLI)
 * @param {import("pg").Pool|import("pg").PoolClient} [db]
 * @returns {Promise<boolean>}
 */
export async function nuskaitytiRcJarDokumentus(nustatymai = {}, db = postgres) {
    const {
        batch = config.rcJarDokumentaiBatch,
        concurrency = config.rcJarDokumentaiConcurrency,
        rps = config.rcJarDokumentaiRps,
        intervalDienomis = config.rcJarDokumentaiIntervalDays,
        kodai = null,
    } = nustatymai;

    let paimti = kodai;
    if (!paimti) {
        const rezultatas = await db.query(PAIMTI_SQL, [batch]);
        paimti = rezultatas.rows.map((eilute) => Number(eilute.jarKodas));
    }
    if (!paimti.length) return false;

    if (!kodai) {
        const { laukia } = (await db.query(LIKUTIS_SQL)).rows[0];
        log(
            `Paimta ${paimti.length} JAR kodų; eilėje dar laukia ${nf(laukia)} ` +
            `(~${fmtDur(laukia / rps)} prie ${rps} užkl./s)`,
        );
    }

    const pradzia = performance.now();
    const ribotuvas = new FifoRateLimiter(rps);
    const limit = pLimit(concurrency);

    // Prie 1 užkl./s porcija trunka ~minutę, tad be tarpinės eilutės atrodo,
    // kad procesas pakibo.
    let atlikta = 0;
    const eiga = setInterval(() => {
        log(`  … ${atlikta}/${paimti.length}`);
    }, 10_000);
    eiga.unref();

    let rezultatai;
    try {
        rezultatai = await Promise.all(paimti.map((jarKodas) =>
            limit(async () => {
                await ribotuvas.acquire();
                const rezultatas = await apdorotiKoda(jarKodas, intervalDienomis, db);
                atlikta++;
                if (rezultatas.klaida) log(`  ${jarKodas}: ${rezultatas.klaida}`);
                return rezultatas;
            })
        ));
    } finally {
        clearInterval(eiga);
    }

    const klaidos = rezultatai.filter((r) => r.klaida);
    const dokumentai = rezultatai.reduce((suma, r) => suma + (r.eiluciuRasta ?? 0), 0);
    const trukme = (performance.now() - pradzia) / 1000;
    log(
        `Nuskaityta ${paimti.length - klaidos.length}/${paimti.length} JAR kodų, ` +
        `${dokumentai} dokumentų eilučių, ${trukme.toFixed(1)}s ` +
        `(${(paimti.length / Math.max(trukme, 0.001)).toFixed(2)} užkl./s)`,
    );
    return true;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    // parseArgs supranta tik `--raktas reikšmė`, o `--kodai=…` rašosi natūraliau.
    const argv = process.argv.slice(2).flatMap((arg) => {
        const lygybe = arg.match(/^(--[^=]+)=(.*)$/);
        return lygybe ? [lygybe[1], lygybe[2]] : [arg];
    });
    const args = parseArgs(argv);
    const kodai = typeof args.kodai === "string"
        ? args.kodai.split(",").map((k) => Number(k.trim())).filter(Boolean)
        : null;
    const nustatymai = {
        kodai,
        batch: numArg(args.batch, config.rcJarDokumentaiBatch),
        concurrency: numArg(args.concurrency, config.rcJarDokumentaiConcurrency),
        rps: numArg(args.rps, config.rcJarDokumentaiRps),
    };
    // Be `--kodai` sukama tol, kol eilėje nebelieka termino sulaukusių kodų;
    // `--ratai` apriboja porcijų skaičių.
    const ratai = numArg(args.ratai, kodai ? 1 : Infinity);

    try {
        for (let ratas = 0; ratas < ratai; ratas++) {
            if (!await nuskaitytiRcJarDokumentus(nustatymai)) {
                log("Eilėje nieko nebėra");
                break;
            }
        }
    } finally {
        await postgres.end();
    }
}
