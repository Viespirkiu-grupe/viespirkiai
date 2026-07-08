import { beforeEach, describe, expect, it, vi } from "vitest";

const quickwitSearch = vi.fn();
const pgQuery = vi.fn();

vi.mock("../quickwit/quickwit.js", () => ({
    search: quickwitSearch,
}));

vi.mock("../postgres/postgres.js", () => ({
    postgres: {
        query: pgQuery,
        connect: vi.fn(),
        end: vi.fn(),
    },
}));

describe("viesiejiPirkimai Quickwit query", () => {
    it("builds full text, raw, date, amount and BVPZ filters", async () => {
        const { buildViesiejiPirkimaiQuickwitQuery } = await import("../modules/viesiejiPirkimai/searchViesiejiPirkimai.js");

        const query = buildViesiejiPirkimaiQuickwitQuery({
            search: "žalia\\ energija",
            pvJarKodas: "188656261",
            statusas: "Paskelbtas",
            pirkimoBudas: "Atviras konkursas",
            paskelbimoDataNuo: "2026-01-02",
            paskelbimoDataIki: "2026-01-03",
            verteNuo: "10,5",
            verteIki: "20.5",
            bvpzPrefiksai: "45, 72",
        });

        expect(query).toContain("pavadinimas:(zalia\\\\ energija)");
        expect(query).toContain('jarKodas:"188656261"');
        expect(query).toContain('statusas:"Paskelbtas"');
        expect(query).toContain('pirkimoBudas:"Atviras konkursas"');
        expect(query).toContain("paskelbimoData:[2026-01-02T00:00:00Z TO *]");
        expect(query).toContain("paskelbimoData:[* TO 2026-01-03T23:59:59Z]");
        expect(query).toContain("numatomaBendraPirkimoVerte:[10.5 TO *]");
        expect(query).toContain("numatomaBendraPirkimoVerte:[* TO 20.5]");
        expect(query).toContain("(bvpzKodai:45* OR bvpzKodai:72*)");
    });

    it("loads PostgreSQL rows in Quickwit hit order", async () => {
        quickwitSearch.mockResolvedValue({
            hits: [{ pirkimoId: "2" }, { pirkimoId: "1" }],
            numHitsEstimate: 2,
        });
        pgQuery.mockResolvedValue({
            rows: [
                { pirkimoId: "1", pavadinimas: "Pirmas", pirkimoVykdytojas: "A", informacija: "" },
                { pirkimoId: "2", pavadinimas: "Antras", pirkimoVykdytojas: "B", informacija: "" },
            ],
        });

        const { searchViesiejiPirkimai } = await import("../modules/viesiejiPirkimai/searchViesiejiPirkimai.js");
        const result = await searchViesiejiPirkimai({}, { engine: "quickwit", limit: 50, page: 1 });

        expect(result.results.map((row: any) => row.pirkimoId)).toEqual(["2", "1"]);
        expect(quickwitSearch).toHaveBeenCalledWith(
            "viesiejiPirkimai",
            expect.objectContaining({ query: "*", sort_by: "paskelbimoData" }),
            { minHits: 50 },
        );
    });
});

describe("viesiejiPirkimai Quickwit document", () => {
    beforeEach(() => {
        quickwitSearch.mockReset();
        pgQuery.mockReset();
    });

    it("normalizes document fields for Quickwit", async () => {
        const { buildDoc } = await import("../modules/viesiejiPirkimai/quickwitProcessIndexQueue.js");

        const doc = buildDoc({
            pirkimoId: "123",
            pavadinimas: "Žalios elektros pirkimas",
            pirkimoVykdytojas: "Vilniaus miesto savivaldybė",
            informacija: "Atviras konkursas",
            paskelbimoData: "2026-07-07 10:11:12",
            pasiulymuPateikimoTerminas: null,
            pirkimoBudas: "Atviras konkursas",
            statusas: "Paskelbtas",
            numatomaBendraPirkimoVerte: "123.45",
            zingsnis: "Pasiūlymų pateikimas",
            type: "CfTWS",
            numatomaVerteEUR: null,
            bvpzKodai: ["09310000"],
            pirkimoObjektoTipas: "Prekės",
            esFinansavimas: true,
            pirkimoVykdytojasId: "abc",
            jarKodas: "188710061",
        });

        expect(doc.pirkimoId).toBe("123");
        expect(doc.tekstas).toContain("Zalios elektros pirkimas");
        expect(doc.tekstas).toContain("Vilniaus miesto savivaldybe");
        expect(doc.numatomaBendraPirkimoVerte).toBe(123.45);
        expect(doc.paskelbimoData).toBe("2026-07-07T10:11:12Z");
        expect(doc.bvpzKodai).toEqual(["09310000"]);
    });
});
