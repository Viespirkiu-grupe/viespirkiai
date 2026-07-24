import { postgres } from "../../postgres/postgres.js";
import { createArgReader } from "../../utils/cliArgs.js";
import { runPool } from "../../utils/workerPool.js";
import { cvpIsScrpeById } from "./atnaujintiPagalUnikalu.js";

// Neseniai matytų sutarčių perskrapinimas (pvz. po incidento, kai dalis įrašų
// nusėdo nepilni).
//   npm run sutartys:rescrape-recent -- [minutės] [concurrency] [--dry-run]

const { flag, positional } = createArgReader(process.argv.slice(2));
const pos = positional();
const dryRun = flag("--dry-run");
const minutes = Number(pos[0] ?? 15);
const concurrency = Number(pos[1] ?? 5);

if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error("Minutes must be a positive integer");
}
if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("Concurrency must be a positive integer");
}

const snapshot = await postgres.query(
    `SELECT "unikalusId"
       FROM "vpmSutartysAtnaujinimai"
      WHERE "matyta" >=
            (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Vilnius')
            - make_interval(mins => $1)
        AND "matyta" <=
            (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Vilnius')
      ORDER BY "matyta", "unikalusId"`,
    [minutes],
);

const ids = snapshot.rows.map((row) => String(row.unikalusId));
console.log(
    `Rescraping ${ids.length} contracts seen in the last ${minutes} minutes ` +
        `with concurrency=${concurrency}`,
);

if (dryRun) {
    console.log("Dry run: no contracts were rescraped");
    await postgres.end();
    process.exit(0);
}

let completed = 0;
const failures = [];

try {
    await runPool(
        ids,
        async (id) => {
            try {
                const result = await cvpIsScrpeById(id);
                if (result.count !== 1) {
                    throw new Error(`Expected one contract, received ${result.count}`);
                }
            } catch (error) {
                failures.push({ id, error: error?.message ?? String(error) });
                console.error(`[${id}] ${error?.stack ?? error}`);
            } finally {
                completed++;
                if (completed % 25 === 0 || completed === ids.length) {
                    console.log(
                        `Progress: ${completed}/${ids.length}, failed=${failures.length}`,
                    );
                }
            }
        },
        concurrency,
    );
} finally {
    await postgres.end();
}

if (failures.length > 0) {
    console.error(`Failed contracts (${failures.length}):`);
    for (const failure of failures) {
        console.error(`${failure.id}\t${failure.error}`);
    }
    process.exitCode = 1;
} else {
    console.log(`Successfully rescraped ${completed} contracts`);
}
