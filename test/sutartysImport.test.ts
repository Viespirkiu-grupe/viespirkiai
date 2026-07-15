import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("../postgres/postgres.js", () => ({
    postgres: { query },
}));

describe("sutartys import validation", () => {
    beforeEach(() => {
        query.mockReset();
    });

    it("keeps date-only contract fields independent from the local timezone", async () => {
        const { parseDateOnly } = await import(
            "../modules/sutartys/import.js"
        );

        expect(
            parseDateOnly("2022-06-30", "faktineIvykdimoData", 1),
        ).toBe("2022-06-30");
        expect(() =>
            parseDateOnly("2022-06-30 03:00:00", "faktineIvykdimoData", 1),
        ).toThrow("Invalid faktineIvykdimoData");
        expect(() =>
            parseDateOnly("2022-02-30", "faktineIvykdimoData", 1),
        ).toThrow("Invalid faktineIvykdimoData");
    });

    it("accepts contract amounts with regular and non-breaking thousands spaces", async () => {
        const { parseNullableNumber } = await import(
            "../modules/sutartys/import.js"
        );

        expect(parseNullableNumber("2 787.20", "verte", 1)).toBe(2787.2);
        expect(parseNullableNumber("1 234,56", "verte", 1)).toBe(1234.56);
        expect(parseNullableNumber("9 876,54", "verte", 1)).toBe(9876.54);
        expect(parseNullableNumber("", "verte", 1)).toBeNull();
    });

    it("sends date-only values to PostgreSQL without an added time", async () => {
        const { cvpIsImportArray } = await import(
            "../modules/sutartys/import.js"
        );
        await cvpIsImportArray([
            {
                sutartiesUnikalusID: "1",
                verte: "10",
                faktineIvykdimoVerte: "9",
                faktineIvykdimoData: "2022-06-30",
                galiojimoData: "2022-07-01",
                sudarymoData: "2022-01-01",
                dokumentai: [],
            },
        ]);

        const values = query.mock.calls[0][1];
        expect(values[7]).toBe("2022-06-30");
        expect(values[9]).toBe("2022-07-01");
        expect(values[16]).toBe("2022-01-01");
    });

    it("rejects malformed numeric values before writing anything", async () => {
        const { cvpIsImportArray } = await import(
            "../modules/sutartys/import.js"
        );

        await expect(
            cvpIsImportArray([
                {
                    sutartiesUnikalusID: "1675305860",
                    verte: "&euro;29.00",
                    faktineIvykdimoVerte: "",
                },
            ]),
        ).rejects.toThrow(
            'Invalid verte for contract 1675305860: "&euro;29.00"',
        );
        expect(query).not.toHaveBeenCalled();
    });
});
