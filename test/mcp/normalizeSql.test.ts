import { describe, it, expect } from "vitest";
import { normalizeSql } from "../../modules/mcp/analyst/normalizeSql.js";

describe("normalizeSql — whitespace collapse", () => {
    it("collapses newlines to a single space", () => {
        expect(normalizeSql("SELECT\nid\nFROM sutartys")).toBe("SELECT id FROM sutartys");
    });

    it("collapses tabs to a single space", () => {
        expect(normalizeSql("SELECT\tid\tFROM sutartys")).toBe("SELECT id FROM sutartys");
    });

    it("collapses multiple spaces to one", () => {
        expect(normalizeSql("SELECT   id   FROM  sutartys")).toBe("SELECT id FROM sutartys");
    });

    it("strips leading and trailing whitespace", () => {
        expect(normalizeSql("  SELECT 1  ")).toBe("SELECT 1");
    });

    it("handles mixed whitespace sequences", () => {
        expect(normalizeSql("SELECT\n  id,\n\tname\nFROM sutartys")).toBe("SELECT id, name FROM sutartys");
    });

    it("leaves already-normalised single-line SQL unchanged", () => {
        const sql = "SELECT id FROM sutartys WHERE id = 1";
        expect(normalizeSql(sql)).toBe(sql);
    });
});

describe("normalizeSql — IS DISTINCT FROM rewrites", () => {
    it("rewrites IS DISTINCT FROM true → IS NOT TRUE", () => {
        expect(normalizeSql("SELECT * FROM sutartys WHERE istrinta IS DISTINCT FROM true"))
            .toBe("SELECT * FROM sutartys WHERE istrinta IS NOT TRUE");
    });

    it("rewrites IS DISTINCT FROM false → IS NOT FALSE", () => {
        expect(normalizeSql("SELECT * FROM sutartys WHERE istrinta IS DISTINCT FROM false"))
            .toBe("SELECT * FROM sutartys WHERE istrinta IS NOT FALSE");
    });

    it("rewrites IS NOT DISTINCT FROM true → IS TRUE", () => {
        expect(normalizeSql("SELECT * FROM sutartys WHERE istrinta IS NOT DISTINCT FROM true"))
            .toBe("SELECT * FROM sutartys WHERE istrinta IS TRUE");
    });

    it("rewrites IS NOT DISTINCT FROM false → IS FALSE", () => {
        expect(normalizeSql("SELECT * FROM sutartys WHERE istrinta IS NOT DISTINCT FROM false"))
            .toBe("SELECT * FROM sutartys WHERE istrinta IS FALSE");
    });

    it("is case-insensitive for IS DISTINCT FROM", () => {
        expect(normalizeSql("SELECT * FROM sutartys WHERE istrinta is distinct from true"))
            .toBe("SELECT * FROM sutartys WHERE istrinta IS NOT TRUE");
    });

    it("handles extra whitespace between IS DISTINCT FROM keywords", () => {
        expect(normalizeSql("SELECT * FROM sutartys WHERE istrinta IS  DISTINCT  FROM  true"))
            .toBe("SELECT * FROM sutartys WHERE istrinta IS NOT TRUE");
    });

    it("rewrites IS NOT DISTINCT FROM before IS DISTINCT FROM to avoid double-replacement", () => {
        const sql = "SELECT * FROM sutartys WHERE a IS NOT DISTINCT FROM true AND b IS DISTINCT FROM false";
        expect(normalizeSql(sql))
            .toBe("SELECT * FROM sutartys WHERE a IS TRUE AND b IS NOT FALSE");
    });

    it("handles multi-line query with IS DISTINCT FROM (combined fix)", () => {
        const input = `SELECT tiekejoKodas, SUM(verte) AS suma
FROM v_sutartys
WHERE pirkejoKodas = '188768730'
AND istrinta IS DISTINCT FROM true
GROUP BY tiekejoKodas`;
        expect(normalizeSql(input))
            .toBe("SELECT tiekejoKodas, SUM(verte) AS suma FROM v_sutartys WHERE pirkejoKodas = '188768730' AND istrinta IS NOT TRUE GROUP BY tiekejoKodas");
    });
});

describe("normalizeSql — idempotency", () => {
    it("applying twice produces the same result for whitespace input", () => {
        const sql = "SELECT\n  id\n  FROM sutartys";
        expect(normalizeSql(normalizeSql(sql))).toBe(normalizeSql(sql));
    });

    it("applying twice produces the same result for IS DISTINCT FROM input", () => {
        const sql = "SELECT * FROM sutartys WHERE istrinta IS DISTINCT FROM true";
        expect(normalizeSql(normalizeSql(sql))).toBe(normalizeSql(sql));
    });
});
