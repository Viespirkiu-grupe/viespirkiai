import { beforeEach, describe, expect, it, vi } from "vitest";
import "../utils/time.js";

const pgQuery = vi.fn();

vi.mock("../postgres/postgres.js", () => ({
    postgres: {
        query: pgQuery,
    },
}));

describe("gautiVmiDuomenis", () => {
    beforeEach(() => {
        pgQuery.mockReset();
    });

    it("queries vmi.mokesciai by the data.gov.lt jar id", async () => {
        pgQuery.mockResolvedValue({ rows: [] });

        const { gautiVmiDuomenis } = await import("../modules/vmi/vmiDuomenys.js");
        await gautiVmiDuomenis("123456789", "jar-id-1");

        expect(pgQuery).toHaveBeenCalledWith(
            expect.stringContaining('m."jarId" = $1::uuid'),
            ["jar-id-1"],
        );
    });

    it("returns undefined without a jar id — there is no other link to VMI", async () => {
        const { gautiVmiDuomenis } = await import("../modules/vmi/vmiDuomenys.js");

        expect(await gautiVmiDuomenis("123456789", null)).toBeUndefined();
        expect(pgQuery).not.toHaveBeenCalled();
    });

    it("fills result jarKodas from the requested code", async () => {
        pgQuery.mockResolvedValue({
            rows: [
                {
                    pavadinimas: "UAB Test",
                    formosPavadinimas: "Uždaroji akcinė bendrovė",
                    suma: 120.5,
                    metai: 2026,
                    menuo: 6,
                    duomenuData: new Date("2026-07-01T00:00:00Z"),
                },
            ],
        });

        const { gautiVmiDuomenis } = await import("../modules/vmi/vmiDuomenys.js");
        const result = await gautiVmiDuomenis("123456789", "jar-id-1");

        expect(result?.jarKodas).toBe("123456789");
        expect(result?.data).toBe("2026-06");
        expect(result?.duomenys).toEqual([
            {
                data: "2026-06",
                duomenuData: expect.any(String),
                suma: 120.5,
            },
        ]);
    });
});
