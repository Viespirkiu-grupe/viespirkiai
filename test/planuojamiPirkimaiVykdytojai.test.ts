import { describe, expect, it, vi } from "vitest";
import { processNextPlanuojamuPirkimuVykdytojas } from "../modules/viesiejiPirkimai/planuojamiPirkimaiVykdytojai.js";

describe("planuojamų pirkimų vykdytojų JAR nustatymas", () => {
    it("VPT darbo metu eilės ir Typesense neliečia", async () => {
        const db = { query: vi.fn() };
        const findJuridinis = vi.fn();
        expect(
            await processNextPlanuojamuPirkimuVykdytojas({
                db,
                findJuridinis,
                workingHours: () => true,
            }),
        ).toBe(false);
        expect(db.query).not.toHaveBeenCalled();
        expect(findJuridinis).not.toHaveBeenCalled();
    });

    it("pagal deduplikuotą pavadinimą nustato JAR ir atnaujina atskirą TSV", async () => {
        const db = {
            query: vi
                .fn()
                .mockResolvedValueOnce({
                    rows: [{ id: "42", pavadinimas: "UAB Testas", jarKodas: null }],
                })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] }),
        };
        const findJuridinis = vi.fn().mockResolvedValue({
            jarKodas: "123456789",
            pavadinimas: "UAB Testas",
        });
        const result = await processNextPlanuojamuPirkimuVykdytojas({
            db,
            findJuridinis,
            workingHours: () => false,
            logger: { log: vi.fn(), error: vi.fn() },
        });

        expect(result).toBe(true);
        expect(findJuridinis).toHaveBeenCalledWith("UAB Testas");
        expect(db.query).toHaveBeenCalledTimes(3);
        expect(db.query.mock.calls[1][1]).toEqual([
            "42",
            "123456789",
            1,
        ]);
        expect(db.query.mock.calls[2][0]).toContain(
            'UPDATE public."planuojamiPirkimaiSearch"',
        );
    });

    it("neradus atitikmens pažymi patikrintu, bet neperrašo TSV", async () => {
        const db = {
            query: vi
                .fn()
                .mockResolvedValueOnce({
                    rows: [{ id: "7", pavadinimas: "Nežinoma įstaiga" }],
                })
                .mockResolvedValueOnce({ rows: [] }),
        };
        await processNextPlanuojamuPirkimuVykdytojas({
            db,
            findJuridinis: vi.fn().mockResolvedValue(null),
            workingHours: () => false,
            logger: { log: vi.fn(), error: vi.fn() },
        });
        expect(db.query).toHaveBeenCalledTimes(2);
        expect(db.query.mock.calls[1][1]).toEqual(["7", null, 1]);
    });

    it("pirmiausia panaudoja jau žinomą kitų viešųjų pirkimų JAR", async () => {
        const db = {
            query: vi
                .fn()
                .mockResolvedValueOnce({
                    rows: [{
                        id: "8",
                        pavadinimas: "AB Žinomas vykdytojas",
                        cachedJarKodas: "987654321",
                    }],
                })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] }),
        };
        const findJuridinis = vi.fn();
        await processNextPlanuojamuPirkimuVykdytojas({
            db,
            findJuridinis,
            workingHours: () => false,
            logger: { log: vi.fn(), error: vi.fn() },
        });
        expect(findJuridinis).not.toHaveBeenCalled();
        expect(db.query.mock.calls[1][1]).toEqual(["8", "987654321", 1]);
    });
});
