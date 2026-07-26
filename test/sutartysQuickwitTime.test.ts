import { describe, expect, it } from "vitest";
import { toRfc3339 } from "../modules/sutartys/quickwitProcessIndexQueue.js";

// Bendra `toRfc3339` elgsena testuojama test/quickwitTime.test.ts; čia tikrinam,
// kad sutarčių modulis vis dar re-eksportuoja būtent tą (juostą suprantančią)
// versiją, o ne savo kopiją.
describe("sutartys Quickwit time conversion", () => {
    it("treats PostgreSQL timestamp strings as Lithuania local time", () => {
        expect(toRfc3339("2026-07-07 23:31:29")).toBe("2026-07-07T20:31:29Z");
    });

    it("keeps date-only values as UTC dates", () => {
        expect(toRfc3339("2026-06-30")).toBe("2026-06-30T00:00:00Z");
    });
});
