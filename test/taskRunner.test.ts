import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

    it("releases once when a success hook throws", async () => {
        const order: string[] = [];
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.registerAll([
            {
                name: "hook",
                mode: "asap",
                priority: 10,
                cooldown: 3600,
                job: async () => { order.push("hook"); return false; },
                onSuccess: () => { throw new Error("hook failed"); },
            },
            { name: "next", mode: "asap", priority: 1, cooldown: 3600, job: async () => { order.push("next"); return false; } },
        ]);
        runner.start();
        await flush();

        expect(order).toEqual(["hook", "next"]);
        expect(runner.activeJobCount()).toBe(0);
        expect(error).toHaveBeenCalledWith(expect.stringContaining("success hook failed"), expect.any(Error));
        runner.setWorkerCount("hook", 0);
        runner.setWorkerCount("next", 0);
        await flush();
        error.mockRestore();
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

    it("does not let nudge re-enable a task explicitly scaled to zero", async () => {
        let calls = 0;
        const runner = new TaskRunner({ maxConcurrentJobs: 1 });
        runner.register({
            name: "disabled",
            mode: "asap",
            cooldown: 3600,
            job: async () => { calls++; return false; },
        });
        runner.start();
        await flush();
        expect(calls).toBe(1);

        runner.setWorkerCount("disabled", 0);
        await flush();
        runner.nudge("disabled");
        await flush();

        expect(calls).toBe(1);
    });
});
