import { describe, expect, it } from "vitest";
// @ts-ignore - JS modulis be tipų
import { normalizeSql, sqlOperation, stripSqlComments } from "../postgres/postgres.js";

describe("normalizeSql (SQL_LOG_FILE)", () => {
    it("suveda užklausą į vieną eilutę", () => {
        expect(normalizeSql("SELECT\n  a,\n  b\nFROM t")).toBe(
            "SELECT a, b FROM t",
        );
    });

    it("sutraukia placeholder'ių sąrašą iki vieno", () => {
        expect(
            normalizeSql("SELECT * FROM t WHERE id IN ($1, $2, $3, $4, $5)"),
        ).toBe("SELECT * FROM t WHERE id IN ($?)");
    });

    it("sutraukia daugiaeilį VALUES", () => {
        expect(
            normalizeSql("INSERT INTO t (a,b) VALUES ($1,$2), ($3,$4), ($5,$6)"),
        ).toBe("INSERT INTO t (a,b) VALUES ($?)");
    });

    it("sutraukia inline literalų sąrašus", () => {
        expect(normalizeSql("SELECT * FROM t WHERE k IN (1, 2, 3, 4)")).toBe(
            "SELECT * FROM t WHERE k IN (…)",
        );
        expect(normalizeSql("SELECT * FROM t WHERE s IN ('a', 'b', 'c')")).toBe(
            "SELECT * FROM t WHERE s IN (…)",
        );
    });

    it("nepaliečia funkcijų argumentų su stulpeliais", () => {
        expect(normalizeSql("SELECT substring(x, 1, 3) FROM t WHERE k = $1")).toBe(
            "SELECT substring(x, 1, 3) FROM t WHERE k = $?",
        );
    });

    it("nerašo parametrų reikšmių – jų tekste ir nėra", () => {
        expect(normalizeSql("UPDATE t SET a = $1 WHERE id = $2")).toBe(
            "UPDATE t SET a = $? WHERE id = $?",
        );
    });

    it("išima komentarus, kad suplokštinus eilutes jie nesuvalgytų užklausos", () => {
        expect(
            normalizeSql("SELECT a -- paaiškinimas\nFROM t WHERE id = $1"),
        ).toBe("SELECT a FROM t WHERE id = $?");
        expect(normalizeSql("SELECT /* blokas */ a FROM t")).toBe(
            "SELECT a FROM t",
        );
    });
});

describe("stripSqlComments", () => {
    it("nepaliečia komentarų ženklų literaluose ir identifikatoriuose", () => {
        expect(stripSqlComments("SELECT 'a--b' AS x FROM t")).toBe(
            "SELECT 'a--b' AS x FROM t",
        );
        expect(stripSqlComments(`SELECT "a/*b" FROM t`)).toBe(
            `SELECT "a/*b" FROM t`,
        );
    });

    it("nepaliečia $$ blokų (plpgsql kūnų)", () => {
        const sql =
            "CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN -- viduje\n RETURN NULL; END; $$ LANGUAGE plpgsql";
        expect(stripSqlComments(sql)).toBe(sql);
    });
});

describe("sqlOperation", () => {
    it("atpažįsta pagrindinius tipus", () => {
        expect(sqlOperation("SELECT 1")).toBe("select");
        expect(sqlOperation("INSERT INTO t (a) VALUES ($?)")).toBe("insert");
        expect(sqlOperation("UPDATE t SET a = $?")).toBe("update");
        expect(sqlOperation("DELETE FROM t WHERE id = $?")).toBe("delete");
        expect(sqlOperation("CREATE INDEX x ON t (a)")).toBe("schema");
        expect(sqlOperation("DROP TABLE t")).toBe("schema");
        expect(sqlOperation("BEGIN")).toBe("tx");
        expect(sqlOperation("SET LOCAL statement_timeout = $?")).toBe("other");
    });

    it("CTE klasifikuojamas pagal veiksmą viduje", () => {
        expect(sqlOperation("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(
            "select",
        );
        expect(
            sqlOperation("WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x"),
        ).toBe("insert");
        expect(
            sqlOperation("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"),
        ).toBe("delete");
    });

    it("nesutrinka dėl skliaustų ir tarpų priekyje", () => {
        expect(sqlOperation("  (SELECT 1)")).toBe("select");
    });
});
