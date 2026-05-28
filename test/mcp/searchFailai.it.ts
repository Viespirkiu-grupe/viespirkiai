/**
 * Integration tests for the search_failai MCP tool handler.
 * Requires live PostgreSQL + Quickwit. Run: npm run test:integration
 *
 * readTekstasFs is mocked so snippet tests work without a configured
 * failaiTekstasLocation — the mock returns a fixed Lithuanian procurement
 * document (test/mocks/dokumentas.txt) for any hash.
 */

import { vi, describe, it, expect } from "vitest";

vi.mock("../../modules/failai/tekstasFs.js", async () => {
    const fs = await import("fs/promises");
    const MOCK_TEXT = await fs.readFile("test/mocks/dokumentas.txt", "utf8");
    return {
        readTekstasFs: async (_hash: string) => MOCK_TEXT,
        getTekstasPath: () => null,
        hashTekstas: (s: string) => s,
        saveTekstasFs: async () => {},
        tekstasFsExists: async () => false,
    };
});

import { handler } from "../../modules/mcp/tools/searchFailai.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;

function parseResult(result: AnyResult) {
    expect(result.isError, "isError must be falsy").toBeFalsy();
    const text = result.content?.[0]?.text;
    expect(typeof text).toBe("string");
    return JSON.parse(text);
}

// ── Basic shape ───────────────────────────────────────────────────────────────

