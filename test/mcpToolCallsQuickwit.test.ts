import { describe, expect, it } from "vitest";
import { buildDoc } from "../modules/mcp/quickwitProcessIndexQueue.js";

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
