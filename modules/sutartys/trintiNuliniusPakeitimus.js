import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { positiveInteger } from "../../utils/cliArgs.js";
import {
    diffContractDocuments,
    fetchRecentChanges,
} from "./recentChanges.js";

export const HELP = `Naudojimas:
  npm run sutartys:dropEmptyChanges -- [parinktys]

Ištrina "nulinius" vpmSutartysChanges įrašus – tokius, kuriuose pasikeitė tik
sutartisHash, bet kanoninio JSON laukų skirtumų nėra (tie patys, kuriuos
sutartys:changes žymi "Matomų kanoninio JSON laukų skirtumų nėra.").

Parinktys:
  -d, --dry-run     Tik suskaičiuoti, nieko netrinti
      --id ID       Apdoroti tik vienos sutarties pakeitimus
  -n, --limit N     Neprivaloma peržiūrimų pakeitimų riba
      --batch-size N Kiek pakeitimų paimti viena DB užklausa (numatyta: 2000)
  -q, --quiet       Nerodyti tarpinės eigos
  -h, --help        Parodyti šią pagalbą`;

export function parseArgs(argv) {
    const options = {
        dryRun: false,
        id: null,
        limit: null,
        batchSize: 2000,
        quiet: false,
        help: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            options.help = true;
        } else if (arg === "--dry-run" || arg === "-d") {
            options.dryRun = true;
        } else if (arg === "--quiet" || arg === "-q") {
            options.quiet = true;
        } else if (arg === "--id") {
            options.id = positiveInteger(argv[++i], arg);
        } else if (arg.startsWith("--id=")) {
            options.id = positiveInteger(arg.slice(5), "--id");
        } else if (arg === "--limit" || arg === "-n") {
            options.limit = positiveInteger(argv[++i], arg);
        } else if (arg.startsWith("--limit=")) {
            options.limit = positiveInteger(arg.slice(8), "--limit");
        } else if (arg === "--batch-size") {
            options.batchSize = positiveInteger(argv[++i], arg);
        } else if (arg.startsWith("--batch-size=")) {
            options.batchSize = positiveInteger(arg.slice(13), "--batch-size");
        } else {
            throw new Error(`Nežinomas argumentas: ${arg}`);
        }
    }

    return options;
}

// Pakeitimas laikomas "nuliniu", jei žinoma tolesnė būsena (after) ir tarp
// šio įrašo sutartis (before) bei after nėra kanoninio JSON skirtumų.
// Jei after nežinomas (pvz. sutartis visai ištrinta iš vpmSutartys), įrašo
// neliečiame – saugu.
function isEmptyChange(row) {
    if (!row.after) return false;
    return diffContractDocuments(row.before, row.after).length === 0;
}

export async function main(argv = process.argv.slice(2), db = postgres) {
    const options = parseArgs(argv);
    if (options.help) {
        console.log(HELP);
        return;
    }

    const log = options.quiet ? () => {} : (text) => process.stdout.write(text);
    if (options.dryRun) {
        log("Sausas paleidimas (--dry-run): nieko netrinsiu.\n");
    }

    // Einame nuo naujausio id link seniausio, kaip ir sutartys:changes.
    // Trynimas DESC tvarka saugus: ištrynus nulinį pakeitimą, ankstesniojo
    // (mažesnio id) "after" tampa lygus dar tolesniam, o jis kanoniškai
    // sutampa su ištrintuoju – tad emptiness sprendimas nesikeičia.
    let beforeId = null;
    let scanned = 0;
    let emptyFound = 0;
    let deleted = 0;

    while (options.limit === null || scanned < options.limit) {
        const size = options.limit === null
            ? options.batchSize
            : Math.min(options.batchSize, options.limit - scanned);
        const rows = await fetchRecentChanges({
            limit: size,
            id: options.id,
            beforeId,
        }, db);
        if (rows.length === 0) break;
        scanned += rows.length;
        beforeId = rows.at(-1).id;

        const emptyIds = rows.filter(isEmptyChange).map((row) => row.id);
        emptyFound += emptyIds.length;

        if (emptyIds.length > 0 && !options.dryRun) {
            const result = await db.query(
                `DELETE FROM public."vpmSutartysChanges" WHERE id = ANY($1::integer[])`,
                [emptyIds],
            );
            deleted += result.rowCount;
        }

        log(
            `\rPeržiūrėta: ${scanned.toLocaleString("lt-LT")} | `
            + `nulinių: ${emptyFound.toLocaleString("lt-LT")} | `
            + `${options.dryRun ? "būtų ištrinta" : "ištrinta"}: `
            + `${(options.dryRun ? emptyFound : deleted).toLocaleString("lt-LT")}   `,
        );

        if (rows.length < size) break;
    }

    log("\n");
    const action = options.dryRun ? "Rasta nulinių (būtų ištrinta)" : "Ištrinta nulinių";
    process.stdout.write(
        `Baigta. Peržiūrėta ${scanned.toLocaleString("lt-LT")} pakeitimų. `
        + `${action}: ${(options.dryRun ? emptyFound : deleted).toLocaleString("lt-LT")}.\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
        .catch((error) => {
            console.error(`Nepavyko ištrinti nulinių pakeitimų: ${error.message}`);
            process.exitCode = 1;
        })
        .finally(async () => {
            await postgres.end();
        });
}
