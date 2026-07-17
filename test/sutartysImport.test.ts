import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("../postgres/postgres.js", () => ({
    postgres: { query },
}));

describe("sutartys import validation", () => {
    beforeEach(() => {
        query.mockReset();
        query.mockResolvedValue({ rows: [] });
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

    it("accepts contract amounts with thousands spaces and an EUR suffix", async () => {
        const { parseNullableNumber } = await import(
            "../modules/sutartys/import.js"
        );

        expect(parseNullableNumber("2 787.20", "verte", 1)).toBe(2787.2);
        expect(parseNullableNumber("1 234,56", "verte", 1)).toBe(1234.56);
        expect(parseNullableNumber("9 876,54", "verte", 1)).toBe(9876.54);
        expect(
            parseNullableNumber(
                "121.00 eur",
                "faktineIvykdimoVerte",
                2005487264,
            ),
        ).toBe(121);
        expect(parseNullableNumber("1 234,56 EUR", "verte", 1)).toBe(1234.56);
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
        expect(
            query.mock.calls.some(
                ([sql, params]) =>
                    String(sql).includes(
                        'INSERT INTO public."vpmSutartys"',
                    ) &&
                    String(params?.[0]).includes('"unikalusId":1') &&
                    /^[a-f0-9]{32}$/.test(String(params?.[1])),
            ),
        ).toBe(true);
    });

    it("records and skips a malformed contract without stopping the batch", async () => {
        const { cvpIsImportArray } = await import(
            "../modules/sutartys/import.js"
        );

        await cvpIsImportArray([
            {
                sutartiesUnikalusID: "1",
                verte: "10",
                faktineIvykdimoVerte: "9",
                faktineIvykdimoData: "",
                galiojimoData: "",
                sudarymoData: "",
                dokumentai: [],
            },
            {
                sutartiesUnikalusID: "2005493961",
                verte: "313.00",
                faktineIvykdimoVerte: "3.13.00",
            },
        ]);

        const brokasCall = query.mock.calls.find(([sql]) =>
            String(sql).includes('INSERT INTO public."vpmSutartysBrokas"'),
        );
        expect(brokasCall?.[1]).toEqual([2005493961]);

        const sutartysCall = query.mock.calls.find(([sql]) =>
            String(sql).includes('INSERT INTO "sutartys"'),
        );
        expect(sutartysCall?.[1]?.[0]).toBe(1);
        expect(sutartysCall?.[1]).not.toContain(2005493961);
    });

    it("does not write an unidentifiable malformed row to the reject table", async () => {
        const { cvpIsImportArray } = await import(
            "../modules/sutartys/import.js"
        );

        await cvpIsImportArray([
            {
                sutartiesUnikalusID: "not-an-id",
                verte: "&euro;29.00",
                faktineIvykdimoVerte: "",
            },
        ]);

        expect(query).not.toHaveBeenCalled();
    });
});
