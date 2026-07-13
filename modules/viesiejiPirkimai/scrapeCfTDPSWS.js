import { postgres } from "../../postgres/postgres.js";
import pLimit from "p-limit";
import Timings from "../../utils/timings.js";
import { log } from "../../utils/log.js";
import { isVptWorkingHours } from "../sutartys/isWorkingHours.js";
import { parseCfTDPSWS, parseFailai, parseVersijos } from "./parsers.js";
import { NUSKAITYMO_VERSIJA } from "./parsers.js";
import { persistPirkimoTurinys } from "./persistTurinys.js";
import { extractTedNoticeNumber } from "./parsers.js";
import { findSingleJuridinis } from "../juridiniai/search.js";
import config from "../../utils/config.js";

const WINDOW_MS = 5000; // fixed smoothing window
const HOST = config.viesiejiPirkimaiUrl;
const timestamps = [];

/**
 * Records a request timestamp for RPS calculation.
 * @returns {void}
 */
export function markRequest() {
    const now = Date.now();
    timestamps.push(now);
    cleanup(now);
}

/**
 * Returns a formatted requests-per-second value using a rolling window.
 * @returns {string}
 */
export function getRpsFormatted() {
    const now = Date.now();
    cleanup(now);

    const rate = (timestamps.length * 1000) / WINDOW_MS;

    return rate < 10
        ? rate.toFixed(2)
        : rate < 100
            ? rate.toFixed(1)
            : String(Math.round(rate));
}

/**
 * Cleans up old timestamps outside the rolling window.
 * @param {number} now
 * @returns {void}
 */
function cleanup(now) {
    const cutoff = now - WINDOW_MS;
    while (timestamps.length && timestamps[0] < cutoff) {
        timestamps.shift();
    }
}

const QUEUE_SIZE = 1000;
const cftQueue = [];
let refillPromise = null;

/**
 * Refills the in-memory queue with items to process.
 * @returns {Promise<void>}
 */
async function refillQueue() {
    if (cftQueue.length > 0) return;

    if (refillPromise) {
        await refillPromise;
        return;
    }

    refillPromise = (async () => {
        const { rows } = await postgres.query(
            `
       WITH candidate AS (
         SELECT "pirkimoId"
         FROM public."viesiejiPirkimaiAtnaujinimai"
         WHERE "typeId" = 3 -- CfTDPSWS
           AND ("turinioNuskaitymas" IS NULL OR "turinioNuskaitymas" = 0)
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE public."viesiejiPirkimaiAtnaujinimai" v
       SET "turinioNuskaitymas" = -2,
           "scrapeReservation" = NOW()
       FROM candidate
       WHERE v."pirkimoId" = candidate."pirkimoId"
       RETURNING v."pirkimoId";
       `,
            [QUEUE_SIZE],
        );

        cftQueue.push(...rows);
    })();

    try {
        await refillPromise;
    } finally {
        refillPromise = null;
    }
}

/**
 * Gets the next item from the queue.
 * @returns {Promise<object | null>}
 */
export async function getNextCft() {
    if (cftQueue.length === 0) {
        await refillQueue();
    }
    return cftQueue.shift() ?? null;
}

/**
 * Fetches a URL and returns response text while tracking RPS.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchText(url) {
    const response = await fetch(url, { redirect: "follow" });
    markRequest();

    const redirectedUrl = response.url || "";
    const wasRedirectedToCas =
        redirectedUrl.startsWith(`${HOST}/cas/login?`) ||
        response.headers
            .get("location")
            ?.startsWith(`${HOST}/cas/login?`);

    if (wasRedirectedToCas) {
        const error = new Error("CAS redirect");
        error.casRedirect = true;
        error.casLocation = redirectedUrl;
        throw error;
    }

    return response.text();
}

/**
 * Processes a single CfTDPSWS record.
 * Returns false if no work is left, true otherwise.
 * @param {object} [options]
 * @param {number} [options.versionConcurrency=8]
 * @returns {Promise<boolean>}
 */
