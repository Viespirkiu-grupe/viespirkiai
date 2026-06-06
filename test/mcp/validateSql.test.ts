import { describe, it, expect } from "vitest";
import { validateSql } from "../../modules/mcp/analyst/validateSql.js";

// --- Layer 1: AST parse + single SELECT ---

describe("Layer 1 — parser", () => {
    it("accepts a valid SELECT", () => {
        expect(validateSql("SELECT 1")).toBeNull();
    });

    it("accepts SELECT from whitelisted table", () => {
        expect(validateSql("SELECT * FROM sutartys")).toBeNull();
    });

    it("rejects INSERT", () => {
        expect(validateSql("INSERT INTO sutartys VALUES (1)")).toBeTypeOf("string");
    });

    it("rejects UPDATE", () => {
        expect(validateSql("UPDATE sutartys SET x = 1")).toBeTypeOf("string");
    });

    it("rejects DELETE", () => {
        expect(validateSql("DELETE FROM sutartys")).toBeTypeOf("string");
    });

    it("rejects DROP", () => {
        expect(validateSql("DROP TABLE sutartys")).toBeTypeOf("string");
    });

    it("rejects CREATE", () => {
        expect(validateSql("CREATE TABLE x (id int)")).toBeTypeOf("string");
    });

    it("rejects multiple statements", () => {
        expect(validateSql("SELECT 1; SELECT 2")).toBeTypeOf("string");
    });

    it("accepts a single statement with a trailing semicolon", () => {
        expect(validateSql("SELECT 1;")).toBeNull();
    });

    it("accepts a CTE with a trailing semicolon", () => {
        expect(validateSql("WITH cte AS (SELECT * FROM sutartys) SELECT * FROM cte;")).toBeNull();
    });

    it("still rejects two terminated statements (injection)", () => {
        expect(validateSql("SELECT 1 FROM sutartys; DROP VIEW v_dalyviai;")).toBeTypeOf("string");
    });

    it("rejects malformed SQL", () => {
        expect(validateSql("SELECT FROM WHERE AND")).toBeTypeOf("string");
    });
});

// --- Layer 2: Table whitelist ---

describe("Layer 2 — table whitelist", () => {
    it("accepts whitelisted table", () => {
        expect(validateSql("SELECT * FROM sutartys")).toBeNull();
    });

    it("accepts jarCsv (mixed-case)", () => {
        expect(validateSql('SELECT * FROM "jarCsv"')).toBeNull();
    });

    it("accepts TEMP view name", () => {
        expect(validateSql("SELECT * FROM v_company")).toBeNull();
    });

    it("accepts all six TEMP view names", () => {
        for (const v of ["v_company", "v_sutartys", "v_pirkimas", "v_person_links", "v_dalyviai", "v_bylos"]) {
            expect(validateSql(`SELECT * FROM ${v}`), `Expected ${v} to be accepted`).toBeNull();
        }
    });

    it("rejects pg_class", () => {
        const r = validateSql("SELECT * FROM pg_class");
        expect(r).toBeTypeOf("string");
        expect(r).toContain("pg_class");
    });

    it("rejects information_schema.tables (schema-qualified)", () => {
        expect(validateSql("SELECT * FROM information_schema.tables")).toBeTypeOf("string");
    });

    it("rejects pg_catalog.pg_class (schema-qualified)", () => {
        expect(validateSql("SELECT * FROM pg_catalog.pg_class")).toBeTypeOf("string");
    });

    it("rejects unknown table", () => {
        const r = validateSql("SELECT * FROM users");
        expect(r).toBeTypeOf("string");
        expect(r).toContain("users");
    });

    it("accepts CTE name in FROM", () => {
        expect(validateSql("WITH cte AS (SELECT * FROM sutartys) SELECT * FROM cte")).toBeNull();
    });
});

// --- Layer 3: Function whitelist ---

