import { Worker } from "./Worker.js";
import { log } from "../utils/log.js";
import cron from "node-cron";

// The previous scheduler added 0.1 priority every 100 ms.
const PRIORITY_AGING_PER_MS = 1 / 1000;

export class TaskRunner {
    #tasks = new Map();                // name -> task def
    #workers = new Map();              // workerKey -> Worker (including stopping workers)
    #desiredWorkerCounts = new Map();  // taskName -> desired count
    #waitingWorkers = new Set();       // admission entries
    #activeJobs = 0;
    #maxConcurrentJobs;
    #nextQueueSequence = 0;
    #started = false;
    #dispatchPaused = false;

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
        if (this.#started) return;
        this.#started = true;
        this.#dispatchPaused = true;

        try {
            for (const [, def] of this.#tasks) {
                if (def.mode === "asap") {
                    this.setWorkerCount(def.name, def.concurrency);
                } else if (def.schedule) {
                    this.#scheduleCron(def);
                } else {
                    console.error(`[TaskRunner] Task "${def.name}" has no mode and no schedule — skipped`);
                }
            }
        } finally {
            this.#dispatchPaused = false;
        }

        this.#dispatch();
        log("[TaskRunner] started");
    }

    /**
     * Scale workers for a task up or down — safe to call at any time.
     * A worker finishing an in-flight job remains tracked until it stops, so a
     * fast down/up sequence cannot create a duplicate worker for the same slot.
     */
    setWorkerCount(taskName, count) {
        const def = this.#tasks.get(taskName);
        if (!def) throw new Error(`Unknown task: ${taskName}`);
        const normalizedCount = typeof count === "string" && count.trim() !== ""
            ? Number(count)
            : count;
        if (!Number.isInteger(normalizedCount) || normalizedCount < 0) {
            throw new Error(`Worker count for ${taskName} must be an integer >= 0`);
        }

        this.#desiredWorkerCounts.set(taskName, normalizedCount);
        this.#reconcileWorkers(def);
    }

    /** Wake sleeping workers for a task immediately without respawning them. */
    nudge(taskName) {
        const workers = this.#workersForTask(taskName);

        if (workers.length > 0) {
            for (const [, worker] of workers) worker.wake();
            return;
        }

        const def = this.#tasks.get(taskName);
        const desired = this.#desiredWorkerCounts.get(taskName);
        // An explicit zero means the task was disabled by dynamic syncing.
        // Do not let a downstream success hook silently re-enable it.
        if (def?.mode === "asap" && desired !== 0 && def.concurrency > 0) {
            this.setWorkerCount(taskName, desired ?? def.concurrency);
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

    #reconcileWorkers(def) {
        const desired = this.#desiredWorkerCounts.get(def.name) ?? 0;
        const existing = this.#workersForTask(def.name);

        if (existing.length > desired) {
            // Stop highest indexes first. Keep them in the map until their
            // current work completes and #handleWorkerStopped runs.
            for (const [, worker] of existing.slice(desired)) worker.stop();
            return;
        }

        if (existing.length < desired) {
            const occupied = new Set(existing.map(([key]) => Number(key.slice(key.lastIndexOf("#") + 1))));
            for (let index = 0; this.#workersForTask(def.name).length < desired; index++) {
                if (!occupied.has(index)) {
                    occupied.add(index);
                    this.#spawnWorker(def, index);
                }
            }
        }
    }

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
            onRelease: () => this.#releaseJob(),
            onSuccess: def.onSuccess ? () => def.onSuccess(this) : null,
            onStopped: (w) => this.#handleWorkerStopped(key, w, def),
        });

        this.#workers.set(key, worker);
        worker.start(index);
        log(`[TaskRunner] spawned worker ${key} (priority=${def.priority})`);
    }

    #handleWorkerStopped(key, worker, def) {
        if (this.#workers.get(key) !== worker) return;
        this.#workers.delete(key);
        this.#reconcileWorkers(def);
    }

    #workersForTask(taskName) {
        const result = [];
        for (const [key, worker] of this.#workers) {
            if (worker.taskName === taskName) result.push([key, worker]);
        }
        result.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
        return result;
    }

    /**
     * Queue a worker for admission. Abort listeners are removed as soon as an
     * entry is admitted so long-lived workers do not accumulate listeners.
     */
    #waitForAdmission(worker, signal) {
        if (signal.aborted) return Promise.resolve(false);

        return new Promise((resolve) => {
            const entry = {
                worker,
                resolve,
                signal,
                enqueuedAt: Date.now(),
                sequence: this.#nextQueueSequence++,
                onAbort: null,
            };
            entry.onAbort = () => {
                if (!this.#waitingWorkers.delete(entry)) return;
                resolve(false);
            };

            this.#waitingWorkers.add(entry);
            signal.addEventListener("abort", entry.onAbort, { once: true });
            this.#dispatch();
        });
    }

    /** Dispatch only in response to queue/capacity changes; no polling timer. */
    #dispatch() {
        if (this.#dispatchPaused) return;
        let available = this.#maxConcurrentJobs - this.#activeJobs;
        if (available <= 0 || this.#waitingWorkers.size === 0) return;

        const now = Date.now();
        const sorted = [...this.#waitingWorkers].sort((a, b) => {
            const aPriority = a.worker.priority + (now - a.enqueuedAt) * PRIORITY_AGING_PER_MS;
            const bPriority = b.worker.priority + (now - b.enqueuedAt) * PRIORITY_AGING_PER_MS;
            return bPriority - aPriority || a.sequence - b.sequence;
        });

        for (const entry of sorted) {
            if (available <= 0) break;
            if (!this.#waitingWorkers.delete(entry)) continue;
            entry.signal.removeEventListener("abort", entry.onAbort);
            if (entry.signal.aborted) {
                entry.resolve(false);
                continue;
            }

            this.#activeJobs++;
            available--;
            entry.resolve(true);
        }
    }

    #releaseJob() {
        if (this.#activeJobs <= 0) {
            console.error("[TaskRunner] attempted to release a job with no active jobs");
            return;
        }
        this.#activeJobs--;
        this.#dispatch();
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
