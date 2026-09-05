#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadEnvFile } from "../utils/configEnv.js";
import { parseArgs, positiveInteger } from "../utils/cliArgs.js";
import { postgres } from "../postgres/postgres.js";
import { streamQuery } from "../postgres/streamQuery.js";
import { FifoRateLimiter } from "../modules/openrouter/fifoRateLimiter.js";
import * as getSutartis from "../modules/mcp/tools/getSutartis.js";
import * as getFailas from "../modules/mcp/tools/getFailas.js";
import * as getFailasTekstas from "../modules/mcp/tools/getFailasTekstas.js";
import {
    isFailureResult,
    runSutartiesAprasas,
} from "../modules/viesiejiPirkimai/pirkimoAprasasHarness.js";
import {
    runAdaptiveSlots,
    runWithSlots,
} from "../modules/viesiejiPirkimai/runWithSlots.js";
import { mcpAdapter } from "../modules/openrouter/mcpAdapter.js";
import {
    apiModel,
    getPaskirtis,
    getVariant,
    PASKIRTYS,
} from "../modules/openrouter/modelioVariantai.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RPS = 12.5;
const MAX_AUTO_CONCURRENCY = 256;

function usage() {
    return [
        "Naudojimas: npm run sutartys:aprasyti -- [parametrai]",
        "",
        "  --limit N          aprašyti daugiausia N sutarčių (numatyta: visas eilėje)",
        "  --rps N            OpenRouter užklausų per sekundę (numatyta: 12.5)",
        "  --concurrency N    fiksuotas darbų skaičius (numatyta: automatinis)",
        '  --variant N        naudoti esamą ai."modeliuVariantai".id (numatyta: pagal ai."paskirtys")',
        '  --force            aprašyti net kai ai."paskirtys".aktyvus = false',
    ].join("\n");
}

function positiveNumber(value, option) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`${option} turi būti teigiamas skaičius`);
    }
    return number;
}

async function queuedContracts(limit) {
    const limitSql = Number.isFinite(limit) ? "LIMIT $1" : "";
    const params = Number.isFinite(limit) ? [limit] : [];
    return streamQuery(
        `SELECT q."id" AS "queueId", q."unikalusId"
         FROM "vpmSutartys"."aprasymaiQueue" q
         ORDER BY q."id"
         ${limitSql}`,
        params,
        { batchSize: 50 },
    );
}

async function queuedContractCount(limit) {
    const { rows } = await postgres.query(
        `SELECT COUNT(*)::int AS "count"
         FROM "vpmSutartys"."aprasymaiQueue"`,
    );
    return Number.isFinite(limit) ? Math.min(rows[0].count, limit) : rows[0].count;
}

function duration(seconds) {
    if (!Number.isFinite(seconds)) return "–";
    const rounded = Math.max(0, Math.round(seconds));
    if (rounded < 60) return `${rounded}s`;
    if (rounded < 3600) return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
    return `${Math.floor(rounded / 3600)}h ${Math.floor((rounded % 3600) / 60)}m`;
}

