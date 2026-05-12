/**
 * Integration tests for the MCP execute_query handler.
 * Requires a real PostgreSQL database (direct connection, not PgBouncer).
 *
 * Run: npm run test:integration
 */

import { describe, it, expect } from "vitest";
import { handler } from "../../modules/mcp/tools/executeQuery.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;

// ---------------------------------------------------------------------------
// Unhappy path — validation rejection
// ---------------------------------------------------------------------------

describe("execute_query — validation rejection", () => {
    it("returns isError when query references a disallowed table", async () => {
        const result = (await handler({
            query: "SELECT * FROM pg_catalog.pg_tables",
            purpose: "testing validation rejection",
            page: 1,
        })) as AnyResult;

        expect(result.isError, "isError must be true for invalid query").toBe(true);
        expect(result.content?.[0]?.text, "error text must be present").toBeTruthy();
        expect(result.content[0].text).toBe("Table 'pg_catalog.pg_tables' is not in the allowed table list — schema-qualified references are not permitted. Call get_schema to see available tables.");
    });
});

// ---------------------------------------------------------------------------
// Happy path — no pagination (page 1, small result set)
// ---------------------------------------------------------------------------

describe("execute_query — happy path without pagination", () => {
    it("returns rows, page metadata, and no hasMore for a small result set", async () => {
        const result = (await handler({
            query: "SELECT \"sutartiesUnikalusId\" FROM sutartys ORDER BY \"sutartiesUnikalusId\" LIMIT 5",
            purpose: "smoke test: fetch 5 contracts",
            page: 1,
        })) as AnyResult;

        expect(result.isError, "isError must be falsy for a valid query").toBeFalsy();
        const text = result.content?.[0]?.text;
        expect(typeof text).toBe("string");

        const payload = JSON.parse(text);
        expect(payload.page).toBe(1);
        expect(payload.pageSize).toBe(50);
        expect(Array.isArray(payload.rows), "rows must be an array").toBe(true);
        expect(payload.rows.length, "must return 5 rows").toBe(5);
        expect(payload.hasMore, "hasMore must be false for 5-row result").toBe(false);
        expect(typeof payload.durationMs).toBe("number");
        expect("sutartiesUnikalusId" in payload.rows[0], "expected column missing").toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Happy path — with pagination (page 2)
// ---------------------------------------------------------------------------

describe("execute_query — happy path with pagination", () => {
    it("page 1 signals hasMore and page 2 returns the next slice", async () => {
        const query = "SELECT \"sutartiesUnikalusId\" FROM sutartys ORDER BY \"sutartiesUnikalusId\"";
        const purpose = "pagination test";

        const [page1Result, page2Result] = await Promise.all([
            handler({ query, purpose, page: 1 }) as Promise<AnyResult>,
            handler({ query, purpose, page: 2 }) as Promise<AnyResult>,
        ]);

        // Page 1
        expect(page1Result.isError).toBeFalsy();
        const p1 = JSON.parse(page1Result.content[0].text);
        expect(p1.page).toBe(1);
        expect(p1.rows.length).toBe(50);
        expect(p1.hasMore, "page 1 must signal hasMore for a large table").toBe(true);

        // Page 2
        expect(page2Result.isError).toBeFalsy();
        const p2 = JSON.parse(page2Result.content[0].text);
        expect(p2.page).toBe(2);
        expect(p2.rows.length, "page 2 must have rows").toBeGreaterThan(0);

        // The first row IDs on each page must differ
        expect(
            p1.rows[0].sutartiesUnikalusId,
            "page 1 and page 2 must not start with the same row"
        ).not.toBe(p2.rows[0].sutartiesUnikalusId);
    });
});
