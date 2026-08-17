import { describe, it, expect } from "vitest";
import { aggregateSodra, aggregateFinansai } from "../../modules/mcp/tools/getJuridinis.js";

// ---------------------------------------------------------------------------
// aggregateSodra
// ---------------------------------------------------------------------------

describe("aggregateSodra", () => {
    it("passes through null unchanged", () => {
        expect(aggregateSodra(null)).toBeNull();
    });

    it("passes through undefined unchanged", () => {
        expect(aggregateSodra(undefined)).toBeUndefined();
    });

    it("handles empty duomenys", () => {
        const result = aggregateSodra({ duomenys: [], extraField: "x" });
        expect(result).toEqual({ extraField: "x", peak: null, byYear: [], gaps: [] });
    });

    it("handles missing duomenys property", () => {
        const result = aggregateSodra({ extraField: "y" });
        expect(result).toEqual({ extraField: "y", peak: null, byYear: [], gaps: [] });
    });

    it("skips entries without a data field", () => {
        const result = aggregateSodra({ duomenys: [{ draustieji: 5, vidutinisAtlyginimas: 1000 }] });
        expect(result.byYear).toEqual([]);
        expect(result.peak).toBeNull();
    });

    it("computes correct byYear averages for a single month", () => {
        const result = aggregateSodra({
            duomenys: [{ data: "2023-06", draustieji: 10, vidutinisAtlyginimas: 2000 }],
        });
        expect(result.byYear).toEqual([{ metai: 2023, avgDraustieji: 10, avgAtlyginimas: 2000 }]);
    });

    it("averages draustieji and vidutinisAtlyginimas across months in the same year", () => {
        const result = aggregateSodra({
            duomenys: [
                { data: "2022-01", draustieji: 10, vidutinisAtlyginimas: 1000 },
                { data: "2022-02", draustieji: 20, vidutinisAtlyginimas: 2000 },
                { data: "2022-03", draustieji: 30, vidutinisAtlyginimas: 3000 },
            ],
        });
        expect(result.byYear).toEqual([{ metai: 2022, avgDraustieji: 20, avgAtlyginimas: 2000 }]);
    });

    it("rounds avgDraustieji to one decimal place", () => {
        const result = aggregateSodra({
            duomenys: [
                { data: "2021-01", draustieji: 1, vidutinisAtlyginimas: null },
                { data: "2021-02", draustieji: 2, vidutinisAtlyginimas: null },
            ],
        });
        // (1+2)/2 = 1.5
        expect(result.byYear[0].avgDraustieji).toBe(1.5);
    });

    it("rounds avgAtlyginimas to nearest integer", () => {
        const result = aggregateSodra({
            duomenys: [
                { data: "2020-01", draustieji: 5, vidutinisAtlyginimas: 1001 },
                { data: "2020-02", draustieji: 5, vidutinisAtlyginimas: 1002 },
            ],
        });
        // (1001+1002)/2 = 1001.5 → rounds to 1002
        expect(result.byYear[0].avgAtlyginimas).toBe(1002);
    });

    it("excludes null vidutinisAtlyginimas from salary average", () => {
        const result = aggregateSodra({
            duomenys: [
                { data: "2019-01", draustieji: 5, vidutinisAtlyginimas: 2000 },
                { data: "2019-02", draustieji: 5, vidutinisAtlyginimas: null },
                { data: "2019-03", draustieji: 5, vidutinisAtlyginimas: null },
            ],
        });
        expect(result.byYear[0].avgAtlyginimas).toBe(2000);
    });

    it("sets avgAtlyginimas to null when no month has salary data", () => {
        const result = aggregateSodra({
            duomenys: [
                { data: "2018-01", draustieji: 3, vidutinisAtlyginimas: null },
            ],
        });
        expect(result.byYear[0].avgAtlyginimas).toBeNull();
    });

    it("sorts byYear ascending", () => {
        const result = aggregateSodra({
            duomenys: [
                { data: "2024-01", draustieji: 5 },
                { data: "2022-01", draustieji: 3 },
                { data: "2023-01", draustieji: 4 },
            ],
        });
        expect(result.byYear.map((r: { metai: number }) => r.metai)).toEqual([2022, 2023, 2024]);
    });

    it("identifies the peak month by highest draustieji", () => {
        const result = aggregateSodra({
            duomenys: [
                { data: "2023-01", draustieji: 5, vidutinisAtlyginimas: 1000 },
                { data: "2023-06", draustieji: 50, vidutinisAtlyginimas: 2000 },
                { data: "2023-12", draustieji: 10, vidutinisAtlyginimas: 1500 },
            ],
        });
        expect(result.peak).toEqual({ data: "2023-06", draustieji: 50, vidutinisAtlyginimas: 2000 });
    });

    it("treats missing draustieji as 0 for peak comparison", () => {
        const result = aggregateSodra({
            duomenys: [
                { data: "2023-01" }, // draustieji undefined → 0
                { data: "2023-02", draustieji: 1 },
            ],
        });
        expect(result.peak?.draustieji).toBe(1);
    });

    it("collects months with zero draustieji into gaps", () => {
        const result = aggregateSodra({
            duomenys: [
                { data: "2023-01", draustieji: 5 },
                { data: "2023-02", draustieji: 0 },
                { data: "2023-03", draustieji: 0 },
                { data: "2023-04", draustieji: 3 },
            ],
        });
        expect(result.gaps).toEqual(["2023-02", "2023-03"]);
    });

    it("treats missing draustieji as 0 and adds to gaps", () => {
        const result = aggregateSodra({
            duomenys: [{ data: "2023-05" }],
        });
        expect(result.gaps).toContain("2023-05");
    });

    it("preserves non-duomenys fields from the original object", () => {
        const result = aggregateSodra({
            duomenys: [],
            jarKodas: "123456789",
            pavadinimas: "UAB Test",
        });
        expect(result.jarKodas).toBe("123456789");
        expect(result.pavadinimas).toBe("UAB Test");
    });
});

