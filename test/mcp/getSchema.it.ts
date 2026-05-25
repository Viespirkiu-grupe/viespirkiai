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

function assertColumnsObject(columns: unknown, label: string) {
    expect(columns !== null && typeof columns === "object" && !Array.isArray(columns), `${label} must be a plain object`).toBe(true);
    for (const [name, type] of Object.entries(columns as Record<string, unknown>)) {
        expect(typeof name).toBe("string");
        expect(typeof type, `${label} column '${name}' type must be a string`).toBe("string");
    }
}

function assertJoinsTuples(joins: unknown, label: string) {
    expect(Array.isArray(joins), `${label} must be an array`).toBe(true);
    for (const join of joins as unknown[]) {
        expect(Array.isArray(join), `${label} join entry must be an array`).toBe(true);
        const [local, foreign, joinType] = join as string[];
        expect(typeof local).toBe("string");
        expect(typeof foreign).toBe("string");
        expect(["strict", "semantic", "sparse"]).toContain(joinType);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;

describe("MCP get_schema — inventory (no-arg)", () => {
    it("returns entities inventory with views and tables", async () => {
        const result = (await handler()) as AnyResult;
        printResult("handler()", result);
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.entities).toBeDefined();
        expect(Array.isArray(sc.entities)).toBe(true);
        expect(sc.entities.length).toBeGreaterThan(0);
        expect(typeof result?.content?.[0]?.text).toBe("string");
    });

    it("each view entry has id, kind, tags, and keys — no description or linksTo", async () => {
        const result = (await handler()) as AnyResult;
        const sc = result?.structuredContent as AnyResult;
        const views = sc.entities.filter((e: AnyResult) => e.kind === "view");
        expect(views.length).toBeGreaterThan(0);
        for (const view of views) {
            expect(view.id, `${view.id} must have id`).toBeDefined();
            expect(Array.isArray(view.tags), `${view.id} must have tags array`).toBe(true);
            expect(view.tags.length, `${view.id} tags must not be empty`).toBeGreaterThan(0);
            expect(Array.isArray(view.keys), `${view.id} must have keys array`).toBe(true);
            expect(view.keys.length, `${view.id} keys must not be empty`).toBeGreaterThan(0);
            // Inventory must NOT contain verbose fields
            expect("description" in view, `${view.id} must NOT have description in inventory`).toBe(false);
            expect("linksTo" in view, `${view.id} must NOT have linksTo in inventory`).toBe(false);
            expect("example" in view, `${view.id} must NOT have example in inventory`).toBe(false);
            expect("columns" in view, `${view.id} must NOT have columns in inventory`).toBe(false);
        }
    });

    it("each table entry has id, kind, and keys", async () => {
        const result = (await handler()) as AnyResult;
        const sc = result?.structuredContent as AnyResult;
        const tables = sc.entities.filter((e: AnyResult) => e.kind === "table");
        expect(tables.length).toBeGreaterThan(0);
        for (const table of tables) {
            expect(table.id).toBeDefined();
            expect(Array.isArray(table.keys)).toBe(true);
        }
    });
});

describe("MCP get_schema — view detail (table + mode:'detail')", () => {
    it("returns compact detail for v_sutartys", async () => {
        const result = (await handler({ table: "v_sutartys" })) as AnyResult;
        printResult('handler({ table: "v_sutartys" })', result);
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.id).toBe("v_sutartys");
        expect(Array.isArray(sc?.pk)).toBe(true);
        assertColumnsObject(sc?.columns, "View columns");
        assertJoinsTuples(sc?.joins, "View joins");
        expect(typeof sc?.ex).toBe("string");
        assertWhereExample(sc.ex, "View example");
        // Must NOT contain old verbose fields
        expect("identifier" in sc).toBe(false);
        expect("description" in sc).toBe(false);
        expect("relationships" in sc).toBe(false);
        expect("keyColumns" in sc).toBe(false);
        expect(typeof result?.content?.[0]?.text).toBe("string");
    });

    it("explicit mode:'detail' returns same shape", async () => {
        const result = (await handler({ table: "v_sutartys", mode: "detail" })) as AnyResult;
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.id).toBe("v_sutartys");
        assertColumnsObject(sc?.columns, "Explicit detail columns");
        assertJoinsTuples(sc?.joins, "Explicit detail joins");
    });
});

describe("MCP get_schema — mode:'columns'", () => {
    it("returns only id and columns object for v_sutartys", async () => {
        const result = (await handler({ table: "v_sutartys", mode: "columns" })) as AnyResult;
        printResult('handler({ table: "v_sutartys", mode: "columns" })', result);
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.id).toBe("v_sutartys");
        assertColumnsObject(sc?.columns, "Columns mode");
        expect("joins" in sc).toBe(false);
        expect("ex" in sc).toBe(false);
        expect("pk" in sc).toBe(false);
    });
});

describe("MCP get_schema — mode:'joins'", () => {
    it("returns only id, pk and joins for v_sutartys", async () => {
        const result = (await handler({ table: "v_sutartys", mode: "joins" })) as AnyResult;
        printResult('handler({ table: "v_sutartys", mode: "joins" })', result);
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.id).toBe("v_sutartys");
        expect(Array.isArray(sc?.pk)).toBe(true);
        assertJoinsTuples(sc?.joins, "Joins mode");
        expect("columns" in sc).toBe(false);
        expect("ex" in sc).toBe(false);
    });
});

describe("MCP get_schema — mode:'examples'", () => {
    it("returns only id and ex array for v_sutartys", async () => {
        const result = (await handler({ table: "v_sutartys", mode: "examples" })) as AnyResult;
        printResult('handler({ table: "v_sutartys", mode: "examples" })', result);
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.id).toBe("v_sutartys");
        expect(Array.isArray(sc?.ex)).toBe(true);
        expect(sc.ex.length).toBeGreaterThan(0);
        assertWhereExample(sc.ex[0], "Examples mode");
        expect("columns" in sc).toBe(false);
        expect("joins" in sc).toBe(false);
    });
});

describe("MCP get_schema — covered table redirect", () => {
    it("returns redirect message for sutartys (covered by v_sutartys)", async () => {
        const result = (await handler({ table: "sutartys" })) as AnyResult;
        printResult('handler({ table: "sutartys" })', result);
        const text: string = result?.content?.[0]?.text ?? "";
        expect(text).toContain("v_sutartys");
        expect(text.toLowerCase()).toMatch(/covered|view/);
        expect(result?.structuredContent).toBeUndefined();
    });
});

describe("MCP get_schema — uncovered table detail", () => {
    it("returns compact detail for mokesciai (not covered by any view)", async () => {
        const result = (await handler({ table: "mokesciai" })) as AnyResult;
        printResult('handler({ table: "mokesciai" })', result);
        const sc = result?.structuredContent as AnyResult;
        expect(sc?.id).toBe("mokesciai");
        assertColumnsObject(sc?.columns, "Table columns");
        expect(Array.isArray(sc?.pk)).toBe(true);
        assertJoinsTuples(sc?.joins, "Table joins");
        expect(typeof sc?.ex).toBe("string");
        assertWhereExample(sc.ex, "Table example");
        expect("identifier" in sc).toBe(false);
        expect("description" in sc).toBe(false);
        expect("relationships" in sc).toBe(false);
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
                const declared = Object.keys(sc.columns as Record<string, string>);
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
