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

    it("queries mokesciai by jarKodas and data.gov.lt jar id", async () => {
        pgQuery.mockResolvedValue({ rows: [] });

        const { gautiVmiDuomenis } = await import("../modules/vmi/vmiDuomenys.js");
        await gautiVmiDuomenis("123456789", "jar-id-1");

        expect(pgQuery).toHaveBeenCalledWith(
            expect.stringContaining("mm_kodas_id = $2"),
            ["123456789", "jar-id-1"],
        );
    });

    it("fills result jarKodas from requested code when VMI row has no jarKodas", async () => {
        pgQuery.mockResolvedValue({
            rows: [
                {
                    pavadinimas: "UAB Test",
                    jarKodas: null,
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
