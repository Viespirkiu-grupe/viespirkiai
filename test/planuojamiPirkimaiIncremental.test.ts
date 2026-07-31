import { describe, expect, it, vi } from "vitest";
import {
    backfillPlanuojamiPirkimai,
    assertPlanuojamiPirkimaiSchema,
    recentPublicationRange,
    updateRecentPlanuojamiPirkimai,
    upsertPlanuojamiPirkimai,
} from "../modules/viesiejiPirkimai/updatePlanuojamiPirkimai.js";

describe("planuojamų pirkimų DB papildymas", () => {
    it("pilnas backfill pirmiausia užtikrina schemą ir rašo per DB callback", async () => {
        const db = { query: vi.fn() };
        const assertSchema = vi.fn().mockResolvedValue(undefined);
        const processRecords = vi.fn(async (options) => {
            expect(options).not.toHaveProperty("outFile");
            return { total: 25, intervals: 2 };
        });
        const result = await backfillPlanuojamiPirkimai({
            db,
            assertSchema,
            processRecords,
            logger: { log: vi.fn() },
            delayMs: 0,
        });
        expect(result).toEqual({ total: 25, intervals: 2 });
        expect(assertSchema).toHaveBeenCalledWith(db);
        expect(processRecords).toHaveBeenCalledWith(
            expect.objectContaining({
                delayMs: 0,
                onRecords: expect.any(Function),
            }),
        );
    });

    it("trūkstant schemos sustoja ir DB struktūros nekeičia", async () => {
        const db = {
            query: vi.fn().mockResolvedValueOnce({ rows: [] }),
        };
        await expect(assertPlanuojamiPirkimaiSchema(db)).rejects.toThrow(
            "Aplikacijos kodas DB struktūros nekeičia",
        );
        expect(db.query).toHaveBeenCalledOnce();
    });

    it("ima šiandieną ir šešias ankstesnes Lietuvos kalendorines dienas", () => {
        expect(
            recentPublicationRange(new Date("2026-01-01T00:30:00Z")),
        ).toEqual({
            from: "2025-12-26T00:00",
            to: "2026-01-01T23:59",
        });
    });

    it("VPT darbo metu nieko nescrapina ir DB neliečia", async () => {
        const processRecords = vi.fn();
        const db = { query: vi.fn() };
        const result = await updateRecentPlanuojamiPirkimai({
            workingHours: () => true,
            processRecords,
            db,
            logger: { log: vi.fn() },
        });
        expect(result).toEqual({ skipped: true, total: 0, intervals: 0 });
        expect(processRecords).not.toHaveBeenCalled();
        expect(db.query).not.toHaveBeenCalled();
    });

    it("ne darbo metu perduoda 7 dienų ribas ir upsertina gautus įrašus", async () => {
        const db = {
            query: vi.fn().mockResolvedValue({ rows: [{ count: 1 }] }),
        };
        const processRecords = vi.fn(async (options) => {
            await options.onRecords([
                {
                    md5: "0123456789abcdef0123456789abcdef",
                    pirkimoVykdytojas: "UAB Testas",
                    bvpzKodai: ["12345678"],
                },
            ]);
            return { total: 1, intervals: 1 };
        });
        const result = await updateRecentPlanuojamiPirkimai({
            now: new Date("2026-07-31T12:00:00Z"),
            workingHours: () => false,
            processRecords,
            db,
            logger: { log: vi.fn() },
        });

        expect(result).toEqual({ skipped: false, total: 1, intervals: 1 });
        expect(processRecords).toHaveBeenCalledWith(
            expect.objectContaining({
                from: "2026-07-25T00:00",
                to: "2026-07-31T23:59",
            }),
        );
        expect(db.query).toHaveBeenCalledOnce();
        expect(db.query.mock.calls[0][0]).toContain("ON CONFLICT (md5)");
        expect(JSON.parse(db.query.mock.calls[0][1][0])).toHaveLength(1);
    });

    it("tuščiam batch nedaro SQL užklausos", async () => {
        const db = { query: vi.fn() };
        expect(await upsertPlanuojamiPirkimai([], db)).toBe(0);
        expect(db.query).not.toHaveBeenCalled();
    });

    it("vienodas md5 eilutes deduplikuoja prieš vieną INSERT", async () => {
        const db = {
            query: vi.fn().mockResolvedValue({ rows: [{ count: 1 }] }),
        };
        const row = {
            md5: "0123456789abcdef0123456789abcdef",
            pirkimoPavadinimas: "Tas pats pirkimas",
        };
        expect(await upsertPlanuojamiPirkimai([row, { ...row }], db)).toBe(1);
        expect(JSON.parse(db.query.mock.calls[0][1][0])).toEqual([row]);
    });
});
