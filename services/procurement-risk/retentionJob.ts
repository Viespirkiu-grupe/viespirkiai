import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import { deleteExpiredSnapshots, RETENTION_INTERVAL } from "./retention.ts";

// Entry point for the scheduled retention job (risk-service-architecture.md
// §7.3). Runs outside the evaluation run, so a slow sweep never delays a run
// and a failed sweep never fails one.
//
// Usage: `npm run risk:retention`.

async function main(): Promise<void> {
    const client = await riskDb.connect();
    try {
        await client.query("BEGIN");
        const stats = await deleteExpiredSnapshots(client);
        await client.query("COMMIT");
        log(
            `procurement-risk: retention (${RETENTION_INTERVAL}) — ${stats.runsCleared} run(s), ${stats.signalsDeleted} signal(s) deleted`,
        );
        console.log(JSON.stringify(stats, null, 2));
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

main()
    .catch((err) => {
        console.error("Procurement Risk Service retention failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await riskDb.end();
    });
