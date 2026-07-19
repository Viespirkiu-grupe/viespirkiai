import { describe, expect, it, vi } from "vitest";
import {
    normalizeScrapedSutartis,
    prepareNormalizedScrapedCanonical,
    prepareScrapedCanonical,
} from "../modules/sutartys/prepareScrapedCanonical.js";

describe("scraped sutarties canonical diagnostika", () => {
    const scraped = {
        sutartiesUnikalusID: "1675305860",
        verte: "1 234,56",
        faktineIvykdimoVerte: "",
        sudarymoData: "2025-10-16",
        galiojimoData: "2025-10-17",
        faktineIvykdimoData: "",
        paskelbimoData: "2025-10-28 17:42:49",
        paskutinioRedagavimoData: "2025-10-28 17:42:49",
        pirkimoNumeris: " P-1\x00 ",
        dokumentai: [],
    };

    it("naudoja tą pačią normalizavimo ir canonical seką kaip importas", () => {
        const direct = prepareScrapedCanonical(scraped, { onInvalid: vi.fn() });
        const normalized = normalizeScrapedSutartis(scraped, { onInvalid: vi.fn() });
        const importPath = prepareNormalizedScrapedCanonical(normalized);

        expect(direct).toEqual(importPath);
        expect(direct?.sutartis).toMatchObject({
            unikalusId: 1675305860,
            numatomaVerte: 1234.56,
            faktineVerte: null,
            pirkimoNumeris: "P-1",
            paskelbimoData: "2025-10-28T17:42:49.000",
            redagavimoData: "2025-10-28T17:42:49.000",
        });
        expect(direct?.json).not.toContain("17:42:49.000Z");
        expect(direct?.md5).toMatch(/^[a-f0-9]{32}$/);
    });
});
