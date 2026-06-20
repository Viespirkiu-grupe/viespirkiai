import { Agent } from "undici";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

const FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const fetchDispatcher = new Agent({
    headersTimeout: FETCH_TIMEOUT_MS,
    bodyTimeout: FETCH_TIMEOUT_MS,
    connectTimeout: FETCH_TIMEOUT_MS,
});

const DEFAULT_LIMIT = 1;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_EXTENSION = null;
const DEFAULT_START_MD5 = null;
const DEFAULT_DIRECT = false;
const DEFAULT_DRY_RUN = false;

const BATCH_SIZE = 1_000;

const DOWNLOAD_URL_PATH = "/download-url";
const STORAGE_USAGE_PATH = "/storage-usage";
const PUBLIC_FILE_BASE_URL = "https://failai.viespirkiai.org";
const MD5_REGEX = /^[a-f0-9]{32}$/i;

const CLI_USAGE =
    "Naudojimas: node modules/failai/kopijuoti.js [iš_dėžės] <į_dėžę> [--extension pdf] [--limit 10] [--concurrency 4] [--start-md5 <md5>] [--direct] [--dry-run]";

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_RED = "\x1b[31m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_BLUE = "\x1b[34m";
const ANSI_MAGENTA = "\x1b[35m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_GRAY = "\x1b[90m";

function color(text, ansi) {
    return `${ansi}${text}${ANSI_RESET}`;
}

function colorTag(tag, ansi) {
    return color(tag.padEnd(12, " "), `${ANSI_BOLD}${ansi}`);
}

function kv(key, value, ansi = ANSI_GRAY) {
    return `${color(key, ansi)}=${value}`;
}

function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 1024) return `${value || 0} B`;

    const units = ["KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = -1;

    do {
        size /= 1024;
        unitIndex++;
    } while (size >= 1024 && unitIndex < units.length - 1);

    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatFailasSummary({ failas, source }) {
    return [
        kv("md5", color(failas.md5, ANSI_CYAN)),
        kv("id", color(failas.firstId, ANSI_YELLOW)),
        kv("ext", color(failas.extension, ANSI_MAGENTA)),
        kv("size", color(formatBytes(failas.dydis), ANSI_BLUE)),
        kv("from", color(source, ANSI_GREEN)),
    ].join(" | ");
}

async function getDezeByName(name) {
    const result = await postgres.query(
        `
        SELECT d.*, a."apiKey"
        FROM public.dezes d
        JOIN public."apiRaktai" a ON a.id = d."apiRaktasId"
        WHERE d.pavadinimas = $1
        LIMIT 1
        `,
        [name],
    );

    return result.rows[0] ?? null;
}

async function getKopijuotiniFailai({ from, to, extension, startMd5, limit }) {
    const result = await postgres.query(
        `
        WITH kandidatai AS (
            SELECT
                fd.md5,
                fd.deze AS "sourceDeze",
                COALESCE(f.dydis, fd.dydis, 0) AS dydis
            FROM public."failaiDezes" fd
            JOIN LATERAL (
                SELECT f.dydis
                FROM public.failai f
                WHERE f.md5 = fd.md5
                  AND f.parsiustas = 1
                  AND ($2::text IS NULL OR lower(f.extension) = lower($2))
                ORDER BY f.id ASC
                LIMIT 1
            ) f ON TRUE
            WHERE ($1::text IS NULL OR fd.deze = $1)
              AND COALESCE(f.dydis, fd.dydis, 0) > 0
              AND ($3::text IS NULL OR fd.md5 > $3)
              AND NOT EXISTS (
                  SELECT 1
                  FROM public."failaiDezes" t
                  WHERE t.md5 = fd.md5
                    AND t.deze = $4
              )
            ORDER BY fd.md5 ASC
            LIMIT $5
        )
        SELECT
            k.md5,
            k."sourceDeze",
            first_failas."firstId",
            first_failas.pavadinimas,
            first_failas.extension,
            k.dydis,
            ids."fileIds"
        FROM kandidatai k
        JOIN LATERAL (
            SELECT
                f.id AS "firstId",
                f.pavadinimas,
                f.extension
            FROM public.failai f
            WHERE f.md5 = k.md5
              AND f.parsiustas = 1
              AND ($2::text IS NULL OR lower(f.extension) = lower($2))
            ORDER BY f.id ASC
            LIMIT 1
        ) first_failas ON TRUE
        JOIN LATERAL (
            SELECT ARRAY_AGG(f.id ORDER BY f.id) AS "fileIds"
            FROM public.failai f
            WHERE f.md5 = k.md5
              AND f.parsiustas = 1
              AND ($2::text IS NULL OR lower(f.extension) = lower($2))
        ) ids ON TRUE
        ORDER BY k.md5 ASC
        `,
        [from, extension, startMd5, to, limit],
    );

    return result.rows;
}

async function getDezesByNames(names) {
    if (!names.length) return new Map();

    const result = await postgres.query(
        `
        SELECT d.*, a."apiKey"
        FROM public.dezes d
        JOIN public."apiRaktai" a ON a.id = d."apiRaktasId"
        WHERE d.pavadinimas = ANY($1::text[])
        `,
        [names],
    );

    return new Map(result.rows.map((row) => [row.pavadinimas, row]));
}

async function updateDezeUsage(deze) {
    const response = await fetch(`${deze.url}${STORAGE_USAGE_PATH}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": deze.apiKey,
        },
        dispatcher: fetchDispatcher,
    });

    if (!response.ok) {
        throw new Error(
            `Nepavyko gauti dėžės "${deze.pavadinimas}" užimtumo: ${response.status}`,
        );
    }

    const { totalSizeBytes } = await response.json();

    await postgres.query(`UPDATE public.dezes SET used = $1 WHERE id = $2`, [
        totalSizeBytes,
        deze.id,
    ]);

    return totalSizeBytes;
}

function getSourceUrl({ failas, fromDeze, direct }) {
    if (direct) {
        return `${fromDeze.url}/file/${failas.md5}.${failas.extension}`;
    }

    return `${PUBLIC_FILE_BASE_URL}/${failas.firstId}`;
}

export async function kopijuotiFailus(from, to, options = {}) {
    const limit = Number.isInteger(options.limit)
        ? options.limit
        : DEFAULT_LIMIT;
    const concurrency = Number.isInteger(options.concurrency)
        ? options.concurrency
        : DEFAULT_CONCURRENCY;
    const extension = options.extension ?? DEFAULT_EXTENSION;
    const startMd5 = options.startMd5 ?? DEFAULT_START_MD5;
    const direct = options.direct ?? DEFAULT_DIRECT;
    const dryRun = options.dryRun ?? DEFAULT_DRY_RUN;

    const toDeze = await getDezeByName(to);
    if (!toDeze) {
        throw new Error(`Nerasta tikslo dėžė: "${to}"`);
    }

    const fromDeze = from ? await getDezeByName(from) : null;
    if (from && !fromDeze) {
        throw new Error(`Nerasta šaltinio dėžė: "${from}"`);
    }

    logger.log(
        [
            colorTag("COPY_PLAN", ANSI_BLUE),
            kv("from", color(from ?? "*", ANSI_GREEN)),
            kv("to", color(to, ANSI_GREEN)),
            kv("limit", color(limit, ANSI_YELLOW)),
            kv("conc", color(concurrency, ANSI_YELLOW)),
            kv("ext", color(extension ?? "*", ANSI_MAGENTA)),
            kv("start", color(startMd5 ?? "*", ANSI_CYAN)),
            kv("direct", color(direct, direct ? ANSI_YELLOW : ANSI_GRAY)),
            kv("dry", color(dryRun, dryRun ? ANSI_YELLOW : ANSI_GRAY)),
        ].join(" | "),
    );

    async function kopijuotiVienaFaila(failas, sourceDezes) {
        const currentFromDeze = from ? fromDeze : sourceDezes.get(failas.sourceDeze);
        if (!currentFromDeze) {
            throw new Error(
                `Nerasta šaltinio dėžė kandidatui md5=${failas.md5}: "${failas.sourceDeze}"`,
            );
        }

        const sourceUrl = getSourceUrl({
            failas,
            fromDeze: currentFromDeze,
            direct,
        });

        logger.log(
            `${colorTag("COPY_START", ANSI_CYAN)} | ${formatFailasSummary({
                failas,
                source: currentFromDeze.pavadinimas,
            })}`,
        );

        if (dryRun) {
            logger.log(
                `${colorTag("COPY_DRY", ANSI_YELLOW)} | ${formatFailasSummary({
                    failas,
                    source: currentFromDeze.pavadinimas,
                })}`,
            );
            logger.log(
                `${colorTag("LAST", ANSI_YELLOW)} | ${kv("md5", color(failas.md5, ANSI_CYAN))} | ${kv("id", color(failas.firstId, ANSI_YELLOW))}`,
            );
            return {
                md5: failas.md5,
                firstId: failas.firstId,
                fileIds: Array.isArray(failas.fileIds) ? failas.fileIds : [],
            };
        }

        const response = await fetch(`${toDeze.url}${DOWNLOAD_URL_PATH}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": toDeze.apiKey,
            },
            body: JSON.stringify({
                url: sourceUrl,
            }),
            dispatcher: fetchDispatcher,
        });

        if (!response.ok) {
            const text = await response.text();
            logger.log(
                `${colorTag("COPY_ERROR", ANSI_RED)} | ${kv("md5", color(failas.md5, ANSI_CYAN))} | ${kv("status", color(response.status, ANSI_RED))} | ${kv("body", color(JSON.stringify(text), ANSI_DIM))}`,
            );
            throw new Error(
                `Tikslo dėžė nepriėmė failo md5=${failas.md5} (${response.status})`,
            );
        }

        const body = await response.json();
        const copiedMd5 = body.md5;
        const copiedSize = body.size ?? failas.dydis;

        if (!copiedMd5) {
            throw new Error(`Kopijavimo atsakyme nėra md5 failui ${failas.md5}`);
        }

        if (copiedMd5 !== failas.md5) {
            throw new Error(
                `Md5 nesutampa: tikėtasi ${failas.md5}, gauta ${copiedMd5}`,
            );
        }

        await postgres.query(
            `
            INSERT INTO public."failaiDezes" (md5, deze, dydis)
            VALUES ($1, $2, $3)
            ON CONFLICT (md5, deze) DO NOTHING
            `,
            [copiedMd5, toDeze.pavadinimas, copiedSize],
        );

        const used = await updateDezeUsage(toDeze);

        logger.log(
            `${colorTag("COPY_DONE", ANSI_GREEN)} | ${formatFailasSummary({
                failas,
                source: currentFromDeze.pavadinimas,
            })} | ${kv("used", color(formatBytes(used), ANSI_BLUE))}`,
        );
        logger.log(
            `${colorTag("LAST", ANSI_GREEN)} | ${kv("md5", color(failas.md5, ANSI_CYAN))} | ${kv("id", color(failas.firstId, ANSI_YELLOW))}`,
        );

        return {
            md5: failas.md5,
            firstId: failas.firstId,
            fileIds: Array.isArray(failas.fileIds) ? failas.fileIds : [],
        };
    }

    let totalCount = 0;
    let currentMd5 = startMd5;
    let remaining = limit;

    while (remaining > 0) {
        const failai = await getKopijuotiniFailai({
            from,
            to,
            extension,
            startMd5: currentMd5,
            limit: Math.min(BATCH_SIZE, remaining),
        });

        if (!failai.length) {
            if (totalCount === 0) {
                logger.log("Nėra daugiau failų kopijavimui pagal nurodytus kriterijus.");
            }
            break;
        }

        const sourceDezes = from
            ? new Map([[fromDeze.pavadinimas, fromDeze]])
            : await getDezesByNames(
                  [...new Set(failai.map((f) => f.sourceDeze))].filter(Boolean),
              );

        let nextIndex = 0;

        async function worker() {
            while (true) {
                const index = nextIndex++;
                if (index >= failai.length) return;
                try {
                    await kopijuotiVienaFaila(failai[index], sourceDezes);
                    totalCount++;
                } catch (error) {
                    logger.log(
                        `${colorTag("COPY_FAIL", ANSI_RED)} | ${kv("md5", color(failai[index].md5, ANSI_CYAN))} | ${kv("error", color(error.message, ANSI_RED))}`,
                    );
                }
            }
        }

        await Promise.all(
            Array.from({ length: Math.min(concurrency, failai.length) }, () => worker()),
        );

        remaining -= failai.length;
        currentMd5 = failai[failai.length - 1].md5;
    }

    logger.log(
        `${colorTag("COPY_END", ANSI_GREEN)} | ${kv("count", color(totalCount, ANSI_YELLOW))} | ${kv("to", color(toDeze.pavadinimas, ANSI_GREEN))}`,
    );

    return totalCount;
}

