import { describe, expect, it } from "vitest";
// @ts-ignore - JS modulis be tipų
import { normalizeSql } from "../postgres/postgres.js";

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
});
