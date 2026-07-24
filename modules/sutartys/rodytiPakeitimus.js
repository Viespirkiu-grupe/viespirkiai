import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { writeWithPager } from "../../utils/pager.js";
import {
    fetchRecentChanges,
    formatRecentChanges,
    parseRecentChangesArgs,
} from "./recentChanges.js";

export const HELP = `Naudojimas:
  npm run sutartys:changes -- [--limit N] [--id SUTARTIES_ID] [parinktys]

Parinktys:
  -n, --limit N   Neprivaloma bendra išvedamų pakeitimų riba
      --id ID      Rodyti tik vienos sutarties pakeitimus
      --json       Išvesti neformatuotas pakeitimų eilutes kaip JSON
      --[no-]color Priverstinai įjungti arba išjungti spalvas
      --[no-]pager Įjungti arba išjungti interaktyvų puslapiavimą
      --page-size N Eilučių skaičius viename puslapyje
      --batch-size N Kiek pakeitimų paimti viena DB užklausa (numatyta: 20)
  -h, --help       Parodyti šią pagalbą`;

async function writeJson(options, db) {
    let beforeId = null;
    let remaining = options.limit;
    let first = true;
    process.stdout.write("[\n");

    while (remaining === null || remaining > 0) {
        const size = remaining === null
            ? options.batchSize
            : Math.min(options.batchSize, remaining);
        const rows = await fetchRecentChanges({
            limit: size,
            id: options.id,
            beforeId,
        }, db);
        if (rows.length === 0) break;
        for (const row of rows) {
            process.stdout.write(`${first ? "" : ",\n"}${JSON.stringify(row)}`);
            first = false;
        }
        beforeId = rows.at(-1).id;
        if (remaining !== null) remaining -= rows.length;
        if (rows.length < size) break;
    }
    process.stdout.write("\n]\n");
}

export async function main(argv = process.argv.slice(2), db = postgres) {
    const options = parseRecentChangesArgs(argv);
    if (options.help) {
        console.log(HELP);
        return;
    }

    if (options.json) {
        await writeJson(options, db);
        return;
    }

    const color = options.color ?? (process.stdout.isTTY === true);
    let beforeId = null;
    let remaining = options.limit;
    let found = false;

    while (remaining === null || remaining > 0) {
        const size = remaining === null
            ? options.batchSize
            : Math.min(options.batchSize, remaining);
        const fetched = await fetchRecentChanges({
            limit: size + 1,
            id: options.id,
            beforeId,
        }, db);
        const rows = fetched.slice(0, size);
        if (rows.length === 0) break;
        found = true;
        if (remaining !== null) remaining -= rows.length;
        const hasMore = fetched.length > size && remaining !== 0;
        const continuePaging = await writeWithPager(
            formatRecentChanges(rows, { color }),
            {
                enabled: options.pager,
                pageSize: options.pageSize,
                hasMore,
            },
        );
        beforeId = rows.at(-1).id;
        if (!hasMore || !continuePaging) break;
    }

    if (!found) {
        process.stdout.write("Sutarčių pakeitimų nerasta.\n");
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
        .catch((error) => {
            console.error(`Nepavyko parodyti sutarčių pakeitimų: ${error.message}`);
            process.exitCode = 1;
        })
        .finally(async () => {
            await postgres.end();
        });
}
