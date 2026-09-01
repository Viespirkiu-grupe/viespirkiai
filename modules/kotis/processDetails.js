#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { positiveInteger } from "../../utils/cliArgs.js";
import { log } from "../../utils/log.js";
import { closeNats } from "../../utils/natsHub.js";
import { fetchKotisHtml, kotisDetailUrl } from "./api.js";
import { claimDetail, discoveryRunning, failDetail } from "./detailQueue.js";
import { assertKotisQueueSchema } from "./discoveryStore.js";
import { publishCard } from "./normalizedStore.js";
import { parseDetailPage } from "./parse.js";

export function parseDetailArgs(argv) {
    const allowed = new Set(["--concurrency", "--max-attempts", "--limit", "--help"]);
    for (const arg of argv) {
        if (arg.startsWith("--") && !allowed.has(arg)) throw new Error(`Nežinomas argumentas: ${arg}`);
    }
    const value = (name) => {
        const index = argv.indexOf(name);
        if (index < 0) return undefined;
        if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
            throw new Error(`${name} trūksta reikšmės`);
        }
        return argv[index + 1];
    };
    if (argv.includes("--help")) return { help: true };
    return {
        help: false,
        concurrency: value("--concurrency") ? positiveInteger(value("--concurrency"), "--concurrency") : 8,
        maxAttempts: value("--max-attempts") ? positiveInteger(value("--max-attempts"), "--max-attempts") : 10,
        limit: value("--limit") ? positiveInteger(value("--limit"), "--limit") : Infinity,
    };
}

function printHelp() {
    console.log(`Naudojimas: node modules/kotis/processDetails.js [parametrai]

  --concurrency N         Vienu metu skaitomos kortelės (numatyta 8)
  --max-attempts N        Daugiausia nesėkmingų bandymų (numatyta 10)
  --limit N               Šio paleidimo kortelių limitas
  --help`);
}

function listRow(job) {
    return {
        id: Number(job.pagalbosId),
        url: job.url,
        gavejas: job.sarasoGavejas,
        teikejas: job.sarasoTeikejas,
        suteikimoData: job.sarasoSuteikimoData,
        suma: job.sarasoSuma,
        teisinisPagrindas: job.sarasoTeisinisPagrindas,
        pagalbosRusis: job.sarasoPagalbosRusis,
        busena: job.sarasoBusena,
    };
}

export async function processKotisDetails(options, {
    db = postgres,
    fetchHtml = fetchKotisHtml,
} = {}) {
    await assertKotisQueueSchema(db);
    log(`KOTIS kortelės: concurrency ${options.concurrency}, max bandymų ${options.maxAttempts}`);
    let claimed = 0;
    let issued = 0;
    let succeeded = 0;
    let failed = 0;
    const queueErrors = [];

    async function worker() {
        while (true) {
            const slot = issued++;
            if (slot >= options.limit) return;
            const job = await claimDetail({ maxAttempts: options.maxAttempts }, db);
            if (!job) {
                issued--;
                if (await discoveryRunning(db)) {
                    await new Promise((resolve) => setTimeout(resolve, 2_000));
                    continue;
                }
                return;
            }
            claimed++;
            const id = Number(job.pagalbosId);
            const url = kotisDetailUrl(id);
            try {
                const record = parseDetailPage(await fetchHtml(url), url, listRow(job));
                await publishCard(record, job, db);
                succeeded++;
            } catch (error) {
                failed++;
                await failDetail(job, error, db).catch((queueError) => queueErrors.push(queueError));
                log(`KOTIS kortelė ${id} nepavyko: ${error.message}`);
            }
            if ((succeeded + failed) % 25 === 0) {
                log(`KOTIS kortelės: baigta ${succeeded + failed}, pavyko ${succeeded}, klaidų ${failed}`);
            }
        }
    }

    await Promise.all(Array.from({ length: options.concurrency }, worker));
    log(`KOTIS kortelės baigtos: pavyko ${succeeded}, klaidų ${failed}`);
    if (queueErrors.length) throw new AggregateError(queueErrors, "Nepavyko išsaugoti KOTIS kortelių klaidų");
    if (failed) throw new Error(`Nepavyko ${failed} KOTIS kortelių; jos paliktos pakartotinam bandymui`);
    return { claimed, succeeded, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const options = parseDetailArgs(process.argv.slice(2));
    if (options.help) printHelp();
    else processKotisDetails(options).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(async () => {
        await closeNats().catch(() => {});
        await postgres.end();
    });
}
