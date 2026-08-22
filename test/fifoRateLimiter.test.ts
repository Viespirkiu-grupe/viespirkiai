import { afterEach, describe, expect, it, vi } from "vitest";
import { FifoRateLimiter } from "../modules/openrouter/fifoRateLimiter.js";

describe("FifoRateLimiter", () => {
    afterEach(() => vi.useRealTimers());

    it("12.5 RPS leidimus išduoda FIFO tvarka kas 80 ms", async () => {
        vi.useFakeTimers();
        const limiter = new FifoRateLimiter(12.5);
        const granted = [];

        limiter.acquire().then(() => granted.push(1));
        limiter.acquire().then(() => granted.push(2));
        limiter.acquire().then(() => granted.push(3));
        await vi.advanceTimersByTimeAsync(0);
        expect(granted).toEqual([1]);

        await vi.advanceTimersByTimeAsync(79);
        expect(granted).toEqual([1]);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted).toEqual([1, 2]);
        await vi.advanceTimersByTimeAsync(80);
        expect(granted).toEqual([1, 2, 3]);
    });
});
