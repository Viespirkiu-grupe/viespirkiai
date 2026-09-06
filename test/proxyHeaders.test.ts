import http from "node:http";
import { describe, expect, it, vi } from "vitest";
// @ts-ignore JS modulis be tipų
import { forwardHeaders, outgoingHeaders, sanitizeHeaderValue } from "../modules/proxy/headers.js";

// Toks `content-disposition` iš šaltinio nuversdavo proxy procesą:
// TypeError [ERR_INVALID_CHAR]: Invalid character in header content.
const BLOGAS = 'attachment; filename="Sutartis\x00\x0bNr-5.pdf"';

describe("sanitizeHeaderValue", () => {
    it("išmeta valdymo simbolius", () => {
        expect(sanitizeHeaderValue(BLOGAS)).toBe('attachment; filename="SutartisNr-5.pdf"');
    });

    it("palieka latin1 baitus (UTF-8 vardas atkeliauja būtent taip)", () => {
        const vardas = Buffer.from('attachment; filename="Sutartis Nr. 5 – ąžuolas.pdf"', "utf8")
            .toString("latin1");
        expect(sanitizeHeaderValue(vardas)).toBe(vardas);
    });

    it("neleidžia įsprausti antraštės per CRLF", () => {
        expect(sanitizeHeaderValue("a\r\nX-Injected: 1")).toBe("aX-Injected: 1");
    });

    it("grąžina null, kai nieko tinkamo nelieka", () => {
        expect(sanitizeHeaderValue("\x00\x01")).toBeNull();
    });
});

describe("forwardHeaders", () => {
    it("praleidžia hop-by-hop antraštes", () => {
        const headers = forwardHeaders({
            "content-type": "text/html",
            connection: "keep-alive",
            "transfer-encoding": "chunked",
        });
        expect(headers).toEqual({ "content-type": "text/html" });
    });

    it("išvalo reikšmę ir apie tai praneša", () => {
        const onWarn = vi.fn();
        const headers = forwardHeaders({ "content-disposition": BLOGAS }, { onWarn });
        expect(headers["content-disposition"]).toBe('attachment; filename="SutartisNr-5.pdf"');
        expect(onWarn).toHaveBeenCalledOnce();
    });

    it("tvarko sąrašus (set-cookie) ir išmeta tuščias reikšmes", () => {
        const headers = forwardHeaders({ "set-cookie": ["a=1", "\x00"] });
        expect(headers["set-cookie"]).toEqual(["a=1"]);
    });

    it("rewrite pritaikomas jau išvalytai reikšmei", () => {
        const headers = forwardHeaders(
            { location: "/x\x00y" },
            { rewrite: (name, value) => name === "location" ? `/vpmis${value}` : value },
        );
        expect(headers.location).toBe("/vpmis/xy");
    });
});

describe("outgoingHeaders", () => {
    it("pakeičia Host šaltinio adresu", () => {
        const headers = outgoingHeaders(
            { host: "10.1.10.2:6969", "user-agent": "Viespirkiai" },
            new URL("https://eviesiejipirkimai.lt/download.php"),
        );
        expect(headers).toEqual({ host: "eviesiejipirkimai.lt", "user-agent": "Viespirkiai" });
    });
});

describe("Node atsakymas", () => {
    it("žalia reikšmė krenta, išvalyta — praeina", () => {
        const res = new http.ServerResponse({ method: "GET" } as any);
        res.assignSocket({ writable: true, cork() {}, uncork() {}, on() {}, removeListener() {} } as any);

        expect(() => res.writeHead(200, { "content-disposition": BLOGAS })).toThrow(/ERR_INVALID_CHAR|Invalid character/);
        expect(() => res.writeHead(200, {
            "content-disposition": sanitizeHeaderValue(BLOGAS)!,
        })).not.toThrow();
    });
});
