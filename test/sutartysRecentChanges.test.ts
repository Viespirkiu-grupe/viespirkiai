import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
    countContractChanges,
    diffContractDocuments,
    fetchRecentChanges,
    formatRecentChanges,
    parseRecentChangesArgs,
    RECENT_CHANGES_SQL,
} from "../modules/sutartys/recentChanges.js";
import { writeWithPager } from "../utils/pager.js";

describe("recent VPM contract changes", () => {
    it("atstato timestamp kaip lokalų laiką be klaidingo Z", () => {
        expect(RECENT_CHANGES_SQL).toContain("'YYYY-MM-DD\"T\"HH24:MI:SS.MS'");
        expect(RECENT_CHANGES_SQL).not.toContain('HH24:MI:SS.MS\"Z\"');
    });

    it("parses filters and output options", () => {
        expect(parseRecentChangesArgs([
            "--limit", "25", "--id=123", "--json", "--no-color",
            "--no-pager", "--page-size=15",
        ])).toEqual({
            limit: 25,
            id: 123,
            batchSize: 20,
            json: true,
            color: false,
            pager: false,
            pageSize: 15,
            help: false,
        });
        expect(() => parseRecentChangesArgs(["--limit", "0"]))
            .toThrow(/teigiamas/);
        expect(() => parseRecentChangesArgs(["--unknown"]))
            .toThrow(/Nežinomas/);
    });

    it("returns changed canonical fields in canonical order", () => {
        expect(diffContractDocuments(
            {
                unikalusId: 1,
                pavadinimas: "Sena",
                faktineVerte: null,
                dokumentai: [{ fileId: 1 }],
            },
            {
                unikalusId: 1,
                pavadinimas: "Nauja",
                faktineVerte: 12.5,
                dokumentai: [{ fileId: 2 }],
            },
        )).toEqual([
            { field: "pavadinimas", before: "Sena", after: "Nauja" },
            { field: "faktineVerte", before: null, after: 12.5 },
            {
                field: "dokumentai[fileId=1]",
                before: { fileId: 1 },
                after: undefined,
            },
            {
                field: "dokumentai[fileId=2]",
                before: undefined,
                after: { fileId: 2 },
            },
        ]);
    });

    it("shows only the added document instead of replacing the whole array", () => {
        expect(diffContractDocuments(
            {
                dokumentai: [{ fileId: 1, pavadinimas: "sutartis.pdf" }],
            },
            {
                dokumentai: [
                    { fileId: 1, pavadinimas: "sutartis.pdf" },
                    { fileId: 2, pavadinimas: "priedas.pdf" },
                ],
            },
        )).toEqual([{
            field: "dokumentai[fileId=2]",
            before: undefined,
            after: { fileId: 2, pavadinimas: "priedas.pdf" },
        }]);
    });

    it("formats changes like a line diff", () => {
        expect(formatRecentChanges([{
            id: 7,
            unikalusId: "42",
            pakeitimoData: "2026-07-17 12:00:00",
            beforeHash: "old",
            afterHash: "new",
            before: { pavadinimas: "Sena", pirkimoNumeris: null },
            after: { pavadinimas: "Nauja", pirkimoNumeris: "P-1" },
        }])).toBe(
            "@@ pakeitimas #7 | sutartis 42 | 2026-07-17 12:00:00 @@\n"
            + "  hash: old -> new\n"
            + '- pavadinimas: "Sena"\n'
            + '+ pavadinimas: "Nauja"\n'
            + "- pirkimoNumeris: null\n"
            + '+ pirkimoNumeris: "P-1"',
        );
    });

    it("adds ANSI colors only when requested", () => {
        const rows = [{
            id: 1,
            unikalusId: "2",
            pakeitimoData: "now",
            before: { pavadinimas: "Sena" },
            after: { pavadinimas: "Nauja" },
        }];
        expect(formatRecentChanges(rows)).not.toContain("\x1b[");
        const colored = formatRecentChanges(rows, { color: true });
        expect(colored).toContain("\x1b[1;36m@@ pakeitimas");
        expect(colored).toContain('\x1b[31m- pavadinimas: "Sena"');
        expect(colored).toContain('\x1b[32m+ pavadinimas: "Nauja"');
    });

    it("pages interactive output and restores terminal input", async () => {
        class FakeInput extends EventEmitter {
            isTTY = true;
            isRaw = false;
            paused = false;
            setRawMode(value: boolean) {
                this.isRaw = value;
            }
            resume() {
                this.paused = false;
            }
            pause() {
                this.paused = true;
            }
        }
        const input = new FakeInput();
        let outputText = "";
        let answered = false;
        const output = {
            isTTY: true,
            rows: 4,
            write(value: string) {
                outputText += value;
                if (!answered && value.includes("-- Daugiau")) {
                    answered = true;
                    setTimeout(() => input.emit("data", Buffer.from("q")), 0);
                }
            },
        };

        await writeWithPager("1\n2\n3\n4", {
            input,
            output,
            pageSize: 2,
        });

        expect(outputText).toContain("1\n2\n");
        expect(outputText).toContain("-- Daugiau (50%) --");
        expect(outputText).not.toContain("3\n4");
        expect(input.isRaw).toBe(false);
        expect(input.paused).toBe(true);
    });

    it("queries the requested count and contract", async () => {
        const rows = [{ id: 1 }];
        const query = vi.fn().mockResolvedValue({ rows });
        await expect(fetchRecentChanges({
            limit: 3,
            id: 42,
            beforeId: 100,
        }, { query }))
            .resolves.toBe(rows);
        expect(query).toHaveBeenCalledWith(RECENT_CHANGES_SQL, [3, 42, 100]);
        expect(RECENT_CHANGES_SQL).toMatch(
            /later\."unikalusId" = recent\."unikalusId"[\s\S]*later\.id > recent\.id/,
        );
    });

    it("counts all changes for one contract", async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{ count: "123" }] });

        await expect(countContractChanges(42, { query })).resolves.toBe(123);
        expect(query).toHaveBeenCalledWith(
            expect.stringMatching(/COUNT\(\*\)[\s\S]*WHERE "unikalusId" = \$1/),
            [42],
        );
    });
});
