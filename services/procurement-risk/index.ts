import { execSync } from "node:child_process";
import { postgres } from "../../postgres/postgres.js";
import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import { runEvaluation } from "./runJob.ts";

// Procurement Risk Service entry point — one sequential evaluation run per
// invocation (risk-service-architecture.md §5: "one single sequential job").
// Not a long-lived daemon yet; a scheduler wrapper is a later step once more
// than one indicator exists (§1.2 discusses process isolation, not
// scheduling shape). Usage: `npm run risk:run` or
// `node services/procurement-risk/index.ts [subject1 subject2 ...]`.

const LOCK_KEY = "procurement-risk-service";

function resolveCodeCommit(): string {
    try {
        return execSync("git rev-parse HEAD", { cwd: import.meta.dirname, encoding: "utf8" }).trim();
    } catch {
        return "unknown";
    }
}

async function main(): Promise<void> {
    const subjects = process.argv.slice(2);
    const client = await riskDb.connect();
    try {
        const lock = await client.query("SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked", [LOCK_KEY]);
        if (!lock.rows[0]?.locked) {
            throw new Error("Another Procurement Risk Service run is already in progress");
        }

        const result = await runEvaluation({
            codeCommit: resolveCodeCommit(),
            subjects: subjects.length > 0 ? subjects : null,
        });

        log(`procurement-risk: run ${result.runId} ${result.status}`);
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
        await Promise.all([postgres.end(), riskDb.end()]);
    });
