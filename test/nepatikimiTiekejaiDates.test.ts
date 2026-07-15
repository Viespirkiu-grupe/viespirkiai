import { describe, expect, it } from "vitest";
import { normalizeVptDate } from "../modules/vptSarasai/nepatikimiScrape.js";

describe("nepatikimi tiekėjai date normalization", () => {
    it("uses the latest date from the VPT explanation date history", () => {
        expect(normalizeVptDate("3/10/2026+07/07/2026")).toBe(
            "2026-07-07",
        );
    });

    it("normalizes Excel serial, ISO and Lithuanian dates", () => {
        expect(normalizeVptDate(46085)).toBe("2026-03-04");
        expect(normalizeVptDate("2026-7-7")).toBe("2026-07-07");
        expect(normalizeVptDate("7.7.2026")).toBe("2026-07-07");
        expect(normalizeVptDate(null)).toBeNull();
    });

    it("rejects unsupported or impossible dates before SQL", () => {
        expect(() => normalizeVptDate("2026-02-30")).toThrow(
            "Invalid VPT date",
        );
        expect(() => normalizeVptDate("soon")).toThrow(
            "Unsupported VPT date",
        );
    });
});