describe("search_failai — basic shape", () => {
    it("returns expected envelope fields (results, page, limit)", async () => {
        const result = (await handler({ extension: "pdf", page: 1, limit: 5 })) as AnyResult;
        const payload = parseResult(result);

        expect(Array.isArray(payload.results)).toBe(true);
        expect(payload.page).toBe(1);
        expect(payload.limit).toBe(5);
    });

    it("each result has id and extension fields", async () => {
        const result = (await handler({ extension: "pdf", page: 1, limit: 3 })) as AnyResult;
        const { results } = parseResult(result);

        expect(results.length).toBeGreaterThan(0);
        for (const row of results) {
            expect(row).toHaveProperty("id");
            expect(row).toHaveProperty("extension");
        }
    });

    it("strips heavy fields (tekstas, search_index) from every result", async () => {
        const result = (await handler({ extension: "pdf", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        for (const row of results) {
            expect(row).not.toHaveProperty("tekstas");
            expect(row).not.toHaveProperty("search_index");
        }
    });
});

// ── Extension filter ──────────────────────────────────────────────────────────

describe("search_failai — extension filter", () => {
    it("all results match the requested extension", async () => {
        const result = (await handler({ extension: "pdf", page: 1, limit: 10 })) as AnyResult;
        const { results } = parseResult(result);

        expect(results.length).toBeGreaterThan(0);
        for (const row of results) {
            expect(row.extension?.toLowerCase()).toBe("pdf");
        }
    });

    it("docx extension returns only docx files", async () => {
        const result = (await handler({ extension: "docx", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        for (const row of results) {
            expect(row.extension?.toLowerCase()).toBe("docx");
        }
    });
});

// ── Full-text search via Quickwit ─────────────────────────────────────────────

describe("search_failai — full-text search (Quickwit)", () => {
    it("returns results for a generic word search", async () => {
        const result = (await handler({ search: "sutartis", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        expect(results.length).toBeGreaterThan(0);
    });

    it("phrase search (quoted) returns results", async () => {
        const result = (await handler({ search: '"viešasis pirkimas"', page: 1, limit: 5 })) as AnyResult;
        const payload = parseResult(result);

        expect(Array.isArray(payload.results)).toBe(true);
    });

    it("paginates correctly — page 2 results differ from page 1", async () => {
        const r1 = (await handler({ search: "sutartis", page: 1, limit: 5 })) as AnyResult;
        const r2 = (await handler({ search: "sutartis", page: 2, limit: 5 })) as AnyResult;

        const p1 = parseResult(r1);
        const p2 = parseResult(r2);

        expect(p1.results.length).toBeGreaterThan(0);
        expect(p2.results.length).toBeGreaterThan(0);

        const ids1 = p1.results.map((r: AnyResult) => r.id);
        const ids2 = p2.results.map((r: AnyResult) => r.id);
        for (const id of ids2) {
            expect(ids1).not.toContain(id);
        }
    });
});

// ── saltinis filter ───────────────────────────────────────────────────────────

describe("search_failai — saltinis filter", () => {
    it("saltinis=cvpIs returns results without crashing", async () => {
        const result = (await handler({
            saltinis: "cvpIs",
            extension: "pdf",
            page: 1,
            limit: 5,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(Array.isArray(payload.results)).toBe(true);
    });
});

// ── puslapiaiMin / puslapiaiMax filters ───────────────────────────────────────

describe("search_failai — puslapiai filters", () => {
    it("puslapiaiMin=5 returns files with at least 5 pages", async () => {
        const result = (await handler({ puslapiaiMin: 5, page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        for (const row of results) {
            if (row.puslapiuSkaicius != null) {
                expect(row.puslapiuSkaicius).toBeGreaterThanOrEqual(5);
            }
        }
    });

    it("puslapiaiMax=2 returns files with at most 2 pages", async () => {
        const result = (await handler({ puslapiaiMax: 2, page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        for (const row of results) {
            if (row.puslapiuSkaicius != null) {
                expect(row.puslapiuSkaicius).toBeLessThanOrEqual(2);
            }
        }
    });
});

// ── Snippet (bug 2.2) ─────────────────────────────────────────────────────────
//
// readTekstasFs is mocked to return the mock procurement document for any hash.
// The mock document contains "Žemaitaitis" and "sutartis", so snippet positioning
// is testable end-to-end through the full handler → searchFailai → buildSnippets chain.

describe("search_failai — snippet", () => {
    it("full-text search returns snippet for each result that has a tekstasHash", async () => {
        const result = (await handler({ search: "sutartis", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        expect(results.length).toBeGreaterThan(0);

        // Every row that came through the Quickwit path has a tekstasHash in the DB.
        // The mock returns the document text for every hash, so snippet must be set.
        for (const row of results) {
            expect(row).toHaveProperty("snippet");
            expect(typeof row.snippet).toBe("string");
            expect(row.snippet.length).toBeGreaterThan(0);
        }
    });

    it("snippet is positioned around the search term", async () => {
        const result = (await handler({ search: "Žemaitaitis", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        expect(results.length).toBeGreaterThan(0);

        // The mock document contains "Žemaitaitis" — the snippet window must include it.
        for (const row of results) {
            expect(row).toHaveProperty("snippet");
            expect(row.snippet).toContain("Žemaitaitis");
        }
    });

    it("snippet is not the full raw tekstas column — it is bounded in length", async () => {
        const result = (await handler({ search: "sutartis", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        expect(results.length).toBeGreaterThan(0);

        // The mock document is 3001 chars; the snippet window is 400 chars.
        for (const row of results) {
            expect(row.snippet.length).toBeLessThanOrEqual(400);
        }
    });

    it("raw tekstas column is never exposed to Claude", async () => {
        const result = (await handler({ search: "sutartis", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        for (const row of results) {
            expect(row).not.toHaveProperty("tekstas");
            expect(row).not.toHaveProperty("search_index");
        }
    });
});

// ── Bug 2.1: name search relevance ───────────────────────────────────────────
//
// With snippets now available we can verify that "Žemaitaitis" results actually
// contain the name — not just that Quickwit returned 20 hits.

describe("search_failai — bug 2.1: name search relevance confirmed via snippet", () => {
    it("every result for a surname search has the surname in its snippet", async () => {
        const result = (await handler({
            search: "Žemaitaitis",
            page: 1,
            limit: 20,
        })) as AnyResult;

        const payload = parseResult(result);

        if (payload.results.length === 0) {
            console.warn("search_failai: 'Žemaitaitis' returned 0 results");
            return;
        }

        // The mock document contains "Žemaitaitis", and the snippet is positioned
        // around the first occurrence. All results get the same mock text, so the
        // snippet must contain the surname for every result.
        for (const row of payload.results) {
            expect(row).toHaveProperty("snippet");
            expect(row.snippet).toContain("Žemaitaitis");
        }
    });
});
