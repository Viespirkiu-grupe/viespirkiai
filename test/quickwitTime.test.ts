import { describe, expect, it } from "vitest";
import { toRfc3339 } from "../utils/time.js";

describe("toRfc3339", () => {
    it("treats PostgreSQL timestamp strings as Lithuania local time (summer, UTC+3)", () => {
        expect(toRfc3339("2026-07-07 23:31:29")).toBe("2026-07-07T20:31:29Z");
    });

    it("treats PostgreSQL timestamp strings as Lithuania local time (winter, UTC+2)", () => {
        expect(toRfc3339("2026-01-15 10:00:00")).toBe("2026-01-15T08:00:00Z");
    });

    it("handles fractional seconds", () => {
        // Milisekundės paliekamos — Quickwit `datetime` jas priima, o `Date`
        // atvejis irgi grąžina jas (`.000Z`), tad elgsena vienoda.
        expect(toRfc3339("2026-07-07 10:11:12.345")).toBe("2026-07-07T07:11:12.345Z");
    });

    it("keeps date-only values as UTC midnight", () => {
        expect(toRfc3339("2026-06-30")).toBe("2026-06-30T00:00:00Z");
    });

    it("converts Date objects (timestamptz columns) straight to UTC", () => {
        expect(toRfc3339(new Date("2026-07-07T07:11:12.000Z"))).toBe("2026-07-07T07:11:12.000Z");
    });

    it("leaves already zoned strings untouched", () => {
        expect(toRfc3339("2026-07-07T07:11:12Z")).toBe("2026-07-07T07:11:12Z");
    });

    it("returns null for null and undefined", () => {
        expect(toRfc3339(null)).toBeNull();
        expect(toRfc3339(undefined)).toBeNull();
    });
});
