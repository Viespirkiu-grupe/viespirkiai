export class Worker {
    #taskName;
    #jobFn;
    #cooldown;
    #errorCooldown;
    #priority;
    #staggerMs;
    #onAdmit;
    #onRelease;
    #onSuccess;

    #abortController = null;
    #waitCycles = 0;
    #wakeWaiters = new Set();

    constructor({ taskName, jobFn, cooldown, errorCooldown, priority, staggerMs, onAdmit, onRelease, onSuccess }) {
        this.#taskName = taskName;
        this.#jobFn = jobFn;
        this.#cooldown = cooldown * 1000;
        this.#errorCooldown = errorCooldown * 1000;
        this.#priority = priority;
        this.#staggerMs = staggerMs;
        this.#onAdmit = onAdmit;
        this.#onRelease = onRelease;
        this.#onSuccess = onSuccess ?? null;
    }

    get taskName() { return this.#taskName; }
    get priority() { return this.#priority; }
    get waitCycles() { return this.#waitCycles; }
    get isRunning() { return this.#abortController !== null; }

    // Effective priority with aging — increases 0.1 per wait cycle to prevent starvation
    get effectivePriority() {
        return this.#priority + this.#waitCycles * 0.1;
    }

    resetWaitCycles() {
        this.#waitCycles = 0;
    }

    incrementWaitCycles() {
        this.#waitCycles++;
    }

    start(workerIndex = 0) {
        if (this.#abortController) return;
        this.#abortController = new AbortController();
        this.#run(workerIndex);
    }

    stop() {
        if (!this.#abortController) return;
        this.#abortController.abort();
        this.#abortController = null;
    }

    wake() {
        // Wake any cooldown/error sleeps without restarting the worker loop.
        const waiters = [...this.#wakeWaiters];
        for (const wake of waiters) wake();
    }

    async #run(workerIndex) {
        const signal = this.#abortController.signal;

        // Stagger startup to avoid DB stampede
        if (this.#staggerMs && workerIndex > 0) {
            await sleep(workerIndex * this.#staggerMs, signal);
            if (signal.aborted) return;
        }

        while (!signal.aborted) {
            // Wait for runner to admit this worker based on priority + capacity
            await this.#onAdmit(this, signal);
            if (signal.aborted) { this.#onRelease(); break; }

            this.resetWaitCycles();

            try {
                const hasMore = await this.#jobFn();
                this.#onRelease();
                if (this.#onSuccess) this.#onSuccess();

                if (hasMore === false) {
                    await this.#sleepWithWake(this.#cooldown, signal);
                }
                // if hasMore is true/undefined, loop immediately
            } catch (err) {
                this.#onRelease();
                console.error(`[${this.#taskName}] job failed:`, err);
                await this.#sleepWithWake(this.#errorCooldown, signal);
            }
        }
    }

    #sleepWithWake(ms, signal) {
        return new Promise((resolve) => {
            if (signal?.aborted) return resolve();

            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.#wakeWaiters.delete(wake);
                signal?.removeEventListener("abort", onAbort);
                resolve();
            };

            const onAbort = () => finish();
            const wake = () => finish();
            const timer = setTimeout(finish, ms);

            this.#wakeWaiters.add(wake);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }
}

export function sleep(ms, signal) {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
}
