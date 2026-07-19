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

        const vpmCall = query.mock.calls.find(
            ([sql, params]) =>
                String(sql).includes('INSERT INTO public."vpmSutartys"') &&
                String(params?.[0]).includes('"unikalusId":1') &&
                /^[a-f0-9]{32}$/.test(String(params?.[1])),
        );
        expect(vpmCall).toBeDefined();
        const doc = JSON.parse(vpmCall![1][0]);
        expect(doc.faktineIvykdimoData).toBe("2022-06-30");
        expect(doc.galiojimoData).toBe("2022-07-01");
        expect(doc.sudarymoData).toBe("2022-01-01");
    });

    it("records a malformed contract and imports it with the broken field nulled", async () => {
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

        const vpmDocs = query.mock.calls
            .filter(([sql]) =>
                String(sql).includes('INSERT INTO public."vpmSutartys"'),
            )
            .map(([, params]) => JSON.parse(params[0]));
        expect(vpmDocs.map((doc) => doc.unikalusId)).toEqual([1, 2005493961]);
        const brokuota = vpmDocs.find((doc) => doc.unikalusId === 2005493961);
        expect(brokuota?.numatomaVerte).toBe(313);
        expect(brokuota?.faktineVerte).toBeNull();
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
