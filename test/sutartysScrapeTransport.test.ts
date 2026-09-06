import { beforeEach, describe, expect, it, vi } from "vitest";

/*
Proxy nesėkmė neturi virsti šaltinio gedimu: 502 kūnas nėra puslapis, tad jo
parsinimas duotų "nerasta lentelė" ir CVP IS gedimų žurnale atsirastų gedimas,
kurio nebuvo (tie įrašai matomi /status intervaluose).
*/

const atsakymas = { value: new Response("") };
const gedimai: string[] = [];
const parseCalls = { count: 0 };

vi.mock("../utils/scrapeFetch.js", () => ({
    createScraperFetch: () => async () => atsakymas.value,
}));
vi.mock("../modules/scrapeProxies/proxyRequest.js", () => ({
    proxyRequest: async (_site: string, url: string) => ({ url, init: {}, meta: {}, proxy: null }),
}));
vi.mock("../postgres/postgres.js", () => ({
    postgres: {
        query: vi.fn(async (_sql: string, params: any[]) => {
            gedimai.push(params?.[0]);
            return { rows: [] };
        }),
    },
}));
vi.mock("../modules/sutartys/parsePageInWorker.js", () => ({
    parseSutartysHtmlInWorker: async () => {
        parseCalls.count += 1;
        return { status: "missing-table", sutartys: [], total: null };
    },
}));
vi.mock("../modules/sutartys/import.js", () => ({ cvpIsImportArray: async () => {} }));
vi.mock("../utils/log.js", () => ({ log: () => {}, Logger: class { log() {} } }));

// @ts-ignore JS modulis be tipų
const { cvpIsScrapePageContent } = await import("../modules/sutartys/scrape.js");

const PUSLAPIS = "https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys";

beforeEach(() => {
    gedimai.length = 0;
    parseCalls.count = 0;
});

describe("cvpIsScrapePageContent transporto klaidos", () => {
    it("proxy 502 su X-Proxy-Error nei parsinamas, nei rašomas į gedimus", async () => {
        atsakymas.value = new Response("Proxy klaida: connect ECONNREFUSED 127.0.0.1:1080\n", {
            status: 502,
            headers: { "x-proxy-error": "ECONNREFUSED" },
        });

        await expect(cvpIsScrapePageContent(PUSLAPIS)).rejects.toThrow(/Proxy nepasiekė šaltinio \(ECONNREFUSED\)/);
        expect(parseCalls.count).toBe(0);
        expect(gedimai).toEqual([]);
    });

    it("proxy 404 dėl nežinomo maršruto irgi nėra šaltinio gedimas", async () => {
        atsakymas.value = new Response("Nežinomas kelias: /x\n", {
            status: 404,
            headers: { "x-proxy-error": "no-route" },
        });

        await expect(cvpIsScrapePageContent(PUSLAPIS)).rejects.toThrow(/no-route/);
        expect(gedimai).toEqual([]);
    });

    it("šaltinio 500 fiksuojamas kaip statuso gedimas, o ne kaip nerasta lentelė", async () => {
        atsakymas.value = new Response("<html>vidinė klaida</html>", { status: 500 });

        await expect(cvpIsScrapePageContent(PUSLAPIS)).rejects.toThrow(/statusas: 500/);
        expect(parseCalls.count).toBe(0);
        expect(gedimai).toEqual(["statusas500"]);
    });

    it("tikras 200 be lentelės lieka nerasta lentelė", async () => {
        atsakymas.value = new Response("<html>be lentelės</html>", { status: 200 });

        await expect(cvpIsScrapePageContent(PUSLAPIS)).rejects.toThrow("Nerasta lentelė");
        expect(parseCalls.count).toBe(1);
        expect(gedimai).toEqual(["nerastaLentele"]);
    });
});
