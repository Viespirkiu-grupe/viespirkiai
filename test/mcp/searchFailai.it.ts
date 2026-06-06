/**
 * Integration tests for the search_failai MCP tool handler.
 * Requires live PostgreSQL + Quickwit + failaiTekstasLocation (remote URL). Run: npm run test:integration
 */

import { describe, it, expect } from "vitest";

import { handler } from "../../modules/mcp/tools/searchFailai.js";

// Mirrors the foldLithuanian used in buildSnippets: strip diacritics before comparing.
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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
    it("full-text search returns at least one non-null snippet", async () => {
        const result = (await handler({ search: "sutartis", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        expect(results.length).toBeGreaterThan(0);
        for (const row of results) {
            expect(row).toHaveProperty("snippet");
        }

        const snippets = results.map((r: AnyResult) => r.snippet).filter((s: unknown) => s !== null);
        expect(snippets.length).toBeGreaterThan(0);
        for (const s of snippets) {
            expect(typeof s).toBe("string");
            expect((s as string).length).toBeGreaterThan(0);
        }
    });

    it("snippet is positioned around the search term", async () => {
        const result = (await handler({ search: "sutartis", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        const snippets = results.map((r: AnyResult) => r.snippet).filter((s: unknown) => s !== null) as string[];
        expect(snippets.length).toBeGreaterThan(0);
        // Lithuanian inflection means the exact word form may not appear in OCR text,
        // so require at least one snippet to contain the folded (diacritic-stripped) term.
        const withTerm = snippets.filter(s => fold(s).includes(fold("sutartis")));
        expect(withTerm.length).toBeGreaterThan(0);
    });

    it("snippet is not the full raw tekstas column — it is bounded in length", async () => {
        const result = (await handler({ search: "sutartis", page: 1, limit: 5 })) as AnyResult;
        const { results } = parseResult(result);

        const snippets = results.map((r: AnyResult) => r.snippet).filter((s: unknown) => s !== null) as string[];
        expect(snippets.length).toBeGreaterThan(0);
        for (const s of snippets) {
            expect(s.length).toBeLessThanOrEqual(400);
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
// Verify that "Žemaitaitis" Quickwit results actually contain the name in their
// snippets — not just that Quickwit returned hits.

describe("search_failai — bug 2.1: name search relevance confirmed via snippet", () => {
    it("every snippet for a surname search contains the surname", async () => {
        const result = (await handler({
            search: "Žemaitaitis",
            page: 1,
            limit: 20,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(payload.results.length).toBeGreaterThan(0);

        const snippets = payload.results
            .map((r: AnyResult) => r.snippet)
            .filter((s: unknown) => s !== null) as string[];

        expect(snippets.length).toBeGreaterThan(0);
        // OCR text may store the name without Lithuanian diacritics ("Zemaitaitis"),
        // so compare after folding both sides.
        for (const s of snippets) {
            expect(fold(s)).toContain(fold("Žemaitaitis"));
        }
    });
});
