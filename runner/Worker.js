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
    #onStopped;

    #abortController = null;
    #stopping = false;
    #wakeWaiters = new Set();

    constructor({
        taskName,
        jobFn,
        cooldown,
        errorCooldown,
        priority,
        staggerMs,
        onAdmit,
        onRelease,
        onSuccess,
        onStopped,
    }) {
        this.#taskName = taskName;
        this.#jobFn = jobFn;
        this.#cooldown = cooldown * 1000;
        this.#errorCooldown = errorCooldown * 1000;
        this.#priority = priority;
        this.#staggerMs = staggerMs;
        this.#onAdmit = onAdmit;
        this.#onRelease = onRelease;
        this.#onSuccess = onSuccess ?? null;
        this.#onStopped = onStopped ?? null;
    }

    get taskName() { return this.#taskName; }
    get priority() { return this.#priority; }
    get isRunning() { return this.#abortController !== null; }
    get isStopping() { return this.#stopping; }

    start(workerIndex = 0) {
        if (this.#abortController) return;
        this.#abortController = new AbortController();
        this.#stopping = false;
        void this.#run(workerIndex).catch((err) => {
            console.error(`[${this.#taskName}] worker loop failed:`, err);
        }).finally(() => {
            this.#abortController = null;
            this.#stopping = false;
            this.#onStopped?.(this);
        });
    }

    stop() {
        if (!this.#abortController || this.#stopping) return;
        this.#stopping = true;
        this.#abortController.abort();
    }

    wake() {
        // Wake any cooldown/error sleeps without restarting the worker loop.
        const waiters = [...this.#wakeWaiters];
        for (const wake of waiters) wake();
    }

    async #run(workerIndex) {
        const signal = this.#abortController.signal;

        // Stagger startup to avoid DB stampede.
        if (this.#staggerMs && workerIndex > 0) {
            await sleep(workerIndex * this.#staggerMs, signal);
            if (signal.aborted) return;
        }

        while (!signal.aborted) {
            // Admission returns false when this worker is cancelled while queued.
            const admitted = await this.#onAdmit(this, signal);
            if (!admitted) break;

            let hasMore;
            let succeeded = false;
            try {
                hasMore = await this.#jobFn();
                succeeded = true;
            } catch (err) {
                console.error(`[${this.#taskName}] job failed:`, err);
            } finally {
                // Exactly one release for every successful admission.
                this.#onRelease();
            }

            if (!succeeded) {
                await this.#sleepWithWake(this.#errorCooldown, signal);
                continue;
            }

            if (this.#onSuccess) {
                try {
                    await this.#onSuccess();
                } catch (err) {
                    // The job already completed. Do not replay it just because its hook failed.
                    console.error(`[${this.#taskName}] success hook failed:`, err);
                }
            }

            if (hasMore === false) {
                await this.#sleepWithWake(this.#cooldown, signal);
            }
            // If hasMore is true/undefined, loop immediately.
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

        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            resolve();
        };
        const onAbort = () => finish();
        const timer = setTimeout(finish, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