async function saveResultAndFinishQueue({ queueId, unikalusId, variantId, success, aprasymas }) {
    const client = await postgres.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO "vpmSutartys"."aprasymai"
                ("unikalusId", "modelioVariantasId", "success", "aprasymas")
             VALUES ($1, $2, $3, $4)
             ON CONFLICT ("unikalusId", "modelioVariantasId") DO NOTHING`,
            [unikalusId, variantId, success, success ? aprasymas : null],
        );
        await client.query(
            `DELETE FROM "vpmSutartys"."aprasymaiQueue" WHERE "id" = $1`,
            [queueId],
        );
        await client.query("COMMIT");
        return result.rowCount === 1;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

export async function main(argv = process.argv.slice(2)) {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(usage());
        return;
    }

    loadEnvFile(process.cwd());
    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error("Nenustatytas OPENROUTER_API_KEY.");
    }

    const args = parseArgs(argv);
    const limit = args.limit == null
        ? Infinity
        : positiveInteger(args.limit, "--limit");
    const concurrency = args.concurrency == null
        ? null
        : positiveInteger(args.concurrency, "--concurrency");
    const rps = args.rps == null
        ? DEFAULT_RPS
        : positiveNumber(args.rps, "--rps");
    const variantId = args.variant == null
        ? null
        : positiveInteger(args.variant, "--variant");
    // Modelis ir įjungimo vėliava — DB lentelėje `ai."paskirtys"`. Sutarčių
    // aprašymas sustabdytas ten (`aktyvus = false`), tad be `--force` skriptas
    // nieko nedaro, net jei kas nors paleistų jį iš įpročio.
    const paskirtis = await getPaskirtis(PASKIRTYS.SUTARCIU_APRASYMAS);
    if (!paskirtis.aktyvus && !args.force) {
        process.stderr.write(
            `Sutarčių aprašymas išjungtas (ai."paskirtys"."${paskirtis.paskirtis}".aktyvus = false).`
            + " Nieko nedaroma; priverstinai – su --force.\n",
        );
        return;
    }
    const variant = variantId ? await getVariant(variantId) : paskirtis.variant;
    const model = apiModel(variant);
    const tools = [getSutartis, getFailas, getFailasTekstas].map(mcpAdapter);
    const rateLimiter = new FifoRateLimiter(rps);
    const stats = { issaugota: 0, neaprasoma: 0, klaidos: 0, jauBuvo: 0 };
    const total = await queuedContractCount(limit);
    const rows = await queuedContracts(limit);
    const startedAt = performance.now();
    let completed = 0;
    let activeJobs = 0;
    let currentConcurrency = concurrency ?? DEFAULT_CONCURRENCY;

    process.stderr.write(
        `Modelis: ${model} · variantas #${variant.id} · ${rps} RPS · `+
        `${concurrency == null ? `automatiniai slotai (pradžia ${DEFAULT_CONCURRENCY})` : `${concurrency} slotai`}`+
        ` · ${total} sutarčių${Number.isFinite(limit) ? ` · limitas ${limit}` : ""}\n\n`,
    );

    const progressLine = () => {
        const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
        const sps = completed / elapsedSeconds;
        const eta = sps > 0 ? (total - completed) / sps : Infinity;
        const percent = total ? completed / total * 100 : 100;
        const queuePercent = currentConcurrency
            ? rateLimiter.waitingCount / currentConcurrency * 100
            : 0;
        process.stderr.write(
            `… ${completed}/${total} (${percent.toFixed(1)}%) · ${sps.toFixed(2)} SPS`+
            ` · ${rateLimiter.averageRps.toFixed(1)}/${rps} RPS`+
            ` · ${activeJobs}/${currentConcurrency} darbai`+
            ` · ${rateLimiter.waitingCount} užklausų eilėje (${queuePercent.toFixed(0)}%)`+
            ` · ETA ${duration(eta)}\n`,
        );
    };
    const progressTimer = setInterval(progressLine, 1000);

    const logCompleted = (unikalusId, symbol, outcome) => {
        completed++;
        process.stderr.write(`${symbol} #${unikalusId} ${outcome}\n`);
    };

    const describeContract = async ({ queueId, unikalusId }) => {
        activeJobs++;
        let symbol = "✓";
        let outcome = "išsaugota";
        try {
            const alreadyDone = await postgres.query(
                `DELETE FROM "vpmSutartys"."aprasymaiQueue" q
                 USING "vpmSutartys"."aprasymai" a
                 WHERE q."id" = $1
                   AND a."unikalusId" = q."unikalusId"
                   AND a."modelioVariantasId" = $2
                 RETURNING q."id"`,
                [queueId, variant.id],
            );
            if (alreadyDone.rowCount) {
                stats.jauBuvo++;
                symbol = "○";
                outcome = "jau buvo";
                return;
            }

            const aprasymas = await runSutartiesAprasas({
                sutartiesId: String(unikalusId),
                apiKey: process.env.OPENROUTER_API_KEY,
                tools,
                model,
                reasoningEffort: variant.reasoningEffort,
                maxOutputTokens: variant.maxOutputTokens ?? 4000,
                temperature: variant.temperatura,
                topP: variant.topP,
                topK: variant.topK,
                beforeRequest: () => rateLimiter.acquire(),
            });
            const success = !isFailureResult(aprasymas);
            const inserted = await saveResultAndFinishQueue({
                queueId,
                unikalusId,
                variantId: variant.id,
                success,
                aprasymas,
            });
            if (!inserted) {
                stats.jauBuvo++;
                symbol = "○";
                outcome = "jau buvo";
            } else if (success) {
                stats.issaugota++;
            } else {
                stats.neaprasoma++;
                symbol = "○";
                outcome = "nepakanka duomenų";
            }
        } catch (error) {
            stats.klaidos++;
            symbol = "✗";
            outcome = `klaida: ${error.message.replace(/\s+/g, " ").slice(0, 160)}`;
        } finally {
            logCompleted(unikalusId, symbol, outcome);
            activeJobs--;
        }
    };

    try {
        if (concurrency == null) {
            await runAdaptiveSlots(rows, describeContract, {
                initialConcurrency: DEFAULT_CONCURRENCY,
                maxConcurrency: MAX_AUTO_CONCURRENCY,
                canGrow: () => rateLimiter.waitingCount <= currentConcurrency * 0.5,
                onConcurrencyChange: (value) => { currentConcurrency = value; },
            });
        } else {
            await runWithSlots(rows, describeContract, concurrency);
        }
    } finally {
        clearInterval(progressTimer);
    }

    progressLine();
    process.stderr.write(
        `\nBaigta · ${stats.issaugota} išsaugota · ${stats.klaidos} klaidų`+
        `${stats.neaprasoma ? ` · ${stats.neaprasoma} neaprašomos` : ""}`+
        `${stats.jauBuvo ? ` · ${stats.jauBuvo} jau buvo` : ""}\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        })
        .finally(() => postgres.end());
}
