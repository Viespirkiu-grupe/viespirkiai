/**
 * Integration tests for the MCP get_schema handler.
 * Requires a real PostgreSQL database (direct connection, not PgBouncer).
 *
 * Run: npm run test:integration
 */

import { describe, it, expect } from "vitest";
import { handler } from "../../modules/mcp/tools/getSchema.js";
import { postgres } from "../../postgres/postgres.js";
import { TEMP_VIEWS_SQL, VIEW_NAMES } from "../../modules/mcp/analyst/tempViews.js";

function printResult(label: string, payload: unknown) {
    const text = JSON.stringify(payload, null, 2);
    console.log(`\n=== ${label} ===\n${text}\n`);
}

function assertWhereExample(sql: string, label: string) {
    expect(sql, `${label} should include a WHERE clause`).toMatch(/\bWHERE\b/i);
    expect(sql, `${label} must not include LIMIT`).not.toMatch(/\bLIMIT\b/i);
    expect(sql, `${label} must be a single-line SQL string`).not.toMatch(/\n/);
    expect(sql, `${label} must not use SELECT *`).not.toMatch(/\bSELECT\s+\*/i);
}

function assertColumnStringArray(columns: unknown, label: string) {
    expect(Array.isArray(columns), `${label} must be an array`).toBe(true);
    for (const col of columns as string[]) {
        expect(col).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*:\s\w+/);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;

describe("MCP get_schema — no-arg summary", () => {
    it("returns entities inventory with views and tables", async () => {
        const result = (await handler()) as AnyResult;
        printResult("handler()", result);
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.entities).toBeDefined();
        expect(Array.isArray(sc.entities)).toBe(true);
        expect(sc.entities.length).toBeGreaterThan(0);
        expect(typeof result?.content?.[0]?.text).toBe("string");
    });

    it("each view entry includes keyColumns and linksTo", async () => {
        const result = (await handler()) as AnyResult;
        const sc = result?.structuredContent as AnyResult;
        const views = sc.entities.filter((e: AnyResult) => e.identifier.startsWith("v_"));
        expect(views.length).toBeGreaterThan(0);
        for (const view of views) {
            expect(Array.isArray(view.keyColumns), `${view.identifier} must have keyColumns array`).toBe(true);
            expect(view.keyColumns.length, `${view.identifier} keyColumns must not be empty`).toBeGreaterThan(0);
            expect(Array.isArray(view.linksTo), `${view.identifier} must have linksTo array`).toBe(true);
        }
    });
});

describe("MCP get_schema — view detail", () => {
    it("returns full column list, primaryKeys and example for v_sutartys", async () => {
        const result = (await handler({ table: "v_sutartys" })) as AnyResult;
        printResult('handler({ table: "v_sutartys" })', result);
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.identifier).toBe("v_sutartys");
        expect("type" in sc).toBe(false);
        assertColumnStringArray(sc?.columns, "View columns");
        expect(Array.isArray(sc?.primaryKeys)).toBe(true);
        expect(Array.isArray(sc?.relationships)).toBe(true);
        expect(JSON.stringify(sc)).not.toContain("nullable");
        expect(typeof sc?.example).toBe("string");
        assertWhereExample(sc.example, "View example");
        expect("sourceSQL" in sc).toBe(false);
        expect(typeof result?.content?.[0]?.text).toBe("string");
    });
});

describe("MCP get_schema — covered table redirect", () => {
    it("returns redirect message for sutartys (covered by v_sutartys)", async () => {
        const result = (await handler({ table: "sutartys" })) as AnyResult;
        printResult('handler({ table: "sutartys" })', result);
        const text: string = result?.content?.[0]?.text ?? "";
        expect(text).toContain("v_sutartys");
        expect(text.toLowerCase()).toMatch(/covered|view/);
        // No structuredContent with columns — it is a redirect, not a schema
        expect(result?.structuredContent).toBeUndefined();
    });
});

describe("MCP get_schema — uncovered table detail", () => {
    it("returns full schema for mokesciai (not covered by any view)", async () => {
        const result = (await handler({ table: "mokesciai" })) as AnyResult;
        printResult('handler({ table: "mokesciai" })', result);
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.identifier).toBe("mokesciai");
        assertColumnStringArray(sc?.columns, "Table columns");
        expect(Array.isArray(sc?.primaryKeys)).toBe(true);
        expect(Array.isArray(sc?.relationships)).toBe(true);
        expect(JSON.stringify(sc)).not.toContain("nullable");
        expect(typeof sc?.example).toBe("string");
        assertWhereExample(sc.example, "Table example");
        expect("sampleRows" in sc).toBe(false);
        expect(typeof result?.content?.[0]?.text).toBe("string");
    });
});

describe("MCP get_schema — curated metadata matches DB columns", () => {
    it("all view columns match information_schema for each temp view", async () => {
        const client = await postgres.connect();
        try {
            await client.query(TEMP_VIEWS_SQL);
            for (const viewName of VIEW_NAMES) {
                const toolResult = (await handler({ table: viewName })) as AnyResult;
                const sc = toolResult?.structuredContent as AnyResult;
                const declared = (sc.columns as string[]).map((c) => c.split(": ")[0]);
                const { rows } = await client.query(
                    `
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_name = $1
                          AND table_schema LIKE 'pg_temp_%'
                        ORDER BY ordinal_position
                    `,
                    [viewName]
                );
                const actual = rows.map((r: { column_name: string }) => r.column_name);
                expect(declared, `Column mismatch for ${viewName}`).toEqual(actual);
            }
        } finally {
            client.release();
        }
    });
});
