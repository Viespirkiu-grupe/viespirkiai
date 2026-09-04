import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { runEvaluation } from "./runJob.ts";

// Procurement Risk Service entry point — one sequential evaluation run per
// invocation (risk-service-architecture.md §5: "one single sequential job").
// Not a long-lived daemon yet; a scheduler wrapper is a later step once more
// than one indicator exists (§1.2 discusses process isolation, not
// scheduling shape). Usage:
//   npm run risk:run                            — full run, every subject
//   npm run risk:run -- <pirkimoNumeris...>      — only the named procurements
//   npm run risk:run -- --limit 20               — capped test-flight run:
//     samples 20 real ATN-1 procurement ids (deterministic, so the run is
//     repeatable) and evaluates every deployed indicator against only those.

const LOCK_KEY = "procurement-risk-service";

/**
 * `--limit N`'s sample: the first N distinct ATN-1 procurement ids, ordered
 * by id, so a test-flight run can be repeated and its numbers compared.
 * Every deployed indicator today reads `ppa."ataskaitos"` (via
 * public.v_dalyviai, LT-COM-01/02/03) and filters $2 against its
 * `pirkimoNumeris`, so this is the shared subject universe to cap. An
 * indicator over a different source table would need its own sampling —
 * this is a convenience for today's ATN-1-only catalogue, not a general
 * subject sampler.
 */
async function sampleAtn1Subjects(limit: number): Promise<readonly string[]> {
    const { rows } = await postgres.query<{ pirkimoNumeris: string }>(
        `SELECT DISTINCT "pirkimoNumeris" FROM ppa."ataskaitos" ORDER BY "pirkimoNumeris" LIMIT $1`,
        [limit],
    );
    return rows.map((row) => row.pirkimoNumeris);
}

/**
 * Parsed by hand rather than through utils/cliArgs.js: that helper's
 * `positional()` does not exclude an option's own value (`--limit 20` would
 * leave "20" in the positional list too), which would silently corrupt the
 * "explicit subject ids" path here.
 */
async function resolveSubjects(argv: readonly string[]): Promise<readonly string[] | null> {
    const limitIndex = argv.indexOf("--limit");
    if (limitIndex === -1) {
        return argv.length > 0 ? argv : null;
    }

    const raw = argv[limitIndex + 1];
    if (!/^\d+$/.test(raw ?? "") || Number(raw) < 1) {
        throw new Error("--limit must be followed by a positive integer");
    }
    const rest = [...argv.slice(0, limitIndex), ...argv.slice(limitIndex + 2)];
    if (rest.length > 0) {
        throw new Error("Pass either explicit subject ids or --limit, not both");
    }

    const subjects = await sampleAtn1Subjects(Number(raw));
    log(`procurement-risk: --limit ${raw} → ${subjects.length} sampled subject(s)`);
    return subjects;
}

async function main(): Promise<void> {
    const subjects = await resolveSubjects(process.argv.slice(2));
    const client = await postgres.connect();
    try {
        const lock = await client.query("SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked", [LOCK_KEY]);
        if (!lock.rows[0]?.locked) {
            throw new Error("Another Procurement Risk Service run is already in progress");
        }

        const result = await runEvaluation({
            subjects,
        });

        log(`procurement-risk: run ${result.status}`);
        console.log(JSON.stringify(result, null, 2));

        if (result.status !== "succeeded") {
            process.exitCode = 1;
        }
    } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [LOCK_KEY]);
        client.release();
    }
}

main()
    .catch((err) => {
        console.error("Procurement Risk Service run failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await postgres.end();
    });
