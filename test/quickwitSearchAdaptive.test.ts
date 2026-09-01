import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `search()` must keep fetching until it has `minHits` live hits.
 *
 * The interesting case is an index whose tombstones are clustered rather than
 * spread evenly: the global dead ratio says "fetch 63 and you'll get 50 live",
 * but a sort can put a wall of stale duplicates on top, so the first fetch
 * returns almost nothing usable. The loop must then re-size from what it
 * actually observed instead of stepping forward by the same too-small amount.
 */

/** Builds a fake index of `total` docs where `isLive(i)` decides tombstones. */
async function loadSearch(index: { total: number; isLive: (i: number) => boolean }) {
  vi.resetModules();

  const requests: { max_hits: number; start_offset: number }[] = [];

  const fetchMock = vi.fn(async (_url: string, options?: any) => {
    const body = JSON.parse(options.body);
    requests.push({ max_hits: body.max_hits, start_offset: body.start_offset });
    const from = body.start_offset;
    const to = Math.min(index.total, from + body.max_hits);
    const hits = [];
    for (let i = from; i < to; i++) hits.push({ quickwitId: String(i) });
    const payload = { hits, num_hits: index.total, elapsed_time_micros: 1 };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  });

  const deadCount = Array.from({ length: index.total }, (_, i) => i).filter((i) => !index.isLive(i)).length;

  vi.doMock("../postgres/postgres.js", () => ({
    postgres: {
      query: vi.fn(async (sql: string, params?: any[]) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized.startsWith('SELECT SUM("gyvosEilutes")')) {
          return { rows: [{ gyva: index.total - deadCount, mirusi: deadCount }] };
        }
        if (normalized.startsWith('SELECT id FROM "quickwit"."lenteles"')) {
          return { rows: [{ id: 7 }] };
        }
        if (normalized.startsWith('SELECT "quickwitIdInt"')) {
          const ids: string[] = params?.[1] ?? [];
          return { rows: ids.filter((id) => index.isLive(Number(id))).map((id) => ({ quickwitIdInt: id })) };
        }
        return { rows: [] };
      }),
    },
  }));
  vi.doMock("../utils/config.js", () => ({
    default: { quickwitUrl: "http://quickwit.test", quickwitTimeoutMs: 5000 },
  }));
  vi.doMock("../utils/log.js", () => ({ Logger: class { log() {} } }));
  vi.stubGlobal("fetch", fetchMock);

  const mod = await import("../quickwit/quickwit.js");
  return { search: mod.search, requests };
}

describe("quickwit search — adaptive re-fetch", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("collects minHits when tombstones are spread evenly", async () => {
    // 5 % dead, scattered — the first over-fetch already covers it.
    const { search, requests } = await loadSearch({
      total: 10_000,
      isLive: (i) => i % 20 !== 0,
    });
    const result = await search("juridiniai", { query: "*" }, { minHits: 50 });

    expect(result.hits.length).toBeGreaterThanOrEqual(50);
    expect(requests).toHaveLength(1);
    expect(result.scanBudgetSpent).toBe(false);
  });

  it("clears a clustered wall of tombstones instead of returning a short page", async () => {
    // The first 2 000 docs are dead apart from a couple — exactly the juridiniai
    // "sorted by darbuotojai" shape that produced 19 rows for a 50-row page.
    const { search, requests } = await loadSearch({
      total: 50_000,
      isLive: (i) => (i < 2_000 ? i % 1_000 === 0 : true),
    });
    const result = await search("juridiniai", { query: "*" }, { minHits: 50 });

    expect(result.hits.length).toBeGreaterThanOrEqual(50);
    expect(result.scanBudgetSpent).toBe(false);
    // Must widen rather than step: a fixed stride would need dozens of requests.
    expect(requests.length).toBeLessThanOrEqual(4);
    expect(requests[1].max_hits).toBeGreaterThan(requests[0].max_hits);
  });

  it("stops at the scan budget and says so instead of looping", async () => {
    // Everything past the first live doc is dead — unsatisfiable by design.
    const { search } = await loadSearch({
      total: 100_000,
      isLive: (i) => i === 0,
    });
    const result = await search("juridiniai", { query: "*" }, { minHits: 50, maxScan: 5_000 });

    expect(result.hits).toHaveLength(1);
    expect(result.scanBudgetSpent).toBe(true);
    expect(result.scanned).toBeLessThanOrEqual(5_000);
  });

  it("reports exhaustion when the index runs out before minHits", async () => {
    const { search } = await loadSearch({ total: 30, isLive: () => true });
    const result = await search("juridiniai", { query: "*" }, { minHits: 50 });

    expect(result.hits).toHaveLength(30);
    expect(result.rawExhausted).toBe(true);
    expect(result.scanBudgetSpent).toBe(false);
  });

  it("reports an exact total when the whole result set was scanned", async () => {
    // 8 raw atitikmenys, iš jų gyvas vienas: anksčiau iš dead ratio išeidavo
    // „Rodomas 1 iš apie 8 rezultatų“.
    const { search } = await loadSearch({ total: 8, isLive: (i) => i === 3 });
    const result = await search("juridiniai", { query: "*" }, { minHits: 50 });

    expect(result.hits).toHaveLength(1);
    expect(result.rawExhausted).toBe(true);
    expect(result.hitsExact).toBe(true);
    expect(result.numHitsEstimate).toBe(1);
  });

  it("keeps the estimate approximate when the scan stopped early", async () => {
    const { search } = await loadSearch({
      total: 100_000,
      isLive: (i) => i % 2 === 0,
    });
    const result = await search("juridiniai", { query: "*" }, { minHits: 50 });

    expect(result.hitsExact).toBe(false);
    expect(result.numHitsEstimate).toBeGreaterThan(result.hits.length);
  });

  it("never asks Quickwit for more than its max_hits / start_offset ceilings", async () => {
    const { search, requests } = await loadSearch({
      total: 500_000,
      isLive: (i) => i > 400_000,
    });
    await search("juridiniai", { query: "*" }, { minHits: 50 });

    for (const request of requests) {
      expect(request.max_hits).toBeLessThanOrEqual(10_000);
      expect(request.start_offset).toBeLessThanOrEqual(10_000);
    }
  });
});
