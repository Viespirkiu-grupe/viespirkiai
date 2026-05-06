import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSql } from "../../modules/mcp/analyst/validateSql.js";

// --- Layer 1: AST parse + single SELECT ---

describe("Layer 1 — parser", () => {
    it("accepts a valid SELECT", () => {
        const r = validateSql("SELECT 1");
        assert.equal(r.ok, true);
    });

    it("accepts SELECT from whitelisted table", () => {
        const r = validateSql('SELECT * FROM sutartys');
        assert.equal(r.ok, true);
    });

    it("rejects INSERT", () => {
        const r = validateSql("INSERT INTO sutartys VALUES (1)");
        assert.equal(r.ok, false);
        assert.equal(r.layer, 1);
    });

    it("rejects UPDATE", () => {
        const r = validateSql('UPDATE sutartys SET x = 1');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 1);
    });

    it("rejects DELETE", () => {
        const r = validateSql('DELETE FROM sutartys');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 1);
    });

    it("rejects DROP", () => {
        const r = validateSql('DROP TABLE sutartys');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 1);
    });

    it("rejects CREATE", () => {
        const r = validateSql('CREATE TABLE x (id int)');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 1);
    });

    it("rejects multiple statements", () => {
        const r = validateSql("SELECT 1; SELECT 2");
        assert.equal(r.ok, false);
        assert.equal(r.layer, 1);
    });

    it("rejects malformed SQL", () => {
        const r = validateSql("SELECT FROM WHERE AND");
        assert.equal(r.ok, false);
        assert.equal(r.layer, 1);
    });
});

// --- Layer 2: Table whitelist ---

describe("Layer 2 — table whitelist", () => {
    it("accepts whitelisted table", () => {
        const r = validateSql('SELECT * FROM sutartys');
        assert.equal(r.ok, true);
    });

    it("accepts jarCsv (mixed-case)", () => {
        const r = validateSql('SELECT * FROM "jarCsv"');
        assert.equal(r.ok, true);
    });

    it("accepts TEMP view name", () => {
        const r = validateSql('SELECT * FROM v_company');
        assert.equal(r.ok, true);
    });

    it("accepts all six TEMP view names", () => {
        for (const v of ["v_company", "v_sutartys", "v_pirkimas", "v_person_links", "v_dalyviai", "v_bylos"]) {
            const r = validateSql(`SELECT * FROM ${v}`);
            assert.equal(r.ok, true, `Expected ${v} to be accepted`);
        }
    });

    it("rejects pg_class", () => {
        const r = validateSql('SELECT * FROM pg_class');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 2);
        assert(r.message.includes("pg_class"), `message: ${r.message}`);
    });

    it("rejects information_schema.tables (schema-qualified)", () => {
        const r = validateSql('SELECT * FROM information_schema.tables');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 2);
    });

    it("rejects pg_catalog.pg_class (schema-qualified)", () => {
        const r = validateSql('SELECT * FROM pg_catalog.pg_class');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 2);
    });

    it("rejects unknown table", () => {
        const r = validateSql('SELECT * FROM users');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 2);
        assert(r.message.includes("users"), `message: ${r.message}`);
    });

    it("accepts CTE name in FROM", () => {
        const r = validateSql('WITH cte AS (SELECT * FROM sutartys) SELECT * FROM cte');
        assert.equal(r.ok, true);
    });
});

// --- Layer 3: Function whitelist ---

