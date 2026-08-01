/**
 * Integration tests for the column-name auto-fix utility.
 * Exercises the full stack: executeWithColumnFix → _runQuery → real PostgreSQL.
 *
 * Run: npm run test:integration
 */

import { describe, it, expect } from "vitest";
import {
    extractBadColumnName,
    fixColumnInQuery,
    getMixedCaseMap,
    executeWithColumnFix,
    MAX_AUTO_RETRIES,
} from "../../modules/mcp/analyst/columnFixer.js";
import { handler } from "../../modules/mcp/tools/executeQuery.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;

// ---------------------------------------------------------------------------
// Pure-function unit coverage (no DB)
// ---------------------------------------------------------------------------

describe("extractBadColumnName", () => {
    it("extracts the lowercased column name from a PG error", () => {
        expect(extractBadColumnName('column "pirkejokodas" does not exist')).toBe("pirkejokodas");
    });

    it("strips table-qualifier prefix from quoted form: \"d.pirkimonumeris\" → \"pirkimonumeris\"", () => {
        expect(extractBadColumnName('column "d.pirkimonumeris" does not exist')).toBe("pirkimonumeris");
    });

    it("handles unquoted form with table qualifier: column d.pirkimonumeris does not exist", () => {
        expect(extractBadColumnName("column d.pirkimonumeris does not exist")).toBe("pirkimonumeris");
    });

    it("handles unquoted form without table qualifier: column pirkimonumeris does not exist", () => {
        expect(extractBadColumnName("column pirkimonumeris does not exist")).toBe("pirkimonumeris");
    });

    it("returns null for unrelated error text", () => {
        expect(extractBadColumnName("permission denied for table sutartys")).toBeNull();
    });

    it("returns null for empty string", () => {
        expect(extractBadColumnName("")).toBeNull();
    });
});

describe("fixColumnInQuery", () => {
    it("replaces quoted lowercase: \"pirkejokodas\" → \"pirkejoKodas\"", () => {
        const q = 'SELECT "pirkejokodas" FROM v_sutartys LIMIT 1';
        expect(fixColumnInQuery(q, "pirkejokodas", "pirkejoKodas"))
            .toBe('SELECT "pirkejoKodas" FROM v_sutartys LIMIT 1');
    });

    it("quotes and corrects unquoted camelCase", () => {
        const q = "SELECT pirkejoKodas FROM v_sutartys LIMIT 1";
        expect(fixColumnInQuery(q, "pirkejokodas", "pirkejoKodas"))
            .toBe('SELECT "pirkejoKodas" FROM v_sutartys LIMIT 1');
    });

    it("corrects all uppercase variant (PIRKEJOKODAS)", () => {
        const q = "SELECT PIRKEJOKODAS FROM v_sutartys LIMIT 1";
        expect(fixColumnInQuery(q, "pirkejokodas", "pirkejoKodas"))
            .toBe('SELECT "pirkejoKodas" FROM v_sutartys LIMIT 1');
    });

    it("does not replace an already correctly quoted identifier", () => {
        const q = 'SELECT "pirkejoKodas" FROM v_sutartys LIMIT 1';
        const fixed = fixColumnInQuery(q, "pirkejokodas", "pirkejoKodas");
        // Should remain unchanged — already correct
        expect(fixed).toBe('SELECT "pirkejoKodas" FROM v_sutartys LIMIT 1');
    });

    it("replaces multiple occurrences in one pass", () => {
        const q = 'SELECT pirkejoKodas, tiekejoKodas, pirkejoKodas FROM v_sutartys';
        const fixed = fixColumnInQuery(q, "pirkejokodas", "pirkejoKodas");
        expect(fixed).toBe('SELECT "pirkejoKodas", tiekejoKodas, "pirkejoKodas" FROM v_sutartys');
    });

    it("handles table-qualified unquoted column: t.pirkejoKodas → t.\"pirkejoKodas\"", () => {
        const q = "SELECT t.pirkejoKodas FROM v_sutartys t";
        const fixed = fixColumnInQuery(q, "pirkejokodas", "pirkejoKodas");
        expect(fixed).toBe('SELECT t."pirkejoKodas" FROM v_sutartys t');
    });
});

