import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../modules/mcp/tools/getSchema.js";
import { postgres } from "../../postgres/postgres.js";
import { TEMP_VIEWS_SQL } from "../../modules/mcp/analyst/tempViews.js";
import { VIEW_NAMES } from "../../modules/mcp/analyst/tempViews.js";

function printResult(label, payload) {
    const text = JSON.stringify(payload, null, 2);
    console.log(`\n=== ${label} ===\n${text}\n`);
}

function assertWhereExample(sql, label) {
    assert.match(sql, /\bWHERE\b/i, `${label} should include a WHERE clause`);
    assert.doesNotMatch(sql, /\bLIMIT\b/i, `${label} must not include LIMIT`);
    assert.doesNotMatch(sql, /\n/, `${label} must be a single-line SQL string`);
    assert.doesNotMatch(sql, /\bSELECT\s+\*/i, `${label} must not use SELECT *`);
}

function assertColumnStringArray(columns, label) {
    assert.ok(Array.isArray(columns), `${label} must be an array`);
    for (const col of columns) {
        assert.match(col, /^[a-zA-Z_][a-zA-Z0-9_]*:\s\w+/, `${label} column '${col}' must be "name: type" format`);
    }
}

describe("MCP get_schema integration", () => {
    it("prints no-arg/get-view/get-table payloads and validates structuredContent contract", async () => {
        const noArgResult = await handler();
        printResult("handler()", noArgResult);
        assert.ok(noArgResult?.structuredContent?.entities, "Expected entities inventory in structuredContent");
        assert.ok(Array.isArray(noArgResult.structuredContent.entities), "Expected entities to be an array");
        assert.ok(noArgResult.structuredContent.entities.length > 0, "Expected at least one entity");
        assert.ok(typeof noArgResult?.content?.[0]?.text === "string", "Expected summary text");

        const viewResult = await handler({ table: "v_sutartys" });
        printResult("handler({ table: \"v_sutartys\" })", viewResult);
        assert.equal(viewResult?.structuredContent?.identifier, "v_sutartys");
        assert.ok(!("type" in viewResult.structuredContent), "Type should not be included");
        assertColumnStringArray(viewResult?.structuredContent?.columns, "View columns");
        assert.ok(Array.isArray(viewResult?.structuredContent?.primaryKeys), "Expected view primaryKeys array");
        assert.ok(Array.isArray(viewResult?.structuredContent?.relationships), "Expected view relationships");
        assert.doesNotMatch(JSON.stringify(viewResult.structuredContent), /nullable/, "nullable field must not appear");
        assert.ok(typeof viewResult?.structuredContent?.example === "string", "Expected view example SQL");
        assertWhereExample(viewResult.structuredContent.example, "View example");
        assert.ok(!("sourceSQL" in viewResult.structuredContent), "View metadata must not expose DDL/sourceSQL");
        assert.ok(typeof viewResult?.content?.[0]?.text === "string", "Expected view summary text");

        const tableResult = await handler({ table: "sutartys" });
        printResult("handler({ table: \"sutartys\" })", tableResult);
        assert.equal(tableResult?.structuredContent?.identifier, "sutartys");
        assert.ok(!("type" in tableResult.structuredContent), "Type should not be included");
        assertColumnStringArray(tableResult?.structuredContent?.columns, "Table columns");
        assert.ok(Array.isArray(tableResult?.structuredContent?.primaryKeys), "Expected table primaryKeys array");
        assert.ok(Array.isArray(tableResult?.structuredContent?.relationships), "Expected table relationships");
        assert.doesNotMatch(JSON.stringify(tableResult.structuredContent), /nullable/, "nullable field must not appear");
        assert.ok(typeof tableResult?.structuredContent?.example === "string", "Expected table example SQL");
        assertWhereExample(tableResult.structuredContent.example, "Table example");
        assert.ok(!("sampleRows" in tableResult.structuredContent), "Table metadata must stay normalized");
        assert.ok(typeof tableResult?.content?.[0]?.text === "string", "Expected table summary text");
    });

    it("ensures curated metadata includes all columns from each temp view", async () => {
        const client = await postgres.connect();
        try {
            await client.query(TEMP_VIEWS_SQL);
            for (const viewName of VIEW_NAMES) {
                const toolResult = await handler({ table: viewName });
                const declared = toolResult.structuredContent.columns.map((c) => c.split(": ")[0]);
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
                const actual = rows.map((r) => r.column_name);
                assert.deepEqual(declared, actual, `Column mismatch for ${viewName}`);
            }
        } finally {
            client.release();
        }
    });
});
