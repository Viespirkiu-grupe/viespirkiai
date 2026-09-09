import { describe, expect, it } from "vitest";
import { changesFilterSql } from "../modules/sutartys/recentChanges.js";
import {
    arFiltruota,
    filtroNuoroda,
    filtroParams,
    parseRedagavimuFiltra,
    parseRikiavima,
    TUSCIAS_FILTRAS,
} from "../src/lib/sutartisPakeitimai.ts";

const params = (query: string) => new URLSearchParams(query);

describe("redagavimų filtrai", () => {
    it("numatytai slepia techninius pakeitimus", () => {
        const { where, params: values } = changesFilterSql({});
        expect(where).toBe('WHERE c."reiksmingas"');
        expect(values).toEqual([]);
    });

    it("laukų filtrui naudoja ?| operatorių – tik jis eina per GIN indeksą", () => {
        const { where, params: values } = changesFilterSql({
            visi: true,
            laukai: ["_verte", "dokumentai"],
        });
        expect(where).toBe('WHERE c."skirtumai" ?| $1::text[]');
        expect(values).toEqual([["_verte", "dokumentai"]]);
    });

    it("iki yra imtinai, o parametrai numeruojami iš eilės", () => {
        const { where, params: values } = changesFilterSql({
            nuo: "2026-09-01",
            iki: "2026-09-05",
            verteMin: 5000,
        });
        expect(where).toContain('c."pakeitimoData" >= $1::date');
        expect(where).toContain('c."pakeitimoData" < $2::date + 1');
        expect(where).toContain('abs(c."verteDelta") >= $3');
        expect(values).toEqual(["2026-09-01", "2026-09-05", 5000]);
    });

    it("parses URL parameters and ignores broken values", () => {
        expect(parseRedagavimuFiltra(params(
            "laukas=_verte&laukas=dokumentai&busena=istrinta&nuo=2026-09-01"
            + "&iki=blogai&verte=padidejo&verteMin=5000&visi=1",
        ))).toEqual({
            visi: true,
            laukai: ["_verte", "dokumentai"],
            busena: "istrinta",
            nuo: "2026-09-01",
            iki: null,
            verte: "padidejo",
            verteMin: 5000,
        });
        expect(parseRedagavimuFiltra(params(""))).toEqual(TUSCIAS_FILTRAS);
        expect(parseRikiavima(params("rikiavimas=kazkas"))).toBe("naujausi");
        expect(parseRikiavima(params("rikiavimas=verte"))).toBe("verte");
    });

    it("filtro nuoroda nuima vieną filtrą ir nepalieka puslapio numerio", () => {
        const filtras = parseRedagavimuFiltra(params("laukas=_verte&busena=istrinta"));
        expect(filtroNuoroda(filtras, "verte", { busena: null }))
            .toBe("?laukas=_verte&rikiavimas=verte");
        expect(filtroNuoroda(TUSCIAS_FILTRAS, "naujausi", {}))
            .toBe("/sutartys/redagavimai");
        expect(filtroParams(TUSCIAS_FILTRAS, "naujausi").toString()).toBe("");
    });

    it("atpažįsta, ar filtras įjungtas", () => {
        expect(arFiltruota(TUSCIAS_FILTRAS)).toBe(false);
        expect(arFiltruota(parseRedagavimuFiltra(params("visi=1")))).toBe(true);
    });
});
