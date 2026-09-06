import { describe, expect, it } from "vitest";
import { VIEW_METADATA } from "@/modules/mcp/tools/getSchema.js";
import { VIEW_NAMES } from "@/modules/mcp/analyst/tempViews.js";

// getSchema.ts pats tikrina pilnumą modulio įsikėlimo metu, tad be šio testo
// trūkstamas įrašas išlenda tik gyvai („Missing VIEW_METADATA for 'v_skelbimas'"
// pakeliui į bet kurį MCP puslapį). Čia jis krenta jau CI.
describe("MCP analitiko view'ų metaduomenys", () => {
    it("turi įrašą kiekvienam tempViews view'ui", () => {
        const trukstami = [...VIEW_NAMES].filter((vardas) => !VIEW_METADATA[vardas]);
        expect(trukstami).toEqual([]);
    });

    it("neaprašo view'ų, kurių nebėra", () => {
        const nereikalingi = Object.keys(VIEW_METADATA)
            .filter((vardas) => !VIEW_NAMES.has(vardas));
        expect(nereikalingi).toEqual([]);
    });
});
