import { describe, it, expect } from "vitest";
import { z } from "zod";
import { schema } from "../../modules/mcp/tools/executeQuery.js";

const Schema = z.object(schema);

describe("executeQuery schema — page", () => {
    it("accepts page 1", () => {
        expect(Schema.parse({ query: "SELECT 1 FROM sutartys", purpose: "audit", page: 1 }).page).toBe(1);
    });

    it("accepts page 200 (upper bound)", () => {
        expect(Schema.parse({ query: "SELECT 1 FROM sutartys", purpose: "audit", page: 200 }).page).toBe(200);
    });

    it("rejects page 0", () => {
        expect(() => Schema.parse({ query: "SELECT 1 FROM sutartys", purpose: "audit", page: 0 })).toThrow();
    });

    it("rejects page 201 (above max)", () => {
        expect(() => Schema.parse({ query: "SELECT 1 FROM sutartys", purpose: "audit", page: 201 })).toThrow();
    });

    it("rejects fractional page", () => {
        expect(() => Schema.parse({ query: "SELECT 1 FROM sutartys", purpose: "audit", page: 1.5 })).toThrow();
    });

    it("defaults page to 1 when omitted", () => {
        expect(Schema.parse({ query: "SELECT 1 FROM sutartys", purpose: "audit" }).page).toBe(1);
    });
});

describe("executeQuery schema — query", () => {
    it("rejects query shorter than 10 chars", () => {
        expect(() => Schema.parse({ query: "SELECT 1", purpose: "audit" })).toThrow();
    });

    it("rejects query exceeding max length", () => {
        expect(() => Schema.parse({ query: "x".repeat(3073), purpose: "audit" })).toThrow();
    });
});

describe("executeQuery schema — purpose", () => {
    it("rejects purpose shorter than 5 chars", () => {
        expect(() => Schema.parse({ query: "SELECT 1 FROM sutartys", purpose: "hi" })).toThrow();
    });

    it("rejects purpose longer than 500 chars", () => {
        expect(() => Schema.parse({ query: "SELECT 1 FROM sutartys", purpose: "x".repeat(501) })).toThrow();
    });
});
