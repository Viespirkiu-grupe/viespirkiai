#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadEnvFile } from "../utils/configEnv.js";
import { parseArgs, positiveInteger } from "../utils/cliArgs.js";
import { postgres } from "../postgres/postgres.js";
import { streamQuery } from "../postgres/streamQuery.js";
import { FifoRateLimiter } from "../modules/openrouter/fifoRateLimiter.js";
import {
    apiModel,
    getPaskirtis,
    getVariant,
    PASKIRTYS,
} from "../modules/openrouter/modelioVariantai.js";
import {
    aprasymoIrankiai,
    aprasytiPirkima,
} from "../modules/viesiejiPirkimai/aprasymoGeneravimas.js";
import {
    runAdaptiveSlots,
    runWithSlots,
} from "../modules/viesiejiPirkimai/runWithSlots.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RPS = 12.5;
const MAX_AUTO_CONCURRENCY = 256;

function usage() {
    return [
        "Naudojimas: npm run pirkimai:aprasyti -- [parametrai]",
        "",
        "  --limit N          aprašyti daugiausia N pirkimų (numatyta: visus)",
        "  --rps N            OpenRouter užklausų per sekundę (numatyta: 12.5)",
        "  --concurrency N    fiksuotas darbų skaičius (numatyta: automatinis)",
        "  --variant N        naudoti esamą aiModelVariants.id (numatyta: pagal aiModelPaskirtys)",
        "  --force            aprašyti net kai aiModelPaskirtys.aktyvus = false",
    ].join("\n");
}

function positiveNumber(value, option) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`${option} turi būti teigiamas skaičius`);
    }
    return number;
}

async function missingPurchases(variantId, limit) {
    const limitSql = Number.isFinite(limit) ? "LIMIT $2" : "";
    const params = Number.isFinite(limit) ? [variantId, limit] : [variantId];
    return streamQuery(
        `SELECT p."pirkimoId"
         FROM public."viesiejiPirkimai" p
         WHERE NOT EXISTS (
             SELECT 1
             FROM public."viesiejiPirkimaiAprasymai" a
             WHERE a."pirkimoId" = p."pirkimoId"
               AND a."modelioVariantasId" = $1
         )
         ORDER BY p."paskelbimoData" DESC NULLS LAST, p."pirkimoId" DESC
         ${limitSql}`,
        params,
        { batchSize: 50 },
    );
}

async function missingPurchaseCount(variantId, limit) {
    const { rows } = await postgres.query(
        `SELECT COUNT(*)::int AS "count"
         FROM public."viesiejiPirkimai" p
         WHERE NOT EXISTS (
             SELECT 1
             FROM public."viesiejiPirkimaiAprasymai" a
             WHERE a."pirkimoId" = p."pirkimoId"
               AND a."modelioVariantasId" = $1
         )`,
        [variantId],
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
    // Modelis imamas iš DB (`aiModelPaskirtys`), nebent nurodytas `--variant`.
    // Ta pati vėliava, kuri stabdo eilę, stabdo ir šį backfill'ą — kad
    // sustabdytas darbas nepasileistų per rankinį paleidimą netyčia.
    const paskirtis = await getPaskirtis(PASKIRTYS.VIESUJU_PIRKIMU_APRASYMAS);
    if (!paskirtis.aktyvus && !args.force) {
        process.stderr.write(
            `Pirkimų aprašymas išjungtas (aiModelPaskirtys."${paskirtis.paskirtis}".aktyvus = false).`
            + " Nieko nedaroma; priverstinai – su --force.\n",
        );
        return;
    }
    const variant = variantId ? await getVariant(variantId) : paskirtis.variant;
    const model = apiModel(variant);
    const tools = aprasymoIrankiai();
    const rateLimiter = new FifoRateLimiter(rps);
    const stats = { pradeta: 0, issaugota: 0, neaprasoma: 0, klaidos: 0, jauBuvo: 0 };
    const total = await missingPurchaseCount(variant.id, limit);
    const startedAt = performance.now();
    let completed = 0;
    let activeJobs = 0;
    let currentConcurrency = concurrency ?? DEFAULT_CONCURRENCY;

    process.stderr.write(
        `Modelis: ${model} · variantas #${variant.id} · ${rps} RPS · `+
        `${concurrency == null ? `automatiniai slotai (pradžia ${DEFAULT_CONCURRENCY})` : `${concurrency} slotai`}`+
        ` · ${total} pirkimų${Number.isFinite(limit) ? ` · limitas ${limit}` : ""}\n\n`,
    );
    const rows = await missingPurchases(variant.id, limit);

    const progressLine = () => {
        const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
        const pps = completed / elapsedSeconds;
        const eta = pps > 0 ? (total - completed) / pps : Infinity;
        const percent = total ? completed / total * 100 : 100;
        const queuePercent = currentConcurrency
            ? rateLimiter.waitingCount / currentConcurrency * 100
            : 0;
        process.stderr.write(
            `… ${completed}/${total} (${percent.toFixed(1)}%) · ${pps.toFixed(2)} PPS`+
            ` · ${rateLimiter.averageRps.toFixed(1)}/${rps} RPS`+
            ` · ${activeJobs}/${currentConcurrency} darbai`+
            ` · ${rateLimiter.waitingCount} užklausų eilėje (${queuePercent.toFixed(0)}%)`+
            ` · ETA ${duration(eta)}\n`,
        );
    };
    const progressTimer = setInterval(progressLine, 1000);

    const logCompleted = (pirkimoId, symbol, outcome) => {
        completed++;
        process.stderr.write(`${symbol} #${pirkimoId} ${outcome}\n`);
    };

    const describePurchase = async ({ pirkimoId }) => {
        stats.pradeta++;
        activeJobs++;
        let symbol = "✓";
        let outcome = "išsaugota";
        try {
            const rezultatas = await aprasytiPirkima({
                pirkimoId,
                variant,
                model,
                tools,
                apiKey: process.env.OPENROUTER_API_KEY,
                beforeRequest: () => rateLimiter.acquire(),
            });
            stats[rezultatas]++;
            if (rezultatas === "neaprasoma") {
                symbol = "○";
                outcome = "nepakanka duomenų";
            } else if (rezultatas === "jauBuvo") {
                symbol = "○";
                outcome = "jau buvo";
            }
        } catch (error) {
            stats.klaidos++;
            symbol = "✗";
            outcome = `klaida: ${error.message.replace(/\s+/g, " ").slice(0, 160)}`;
        } finally {
            logCompleted(pirkimoId, symbol, outcome);
            activeJobs--;
        }
    };

    try {
        if (concurrency == null) {
            await runAdaptiveSlots(rows, describePurchase, {
                initialConcurrency: DEFAULT_CONCURRENCY,
                maxConcurrency: MAX_AUTO_CONCURRENCY,
                canGrow: () => rateLimiter.waitingCount <= currentConcurrency * 0.5,
                onConcurrencyChange: (value) => { currentConcurrency = value; },
            });
        } else {
            await runWithSlots(rows, describePurchase, concurrency);
        }
    } finally {
        clearInterval(progressTimer);
    }

    progressLine();

    process.stderr.write(
        `\nBaigta · ${stats.issaugota} išsaugota · ${stats.klaidos} klaidų`+
        `${stats.neaprasoma ? ` · ${stats.neaprasoma} neaprašomi` : ""}`+
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