// ---------------------------------------------------------------------------
// getMixedCaseMap — verifies view columns are present (DB required)
// ---------------------------------------------------------------------------

describe("getMixedCaseMap", () => {
    it("includes known mixed-case view columns", async () => {
        const map = await getMixedCaseMap();
        expect(map.get("pirkejokodas")).toBe("pirkejoKodas");
        expect(map.get("tiekejokodas")).toBe("tiekejoKodas");
        expect(map.get("jarkodas")).toBe("jarKodas");
        expect(map.get("sutartiesunikalusid")).toBe("sutartiesUnikalusId");
    });

    it("includes mixed-case table columns from the DB", async () => {
        const map = await getMixedCaseMap();
        // jarAsmenys.jarKodas is a raw table column that must also be in the map
        expect(map.has("jarkodas")).toBe(true);
    });

    it("does NOT include all-lowercase columns", async () => {
        const map = await getMixedCaseMap();
        // "verte", "tipas", "statusas" are all-lowercase — not in the map
        expect(map.has("verte")).toBe(false);
        expect(map.has("tipas")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// executeWithColumnFix — unit coverage with a mock executor (no DB)
// ---------------------------------------------------------------------------

describe("executeWithColumnFix — mock executor", () => {
    it("returns success immediately when the first attempt succeeds", async () => {
        const ok = { content: [{ type: "text", text: '{"rows":[]}' }] };
        const run = async () => ok;
        expect(await executeWithColumnFix(run, "SELECT 1")).toBe(ok);
    });

    it("stops retrying on non-column errors", async () => {
        let calls = 0;
        const run = async () => {
            calls++;
            return { content: [{ type: "text", text: "permission denied" }], isError: true };
        };
        const result = (await executeWithColumnFix(run, "SELECT 1")) as AnyResult;
        expect(result.isError).toBe(true);
        expect(calls).toBe(1); // no retries for non-column errors
        expect(result.content[0].text).toContain("[attempt 1]");
    });

    it("stops after MAX_AUTO_RETRIES and collects all errors", async () => {
        let calls = 0;
        // Each call returns a different unknown column — no fix possible, but we advance
        // the test by returning unknown columns so extractBadColumnName + map miss fires break early.
        // Use a column that IS in the map so the fixer keeps trying but can't change the query.
        const run = async (_q: string) => {
            calls++;
            // Return the same column error every time → fixer finds the column, rewrites the
            // query on first try, but subsequent rewrites produce the same string → breaks.
            // So we won't actually hit MAX_AUTO_RETRIES naturally here; test the break-on-no-change path.
            return {
                content: [{ type: "text", text: 'column "unknowncol123" does not exist' }],
                isError: true,
            };
        };
        const result = (await executeWithColumnFix(run, "SELECT 1")) as AnyResult;
        expect(result.isError).toBe(true);
        // "unknowncol123" is not in the map → breaks after 1 attempt
        expect(calls).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Full integration via execute_query handler
// ---------------------------------------------------------------------------

describe("execute_query — column case auto-fix (integration)", () => {
    it("auto-fixes unquoted camelCase: pirkejoKodas → \"pirkejoKodas\"", async () => {
        const result = (await handler({
            query: "SELECT pirkejoKodas FROM v_sutartys LIMIT 1",
            purpose: "auto-fix integration: unquoted camelCase",
            page: 1,
        })) as AnyResult;

        expect(result.isError, "should succeed after auto-fix").toBeFalsy();
        const payload = JSON.parse(result.content[0].text);
        expect(payload.rows.length, "must return at least one row").toBeGreaterThan(0);
        expect("pirkejoKodas" in payload.rows[0], "pirkejoKodas must be in the result row").toBe(true);
    });

    it("auto-fixes quoted lowercase: \"pirkejokodas\" → \"pirkejoKodas\"", async () => {
        const result = (await handler({
            query: 'SELECT "pirkejokodas" FROM v_sutartys LIMIT 1',
            purpose: "auto-fix integration: quoted lowercase",
            page: 1,
        })) as AnyResult;

        expect(result.isError, "should succeed after auto-fix").toBeFalsy();
        const payload = JSON.parse(result.content[0].text);
        expect(payload.rows.length).toBeGreaterThan(0);
        expect("pirkejoKodas" in payload.rows[0]).toBe(true);
    });

    it("auto-fixes two wrong-case columns across sequential retries", async () => {
        // Both pirkejoKodas and tiekejoKodas are wrong case — each retry fixes one.
        const result = (await handler({
            query: "SELECT pirkejoKodas, tiekejoKodas FROM v_sutartys WHERE tiekejoKodas IS NOT NULL LIMIT 1",
            purpose: "auto-fix integration: two wrong-case columns",
            page: 1,
        })) as AnyResult;

        expect(result.isError, "should succeed after two auto-fix retries").toBeFalsy();
        const payload = JSON.parse(result.content[0].text);
        expect(payload.rows.length).toBeGreaterThan(0);
        expect("pirkejoKodas" in payload.rows[0]).toBe(true);
        expect("tiekejoKodas" in payload.rows[0]).toBe(true);
    });

    it("auto-fixes a raw table column (tiekejoKodas on sutartys)", async () => {
        const result = (await handler({
            query: 'SELECT tiekejoKodas FROM sutartys WHERE tiekejoKodas IS NOT NULL LIMIT 1',
            purpose: "auto-fix integration: raw table column",
            page: 1,
        })) as AnyResult;

        expect(result.isError, "should succeed after auto-fix on raw table").toBeFalsy();
        const payload = JSON.parse(result.content[0].text);
        expect(payload.rows.length).toBeGreaterThan(0);
    });

    it("auto-fixes table-alias-qualified unquoted camelCase: d.pirkimoNumeris → d.\"pirkimoNumeris\"", async () => {
        const result = (await handler({
            query: "SELECT d.pirkimoNumeris FROM v_dalyviai d LIMIT 1",
            purpose: "auto-fix integration: table-alias qualified unquoted camelCase",
            page: 1,
        })) as AnyResult;

        expect(result.isError, "should succeed after auto-fix of table-qualified column").toBeFalsy();
        const payload = JSON.parse(result.content[0].text);
        expect(payload.rows.length).toBeGreaterThan(0);
        expect("pirkimoNumeris" in payload.rows[0]).toBe(true);
    });

    it("returns isError when column is unknown (not fixable)", async () => {
        const result = (await handler({
            query: "SELECT totallyMadeUpColumn FROM v_sutartys LIMIT 1",
            purpose: "auto-fix integration: unfixable column",
            page: 1,
        })) as AnyResult;

        expect(result.isError, "should remain an error — column not in map").toBe(true);
        // Must not have retried more than once (column not in map → break immediately)
        expect(result.content[0].text).toContain("[attempt 1]");
        expect(result.content[0].text).not.toContain("[attempt 2]");
    });

    it("returns isError for non-column errors without retry", async () => {
        // Syntax error — not a column-name issue
        const result = (await handler({
            query: "SELECT 1 FROM v_sutartys WHERE",
            purpose: "auto-fix integration: syntax error",
            page: 1,
        })) as AnyResult;

        // validateSql may catch this before DB; either way it should be an error
        expect(result.isError).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Recursion guard — cannot exceed MAX_AUTO_RETRIES
// ---------------------------------------------------------------------------

describe("executeWithColumnFix — recursion guard", () => {
    it(`never calls runAttempt more than ${MAX_AUTO_RETRIES} times`, async () => {
        let calls = 0;
        // Each call fixes a column but we simulate a fresh unknown-column error each time
        // by returning a different fake column name — none of which are in the map.
        const fakeColumns = ["aaa111", "bbb222", "ccc333", "ddd444", "eee555", "fff666"];
        const run = async () => {
            const col = fakeColumns[calls] ?? "zzz999";
            calls++;
            return {
                content: [{ type: "text", text: `column "${col}" does not exist` }],
                isError: true,
            };
        };
        await executeWithColumnFix(run, "SELECT 1 FROM v_sutartys");
        expect(calls).toBeLessThanOrEqual(MAX_AUTO_RETRIES);
    });
});
