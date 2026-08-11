import { Readable } from "node:stream";
import { Response as NodeFetchResponse } from "node-fetch";
import { describe, expect, it, vi } from "vitest";
// @ts-ignore JS modulis be tipų
import { createScrapeFetch, createScraperFetch, scrapeAddressParts } from "../utils/scrapeFetch.js";

describe("scrapeAddressParts", () => {
    it("išskiria host, domain ir rekonstruojamą path", () => {
        expect(scrapeAddressParts("https://api.foo.example.lt:8443/a/b?page=2")).toEqual({
            scheme: "https",
            host: "api.foo.example.lt:8443",
            domain: "example.lt",
            path: "/a/b?page=2",
        });
    });

    it("maskuoja slaptus query parametrus ir palieka IP", () => {
        expect(scrapeAddressParts("http://10.1.2.3:8080/x?api_key=secret&page=3")).toEqual({
            scheme: "http",
            host: "10.1.2.3:8080",
            domain: "10.1.2.3",
            path: "/x?api_key=%5Bredacted%5D&page=3",
        });
    });
});

describe("createScrapeFetch", () => {
    it("modulio klientas prideda numatytą scraperį ir operaciją", async () => {
        const emit = vi.fn();
        const fetch = createScraperFetch("cvpp", {
            operation: "notice",
            fetchImpl: async () => new Response(null, { status: 204 }),
        });
        // Viešas factory naudoja runtime emitterį, todėl defaultMeta tikrinamas
        // per žemesnio lygio factory, kur emitterį galima izoliuoti.
        expect(typeof fetch).toBe("function");
        expect(emit).not.toHaveBeenCalled();
    });

    it("perduoda JSON body ir užbaigus įrašo statusą, baitus bei kontekstą", async () => {
        const emit = vi.fn();
        const body = JSON.stringify({ ok: true });
        const fetchImpl = vi.fn(async () => new Response(body, {
            status: 200,
            headers: { "Content-Length": String(Buffer.byteLength(body)) },
        }));
        const fetch = createScrapeFetch(fetchImpl, { enabled: true, emit });

        const response = await fetch("https://api.example.lt/items?page=1", undefined, {
            scraper: "example",
            operation: "list",
            item: 7,
        });

        expect(await response.json()).toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(emit).toHaveBeenCalledOnce();
        expect(emit.mock.calls[0][0]).toMatchObject({
            scraper: "example",
            operation: "list",
            item: "7",
            status: 200,
            ok: true,
            bytes: Buffer.byteLength(body),
            contentLength: Buffer.byteLength(body),
            host: "api.example.lt",
            domain: "example.lt",
            path: "/items?page=1",
        });
    });

    it("transporto klaidai įrašo null statusą ir permeta tą pačią klaidą", async () => {
        const emit = vi.fn();
        const error = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
        const fetch = createScrapeFetch(vi.fn(async () => { throw error; }), { enabled: true, emit });

        await expect(fetch("https://example.lt/x", undefined, {
            scraper: "example",
            operation: "one",
        })).rejects.toBe(error);
        expect(emit.mock.calls[0][0]).toMatchObject({
            status: null,
            ok: false,
            bytes: 0,
            errorName: "TypeError",
            errorCode: "ECONNRESET",
        });
    });

    it("palaiko node-fetch Response ir neskaito body antrą kartą", async () => {
        const emit = vi.fn();
        const chunks = [Buffer.alloc(1024), Buffer.alloc(2048)];
        const fetch = createScrapeFetch(
            vi.fn(async () => new NodeFetchResponse(Readable.from(chunks), {
                status: 503,
                headers: { "Content-Type": "application/octet-stream" },
            })),
            { enabled: true, emit },
        );

        const response = await fetch("https://api.example.lt/file", undefined, {
            scraper: "example",
            operation: "file",
        });
        expect((await response.arrayBuffer()).byteLength).toBe(3072);
        expect(emit).toHaveBeenCalledOnce();
        expect(emit.mock.calls[0][0]).toMatchObject({ status: 503, ok: false, bytes: 3072 });
    });

    it("išjungtas grąžina originalų Response be apvalkalo", async () => {
        const original = new Response("x");
        const emit = vi.fn();
        const fetch = createScrapeFetch(vi.fn(async () => original), { enabled: false, emit });
        expect(await fetch("https://example.lt")).toBe(original);
        expect(emit).not.toHaveBeenCalled();
    });
});
