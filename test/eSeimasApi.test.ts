import { afterEach, describe, expect, it, vi } from "vitest";
import { createESeimasApi, ESeimasNotFoundError } from "../modules/eSeimas/eSeimasApi.js";

afterEach(() => vi.unstubAllGlobals());

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("e-Seimas API client", () => {
  it("uses the separate e-Seimas routes and passes the shared bearer key", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ source: "e-seimas", items: [] }))
      .mockImplementation(() => Promise.resolve(json({ id: "ABC" })));
    vi.stubGlobal("fetch", fetchMock);
    const api = createESeimasApi({ baseUrl: "http://adapter.test/", apiKey: "key", maxInflight: 1 });

    await api.searchLegalActs({ from: "2026-08-01", to: "2026-08-01", page: 2 });
    await api.getLegalAct("TAD", "ABC");
    await api.getConsolidatedEdition("TAD", "ABC");
    await api.getEditionList("TAD", "ABC");
    await api.getHistoricalConsolidatedEdition("TAD", "ABC", "edition-1");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      "http://adapter.test/v1/seimas/legal-acts?from=2026-08-01&to=2026-08-01&page=2",
      "http://adapter.test/v1/seimas/legal-acts/TAD/ABC",
      "http://adapter.test/v1/seimas/legal-acts/TAD/ABC/asr",
      "http://adapter.test/v1/seimas/legal-acts/TAD/ABC/editions",
      "http://adapter.test/v1/seimas/legal-acts/TAD/ABC/edition-1",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers.Authorization).toBe("Bearer key");
    }
  });

  it("maps adapter 404 to the typed not-found error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "no_current_consolidated_edition" }, 404)));
    const api = createESeimasApi({ baseUrl: "http://adapter.test", maxInflight: 1 });
    await expect(api.getConsolidatedEdition("TAD", "ABC")).rejects.toBeInstanceOf(ESeimasNotFoundError);
  });
});
