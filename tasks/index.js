import { TaskRunner } from "../runner/TaskRunner.js";
import { startDokNuskaitytojai } from "./dokNuskaitytojai.js";
import { postgres } from "../postgres/postgres.js";
import { closeNats } from "../utils/natsHub.js";

import tedTasks from "./ted.js";
import sutartysTasks from "./sutartys.js";
import failaiTasks from "./failai.js";
import dokumentaiTasks from "./dokumentai.js";
import viesiejiPirkimaiTasks from "./viesiejiPirkimai.js";
import adpTasks from "./adp.js";
import miscTasks from "./misc.js";
import eTarTasks from "./eTar.js";
import eSeimasTasks from "./eSeimas.js";

// Pool size - 2 reserved for cron jobs and admin queries
const runner = new TaskRunner({ maxConcurrentJobs: 18 });

runner.registerAll([
    ...tedTasks,
    ...sutartysTasks,
    ...failaiTasks,
    ...dokumentaiTasks,
    ...viesiejiPirkimaiTasks,
    ...adpTasks,
    ...miscTasks,
    ...eTarTasks,
    ...eSeimasTasks,
]);

runner.start();

// Dynamic dokNuskaitytojai workers — synced from DB every 10s
const stopDokNuskaitytojai = startDokNuskaitytojai(runner);

let shuttingDown = false;
let forceExitArmed = false;
let shutdownStartedAt = 0;
const DUPLICATE_SIGNAL_WINDOW_MS = 1_000;
// Kai kurie parsisiuntimai teisėtai trunka kelias minutes. Pirmas signalas jų
// nenukerta; apsauga skirta tik realiai pakibusiam shutdown'ui.
const FORCE_TIMEOUT_MS = 10 * 60_000;

async function shutdown(signal) {
    if (forceExitArmed) {
        // startTaskRunner.sh persiunčia terminalo signalą vaikui. Kai kuriuose
        // job-control režimuose Node tą patį signalą jau būna gavęs tiesiogiai,
        // todėl abu pristatymai gali ateiti beveik vienu metu. Tai vienas Ctrl+C,
        // ne vartotojo prašymas nutraukti priverstinai.
        if (Date.now() - shutdownStartedAt < DUPLICATE_SIGNAL_WINDOW_MS) return;
        console.error(`[TaskRunner] ${signal} gautas dar kartą – išeiname iš karto`);
        process.exit(130);
    }
    if (shuttingDown) return;

    shuttingDown = true;
    forceExitArmed = true;
    shutdownStartedAt = Date.now();
    console.log(`[TaskRunner] ${signal} gautas – baigiame vykstančius darbus…`);

    const forceTimer = setTimeout(() => {
        console.error(`[TaskRunner] nepavyko sustoti per ${FORCE_TIMEOUT_MS / 1000}s – išeiname priverstinai`);
        process.exit(1);
    }, FORCE_TIMEOUT_MS);
    forceTimer.unref();

    try {
        await stopDokNuskaitytojai();
        await runner.stop();
        await closeNats();
        await postgres.end();
        clearTimeout(forceTimer);
        console.log("[TaskRunner] graceful shutdown baigtas");
        process.exit(0);
    } catch (error) {
        console.error("[TaskRunner] shutdown klaida:", error);
        process.exit(1);
    }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
