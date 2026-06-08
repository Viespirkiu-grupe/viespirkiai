import { TaskRunner } from "../runner/TaskRunner.js";
import { startDokNuskaitytojai } from "./dokNuskaitytojai.js";

import tedTasks from "./ted.js";
import sutartysTasks from "./sutartys.js";
import failaiTasks from "./failai.js";
import dokumentaiTasks from "./dokumentai.js";
import viesiejiPirkimaiTasks from "./viesiejiPirkimai.js";
import adpTasks from "./adp.js";
import miscTasks from "./misc.js";

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
]);

runner.start();

// Dynamic dokNuskaitytojai workers — synced from DB every 10s
startDokNuskaitytojai(runner);