describe("Layer 3 — function whitelist", () => {
    it("accepts COUNT, SUM, DATE_TRUNC", () => {
        const r = validateSql(`SELECT COUNT(*), SUM(verte), DATE_TRUNC('year', "sudarymoData") FROM sutartys`);
        assert.equal(r.ok, true);
    });

    it("accepts aggregate functions", () => {
        const r = validateSql('SELECT COUNT(*), SUM(x), AVG(x), MIN(x), MAX(x), STDDEV(x) FROM sutartys');
        assert.equal(r.ok, true);
    });

    it("accepts window function RANK()", () => {
        const r = validateSql('SELECT RANK() OVER (ORDER BY verte) FROM sutartys');
        assert.equal(r.ok, true);
    });

    it("accepts window function ROW_NUMBER()", () => {
        const r = validateSql('SELECT ROW_NUMBER() OVER (PARTITION BY "tiekejoKodas" ORDER BY verte) FROM sutartys');
        assert.equal(r.ok, true);
    });

    it("accepts COUNT(*) OVER () window aggregate", () => {
        const r = validateSql('SELECT COUNT(*) OVER () FROM sutartys');
        assert.equal(r.ok, true);
    });

    it("accepts COALESCE", () => {
        const r = validateSql('SELECT COALESCE(verte, 0) FROM sutartys');
        assert.equal(r.ok, true);
    });

    it("accepts ROUND, ABS", () => {
        const r = validateSql('SELECT ROUND(verte, 2), ABS(verte) FROM sutartys');
        assert.equal(r.ok, true);
    });

    it("accepts string functions", () => {
        const r = validateSql('SELECT UPPER(pavadinimas), LOWER(pavadinimas), LENGTH(pavadinimas) FROM sutartys');
        assert.equal(r.ok, true);
    });

    it("accepts UNNEST", () => {
        const r = validateSql("SELECT UNNEST(ARRAY['a','b'])");
        assert.equal(r.ok, true);
    });

    it("accepts ::text cast (not a function)", () => {
        const r = validateSql('SELECT "jarKodas"::text FROM "jarCsv"');
        assert.equal(r.ok, true);
    });

    it("rejects pg_sleep", () => {
        const r = validateSql('SELECT pg_sleep(5)');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 3);
        assert(r.message.includes("pg_sleep"), `message: ${r.message}`);
    });

    it("rejects pg_read_file", () => {
        const r = validateSql("SELECT pg_read_file('/etc/passwd')");
        assert.equal(r.ok, false);
        assert.equal(r.layer, 3);
    });

    it("rejects current_setting", () => {
        const r = validateSql("SELECT current_setting('server_version')");
        assert.equal(r.ok, false);
        assert.equal(r.layer, 3);
    });

    it("rejects unknown UDF", () => {
        const r = validateSql('SELECT my_custom_function()');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 3);
    });

    it("accepts all functions used in investigation-step examples", () => {
        const queries = [
            `SELECT DATE_TRUNC('year', "sudarymoData")::date AS metai, COUNT(*) AS n, ROUND(SUM(verte)/1000) AS v, ROUND(SUM("faktineIvykdimoVerte")/NULLIF(SUM(verte),0),2) AS r FROM v_sutartys WHERE "tiekejoKodas" = '1' AND istrinta IS NOT TRUE GROUP BY metai`,
            `SELECT "pirkimoBudas", COUNT(*) AS n, ROUND(SUM("numatomaVerteEUR")) AS v FROM v_pirkimas WHERE "jarKodas" = '1' GROUP BY "pirkimoBudas" ORDER BY n DESC`,
            `SELECT COUNT(*) FILTER (WHERE rank = 1) AS wins, ROUND(AVG(bidders), 1) AS avg FROM (SELECT RANK() OVER (PARTITION BY "pirkimoNumeris" ORDER BY "pasiulymoKaina") AS rank, COUNT(*) OVER (PARTITION BY "pirkimoNumeris") AS bidders FROM v_dalyviai) q`,
        ];
        for (const q of queries) {
            const r = validateSql(q);
            assert.equal(r.ok, true, `Expected valid for: ${q.substring(0, 60)}`);
        }
    });
});

// --- Layer 4: Complexity limits ---

describe("Layer 4 — complexity limits", () => {
    // Helper to build a query with N joins
    function buildJoinQuery(n) {
        let sql = 'SELECT s."tiekejoKodas" FROM sutartys s';
        for (let i = 1; i <= n; i++) {
            sql += ` JOIN "jarCsv" j${i} ON j${i}."jarKodas"::text = s."tiekejoKodas"`;
        }
        return sql;
    }

    it("accepts exactly 6 JOINs", () => {
        const r = validateSql(buildJoinQuery(6));
        assert.equal(r.ok, true);
    });

    it("rejects 7 JOINs", () => {
        const r = validateSql(buildJoinQuery(7));
        assert.equal(r.ok, false);
        assert.equal(r.layer, 4);
        assert(r.message.includes("JOIN"), `message: ${r.message}`);
    });

    it("accepts subquery depth 1", () => {
        const r = validateSql('SELECT * FROM (SELECT * FROM sutartys) AS q');
        assert.equal(r.ok, true);
    });

    it("accepts subquery depth 3", () => {
        const r = validateSql('SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM sutartys) AS q1) AS q2) AS q3');
        assert.equal(r.ok, true);
    });

    it("rejects subquery depth 4", () => {
        const r = validateSql('SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM sutartys) AS q1) AS q2) AS q3) AS q4');
        assert.equal(r.ok, false);
        assert.equal(r.layer, 4);
        assert(r.message.includes("depth") || r.message.includes("nesting"), `message: ${r.message}`);
    });

    it("accepts exactly 8 CTEs", () => {
        const ctes = Array.from({ length: 8 }, (_, i) => `cte${i + 1} AS (SELECT ${i + 1})`).join(", ");
        const r = validateSql(`WITH ${ctes} SELECT * FROM cte1`);
        assert.equal(r.ok, true);
    });

    it("rejects 9 CTEs", () => {
        const ctes = Array.from({ length: 9 }, (_, i) => `cte${i + 1} AS (SELECT ${i + 1})`).join(", ");
        const r = validateSql(`WITH ${ctes} SELECT * FROM cte1`);
        assert.equal(r.ok, false);
        assert.equal(r.layer, 4);
        assert(r.message.includes("CTE"), `message: ${r.message}`);
    });

    it("accepts WITH RECURSIVE and returns hasRecursive: true", () => {
        const r = validateSql(
            'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n < 5) SELECT * FROM r'
        );
        assert.equal(r.ok, true);
        assert.equal(r.hasRecursive, true);
    });

    it("returns hasRecursive: false for non-recursive CTE", () => {
        const r = validateSql('WITH cte AS (SELECT * FROM sutartys) SELECT * FROM cte');
        assert.equal(r.ok, true);
        assert.equal(r.hasRecursive, false);
    });
});
