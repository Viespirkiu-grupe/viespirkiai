import { describe, expect, it } from "vitest";
import {
    buildDoc,
    buildGeo,
    mortonTileKey,
    webMercatorTile,
} from "../modules/juridiniai/quickwitProcessIndexQueue.js";
import { buildJuridiniaiQuickwitQuery } from "../modules/juridiniai/searchQuickwit.js";
import { decodeMorton, mortonKey, tileCenter } from "../modules/juridiniai/quickwitMap.js";

describe("juridiniai Morton tile keys", () => {
    it("calculates Web Mercator and Morton values for every z0-z19 level", () => {
        const geo = buildGeo(54.6872, 25.2797);

        expect(geo).toMatchObject({
            lat: 54.6872,
            lon: 25.2797,
            z0: 0,
            z5: 396,
            z12: 6_488_951,
            z16: 1_661_171_662,
            z19: 106_314_986_408,
        });
        expect(Object.keys(geo!)).toHaveLength(22);
    });

    it("uses x bits in even and y bits in odd positions", () => {
        expect(mortonTileKey(2, 1, 2)).toBe(6);
        expect(webMercatorTile(54.6872, 25.2797, 2)).toEqual({ x: 2, y: 1 });
    });

    it("returns null without a complete coordinate pair", () => {
        expect(buildGeo(null, 25)).toBeNull();
        expect(buildGeo(54, null)).toBeNull();
    });
});

describe("juridiniai Quickwit search query", () => {
    it("combines text, multi-select facets, ranges and a map cell", () => {
        const query = buildJuridiniaiQuickwitQuery({
            search: "Žalias ąžuolas",
            registracija: "registruoti",
            apskritis: "Vilniaus apskritis,Kauno apskritis",
            darbuotojaiNuo: "10",
            atlyginimasIki: "2500,50",
            tileZoom: "12",
            tileKey: "6488951",
        });
        expect(query).toContain("pavadinimas:");
        expect(query).toContain("isregistruotas:false");
        expect(query).toContain('apskritis:\"Vilniaus apskritis\"');
        expect(query).toContain("darbuotojai:[10 TO *]");
        expect(query).toContain("vidutinisAtlyginimas:[* TO 2500.5]");
        expect(query).toContain("geo.z12:6488951");
    });

    it("round-trips Morton keys and returns a point inside the tile", () => {
        const key = mortonKey(3245, 1189, 12);
        expect(decodeMorton(key, 12)).toEqual({ x: 3245, y: 1189 });
        const center = tileCenter(3245, 1189, 12);
        expect(center.lat).toBeGreaterThan(-85.1);
        expect(center.lon).toBeLessThan(180);
    });
});

describe("juridiniai Quickwit document", () => {
    it("joins lookup values, metrics, dates and generated geography", () => {
        const doc = buildDoc({
            jarKodas: "123456789",
            pavadinimas: "UAB Žalias Ąžuolas",
            adresas: "Vilnius",
            formosKodas: 310,
            formosPavadinimas: "Uždaroji akcinė bendrovė",
            viesasis: false,
            statusoKodas: 0,
            statusoPavadinimas: "Teisinis statusas neįregistruotas",
            isregistruotas: false,
            registravimoData: "2020-01-15",
            isregistravimoData: null,
            savivaldybe: "Vilniaus m. sav.",
            apskritis: "Vilniaus apskritis",
            evrkKodas: "620100",
            evrkPavadinimas: "Programavimas",
            darbuotojai: "42",
            vidutinisAtlyginimas: "2450.32",
            vmiMokesciai: "123.45",
            istatinisKapitalas: null,
            pirkimuKiekis: "2",
            pirkimuSuma: "1000",
            pardavimuKiekis: "3",
            pardavimuSuma: "2000",
            byluKiekis: "0",
            vdiPazeidimuKiekis: "0",
            domenuKiekis: "1",
            lat: 54.6872,
            lon: 25.2797,
            atnaujinta: new Date("2026-08-01T10:00:00Z"),
        });

        expect(doc.pavadinimasAscii).toBe("UAB Zalias Azuolas");
        expect(doc.registravimoData).toBe("2020-01-15T00:00:00Z");
        expect(doc.rodikliai).toMatchObject({
            vmiMokesciai: 123.45,
            pirkimuKiekis: 2,
            byluKiekis: 0,
        });
        expect(doc.rodikliai).not.toHaveProperty("istatinisKapitalas");
        expect(doc.geo?.z19).toBe(106_314_986_408);
        expect(doc.atnaujinta).toBe("2026-08-01T10:00:00.000Z");
    });
});
