import { describe, expect, it } from "vitest";
import { qwUserText } from "@/quickwit/qwUserText.js";
import { buildSutartysQuickwitQuery } from "@/modules/sutartys/searchSutartys.js";

describe("qwUserText", () => {
    it("quotes each word so query-language characters stay literal", () => {
        expect(qwUserText("vandens tiekimas")).toBe('"vandens" "tiekimas"');
        // Issue #76: dvitaškis (ir kiti sintaksės simboliai) anksčiau griaudavo parserį.
        expect(qwUserText("test:")).toBe('"test:"');
        expect(qwUserText("a{b ]c( ^d")).toBe('"a{b" "]c(" "^d"');
        expect(qwUserText("vanduo AND")).toBe('"vanduo" "AND"');
        expect(qwUserText("IN")).toBe('"IN"');
    });

    it("escapes quotes and backslashes inside the quoted term", () => {
        expect(qwUserText('te"st')).toBe('"te\\"st"');
        expect(qwUserText("test\\")).toBe('"test\\\\"');
    });

    it("keeps prefix search on trailing asterisks", () => {
        expect(qwUserText("brok*")).toBe('"brok"*');
        expect(qwUserText("brok** rem*")).toBe('"brok"* "rem"*');
    });

    it("drops words without letters or digits and returns empty for nothing to search", () => {
        expect(qwUserText("vanduo :")).toBe('"vanduo"');
        expect(qwUserText(" :- ")).toBe("");
        expect(qwUserText("")).toBe("");
        expect(qwUserText("*")).toBe("");
    });

    it("wraps the whole text as one phrase in phrase mode", () => {
        expect(qwUserText("vandens tiekimas", { phrase: true })).toBe('"vandens tiekimas"');
        expect(qwUserText("test:", { phrase: true })).toBe('"test:"');
        expect(qwUserText(":-", { phrase: true })).toBe("");
    });
});

describe("sutartys Quickwit query", () => {
    it("searches every text field with sanitised terms", () => {
        // „ą" → „a" (foldLithuanian), dvitaškis lieka kabutėse — Quickwit nebeklumpa.
        expect(buildSutartysQuickwitQuery({ search: "sąskaita:" }))
            .toBe(
                '(pavadinimas:("saskaita:") OR tekstas:("saskaita:") OR tiekejai:("saskaita:")'
                + ' OR perkanciojiOrganizacija:("saskaita:") OR bvpzPavadinimai:("saskaita:"))',
            );
    });

    it("adds no text clause when the search is punctuation only", () => {
        expect(buildSutartysQuickwitQuery({ search: " :: " })).toBe("*");
    });
});