describe("Layer 3 — function whitelist", () => {
    it("accepts COUNT, SUM, DATE_TRUNC", () => {
        expect(validateSql(`SELECT COUNT(*), SUM(verte), DATE_TRUNC('year', "sudarymoData") FROM sutartys`)).toBeNull();
    });

    it("accepts aggregate functions", () => {
        expect(validateSql("SELECT COUNT(*), SUM(x), AVG(x), MIN(x), MAX(x), STDDEV(x) FROM sutartys")).toBeNull();
    });

    it("accepts window function RANK()", () => {
        expect(validateSql("SELECT RANK() OVER (ORDER BY verte) FROM sutartys")).toBeNull();
    });

    it("accepts window function ROW_NUMBER()", () => {
        expect(validateSql('SELECT ROW_NUMBER() OVER (PARTITION BY "tiekejoKodas" ORDER BY verte) FROM sutartys')).toBeNull();
    });

    it("accepts COUNT(*) OVER () window aggregate", () => {
        expect(validateSql("SELECT COUNT(*) OVER () FROM sutartys")).toBeNull();
    });

    it("accepts COALESCE", () => {
        expect(validateSql("SELECT COALESCE(verte, 0) FROM sutartys")).toBeNull();
    });

    it("accepts ROUND, ABS", () => {
        expect(validateSql("SELECT ROUND(verte, 2), ABS(verte) FROM sutartys")).toBeNull();
    });

    it("accepts string functions", () => {
        expect(validateSql("SELECT UPPER(pavadinimas), LOWER(pavadinimas), LENGTH(pavadinimas) FROM sutartys")).toBeNull();
    });

    it("accepts UNNEST", () => {
        expect(validateSql("SELECT UNNEST(ARRAY['a','b'])")).toBeNull();
    });

    it("accepts ::text cast (not a function)", () => {
        expect(validateSql('SELECT "jarKodas"::text FROM "jarCsv"')).toBeNull();
    });

    it("rejects pg_sleep", () => {
        const r = validateSql("SELECT pg_sleep(5)");
        expect(r).toBeTypeOf("string");
        expect(r).toContain("pg_sleep");
    });

    it("rejects pg_read_file", () => {
        expect(validateSql("SELECT pg_read_file('/etc/passwd')")).toBeTypeOf("string");
    });

    it("rejects current_setting", () => {
        expect(validateSql("SELECT current_setting('server_version')")).toBeTypeOf("string");
    });

    it("rejects unknown UDF", () => {
        expect(validateSql("SELECT my_custom_function()")).toBeTypeOf("string");
    });

    it("accepts all functions used in investigation-step examples", () => {
        const queries = [
            `SELECT DATE_TRUNC('year', "sudarymoData")::date AS metai, COUNT(*) AS n, ROUND(SUM(verte)/1000) AS v, ROUND(SUM("faktineIvykdimoVerte")/NULLIF(SUM(verte),0),2) AS r FROM v_sutartys WHERE "tiekejoKodas" = '1' AND istrinta IS NOT TRUE GROUP BY metai`,
            `SELECT "pirkimoBudas", COUNT(*) AS n, ROUND(SUM("numatomaVerteEUR")) AS v FROM v_pirkimas WHERE "jarKodas" = '1' GROUP BY "pirkimoBudas" ORDER BY n DESC`,
            `SELECT COUNT(*) FILTER (WHERE rank = 1) AS wins, ROUND(AVG(bidders), 1) AS avg FROM (SELECT RANK() OVER (PARTITION BY "pirkimoNumeris" ORDER BY "pasiulymoKaina") AS rank, COUNT(*) OVER (PARTITION BY "pirkimoNumeris") AS bidders FROM v_dalyviai) q`,
        ];
        for (const q of queries) {
            expect(validateSql(q), `Expected valid for: ${q.substring(0, 60)}`).toBeNull();
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
        expect(validateSql(buildJoinQuery(6))).toBeNull();
    });

    it("rejects 7 JOINs", () => {
        const r = validateSql(buildJoinQuery(7));
        expect(r).toBeTypeOf("string");
        expect(r).toContain("JOIN");
    });

    it("accepts subquery depth 1", () => {
        expect(validateSql("SELECT * FROM (SELECT * FROM sutartys) AS q")).toBeNull();
    });

    it("accepts subquery depth 3", () => {
        expect(validateSql(
            "SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM sutartys) AS q1) AS q2) AS q3"
        )).toBeNull();
    });

    it("rejects subquery depth 4", () => {
        const r = validateSql(
            "SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM sutartys) AS q1) AS q2) AS q3) AS q4"
        );
        expect(r).toBeTypeOf("string");
        expect(r).toMatch(/depth|nesting/);
    });

    it("accepts exactly 8 CTEs", () => {
        const ctes = Array.from({ length: 8 }, (_, i) => `cte${i + 1} AS (SELECT ${i + 1})`).join(", ");
        expect(validateSql(`WITH ${ctes} SELECT * FROM cte1`)).toBeNull();
    });

    it("rejects 9 CTEs", () => {
        const ctes = Array.from({ length: 9 }, (_, i) => `cte${i + 1} AS (SELECT ${i + 1})`).join(", ");
        const r = validateSql(`WITH ${ctes} SELECT * FROM cte1`);
        expect(r).toBeTypeOf("string");
        expect(r).toContain("CTE");
    });

    it("rejects WITH RECURSIVE", () => {
        const r = validateSql(
            "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n < 5) SELECT * FROM r"
        );
        expect(r).toBeTypeOf("string");
        expect(r).toContain("RECURSIVE");
    });

    it("accepts non-recursive CTE", () => {
        expect(validateSql("WITH cte AS (SELECT * FROM sutartys) SELECT * FROM cte")).toBeNull();
    });
});
