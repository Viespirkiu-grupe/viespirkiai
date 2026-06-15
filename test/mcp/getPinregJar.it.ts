/**
 * Integration tests for the get_pinreg_jar MCP tool handler.
 * Requires a live DB. Run: npm run test:integration
 */

import { describe, it, expect } from "vitest";
import { handler } from "../../modules/mcp/tools/getPinregJar.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;

function parseResult(result: AnyResult) {
    const text = result.content?.[0]?.text;
    expect(typeof text).toBe("string");
    return JSON.parse(text);
}

// Kelmės rajono savivaldybės administracija — known to have both direct and
// spousal PINREG declarations.
const KNOWN_JAR_KODAS = "188768730";

describe("get_pinreg_jar", () => {
    it("returns asmenys and rysiaiSuJa grouped by person", async () => {
        const result = (await handler({
            jarKodas: KNOWN_JAR_KODAS,
            limit: 5,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(Array.isArray(payload.asmenys)).toBe(true);
        expect(Array.isArray(payload.rysiaiSuJa)).toBe(true);
        expect(payload.asmenys.length).toBeGreaterThan(0);
        expect(payload.limit).toBe(5);
    });

    it("each asmuo has a single readable name and grouped deklaracijos/irasos", () => {
        return handler({ jarKodas: KNOWN_JAR_KODAS, limit: 5 }).then((result) => {
            const payload = parseResult(result as AnyResult);
            const asmuo = payload.asmenys[0];

            expect(typeof asmuo.asmuo).toBe("string");
            expect(asmuo.asmuo).not.toMatch(/\*/); // not censored
            expect(["tiesioginis", "sutuoktinis"]).toContain(asmuo.rysys);
            expect(Array.isArray(asmuo.deklaracijos)).toBe(true);
            expect(asmuo.deklaracijos.length).toBeGreaterThan(0);

            const dekl = asmuo.deklaracijos[0];
            expect(typeof dekl.uuid).toBe("string");
            expect(Array.isArray(dekl.irasos)).toBe(true);
            expect(dekl.irasos.length).toBeGreaterThan(0);

            const iraso = dekl.irasos[0];
            // raw identity fields must not leak into individual records
            expect(iraso.vardas).toBeUndefined();
            expect(iraso.pavarde).toBeUndefined();
            expect(iraso.asmuo).toBeUndefined();
            expect(iraso.jarKodas).toBeUndefined();
        });
    });

    it("limit caps the number of unique asmenys, not raw rows", async () => {
        const limited = parseResult(
            (await handler({ jarKodas: KNOWN_JAR_KODAS, limit: 1 })) as AnyResult,
        );
        const unlimited = parseResult(
            (await handler({ jarKodas: KNOWN_JAR_KODAS, limit: 100 })) as AnyResult,
        );

        expect(limited.asmenys.length).toBeLessThanOrEqual(1);
        expect(limited.counts.asmenys).toBe(unlimited.counts.asmenys);
        expect(unlimited.counts.asmenys).toBeGreaterThan(limited.asmenys.length);
    });

    it("returns empty asmenys/rysiaiSuJa for a jarKodas with no PINREG data", async () => {
        const result = (await handler({
            jarKodas: "100000001",
            limit: 5,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(payload.asmenys).toEqual([]);
        expect(payload.rysiaiSuJa).toEqual([]);
        expect(payload.counts).toEqual({ asmenys: 0, rysiaiSuJa: 0 });
    });
});
