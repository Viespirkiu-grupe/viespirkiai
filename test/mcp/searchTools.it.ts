/**
 * Integration tests for search MCP tool handlers.
 * Requires a live DB. Run: npm run test:integration
 */

import { describe, it, expect } from "vitest";
import { handler as searchSutartysHandler } from "../../modules/mcp/tools/searchSutartys.js";
import { handler as searchJuridiniaiHandler } from "../../modules/mcp/tools/searchJuridiniai.js";
import { handler as searchFailaiHandler } from "../../modules/mcp/tools/searchFailai.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;

function parseResult(result: AnyResult) {
    expect(result.isError, "isError must be falsy").toBeFalsy();
    const text = result.content?.[0]?.text;
    expect(typeof text).toBe("string");
    return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// search_sutartys
// ---------------------------------------------------------------------------

describe("search_sutartys", () => {
    it("returns results and expected shape for a keyword search", async () => {
        const result = (await searchSutartysHandler({
            search: "švietimas",
            limit: 5,
            page: 1,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(Array.isArray(payload.results), "results must be array").toBe(true);
        expect(payload.results.length, "must return at least 1 result").toBeGreaterThan(0);
        expect(payload.page).toBe(1);
        expect(payload.limit).toBe(5);

        const row = payload.results[0];
        expect(row).toHaveProperty("sutartiesUnikalusId");
        expect(row).toHaveProperty("perkanciojiOrganizacija");
    });

    it("filters by sudarymoDataNuo / sudarymoDataIki without crashing", async () => {
        const result = (await searchSutartysHandler({
            sudarymoDataNuo: "2022-01-01",
            sudarymoDataIki: "2022-12-31",
            limit: 5,
            page: 1,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(Array.isArray(payload.results)).toBe(true);
    });

    it("returns isError for no params (open query) — still returns a valid array", async () => {
        const result = (await searchSutartysHandler({
            limit: 3,
            page: 1,
        })) as AnyResult;

        // Handler should not throw — it either returns results or isError
        expect(result).toHaveProperty("content");
    });

    // Bug report: tiekejoKodas=809 is the CVP IS placeholder for all natural persons,
    // so filtering by it alone returns hundreds of unrelated contracts.
    it("rejects tiekejoKodas=809 (fizinis asmuo) used alone with isError", async () => {
        const result = (await searchSutartysHandler({
            tiekejoKodas: "809",
            page: 1,
            limit: 5,
        })) as AnyResult;

        expect(result.isError, "must be isError when special code used alone").toBe(true);
        const text = result.content?.[0]?.text ?? "";
        expect(text).toContain("809");
    });

    it("allows tiekejoKodas=809 when combined with a search term", async () => {
        const result = (await searchSutartysHandler({
            tiekejoKodas: "809",
            search: "Žemaitaitis",
            page: 1,
            limit: 5,
        })) as AnyResult;

        // search narrows results enough — should proceed normally
        expect(result.isError).toBeFalsy();
        expect(result).toHaveProperty("content");
    });

    it("allows tiekejoKodas=809 when combined with perkanciosiosOrganizacijosKodas", async () => {
        const result = (await searchSutartysHandler({
            tiekejoKodas: "809",
            perkanciosiosOrganizacijosKodas: "188710442",
            page: 1,
            limit: 5,
        })) as AnyResult;

        expect(result.isError).toBeFalsy();
        expect(result).toHaveProperty("content");
    });
});

// ---------------------------------------------------------------------------
// search_juridiniai
// ---------------------------------------------------------------------------

describe("search_juridiniai", () => {
    it("returns isError when no search param is given", async () => {
        const result = (await searchJuridiniaiHandler({
            page: 1,
            limit: 5,
        })) as AnyResult;

        expect(result.isError, "isError must be true without any filter").toBe(true);
    });

    it("returns results and expected shape for a name search", async () => {
        const result = (await searchJuridiniaiHandler({
            search: "UAB",
            limit: 5,
            page: 1,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(Array.isArray(payload.results), "results must be array").toBe(true);
        expect(payload.results.length, "must return at least 1 result").toBeGreaterThan(0);
        expect(payload.page).toBe(1);
        expect(payload.limit).toBe(5);

        const row = payload.results[0];
        expect(row).toHaveProperty("jarKodas");
        expect(row).toHaveProperty("pavadinimas");
    });

    it("returns isError when location is given without locationRadius", async () => {
        const result = (await searchJuridiniaiHandler({
            location: "54.6872,25.2797",
            page: 1,
            limit: 5,
        })) as AnyResult;

        expect(result.isError, "isError must be true when radius is missing").toBe(true);
    });
});

// ---------------------------------------------------------------------------
// search_failai
// ---------------------------------------------------------------------------

describe("search_failai", () => {
    it("returns results filtered by extension", async () => {
        const result = (await searchFailaiHandler({
            extension: "pdf",
            limit: 5,
            page: 1,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(Array.isArray(payload.results), "results must be array").toBe(true);
        expect(payload.results.length, "must return at least 1 result").toBeGreaterThan(0);
        expect(payload.page).toBe(1);
        expect(payload.limit).toBe(5);

        const row = payload.results[0];
        expect(row).toHaveProperty("id");
        // Heavy fields stripped in handler
        expect(row).not.toHaveProperty("tekstas");
        expect(row).not.toHaveProperty("search_index");
    });

    it("returns results for a full-text search via Quickwit", async () => {
        const result = (await searchFailaiHandler({
            search: "sutartis",
            limit: 5,
            page: 1,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(Array.isArray(payload.results)).toBe(true);
        expect(payload.results.length).toBeGreaterThan(0);
    });
});
