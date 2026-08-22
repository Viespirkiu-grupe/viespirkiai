import { describe, expect, it } from "vitest";
import {
    runAdaptiveSlots,
    runWithSlots,
} from "../modules/viesiejiPirkimai/runWithSlots.js";

describe("runWithSlots", () => {
    it("async iterable apdoroja neviršydamas keturių aktyvių darbų", async () => {
        let active = 0;
        let maxActive = 0;
        const completed = [];

        async function* items() {
            for (let i = 0; i < 12; i++) yield i;
        }

        await runWithSlots(items(), async (item) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            completed.push(item);
            active--;
        }, 4);

        expect(maxActive).toBe(4);
        expect(completed).toHaveLength(12);
        expect(new Set(completed).size).toBe(12);
    });

    it("automatiškai augina slotų kiekį iki nustatytos ribos", async () => {
        let active = 0;
        let maxActive = 0;

        async function* items() {
            for (let i = 0; i < 20; i++) yield i;
        }

        await runAdaptiveSlots(items(), async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 10));
            active--;
        }, {
            initialConcurrency: 1,
            maxConcurrency: 4,
            growEveryMs: 2,
        });

        expect(maxActive).toBeGreaterThan(1);
        expect(maxActive).toBeLessThanOrEqual(4);
    });
});