// ---------------------------------------------------------------------------
// aggregateFinansai
// ---------------------------------------------------------------------------

describe("aggregateFinansai", () => {
    it("passes through null unchanged", () => {
        expect(aggregateFinansai(null)).toBeNull();
    });

    it("passes through undefined unchanged", () => {
        expect(aggregateFinansai(undefined)).toBeUndefined();
    });

    it("returns byYear:[] when ataskaitos is empty", () => {
        expect(aggregateFinansai({ ataskaitos: [] })).toEqual({ byYear: [] });
    });

    it("returns byYear:[] when ataskaitos is missing", () => {
        expect(aggregateFinansai({})).toEqual({ byYear: [] });
    });

    it("extracts the 6 financial fields for a single year", () => {
        const result = aggregateFinansai({
            ataskaitos: [
                {
                    laikotarpisIki: "2023-12-31",
                    standards: [
                        {
                            lines: [
                                { lineName: "Pardavimo pajamos", reiksme: 100000 },
                                { lineName: "Grynasis pelnas (nuostoliai)", reiksme: 15000 },
                                { lineName: "Ilgalaikis turtas", reiksme: 50000 },
                                { lineName: "Trumpalaikis turtas", reiksme: 30000 },
                                { lineName: "Nuosavas kapitalas", reiksme: 40000 },
                                { lineName: "Mokėtinos sumos ir kiti įsipareigojimai", reiksme: 20000 },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(result.byYear).toEqual([
            {
                metai: 2023,
                pajamos: 100000,
                pelnas: 15000,
                ilgalaikis: 50000,
                trumpalaikis: 30000,
                kapitalas: 40000,
                isipareigojimai: 20000,
            },
        ]);
    });

    it("sets missing fields to null", () => {
        const result = aggregateFinansai({
            ataskaitos: [
                {
                    laikotarpisIki: "2022-12-31",
                    standards: [
                        {
                            lines: [
                                { lineName: "Pardavimo pajamos", reiksme: 50000 },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(result.byYear[0].pelnas).toBeNull();
        expect(result.byYear[0].ilgalaikis).toBeNull();
        expect(result.byYear[0].kapitalas).toBeNull();
    });

    it("accepts the alternative pelnas line name", () => {
        const result = aggregateFinansai({
            ataskaitos: [
                {
                    laikotarpisIki: "2021-12-31",
                    standards: [
                        {
                            lines: [
                                { lineName: "Pelnas (nuostoliai) prieš apmokestinimą", reiksme: 8000 },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(result.byYear[0].pelnas).toBe(8000);
    });

    it("accepts the alternative isipareigojimai line name", () => {
        const result = aggregateFinansai({
            ataskaitos: [
                {
                    laikotarpisIki: "2020-12-31",
                    standards: [
                        {
                            lines: [
                                { lineName: "Mokėtinos sumos ir įsipareigojimai", reiksme: 12000 },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(result.byYear[0].isipareigojimai).toBe(12000);
    });

    it("flattens lines across multiple standards in one year", () => {
        const result = aggregateFinansai({
            ataskaitos: [
                {
                    laikotarpisIki: "2023-12-31",
                    standards: [
                        { lines: [{ lineName: "Pardavimo pajamos", reiksme: 70000 }] },
                        { lines: [{ lineName: "Ilgalaikis turtas", reiksme: 25000 }] },
                    ],
                },
            ],
        });
        expect(result.byYear[0].pajamos).toBe(70000);
        expect(result.byYear[0].ilgalaikis).toBe(25000);
    });

    it("sujungia atskiras balanso ir pelno ataskaitas pagal metus", () => {
        const result = aggregateFinansai({
            ataskaitos: [
                {
                    laikotarpisIki: "2024-12-31",
                    standards: [{ lines: [{ lineName: "Pardavimo pajamos", reiksme: 90000 }] }],
                },
                {
                    laikotarpisIki: "2024-12-31",
                    standards: [{ lines: [{ lineName: "Ilgalaikis turtas", reiksme: 45000 }] }],
                },
            ],
        });
        expect(result.byYear).toHaveLength(1);
        expect(result.byYear[0]).toMatchObject({
            metai: 2024,
            pajamos: 90000,
            ilgalaikis: 45000,
        });
    });

    it("handles missing standards property gracefully", () => {
        const result = aggregateFinansai({
            ataskaitos: [{ laikotarpisIki: "2023-12-31" }],
        });
        expect(result.byYear[0]).toEqual({
            metai: 2023,
            pajamos: null,
            pelnas: null,
            ilgalaikis: null,
            trumpalaikis: null,
            kapitalas: null,
            isipareigojimai: null,
        });
    });

    it("sorts byYear ascending across multiple years", () => {
        const result = aggregateFinansai({
            ataskaitos: [
                { laikotarpisIki: "2024-12-31", standards: [] },
                { laikotarpisIki: "2022-12-31", standards: [] },
                { laikotarpisIki: "2023-12-31", standards: [] },
            ],
        });
        expect(result.byYear.map((r: { metai: number }) => r.metai)).toEqual([2022, 2023, 2024]);
    });

    it("filters out ataskaita entries without laikotarpisIki", () => {
        const result = aggregateFinansai({
            ataskaitos: [
                { standards: [] }, // no laikotarpisIki
                { laikotarpisIki: "2023-12-31", standards: [] },
            ],
        });
        expect(result.byYear).toHaveLength(1);
        expect(result.byYear[0].metai).toBe(2023);
    });

    it("extracts metai from the first 4 characters of laikotarpisIki", () => {
        const result = aggregateFinansai({
            ataskaitos: [{ laikotarpisIki: "2019-06-30", standards: [] }],
        });
        expect(result.byYear[0].metai).toBe(2019);
    });
});
