import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nats = vi.hoisted(() => ({
    subscriptions: [] as Array<{
        subject: string;
        handler: () => void;
        options: { queue?: string };
        unsubscribe: ReturnType<typeof vi.fn>;
    }>,
}));

vi.mock("../utils/natsHub.js", () => ({
    subscribe: vi.fn((subject: string, handler: () => void, options: { queue?: string }) => {
        const unsubscribe = vi.fn();
        nats.subscriptions.push({ subject, handler, options, unsubscribe });
        return unsubscribe;
    }),
}));

import { TaskRunner } from "../runner/TaskRunner.js";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("TaskRunner", () => {
    beforeEach(() => {
        nats.subscriptions.length = 0;
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("admits startup workers in priority order without a polling interval", async () => {
        const order: string[] = [];
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.registerAll([
            { name: "low", mode: "asap", priority: 1, cooldown: 3600, job: async () => { order.push("low"); return false; } },
            { name: "high", mode: "asap", priority: 10, cooldown: 3600, job: async () => { order.push("high"); return false; } },
        ]);

        runner.start();
        await flush();

        expect(order).toEqual(["high", "low"]);
        expect(runner.activeJobCount()).toBe(0);
        runner.setWorkerCount("low", 0);
        runner.setWorkerCount("high", 0);
        await flush();
    });

    it("preserves priority aging using queue time", async () => {
        const blocker = deferred<boolean>();
        const order: string[] = [];
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.registerAll([
            { name: "blocker", mode: "asap", priority: 20, cooldown: 3600, job: () => blocker.promise },
            { name: "old-low", mode: "asap", priority: 1, cooldown: 3600, job: async () => { order.push("old-low"); return false; } },
            { name: "new-high", mode: "asap", concurrency: 0, priority: 10, cooldown: 3600, job: async () => { order.push("new-high"); return false; } },
        ]);
        runner.start();
        await flush();

        vi.setSystemTime(new Date("2026-01-01T00:00:09.500Z"));
        runner.setWorkerCount("new-high", 1);
        vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));
        blocker.resolve(false);
        await flush();

        expect(order).toEqual(["old-low", "new-high"]);
        for (const name of ["blocker", "old-low", "new-high"]) runner.setWorkerCount(name, 0);
        await flush();
    });

    it("does not release another job's slot when a waiter is cancelled", async () => {
        const blocker = deferred<boolean>();
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.registerAll([
            { name: "blocker", mode: "asap", priority: 10, job: () => blocker.promise },
            { name: "waiter", mode: "asap", priority: 1, job: async () => false },
        ]);
        runner.start();
        await flush();
        expect(runner.activeJobCount()).toBe(1);

        runner.setWorkerCount("waiter", 0);
        await flush();
        expect(runner.activeJobCount()).toBe(1);

        blocker.resolve(false);
        await flush();
        expect(runner.activeJobCount()).toBe(0);
        runner.setWorkerCount("blocker", 0);
        await flush();
    });

    it("waits for a stopping job before replacing it during rapid down/up scaling", async () => {
        const first = deferred<boolean>();
        let calls = 0;
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.register({
            name: "dynamic",
            mode: "asap",
            cooldown: 3600,
            job: async () => {
                calls++;
                return calls === 1 ? first.promise : false;
            },
        });
        runner.start();
        await flush();
        expect(calls).toBe(1);

        runner.setWorkerCount("dynamic", 0);
        runner.setWorkerCount("dynamic", 1);
        await flush();
        expect(calls).toBe(1);

        first.resolve(false);
        await flush();
        expect(calls).toBe(2);
        runner.setWorkerCount("dynamic", 0);
        await flush();
    });

    it("starts only once", async () => {
        let calls = 0;
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.register({ name: "once", mode: "asap", cooldown: 3600, job: async () => { calls++; return false; } });
        runner.start();
        runner.start();
        await flush();
        expect(calls).toBe(1);
        runner.setWorkerCount("once", 0);
        await flush();
    });

    it("accepts PostgreSQL integer strings for dynamic concurrency", async () => {
        let calls = 0;
        const runner = new TaskRunner({ maxConcurrentJobs: 2 });
        runner.register({
            name: "db-count",
            mode: "asap",
            concurrency: "2" as unknown as number,
            staggerMs: 0,
            cooldown: 3600,
            job: async () => { calls++; return false; },
        });

        runner.start();
        await flush();
        expect(calls).toBe(2);
        runner.setWorkerCount("db-count", 0);
        await flush();
    });

    it("wakes a sleeping task from its NATS queue subscription", async () => {
        let calls = 0;
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.register({
            name: "signalled",
            mode: "asap",
            cooldown: 3600,
            wakeOn: ["work.ready"],
            job: async () => { calls++; return false; },
        });
        runner.start();
        await flush();
        expect(calls).toBe(1);

        expect(nats.subscriptions).toHaveLength(1);
        expect(nats.subscriptions[0]).toMatchObject({
            subject: "work.ready",
            options: { queue: "taskrunner.signalled" },
        });
        nats.subscriptions[0].handler();
        await flush();
        expect(calls).toBe(2);

        runner.setWorkerCount("signalled", 0);
        await flush();
        expect(nats.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    });

    it("has no public local nudge API", () => {
        const runner = new TaskRunner();
        expect("nudge" in runner).toBe(false);
    });

    it("graceful stop waits for the active job and starts no next job", async () => {
        const active = deferred<boolean>();
        let calls = 0;
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.register({
            name: "graceful",
            mode: "asap",
            cooldown: 3600,
            wakeOn: ["work.graceful"],
            job: async () => {
                calls++;
                return active.promise;
            },
        });

        runner.start();
        await flush();
        expect(calls).toBe(1);

        let stopped = false;
        const stopPromise = runner.stop().then(() => { stopped = true; });
        await flush();
        expect(stopped).toBe(false);
        expect(nats.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();

        active.resolve(true);
        await stopPromise;
        await flush();
        expect(stopped).toBe(true);
        expect(calls).toBe(1);
        expect(runner.activeJobCount()).toBe(0);
    });

    it("aborts the running job's signal on stop so long retry loops can bail out", async () => {
        const active = deferred<boolean>();
        let jobSignal: AbortSignal | undefined;
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.register({
            name: "abortable",
            mode: "asap",
            cooldown: 3600,
            job: async (signal: AbortSignal) => {
                jobSignal = signal;
                return active.promise;
            },
        });

        runner.start();
        await flush();
        expect(jobSignal).toBeInstanceOf(AbortSignal);
        expect(jobSignal!.aborted).toBe(false);

        const stopPromise = runner.stop();
        await flush();
        expect(jobSignal!.aborted).toBe(true);

        active.resolve(false);
        await stopPromise;
        await flush();
        expect(runner.activeJobCount()).toBe(0);
    });
});
