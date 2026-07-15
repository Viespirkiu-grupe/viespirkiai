import { postgres } from "../postgres/postgres.js";
import { cvpIsScrpeById } from "../modules/sutartys/atnaujintiPagalUnikalu.js";

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
const minutes = Number(positional[0] ?? 15);
const concurrency = Number(positional[1] ?? 5);

if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error("Minutes must be a positive integer");
}
if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("Concurrency must be a positive integer");
}

const snapshot = await postgres.query(
    `SELECT "sutartiesUnikalusId"
       FROM "sutartysAtnaujinimai"
      WHERE "paskutiniKartaMatyta" >=
            (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Vilnius')
            - make_interval(mins => $1)
        AND "paskutiniKartaMatyta" <=
            (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Vilnius')
      ORDER BY "paskutiniKartaMatyta", "sutartiesUnikalusId"`,
    [minutes],
);

const ids = snapshot.rows.map((row) => String(row.sutartiesUnikalusId));
console.log(
    `Rescraping ${ids.length} contracts seen in the last ${minutes} minutes ` +
        `with concurrency=${concurrency}`,
);

if (dryRun) {
    console.log("Dry run: no contracts were rescraped");
    await postgres.end();
    process.exit(0);
}

let cursor = 0;
let completed = 0;
const failures = [];

async function worker() {
    while (true) {
        const index = cursor++;
        if (index >= ids.length) return;
        const id = ids[index];

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
    }
}

try {
    await Promise.all(
        Array.from(
            { length: Math.min(concurrency, ids.length) },
            () => worker(),
        ),
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
