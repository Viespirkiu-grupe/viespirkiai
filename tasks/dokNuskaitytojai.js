import { postgres } from "../postgres/postgres.js";
import { nuskaitytiVienoDokumentoDuomenis } from "../modules/failai/nuskaitytiTeksta.js";
import { log } from "../utils/log.js";
import { WORK_SIGNALS } from "../utils/taskSignals.js";

const DOK_TASK_PREFIX = "nuskaitytiDokumenta";
const SYNC_INTERVAL_MS = 10_000;

/**
 * Registers a dynamic task for a dokNuskaitytojas row.
 * The task itself is registered into the runner so setWorkerCount can manage it.
 */
function buildDokTask(runner, row) {
    const name = `${DOK_TASK_PREFIX}-${row.id}`;

    // Register task def if not already known to the runner
    if (!runner.hasTask(name)) {
        runner.register({
            name,
            mode: "asap",
            priority: 5,
            concurrency: row.concurrency,
            cooldown: 10,
            errorCooldown: 1,
            wakeOn: [WORK_SIGNALS.FILES_EXTRACTION_READY],
            job: () => nuskaitytiVienoDokumentoDuomenis(row.id),
        });
    }

    return { name, concurrency: row.concurrency };
}

export function startDokNuskaitytojai(runner) {
    let stopped = false;
    let syncPromise = null;

    async function sync() {
        if (stopped) return;
        try {
            const { rows } = await postgres.query(`
                SELECT * FROM "dokNuskaitytojai" WHERE enabled = true
            `);
            if (stopped) return;

            const desired = new Map(
                rows.map((row) => {
                    const { name, concurrency } = buildDokTask(runner, row);
                    return [name, concurrency];
                })
            );

            // Scale up/down workers per task
            for (const [name, count] of desired) {
                runner.setWorkerCount(name, count);
            }

            // Stop tasks that are no longer in DB
            for (const taskName of runner.taskNames()) {
                if (taskName.startsWith(DOK_TASK_PREFIX) && !desired.has(taskName)) {
                    log(`[dokNuskaitytojai] stopping removed task: ${taskName}`);
                    runner.setWorkerCount(taskName, 0);
                }
            }
        } catch (err) {
            console.error("[dokNuskaitytojai] sync failed:", err);
        }
    }

    function runSync() {
        if (stopped || syncPromise) return;
        syncPromise = sync().finally(() => {
            syncPromise = null;
        });
    }

    runSync(); // initial
    const interval = setInterval(runSync, SYNC_INTERVAL_MS);

    return async () => {
        stopped = true;
        clearInterval(interval);
        await syncPromise;
    };
}
