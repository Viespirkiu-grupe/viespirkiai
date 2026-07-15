import { describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("../postgres/postgres.js", () => ({
    postgres: { query },
}));

describe("sutartys import validation", () => {
    it("accepts contract amounts with regular and non-breaking thousands spaces", async () => {
        const { parseNullableNumber } = await import(
            "../modules/sutartys/import.js"
        );

        expect(parseNullableNumber("2 787.20", "verte", 1)).toBe(2787.2);
        expect(parseNullableNumber("1 234,56", "verte", 1)).toBe(1234.56);
        expect(parseNullableNumber("9 876,54", "verte", 1)).toBe(9876.54);
        expect(parseNullableNumber("", "verte", 1)).toBeNull();
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
