import { Worker, sleep } from "./Worker.js";
import { log } from "../utils/log.js";
import cron from "node-cron";

const SCHEDULER_INTERVAL_MS = 100; // how often priority queue is re-evaluated

export class TaskRunner {
    #tasks = new Map();           // name -> task def
    #workers = new Map();         // workerKey -> Worker
    #waitingWorkers = new Set();  // workers blocked on admission
    #activeJobs = 0;
    #maxConcurrentJobs;
    #nudgeTimers = new Map();     // taskName -> timer (for nudge())

    constructor({ maxConcurrentJobs = 20 } = {}) {
        this.#maxConcurrentJobs = maxConcurrentJobs;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    register(taskDef) {
        const def = withDefaults(taskDef);
        this.#tasks.set(def.name, def);
        return this;
    }

    registerAll(taskDefs) {
        for (const def of taskDefs) this.register(def);
        return this;
    }

    start() {
        for (const [, def] of this.#tasks) {
            if (def.mode === "asap") {
                this.setWorkerCount(def.name, def.concurrency);
            } else if (def.schedule) {
                this.#scheduleCron(def);
            } else {
                console.error(`[TaskRunner] Task "${def.name}" has no mode and no schedule — skipped`);
            }
        }

        this.#runScheduler();
        log("[TaskRunner] started");
    }

    /**
     * Scale workers for a task up or down — safe to call at any time.
     * Used by dynamic task syncing (e.g. dokNuskaitytojai).
     */
    setWorkerCount(taskName, count) {
        const def = this.#tasks.get(taskName);
        if (!def) throw new Error(`Unknown task: ${taskName}`);

        const existing = this.#workersForTask(taskName);

        if (count > existing.length) {
            for (let i = existing.length; i < count; i++) {
                this.#spawnWorker(def, i);
            }
        } else if (count < existing.length) {
            const toStop = existing.slice(count);
            for (const [key, worker] of toStop) {
                worker.stop();
                this.#workers.delete(key);
                this.#waitingWorkers.delete(worker);
            }
        }
    }

    /**
     * Wake sleeping workers for a task immediately without respawning them.
     * Useful after a trigger task produces work for a downstream task.
     */
    nudge(taskName) {
        const workers = this.#workersForTask(taskName);

        if (workers.length > 0) {
            for (const [, worker] of workers) {
                worker.wake();
            }
            return;
        }

        // If workers are currently scaled to 0, spawn the configured baseline.
        const def = this.#tasks.get(taskName);
        if (def?.mode === "asap" && def.concurrency > 0) {
            this.setWorkerCount(taskName, def.concurrency);
        }
    }

    activeJobCount() {
        return this.#activeJobs;
    }

    hasTask(name) {
        return this.#tasks.has(name);
    }

    taskNames() {
        return this.#tasks.keys();
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    #spawnWorker(def, index) {
        const key = `${def.name}#${index}`;
        if (this.#workers.has(key)) return;

        const worker = new Worker({
            taskName: def.name,
            jobFn: def.job,
            cooldown: def.cooldown,
            errorCooldown: def.errorCooldown,
            priority: def.priority,
            staggerMs: def.staggerMs,
            onAdmit: (w, signal) => this.#waitForAdmission(w, signal),
            onRelease: () => { this.#activeJobs = Math.max(0, this.#activeJobs - 1); },
            onSuccess: def.onSuccess ? () => def.onSuccess(this) : null,
        });

        this.#workers.set(key, worker);
        worker.start(index);
        log(`[TaskRunner] spawned worker ${key} (priority=${def.priority})`);
    }

    #workersForTask(taskName) {
        const result = [];
        for (const [key, worker] of this.#workers) {
            if (worker.taskName === taskName) result.push([key, worker]);
        }
        return result;
    }

    /**
     * Each worker calls this and awaits it. The scheduler resolves these
     * promises in priority order when slots are available.
     */
    #waitForAdmission(worker, signal) {
        return new Promise((resolve) => {
            const entry = { worker, resolve, signal };

            this.#waitingWorkers.add(entry);

            signal.addEventListener("abort", () => {
                this.#waitingWorkers.delete(entry);
                resolve(); // let the worker loop exit cleanly
            }, { once: true });
        });
    }

    /**
     * Core scheduler loop — runs every SCHEDULER_INTERVAL_MS.
     * Sorts waiting workers by effectivePriority, admits as many as capacity allows,
     * and increments waitCycles for those still waiting (aging).
     */
    #runScheduler() {
        setInterval(() => {
            const available = this.#maxConcurrentJobs - this.#activeJobs;
            if (available <= 0 || this.#waitingWorkers.size === 0) {
                // Age workers that are still waiting
                for (const { worker } of this.#waitingWorkers) {
                    worker.incrementWaitCycles();
                }
                return;
            }

            // Sort by effectivePriority descending
            const sorted = [...this.#waitingWorkers].sort(
                (a, b) => b.worker.effectivePriority - a.worker.effectivePriority
            );

            let admitted = 0;
            for (const entry of sorted) {
                if (admitted >= available) break;
                if (entry.signal.aborted) {
                    this.#waitingWorkers.delete(entry);
                    continue;
                }

                this.#waitingWorkers.delete(entry);
                this.#activeJobs++;
                admitted++;
                entry.worker.resetWaitCycles();
                entry.resolve();
            }

            // Age remaining waiters
            for (const { worker } of this.#waitingWorkers) {
                worker.incrementWaitCycles();
            }
        }, SCHEDULER_INTERVAL_MS);
    }

    #scheduleCron(def) {
        if (!def.schedule) return;
        let running = false;
        cron.schedule(def.schedule, async () => {
            if (running) return;
            running = true;
            try {
                await def.job();
            } catch (err) {
                console.error(`[TaskRunner] cron task "${def.name}" failed:`, err.message);
            } finally {
                running = false;
            }
        });
        log(`[TaskRunner] scheduled cron task: ${def.name} (${def.schedule})`);
    }
}

function withDefaults(def) {
    return {
        concurrency: 1,
        cooldown: 60,
        errorCooldown: 60,
        priority: 5,
        staggerMs: 500,
        mode: null,
        schedule: null,
        ...def,
    };
}
