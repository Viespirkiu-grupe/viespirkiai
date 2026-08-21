import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDoc } from "../modules/mcp/quickwitProcessIndexQueue.js";

const INDEX_CONFIG = fs.readFileSync(
    path.join(import.meta.dirname, "../modules/mcp/mcpToolCalls.quickwit.yaml"),
    "utf8",
);

describe("mcpToolCalls Quickwit index config", () => {
    it("declares every field buildDoc can emit", () => {
        expect(INDEX_CONFIG).toMatch(/^version: 0\.9$/m);
        expect(INDEX_CONFIG).toMatch(/^index_id: mcpToolCallsTemplate$/m);

        const doc = buildDoc({
            id: "1",
            toolName: "search_sutartys",
            userAgent: "curl/8.9.1",
            success: true,
            durationMs: 412,
            errorMsg: "klaida",
            createdAt: new Date("2026-08-20T21:11:05.393Z"),
        });

        for (const field of Object.keys(doc)) {
            expect(INDEX_CONFIG).toContain(`name: ${field}`);
        }
        // `indexDocs` prideda jį pats, o `mode: strict` be jo neveiktų.
        expect(INDEX_CONFIG).toContain("name: quickwitId");
        expect(INDEX_CONFIG).toContain("timestamp_field: createdAt");
    });
});

describe("mcpToolCalls buildDoc", () => {
    it("normalises numbers and timestamps", () => {
        expect(
            buildDoc({
                id: "168514",
                toolName: "search_sutartys",
                userAgent: "curl/8.9.1",
                success: true,
                durationMs: 412,
                errorMsg: null,
                createdAt: new Date("2026-08-20T21:11:05.393Z"),
            }),
        ).toEqual({
            id: 168514,
            toolName: "search_sutartys",
            userAgent: "curl/8.9.1",
            success: true,
            durationMs: 412,
            createdAt: "2026-08-20T21:11:05.393Z",
        });
    });

    it("drops null fields but keeps false and zero", () => {
        const doc = buildDoc({
            id: "7",
            toolName: "get_schema",
            userAgent: null,
            success: false,
            durationMs: 0,
            errorMsg: null,
            createdAt: new Date("2026-08-20T21:11:05.000Z"),
        });

        expect(doc).not.toHaveProperty("userAgent");
        expect(doc).not.toHaveProperty("errorMsg");
        expect(doc.success).toBe(false);
        expect(doc.durationMs).toBe(0);
    });
});
