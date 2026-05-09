import { describe, it, expect } from "vitest";
import { validateSql } from "../../modules/mcp/analyst/validateSql.js";

// --- Layer 1: AST parse + single SELECT ---

describe("Layer 1 — parser", () => {
    it("accepts a valid SELECT", () => {
        const r = validateSql("SELECT 1");
        expect(r.ok).toBe(true);
    });

    it("accepts SELECT from whitelisted table", () => {
        const r = validateSql("SELECT * FROM sutartys");
        expect(r.ok).toBe(true);
    });

    it("rejects INSERT", () => {
        const r = validateSql("INSERT INTO sutartys VALUES (1)");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(1);
    });

    it("rejects UPDATE", () => {
        const r = validateSql("UPDATE sutartys SET x = 1");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(1);
    });

    it("rejects DELETE", () => {
        const r = validateSql("DELETE FROM sutartys");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(1);
    });

    it("rejects DROP", () => {
        const r = validateSql("DROP TABLE sutartys");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(1);
    });

    it("rejects CREATE", () => {
        const r = validateSql("CREATE TABLE x (id int)");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(1);
    });

    it("rejects multiple statements", () => {
        const r = validateSql("SELECT 1; SELECT 2");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(1);
    });

    it("rejects malformed SQL", () => {
        const r = validateSql("SELECT FROM WHERE AND");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(1);
    });
});

// --- Layer 2: Table whitelist ---

describe("Layer 2 — table whitelist", () => {
    it("accepts whitelisted table", () => {
        const r = validateSql("SELECT * FROM sutartys");
        expect(r.ok).toBe(true);
    });

    it("accepts jarCsv (mixed-case)", () => {
        const r = validateSql('SELECT * FROM "jarCsv"');
        expect(r.ok).toBe(true);
    });

    it("accepts TEMP view name", () => {
        const r = validateSql("SELECT * FROM v_company");
        expect(r.ok).toBe(true);
    });

    it("accepts all six TEMP view names", () => {
        for (const v of ["v_company", "v_sutartys", "v_pirkimas", "v_person_links", "v_dalyviai", "v_bylos"]) {
            const r = validateSql(`SELECT * FROM ${v}`);
            expect(r.ok, `Expected ${v} to be accepted`).toBe(true);
        }
    });

    it("rejects pg_class", () => {
        const r = validateSql("SELECT * FROM pg_class");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(2);
        expect(r.message).toContain("pg_class");
    });

    it("rejects information_schema.tables (schema-qualified)", () => {
        const r = validateSql("SELECT * FROM information_schema.tables");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(2);
    });

    it("rejects pg_catalog.pg_class (schema-qualified)", () => {
        const r = validateSql("SELECT * FROM pg_catalog.pg_class");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(2);
    });

    it("rejects unknown table", () => {
        const r = validateSql("SELECT * FROM users");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(2);
        expect(r.message).toContain("users");
    });

    it("accepts CTE name in FROM", () => {
        const r = validateSql("WITH cte AS (SELECT * FROM sutartys) SELECT * FROM cte");
        expect(r.ok).toBe(true);
    });
});

// --- Layer 3: Function whitelist ---

