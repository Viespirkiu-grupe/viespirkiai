import { describe, expect, it } from "vitest";
import { buildCursorQuery, parseArgs } from "../modules/ppa/discover.js";

describe("PPA XLSX discovery", () => {
    it("uses the phrase and XLSX filter for the first Quickwit window", () => {
        expect(buildCursorQuery(null)).toBe(
            '(extension:"xlsx") AND "VII.3 PASIULYMU VERTINIMAS"',
        );
    });

    it("continues strictly after the last document id", () => {
        expect(buildCursorQuery(123)).toBe(
            '((extension:"xlsx") AND "VII.3 PASIULYMU VERTINIMAS") AND id:{123 TO *]',
        );
    });

    it("writes by default", () => {
        expect(parseArgs([])).toEqual({
            dryRun: false,
            help: false,
        });
    });

    it("parses dry-run", () => {
        expect(parseArgs(["--dry-run"])).toEqual({
            dryRun: true,
            help: false,
        });
    });
});
