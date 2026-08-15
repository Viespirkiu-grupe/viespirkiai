import { describe, expect, it } from "vitest";
import XLSX from "xlsx";
import {
    findPpaSheet,
    normalizePpaDate,
    normalizePpaNumber,
    normalizePpaSheetName,
    parsePpaArgs,
} from "../modules/ppa/parse.js";

describe("PPA XLSX numbers", () => {
    it.each([
        [1, 1],
        ["2", 2],
        [null, null],
        ["", null],
        ["Tiekėjų grupė", null],
    ])("normalizes %j to %j", (input, expected) => {
        expect(normalizePpaNumber(input)).toBe(expected);
    });
});

describe("PPA XLSX sheet names", () => {
    it.each([
        ["I.–III.", "I-III"],
        ["I–III", "I-III"],
        ["III.5", "III5"],
        ["III.-5", "III5"],
        ["III-5", "III5"],
        ["V.–VI.-2", "V-VI2"],
        ["V–VI-2", "V-VI2"],
        ["V.VI.2", "V-VI2"],
        ["V.–V.-2", "V-VI2"],
        ["VII.-1", "VII1"],
        ["VII–2", "VII2"],
        [" VI. ", "VI"],
        ["XIII.", "XIII"],
        ["XIII", "XIII"],
    ])("normalizes %s to %s", (input, expected) => {
        expect(normalizePpaSheetName(input)).toBe(expected);
    });

    it("finds a sheet across punctuation variants and returns null when absent", () => {
        const sheet = { marker: true };
        const workbook = {
            SheetNames: ["I–III", "XIII"],
            Sheets: { "I–III": {}, XIII: sheet },
        };
        expect(findPpaSheet(workbook, "XIII.")).toBe(sheet);
        expect(findPpaSheet(workbook, "XI.")).toBeNull();
    });

    it("uses the newest numbered copy when the original sheet is absent", () => {
        const newest = { marker: "newest" };
        const workbook = {
            SheetNames: ["VII.3 (1)", "VII.3 (3)", "VII.3 (2)"],
            Sheets: {
                "VII.3 (1)": { marker: "old" },
                "VII.3 (2)": { marker: "older" },
                "VII.3 (3)": newest,
            },
        };
        expect(findPpaSheet(workbook, "VII.3")).toBe(newest);
    });

    it("finds a renamed sheet from its section heading", () => {
        const sheet = XLSX.utils.aoa_to_sheet([
            ["PIRKIMO PROCEDŪRŲ ATASKAITA"],
            ["VII.3 PASIŪLYMŲ VERTINIMAS: Nustatyta pasiūlymų eilė"],
        ]);
        const workbook = {
            SheetNames: ["11"],
            Sheets: { 11: sheet },
        };
        expect(findPpaSheet(workbook, "VII.3")).toBe(sheet);
    });
});

describe("PPA XLSX dates", () => {
    it.each([
        ["14/10/2025", "2025-10-14"],
        ["14.10.2025", "2025-10-14"],
        ["2025/10/14", "2025-10-14"],
        ["2025-10-14", "2025-10-14"],
        ["2025 11 25", "2025-11-25"],
        ["206-04-03", "2026-04-03"],
        ["2026-04-29*", "2026-04-29"],
        ["1-2-2026", "2026-02-01"],
        ["11/25/25", "2025-11-25"],
        ["25/11/25", "2025-11-25"],
    ])("normalizes %s to %s", (input, expected) => {
        expect(normalizePpaDate(input)).toBe(expected);
    });

    it("keeps an empty date empty", () => {
        expect(normalizePpaDate(null)).toBeNull();
        expect(normalizePpaDate("-")).toBeNull();
    });

    it("uses the calendar components of an XLSX Date value", () => {
        expect(normalizePpaDate(new Date(2025, 10, 25))).toBe("2025-11-25");
    });

    it("converts an unformatted Excel date serial", () => {
        expect(normalizePpaDate(45999)).toBe("2025-12-08");
    });

    it("does not guess an ambiguous textual short date", () => {
        expect(() => normalizePpaDate("11/12/25")).toThrow(/ambiguous date/);
    });

    it.each(["31/02/2025", "2025-13-01", "not-a-date"])(
        "rejects invalid date %s",
        (input) => {
            expect(() => normalizePpaDate(input)).toThrow(/invalid date/);
        },
    );
});

describe("PPA parser CLI", () => {
    it("defaults to one worker", () => {
        expect(parsePpaArgs([])).toEqual({ concurrency: 1, help: false });
    });

    it.each([
        [["--concurrency=8"], 8],
        [["--concurrency", "12"], 12],
    ])("parses %j", (args, concurrency) => {
        expect(parsePpaArgs(args)).toEqual({ concurrency, help: false });
    });

    it.each(["0", "65", "1.5", "nope"])("rejects concurrency %s", (value) => {
        expect(() => parsePpaArgs([`--concurrency=${value}`])).toThrow(/nuo 1 iki 64/);
    });
});
