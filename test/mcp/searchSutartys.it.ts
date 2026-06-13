/**
 * Integration tests for searchSutartys with Typesense engine.
 * Requires live Typesense. Run: npm run test:integration
 */

import { describe, it, expect } from "vitest";
import { searchSutartys } from "../../modules/sutartys/searchSutartys.js";

describe("searchSutartys (postgres engine)", () => {
    it("does not compute aggregates unless explicitly requested", async () => {
        const { results, sutarciuKiekis, bendraVerte } = await searchSutartys(
            { perkanciosiosOrganizacijosKodas: "188710442" },
            { engine: "postgres", limit: 5, page: 1 },
        );

        expect(results.length).toBeGreaterThan(0);
        expect(sutarciuKiekis).toBeNull();
        expect(bendraVerte).toBeNull();
    });
});

describe("searchSutartys (typesense engine)", () => {
    it("returns results and expected shape for a keyword search", async () => {
        const { results, total } = await searchSutartys(
            { search: "švietimas" },
            { engine: "typesense", limit: 5, page: 1 },
        );

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        expect(typeof total).toBe("number");

        const row = results[0];
        expect(row).toHaveProperty("sutartiesUnikalusId");
        expect(row).toHaveProperty("perkanciojiOrganizacija");
        expect(row).toHaveProperty("pavadinimas");
        expect(Array.isArray(row.tiekejai)).toBe(true);
        expect(Array.isArray(row.tiekejaiKodai)).toBe(true);
        expect(Array.isArray(row.bvpzKodai)).toBe(true);
    });

    it("filters by tiekejoKodas", async () => {
        const first = await searchSutartys(
            { search: "*" },
            { engine: "typesense", limit: 1, page: 1 },
        );
        expect(first.results.length).toBeGreaterThan(0);

        const kodas = first.results[0].tiekejaiKodai[0];
        const { results } = await searchSutartys(
            { tiekejoKodas: kodas },
            { engine: "typesense", limit: 5, page: 1 },
        );

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        for (const row of results) {
            expect(row.tiekejaiKodai).toContain(kodas);
        }
    });

    it("filters by sudarymoDataNuo and sudarymoDataIki", async () => {
        const { results } = await searchSutartys(
            { sudarymoDataNuo: "2022-01-01", sudarymoDataIki: "2022-12-31" },
            { engine: "typesense", limit: 5, page: 1 },
        );

        expect(Array.isArray(results)).toBe(true);
    });

    it("paginates correctly", async () => {
        const page1 = await searchSutartys(
            { search: "sutartis" },
            { engine: "typesense", limit: 3, page: 1 },
        );
        const page2 = await searchSutartys(
            { search: "sutartis" },
            { engine: "typesense", limit: 3, page: 2 },
        );

        expect(page1.results.length).toBeGreaterThan(0);
        expect(page2.results.length).toBeGreaterThan(0);

        const ids1 = page1.results.map((r) => r.sutartiesUnikalusId);
        const ids2 = page2.results.map((r) => r.sutartiesUnikalusId);
        for (const id of ids2) {
            expect(ids1).not.toContain(id);
        }
    });

    // Bug report: "search='Žemaitaitis' returned 22 results with Agnius, Viktoras,
    // Gediminas, Eividas — completely unrelated people."
    //
    // Finding: the report is inaccurate — every result DOES contain "Žemaitaitis"
    // in the tiekejas field. The real limitation is that there is no exact/phrase
    // match: searching by surname finds everyone with that surname, so there is no
    // way to narrow to a specific person (e.g. "Remigijus Žemaitaitis") without
    // also providing a perkanciosiosOrganizacijosKodas or tiekejoKodas filter.
    it("surname search – all results contain the queried surname (no false positives)", async () => {
        const { results, total } = await searchSutartys(
            { search: "Žemaitaitis" },
            { engine: "typesense", limit: 50, page: 1 },
        );

        expect(total).toBeGreaterThan(0);
        expect(results.length).toBeGreaterThan(0);

        const surname = "žemaitaitis";
        for (const row of results) {
            const haystack = [
                row.pavadinimas ?? "",
                row.perkanciojiOrganizacija ?? "",
                ...(row.tiekejai ?? []),
            ]
                .join(" ")
                .toLowerCase();
            expect(
                haystack,
                `Expected every result to contain "${surname}" but got: tiekejai=${JSON.stringify(row.tiekejai)}`,
            ).toContain(surname);
        }
    });

    it("stream mode returns an async iterable of rows", async () => {
        const { stream, client, results } = await searchSutartys(
            { search: "švietimas" },
            { engine: "typesense", stream: true },
        );

        expect(results).toEqual([]);
        expect(client).toBeNull();
        expect(stream).not.toBeNull();

        const rows: object[] = [];
        for await (const row of stream!) {
            rows.push(row);
            if (rows.length >= 3) break;
        }

        expect(rows.length).toBeGreaterThan(0);
        const row = rows[0] as Record<string, unknown>;
        expect(row).toHaveProperty("sutartiesUnikalusId");
    });
});
