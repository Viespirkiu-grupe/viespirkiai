import { postgres } from "../../postgres/postgres.js";
import pLimit from "p-limit";
import { parsePmc, parseFailai, parseVersijos } from "./parsers.js";

const WINDOW_MS = 5000; // fixed smoothing window
const timestamps = [];

export function markRequest() {
    const now = Date.now();
    timestamps.push(now);
    cleanup(now);
}

export function getRpsFormatted() {
    const now = Date.now();
    cleanup(now);

    // normalize to per-second
    const rate = (timestamps.length * 1000) / WINDOW_MS;

    return rate < 10
        ? rate.toFixed(2)
        : rate < 100
          ? rate.toFixed(1)
          : String(Math.round(rate));
}

function cleanup(now) {
    const cutoff = now - WINDOW_MS;
    while (timestamps.length && timestamps[0] < cutoff) {
        timestamps.shift();
    }
}

const QUEUE_SIZE = 1000;
const cftQueue = [];
let refillPromise = null;

async function refillQueue() {
    if (cftQueue.length > 0) return;

    if (refillPromise) {
        await refillPromise;
        return;
    }

    refillPromise = (async () => {
        const { rows } = await postgres.query(
            `
            SELECT *
            FROM public."viesiejiPirkimai"
            WHERE type = 'Pmc'
              AND ("turinioNuskaitymas" IS NULL OR "turinioNuskaitymas" = 0)
            LIMIT $1
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

export async function getNextCft() {
    if (cftQueue.length === 0) {
        await refillQueue();
    }
    return cftQueue.shift() ?? null;
}

export async function nuskaitytiPmc() {
    let cft = await getNextCft();
    if (!cft) {
        return false;
    }

    try {
        let url = `https://viesiejipirkimai.lt/epps/pmc/viewPmc.do?resourceId=${cft.pirkimoId}`;
        console.log(`Nuskaitymas iš ${url}`, `| RPS: ${getRpsFormatted()}`);

        let response = await fetch(url);
        markRequest();
        let text = await response.text();
        let result = await parsePmc(text);

        let failaiUrl = `https://viesiejipirkimai.lt/epps/pmc/listPmcContractDocuments.do?d-5419-p=&resourceId=${cft.pirkimoId}&T02_ps=10000`;
        console.log(failaiUrl, `| RPS: ${getRpsFormatted()}`);
        let responseFailai = await fetch(failaiUrl);
        markRequest();

        let textFailai = await responseFailai.text();

        let failai = await parseFailai(textFailai);

        const limit = pLimit(8); // adjust concurrency

        await Promise.all(
            failai.map((file) =>
                limit(async () => {
                    if (!file.versijosExists) return;

                    const versijosUrl = `https://viesiejipirkimai.lt/epps/cft/viewDocumentVersions.do?resourceId=${file.dokumentasId}&d-16398-p=&T02_ps=10000`;
                    console.log(versijosUrl, `| RPS: ${getRpsFormatted()}`);
                    const responseVersijos = await fetch(versijosUrl);
                    markRequest();

                    const textVersijos = await responseVersijos.text();

                    file.versijos = await parseVersijos(textVersijos);
                }),
            ),
        );

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

        if (failaiFlat.length > 0) {
            const failaiValues = [];
            const failaiPlaceholders = failaiFlat
                .map((f, i) => {
                    const start = i * 4 + 1;
                    failaiValues.push(f.saltinis);
                    failaiValues.push(f.saltinioId);
                    failaiValues.push(f.pavadinimas);
                    failaiValues.push(f.extension);
                    return `($${start}, $${start + 1}, $${start + 2}, $${start + 3})`;
                })
                .join(", ");

            const failaiQuery = `
            INSERT INTO public."failai"
            ("saltinis", "saltinioId", "pavadinimas", "extension")
            VALUES ${failaiPlaceholders}
            ON CONFLICT ("saltinis", "saltinioId") WHERE (saltinis IS NOT NULL AND saltinis <> 'archive' AND "saltinioId" IS NOT NULL) DO NOTHING;
            `;

            await postgres.query(failaiQuery, failaiValues);
        }

        await postgres.query(
            `
      UPDATE public."viesiejiPirkimai"
      SET "turinioNuskaitymas" = 1,
          "turinioNuskaitymoData" = NOW(),
          turinys = $1
      WHERE "pirkimoId" = $2
      `,
            [result, cft.pirkimoId],
        );

        console.log(`Nuskaitymas baigtas ir įrašytas į DB.`);
    } catch (error) {
        console.error(`Klaida apdorojant pirkimą ID ${cft.pirkimoId}:`, error);

        await postgres.query(
            `
      UPDATE public."viesiejiPirkimai"
      SET "turinioNuskaitymas" = -1,
          "turinioNuskaitymoData" = NOW()
      WHERE "pirkimoId" = $1
      `,
            [cft.pirkimoId],
        );
    }

    return true;
}

const WORKERS = 24;

await Promise.all(
    Array.from({ length: WORKERS }, async () => {
        while (await nuskaitytiPmc()) {}
    }),
);
process.exit();
