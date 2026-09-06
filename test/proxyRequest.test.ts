import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows: any[] = [];

vi.mock("../postgres/postgres.js", () => ({
    postgres: { query: vi.fn(async () => ({ rows })) },
}));

// @ts-ignore JS modulis be tipų
const { proxyRequest } = await import("../modules/scrapeProxies/proxyRequest.js");
// @ts-ignore JS modulis be tipų
const { resetProxyCache } = await import("../modules/scrapeProxies/getProxyBySite.js");
// @ts-ignore JS modulis be tipų
const { resetScrapeOrigins, scrapeTargetUrl } = await import("../utils/scrapeTarget.js");
const { postgres } = await import("../postgres/postgres.js");

const URL_ = "https://eviesiejipirkimai.lt/download.php?dok_id=5&file_id=7";

beforeEach(() => {
    rows.length = 0;
    resetProxyCache();
});

afterEach(() => {
    resetScrapeOrigins();
    vi.mocked(postgres.query).mockClear();
});

describe("proxyRequest", () => {
    it("be proxy grąžina tą patį URL", async () => {
        const req = await proxyRequest("eviesiejipirkimai", URL_);
        expect(req).toMatchObject({ url: URL_, proxy: null });
        expect(req.init).toEqual({});
        expect(req.meta).toEqual({});
    });

    it("httpReverse pakeičia origin, o logui užregistruoja atgalinį kelią", async () => {
        rows.push({ type: "httpReverse", url: "http://10.1.10.2:9203", site: "eviesiejipirkimai" });
        const req = await proxyRequest("eviesiejipirkimai", URL_);
        expect(req.url).toBe("http://10.1.10.2:9203/download.php?dok_id=5&file_id=7");
        expect(req.init).toEqual({});
        expect(scrapeTargetUrl(req.url)).toBe(URL_);
    });

    it("išlaiko proxy kelio prefiksą ir jį pašalina rašydamas į logą", async () => {
        rows.push({ type: "httpReverse", url: "http://10.1.10.2:6969/vpmis", site: "eviesiejipirkimai" });
        const puslapis = "https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys";
        const req = await proxyRequest("eviesiejipirkimai", puslapis);
        expect(req.url).toBe("http://10.1.10.2:6969/vpmis/index.php?option=com_vptpublic&task=sutartys");
        expect(scrapeTargetUrl(req.url)).toBe(puslapis);
    });

    it("socks5 URL nekeičia, o priduria agentą ir node-fetch", async () => {
        rows.push({
            type: "socks5",
            url: "socks5://vartotojas:slaptas@10.1.10.7:1080",
            site: "eviesiejipirkimai",
        });
        const req: any = await proxyRequest("eviesiejipirkimai", URL_);
        expect(req.url).toBe(URL_);
        expect(req.init.agent).toBeDefined();
        expect(typeof req.meta.fetchImpl).toBe("function");
        expect(req.init.agent.proxy).toMatchObject({
            host: "10.1.10.7",
            port: 1080,
            type: 5,
            userId: "vartotojas",
            password: "slaptas",
        });
    });

    it("useProxy: false proxy net neieško", async () => {
        rows.push({ type: "httpReverse", url: "http://10.1.10.2:9203", site: "eviesiejipirkimai" });
        const req = await proxyRequest("eviesiejipirkimai", URL_, { useProxy: false });
        expect(req).toMatchObject({ url: URL_, proxy: null });
        expect(postgres.query).not.toHaveBeenCalled();
    });

    it("ieško abiejų transportų vienu SELECT'u", async () => {
        await proxyRequest("eviesiejipirkimai", URL_);
        const [sql, params] = vi.mocked(postgres.query).mock.calls[0] as any[];
        expect(sql).toContain("type = ANY($2)");
        expect(params).toEqual(["eviesiejipirkimai", ["httpReverse", "socks5"]]);
    });
});