function parseArgs(argv) {
    const positional = [];
    const options = {
        concurrency: DEFAULT_CONCURRENCY,
        direct: DEFAULT_DIRECT,
        dryRun: DEFAULT_DRY_RUN,
        extension: DEFAULT_EXTENSION,
        startMd5: DEFAULT_START_MD5,
        limit: DEFAULT_LIMIT,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "--direct") {
            options.direct = true;
            continue;
        }

        if (arg === "--dry-run") {
            options.dryRun = true;
            continue;
        }

        if (arg === "--extension") {
            options.extension = argv[++i] ?? null;
            continue;
        }

        if (arg.startsWith("--extension=")) {
            options.extension = arg.slice("--extension=".length) || null;
            continue;
        }

        if (arg === "--start-md5") {
            options.startMd5 = argv[++i] ?? null;
            continue;
        }

        if (arg.startsWith("--start-md5=")) {
            options.startMd5 = arg.slice("--start-md5=".length) || null;
            continue;
        }

        if (arg === "--limit") {
            options.limit = Number.parseInt(
                argv[++i] ?? String(DEFAULT_LIMIT),
                10,
            );
            continue;
        }

        if (arg.startsWith("--limit=")) {
            options.limit = Number.parseInt(arg.slice("--limit=".length), 10);
            continue;
        }

        if (arg === "--concurrency") {
            options.concurrency = Number.parseInt(
                argv[++i] ?? String(DEFAULT_CONCURRENCY),
                10,
            );
            continue;
        }

        if (arg.startsWith("--concurrency=")) {
            options.concurrency = Number.parseInt(
                arg.slice("--concurrency=".length),
                10,
            );
            continue;
        }

        if (arg === "--kiekis") {
            options.limit = Number.parseInt(
                argv[++i] ?? String(DEFAULT_LIMIT),
                10,
            );
            continue;
        }

        if (arg.startsWith("--kiekis=")) {
            options.limit = Number.parseInt(arg.slice("--kiekis=".length), 10);
            continue;
        }

        positional.push(arg);
    }

    if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new Error("Parametras --limit turi būti teigiamas sveikas skaičius.");
    }

    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
        throw new Error(
            "Parametras --concurrency turi būti teigiamas sveikas skaičius.",
        );
    }

    if (options.startMd5 && !MD5_REGEX.test(options.startMd5)) {
        throw new Error("Parametras --start-md5 turi būti 32 simbolių md5.");
    }

    return {
        positional,
        options,
    };
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const { positional, options } = parseArgs(process.argv.slice(2));

    if (positional.length < 1 || positional.length > 2) {
        logger.log(CLI_USAGE);
        process.exit(1);
    }

    const [from, to] =
        positional.length === 1 ? [null, positional[0]] : positional;

    kopijuotiFailus(from, to, options)
        .then(async () => {
            await postgres.end();
            process.exit(0);
        })
        .catch(async (error) => {
            console.error("Klaida:", error);
            await postgres.end();
            process.exit(1);
        });
}
