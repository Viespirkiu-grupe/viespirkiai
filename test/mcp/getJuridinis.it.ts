/**
 * Integration tests for the get_juridinis MCP tool handler.
 * Requires a live DB. Run: npm run test:integration
 */

import { describe, it, expect } from "vitest";
import { handler } from "../../modules/mcp/tools/getJuridinis.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;

function parseResult(result: AnyResult) {
    expect(result.isError, "isError must be falsy").toBeFalsy();
    const text = result.content?.[0]?.text;
    expect(typeof text).toBe("string");
    return JSON.parse(text);
}

const KNOWN_JAR_KODAS = "302556251";

describe("get_juridinis", () => {
    it("returns full company profile for a known jarKodas", async () => {
        const result = (await handler({
            jarKodas: KNOWN_JAR_KODAS,
            sutartysLimit: 5,
            pinregLimit: 3,
            teismoNuosprendziaiLimit: 5,
            regitraLimit: 3,
            darboSkelbimaiLimit: 3,
            rcPranesimaiLimit: 3,
            domenaiLimit: 3,
            kotisLimit: 3,
            esInvesticijosLimit: 3,
            mvpAprasaiLimit: 1,
        })) as AnyResult;

        const asmuo = parseResult(result);
        expect(asmuo).toHaveProperty("jar");
        expect(String(asmuo.jar.jarKodas)).toBe(KNOWN_JAR_KODAS);
        expect(typeof asmuo.jar.pavadinimas).toBe("string");
        expect(asmuo.jar.pavadinimas.length).toBeGreaterThan(0);
    });

    it("returns isError for a non-existent jarKodas", async () => {
        const result = (await handler({
            jarKodas: "100000001",
            sutartysLimit: 5,
            pinregLimit: 3,
            teismoNuosprendziaiLimit: 5,
            regitraLimit: 3,
            darboSkelbimaiLimit: 3,
            rcPranesimaiLimit: 3,
            domenaiLimit: 3,
            kotisLimit: 3,
            esInvesticijosLimit: 3,
            mvpAprasaiLimit: 1,
        })) as AnyResult;

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("100000001");
    });

    it("sodra is aggregated — no raw duomenys, has byYear and peak", async () => {
        const result = (await handler({
            jarKodas: KNOWN_JAR_KODAS,
            sutartysLimit: 5,
            pinregLimit: 3,
            teismoNuosprendziaiLimit: 5,
            regitraLimit: 3,
            darboSkelbimaiLimit: 3,
            rcPranesimaiLimit: 3,
            domenaiLimit: 3,
            kotisLimit: 3,
            esInvesticijosLimit: 3,
            mvpAprasaiLimit: 1,
        })) as AnyResult;

        const asmuo = parseResult(result);
        if (asmuo.sodra) {
            expect(asmuo.sodra.duomenys).toBeUndefined();
            expect(Array.isArray(asmuo.sodra.byYear)).toBe(true);
            expect(asmuo.sodra.byYear.length).toBeGreaterThan(0);
            expect(Array.isArray(asmuo.sodra.gaps)).toBe(true);
            const yr = asmuo.sodra.byYear[0];
            expect(yr).toHaveProperty("metai");
            expect(yr).toHaveProperty("avgDraustieji");
            expect(yr).toHaveProperty("avgAtlyginimas");
        }
    });

    it("finansai is aggregated into byYear rows with fraud-relevant fields only", async () => {
        const result = (await handler({
            jarKodas: KNOWN_JAR_KODAS,
            sutartysLimit: 5,
            pinregLimit: 3,
            teismoNuosprendziaiLimit: 5,
            regitraLimit: 3,
            darboSkelbimaiLimit: 3,
            rcPranesimaiLimit: 3,
            domenaiLimit: 3,
            kotisLimit: 3,
            esInvesticijosLimit: 3,
            mvpAprasaiLimit: 1,
        })) as AnyResult;

        const asmuo = parseResult(result);
        if (asmuo.finansai) {
            // Raw arrays and schema metadata must be gone
            expect(asmuo.finansai.balansai).toBeUndefined();
            expect(asmuo.finansai.pelnasNuostoliai).toBeUndefined();
            expect(asmuo.finansai.ataskaitos).toBeUndefined();
            expect(asmuo.finansai.pagalEilute).toBeUndefined();
            expect(asmuo.finansai.lentele).toBeUndefined();

            // byYear must exist and be sorted ascending
            expect(Array.isArray(asmuo.finansai.byYear)).toBe(true);
            expect(asmuo.finansai.byYear.length).toBeGreaterThan(0);

            const years = asmuo.finansai.byYear.map((r: AnyResult) => r.metai);
            expect(years).toEqual([...years].sort((a, b) => a - b));

            // Each row must have exactly the 7 expected fields
            const EXPECTED_FIELDS = ["metai", "pajamos", "pelnas", "ilgalaikis", "trumpalaikis", "kapitalas", "isipareigojimai"];
            for (const row of asmuo.finansai.byYear) {
                for (const f of EXPECTED_FIELDS) {
                    expect(row).toHaveProperty(f);
                }
                // No schema metadata should leak through
                expect(row.templateId).toBeUndefined();
                expect(row.standardId).toBeUndefined();
                expect(row.lineTypeId).toBeUndefined();
            }

            // The known company has financial data — at least one year should have revenue
            const withRevenue = asmuo.finansai.byYear.filter((r: AnyResult) => r.pajamos !== null);
            expect(withRevenue.length).toBeGreaterThan(0);
        }
    });

    it("respects sutartysLimit — returns no more than requested", async () => {
        const result = (await handler({
            jarKodas: KNOWN_JAR_KODAS,
            sutartysLimit: 2,
            pinregLimit: 1,
            teismoNuosprendziaiLimit: 1,
            regitraLimit: 1,
            darboSkelbimaiLimit: 1,
            rcPranesimaiLimit: 1,
            domenaiLimit: 1,
            kotisLimit: 1,
            esInvesticijosLimit: 1,
            mvpAprasaiLimit: 1,
        })) as AnyResult;

        const asmuo = parseResult(result);
        if (Array.isArray(asmuo.sutartys?.sutartys)) {
            expect(asmuo.sutartys.sutartys.length).toBeLessThanOrEqual(2);
        }
    });

    it("returns pavadinimas and aprasymas for a special jarKodas (no DB needed)", async () => {
        const result = (await handler({
            jarKodas: "801",
            sutartysLimit: 5,
            pinregLimit: 3,
            teismoNuosprendziaiLimit: 5,
            regitraLimit: 3,
            darboSkelbimaiLimit: 3,
            rcPranesimaiLimit: 3,
            domenaiLimit: 3,
            kotisLimit: 3,
            esInvesticijosLimit: 3,
            mvpAprasaiLimit: 1,
        })) as AnyResult;

        const payload = parseResult(result);
        expect(typeof payload.pavadinimas).toBe("string");
        expect(typeof payload.aprasymas).toBe("string");
    });
});