describe("Layer 3 — function whitelist", () => {
    it("accepts COUNT, SUM, DATE_TRUNC", () => {
        const r = validateSql(`SELECT COUNT(*), SUM(verte), DATE_TRUNC('year', "sudarymoData") FROM sutartys`);
        expect(r.ok).toBe(true);
    });

    it("accepts aggregate functions", () => {
        const r = validateSql("SELECT COUNT(*), SUM(x), AVG(x), MIN(x), MAX(x), STDDEV(x) FROM sutartys");
        expect(r.ok).toBe(true);
    });

    it("accepts window function RANK()", () => {
        const r = validateSql("SELECT RANK() OVER (ORDER BY verte) FROM sutartys");
        expect(r.ok).toBe(true);
    });

    it("accepts window function ROW_NUMBER()", () => {
        const r = validateSql('SELECT ROW_NUMBER() OVER (PARTITION BY "tiekejoKodas" ORDER BY verte) FROM sutartys');
        expect(r.ok).toBe(true);
    });

    it("accepts COUNT(*) OVER () window aggregate", () => {
        const r = validateSql("SELECT COUNT(*) OVER () FROM sutartys");
        expect(r.ok).toBe(true);
    });

    it("accepts COALESCE", () => {
        const r = validateSql("SELECT COALESCE(verte, 0) FROM sutartys");
        expect(r.ok).toBe(true);
    });

    it("accepts ROUND, ABS", () => {
        const r = validateSql("SELECT ROUND(verte, 2), ABS(verte) FROM sutartys");
        expect(r.ok).toBe(true);
    });

    it("accepts string functions", () => {
        const r = validateSql("SELECT UPPER(pavadinimas), LOWER(pavadinimas), LENGTH(pavadinimas) FROM sutartys");
        expect(r.ok).toBe(true);
    });

    it("accepts UNNEST", () => {
        const r = validateSql("SELECT UNNEST(ARRAY['a','b'])");
        expect(r.ok).toBe(true);
    });

    it("accepts ::text cast (not a function)", () => {
        const r = validateSql('SELECT "jarKodas"::text FROM "jarCsv"');
        expect(r.ok).toBe(true);
    });

    it("rejects pg_sleep", () => {
        const r = validateSql("SELECT pg_sleep(5)");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(3);
        expect(r.message).toContain("pg_sleep");
    });

    it("rejects pg_read_file", () => {
        const r = validateSql("SELECT pg_read_file('/etc/passwd')");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(3);
    });

    it("rejects current_setting", () => {
        const r = validateSql("SELECT current_setting('server_version')");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(3);
    });

    it("rejects unknown UDF", () => {
        const r = validateSql("SELECT my_custom_function()");
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(3);
    });

    it("accepts all functions used in investigation-step examples", () => {
        const queries = [
            `SELECT DATE_TRUNC('year', "sudarymoData")::date AS metai, COUNT(*) AS n, ROUND(SUM(verte)/1000) AS v, ROUND(SUM("faktineIvykdimoVerte")/NULLIF(SUM(verte),0),2) AS r FROM v_sutartys WHERE "tiekejoKodas" = '1' AND istrinta IS NOT TRUE GROUP BY metai`,
            `SELECT "pirkimoBudas", COUNT(*) AS n, ROUND(SUM("numatomaVerteEUR")) AS v FROM v_pirkimas WHERE "jarKodas" = '1' GROUP BY "pirkimoBudas" ORDER BY n DESC`,
            `SELECT COUNT(*) FILTER (WHERE rank = 1) AS wins, ROUND(AVG(bidders), 1) AS avg FROM (SELECT RANK() OVER (PARTITION BY "pirkimoNumeris" ORDER BY "pasiulymoKaina") AS rank, COUNT(*) OVER (PARTITION BY "pirkimoNumeris") AS bidders FROM v_dalyviai) q`,
        ];
        for (const q of queries) {
            const r = validateSql(q);
            expect(r.ok, `Expected valid for: ${q.substring(0, 60)}`).toBe(true);
        }
    });
});

// --- Layer 4: Complexity limits ---

describe("Layer 4 — complexity limits", () => {
    function buildJoinQuery(n: number): string {
        let sql = 'SELECT s."tiekejoKodas" FROM sutartys s';
        for (let i = 1; i <= n; i++) {
            sql += ` JOIN "jarCsv" j${i} ON j${i}."jarKodas"::text = s."tiekejoKodas"`;
        }
        return sql;
    }

    it("accepts exactly 6 JOINs", () => {
        const r = validateSql(buildJoinQuery(6));
        expect(r.ok).toBe(true);
    });

    it("rejects 7 JOINs", () => {
        const r = validateSql(buildJoinQuery(7));
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(4);
        expect(r.message).toContain("JOIN");
    });

    it("accepts subquery depth 1", () => {
        const r = validateSql("SELECT * FROM (SELECT * FROM sutartys) AS q");
        expect(r.ok).toBe(true);
    });

    it("accepts subquery depth 3", () => {
        const r = validateSql(
            "SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM sutartys) AS q1) AS q2) AS q3"
        );
        expect(r.ok).toBe(true);
    });

    it("rejects subquery depth 4", () => {
        const r = validateSql(
            "SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM sutartys) AS q1) AS q2) AS q3) AS q4"
        );
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(4);
        expect(r.message).toMatch(/depth|nesting/);
    });

    it("accepts exactly 8 CTEs", () => {
        const ctes = Array.from({ length: 8 }, (_, i) => `cte${i + 1} AS (SELECT ${i + 1})`).join(", ");
        const r = validateSql(`WITH ${ctes} SELECT * FROM cte1`);
        expect(r.ok).toBe(true);
    });

    it("rejects 9 CTEs", () => {
        const ctes = Array.from({ length: 9 }, (_, i) => `cte${i + 1} AS (SELECT ${i + 1})`).join(", ");
        const r = validateSql(`WITH ${ctes} SELECT * FROM cte1`);
        expect(r.ok).toBe(false);
        expect(r.layer).toBe(4);
        expect(r.message).toContain("CTE");
    });

    it("accepts WITH RECURSIVE and returns hasRecursive: true", () => {
        const r = validateSql(
            "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n < 5) SELECT * FROM r"
        );
        expect(r.ok).toBe(true);
        expect(r.hasRecursive).toBe(true);
    });

    it("returns hasRecursive: false for non-recursive CTE", () => {
        const r = validateSql("WITH cte AS (SELECT * FROM sutartys) SELECT * FROM cte");
        expect(r.ok).toBe(true);
        expect(r.hasRecursive).toBe(false);
    });
});