async function processCfTDPSWSRecord(cft, options = {}) {
    const versionConcurrency = options.versionConcurrency ?? 8;

    const timings = new Timings();
    try {
        const url = `${HOST}/epps/dps/prepareViewCfTDPSWS.do?resourceId=${cft.pirkimoId}`;
        timings.start("fetchMain");
        const text = await fetchText(url);
        timings.end("fetchMain");

        const result = await parseCfTDPSWS(text);

        const failaiUrl = `${HOST}/epps/pmc/listPmcContractDocuments.do?d-5419-p=&resourceId=${cft.pirkimoId}&T02_ps=10000`;
        timings.start("fetchFiles");
        const textFailai = await fetchText(failaiUrl);
        timings.end("fetchFiles");

        const failai = await parseFailai(textFailai);

        const limit = pLimit(versionConcurrency);

        timings.start("fetchVersions");
        await Promise.all(
            failai.map((file) =>
                limit(async () => {
                    if (!file.versijosExists) return;

                    const versijosUrl = `${HOST}/epps/cft/viewDocumentVersions.do?resourceId=${file.dokumentasId}&d-16398-p=&T02_ps=10000`;
                    const textVersijos = await fetchText(versijosUrl);
                    file.versijos = await parseVersijos(textVersijos);
                }),
            ),
        );
        timings.end("fetchVersions");

        result.failai = failai;

        const failaiFlat = failai.flatMap((failas) => {
            if (!failas.versijosExists || !failas.versijos) return [];

            return failas.versijos.map((v) => ({
                saltinis: "cvpIs",
                saltinioId: `${cft.pirkimoId}/${failas.dokumentasId}/${v.versionId}`,
                pavadinimas: failas.dokumentasPavadinimas,
                extension: failas.dokumentasPavadinimas?.split(".").pop() || "",
            }));
        });

        timings.start("upsertFiles");
        if (failaiFlat.length > 0) {
            const existsResult = await postgres.query(
                `SELECT "saltinis", "saltinioId" FROM failai
         WHERE ("saltinis", "saltinioId") IN (${failaiFlat.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})
           AND saltinis IS NOT NULL AND saltinis <> 'archive' AND "saltinioId" IS NOT NULL`,
                failaiFlat.flatMap(f => [f.saltinis, f.saltinioId])
            );

            const existingSet = new Set(existsResult.rows.map(r => `${r.saltinis}:${r.saltinioId}`));
            const toInsert = failaiFlat.filter(f => !existingSet.has(`${f.saltinis}:${f.saltinioId}`));

            if (toInsert.length > 0) {
                const placeholders = toInsert.map((_, i) =>
                    `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
                );
                await postgres.query(
                    `INSERT INTO failai ("saltinis", "saltinioId", "pavadinimas", "extension")
             VALUES ${placeholders.join(', ')}
             ON CONFLICT ("saltinis", "saltinioId") WHERE (saltinis IS NOT NULL AND saltinis <> 'archive' AND "saltinioId" IS NOT NULL) DO NOTHING`,
                    toInsert.flatMap(f => [f.saltinis, f.saltinioId, f.pavadinimas, f.extension])
                );
            }
        }
        timings.end("upsertFiles");

        const tedNoticeNumbers = [
            ...new Set(
                result?.tedNuorodosIPaskelbtusPranesimus
                    ?.map(extractTedNoticeNumber)
                    .filter(Boolean) ?? [],
            ),
        ];

        if (tedNoticeNumbers.length > 0) {
            const values = [];
            const placeholders = tedNoticeNumbers
                .map((n, i) => {
                    const start = i + 1;
                    values.push(n);
                    return `($${start})`;
                })
                .join(", ");

            await postgres.query(
                `
                INSERT INTO "tedNotices" ("tedNoticeNumber")
                VALUES ${placeholders}
                ON CONFLICT ("tedNoticeNumber") DO NOTHING;
                `,
                values,
            );
        }

        timings.start("updatePurchase");
        let jarKodas = null;
        if (result.pirkimoVykdytojasId) {
            await postgres.query(
                `
                INSERT INTO public."viesiejiPirkimaiVykdytojai" (id)
                VALUES ($1)
                ON CONFLICT (id) DO NOTHING
                `,
                [result.pirkimoVykdytojasId],
            );
            const { rows } = await postgres.query(
                `SELECT "jarKodas" FROM public."viesiejiPirkimaiVykdytojai" WHERE id = $1`,
                [result.pirkimoVykdytojasId],
            );
            jarKodas = rows[0]?.jarKodas ?? null;
        }
        if (!jarKodas && result.pirkimoVykdytojasPavadinimas) {
            const juridinis = await findSingleJuridinis(
                result.pirkimoVykdytojasPavadinimas,
            );
            jarKodas = juridinis?.jarKodas ?? null;
        }
        // Promoted stulpelius rašom į storąją lentelę tik jei kas nors pasikeitė
        // (IS DISTINCT FROM), kad nekintantis 12h perskaitymas nebloatintų eilutės.
        await postgres.query(
            `
            UPDATE public."viesiejiPirkimai"
            SET "numatomaVerteEUR" = $2,
                "bvpzKodai" = $3,
                "pirkimoObjektoTipas" = $4,
                "esFinansavimas" = $5,
                "pirkimoVykdytojasId" = $6,
                "jarKodas" = COALESCE($7, "jarKodas")
            WHERE "pirkimoId" = $1
              AND (
                  "numatomaVerteEUR" IS DISTINCT FROM $2
                  OR "bvpzKodai" IS DISTINCT FROM $3
                  OR "pirkimoObjektoTipas" IS DISTINCT FROM $4
                  OR "esFinansavimas" IS DISTINCT FROM $5
                  OR "pirkimoVykdytojasId" IS DISTINCT FROM $6
                  OR "jarKodas" IS DISTINCT FROM COALESCE($7, "jarKodas")
              )
            `,
            [
                cft.pirkimoId,
                result.numatomaVerteEUR ?? null,
                result.bvpzKodai ?? [],
                result.pirkimoObjektoTipas ?? null,
                result.esFinansavimas === "Taip"
                    ? true
                    : result.esFinansavimas === "Ne"
                        ? false
                        : null,
                result.pirkimoVykdytojasId ?? null,
                jarKodas,
            ],
        );
        // Turinys → reliacinės lentelės (Keys/Dalys/Failai/Skelbimai).
        await persistPirkimoTurinys(cft.pirkimoId, result);
        // Nuskaitymo būsena/data visada į plonąją lentelę.
        await postgres.query(
            `
            UPDATE public."viesiejiPirkimaiAtnaujinimai"
            SET "turinioNuskaitymas" = ${NUSKAITYMO_VERSIJA},
                "turinioNuskaitymoData" = (now() AT TIME ZONE 'Europe/Vilnius'),
                "scrapeReservation" = NULL
            WHERE "pirkimoId" = $1
            `,
            [cft.pirkimoId],
        );
        timings.end("updatePurchase");

        timings.end("all");
        log(
            `Nuskaitytas CfTDPSWS id ${cft.pirkimoId} | fetch ${timings.humanDuration("fetchMain")}/${timings.humanDuration("fetchFiles")}/${timings.humanDuration("fetchVersions")} | upsert ${timings.humanDuration("upsertFiles")}/${timings.humanDuration("updatePurchase")} | viso ${timings.humanDuration()}`,
        );
    } catch (error) {
        console.error(`Klaida apdorojant pirkimą ID ${cft.pirkimoId}:`, error);

        const status = error?.casRedirect ? -404 : -1;

        await postgres.query(
            `
      UPDATE public."viesiejiPirkimaiAtnaujinimai"
      SET "turinioNuskaitymas" = $1,
          "turinioNuskaitymoData" = NOW(),
          "scrapeReservation" = NULL
      WHERE "pirkimoId" = $2
      `,
            [status, cft.pirkimoId],
        );
    }

    return true;
}

export async function processCfTDPSWS(options = {}) {
    const cft = await getNextCft();
    if (!cft) return false;

    await processCfTDPSWSRecord(cft, options);
    return true;
}

/**
 * Processes the oldest CfTDPSWS record by turinioNuskaitymoData during off-hours.
 * Returns false if working hours, no records, or the oldest is older than 12 hours.
 * @param {object} [options]
 * @param {number} [options.versionConcurrency=8]
 * @returns {Promise<boolean>}
 */
export async function processOldestCfTDPSWSOffHours(options = {}) {
    if (isVptWorkingHours()) return false;

    const { rows } = await postgres.query(
        `
        WITH candidate AS (
            SELECT "pirkimoId"
            FROM public."viesiejiPirkimaiAtnaujinimai"
            WHERE "typeId" = 3 -- CfTDPSWS
              AND "turinioNuskaitymas" != -2
              AND (
                  ("turinioNuskaitymas" < ${NUSKAITYMO_VERSIJA} AND "turinioNuskaitymas" >= 0)
                  OR "turinioNuskaitymoData" <= (now() AT TIME ZONE 'Europe/Vilnius') - interval '12 hours'
              )
            ORDER BY "turinioNuskaitymoData" ASC NULLS LAST
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE public."viesiejiPirkimaiAtnaujinimai" v
        SET "turinioNuskaitymas" = -2,
            "scrapeReservation" = (now() AT TIME ZONE 'Europe/Vilnius')
        FROM candidate
        WHERE v."pirkimoId" = candidate."pirkimoId"
        RETURNING v."pirkimoId";
        `,
    );

    const cft = rows[0];
    if (!cft) return false;

    await processCfTDPSWSRecord(cft, options);
    return true;
}

const WORKERS = 16;

if (import.meta.url === `file://${process.argv[1]}`) {
    const maxArg = Number(process.argv[2]);
    const maxCount =
        Number.isFinite(maxArg) && maxArg > 0 ? Math.floor(maxArg) : null;

    try {
        if (maxCount) {
            for (let i = 0; i < maxCount; i += 1) {
                const didWork = await processCfTDPSWS();
                if (!didWork) break;
            }
        } else {
            await Promise.all(
                Array.from({ length: WORKERS }, async () => {
                    while (await processCfTDPSWS()) { }
                }),
            );
        }
    } finally {
        await postgres.end();
    }
}
