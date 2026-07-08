import { describe, expect, it } from "vitest";
import { toRfc3339 } from "../modules/sutartys/quickwitProcessIndexQueue.js";

describe("sutartys Quickwit time conversion", () => {
    it("treats PostgreSQL timestamp strings as Lithuania local time", () => {
        expect(toRfc3339("2026-07-07 23:31:29")).toBe("2026-07-07T20:31:29Z");
    });

    it("keeps date-only values as UTC dates", () => {
        expect(toRfc3339("2026-06-30")).toBe("2026-06-30T00:00:00Z");
    });
});
